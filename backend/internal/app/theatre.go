package app

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

type TheatreWorkRequest struct {
	ResourceID        string                 `json:"resourceId"`
	CoverResourceID   *string                `json:"coverResourceId"`
	Title             string                 `json:"title"`
	Description       string                 `json:"description"`
	Kind              string                 `json:"kind"`
	IsComplete        *bool                  `json:"isComplete"`
	Episodes          *[]TheatreEpisodeInput `json:"episodes"`
	ExpectedUpdatedAt *time.Time             `json:"expectedUpdatedAt"`
}

type TheatreEpisodeInput struct {
	ResourceID string `json:"resourceId"`
	Title      string `json:"title"`
}

type TheatreWorkDetail struct {
	Work     *repository.TheatreWorkRecord     `json:"work"`
	Episodes []repository.TheatreEpisodeRecord `json:"episodes"`
}

type TheatreWorkPage struct {
	Works    []repository.TheatreWorkRecord `json:"works"`
	Total    int64                          `json:"total"`
	Page     int                            `json:"page"`
	PageSize int                            `json:"pageSize"`
}

func (s *Service) requireTheatreUser(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return Unauthorized("请先登录")
	}
	user, err := s.repo.User(userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Unauthorized("请先登录")
	}
	if err != nil {
		return err
	}
	if user.Status != model.UserStatusActive {
		return Forbidden("账号不可用")
	}
	return nil
}

func (s *Service) TheatreWorks(userID, keyword string, mine bool, page, pageSize int, kind string) (TheatreWorkPage, error) {
	if err := s.requireTheatreUser(userID); err != nil {
		return TheatreWorkPage{}, err
	}
	keyword = strings.TrimSpace(keyword)
	if page < 1 || page > 1000000 || pageSize < 1 || pageSize > 48 || utf8.RuneCountInString(keyword) > 120 {
		return TheatreWorkPage{}, BadAuthRequest("剧场查询参数无效")
	}
	if kind != "" && kind != model.TheatreWorkVideo && kind != model.TheatreWorkShortDrama {
		return TheatreWorkPage{}, BadAuthRequest("作品类型无效")
	}
	ownerID := ""
	if mine {
		ownerID = userID
	}
	works, total, err := s.repo.TheatreWorks(ownerID, keyword, kind, page, pageSize)
	return TheatreWorkPage{Works: works, Total: total, Page: page, PageSize: pageSize}, err
}

func (s *Service) theatreEpisodes(userID, workID string, inputs []TheatreEpisodeInput) ([]model.TheatreEpisode, error) {
	if len(inputs) < 1 || len(inputs) > 200 {
		return nil, BadAuthRequest("短剧须包含 1–200 集视频")
	}
	ids := make([]string, 0, len(inputs))
	seen := map[string]bool{}
	episodes := make([]model.TheatreEpisode, 0, len(inputs))
	now := time.Now()
	for i, input := range inputs {
		id, title := strings.TrimSpace(input.ResourceID), strings.TrimSpace(input.Title)
		if id == "" || seen[id] {
			return nil, BadAuthRequest("每集须选择不同的已上传视频")
		}
		if utf8.RuneCountInString(title) > 120 {
			return nil, BadAuthRequest("剧集标题不能超过 120 个字符")
		}
		if title == "" {
			title = fmt.Sprintf("第%d集", i+1)
		}
		seen[id] = true
		ids = append(ids, id)
		episodes = append(episodes, model.TheatreEpisode{ID: newID(), WorkID: workID, ResourceID: id, Number: i + 1, Title: title, CreatedAt: now, UpdatedAt: now})
	}
	resources, err := s.repo.ResourcesForUserIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	if len(resources) != len(ids) {
		return nil, NotFound("剧集视频不存在或不可访问")
	}
	for _, resource := range resources {
		if resource.Status != model.ResourceStatusReady || resource.Kind != "video" || !strings.HasPrefix(resource.MimeType, "video/") {
			return nil, BadAuthRequest("每集须为已上传完成的视频")
		}
	}
	return episodes, nil
}

func theatreWriteError(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return NotFound("作品或媒体不存在或不可访问")
	case errors.Is(err, repository.ErrTheatreRevisionConflict):
		return NewAppError(409, "作品已被修改，请重新打开编辑窗口")
	case errors.Is(err, repository.ErrTheatreResourceConflict):
		return NewAppError(409, "首集视频已用于另一部作品，请选择其他视频")
	default:
		return err
	}
}

func validateTheatreMetadata(req TheatreWorkRequest) (string, string, error) {
	title, description := strings.TrimSpace(req.Title), strings.TrimSpace(req.Description)
	if title == "" || utf8.RuneCountInString(title) > 120 {
		return "", "", BadAuthRequest("作品标题须为 1–120 个字符")
	}
	if utf8.RuneCountInString(description) > 2000 {
		return "", "", BadAuthRequest("作品简介不能超过 2000 个字符")
	}
	return title, description, nil
}

func (s *Service) validateTheatreCover(userID, resourceID string) error {
	if resourceID == "" {
		return nil
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("封面不存在或不可访问")
	}
	if err != nil {
		return err
	}
	if resource.Status != model.ResourceStatusReady || resource.Kind != "image" || resource.Size <= 0 || resource.Size > 10<<20 {
		return BadAuthRequest("封面须为已上传完成且不超过 10MB 的图片")
	}
	switch resource.MimeType {
	case "image/jpeg", "image/png", "image/webp":
		return nil
	default:
		return BadAuthRequest("封面仅支持 JPG、PNG、WebP 图片")
	}
}

func (s *Service) CreateTheatreWork(userID string, req TheatreWorkRequest) (*model.TheatreWork, error) {
	if err := s.requireTheatreUser(userID); err != nil {
		return nil, err
	}
	title, description, err := validateTheatreMetadata(req)
	if err != nil {
		return nil, err
	}
	kind := req.Kind
	if kind == "" {
		kind = model.TheatreWorkVideo
	}
	if kind != model.TheatreWorkVideo && kind != model.TheatreWorkShortDrama {
		return nil, BadAuthRequest("作品类型无效")
	}
	workID := newID()
	var episodes []model.TheatreEpisode
	resourceID := strings.TrimSpace(req.ResourceID)
	if kind == model.TheatreWorkShortDrama {
		if req.Episodes == nil {
			return nil, BadAuthRequest("请先添加短剧集数")
		}
		episodes, err = s.theatreEpisodes(userID, workID, *req.Episodes)
		if err != nil {
			return nil, err
		}
		if resourceID != "" && resourceID != episodes[0].ResourceID {
			return nil, BadAuthRequest("短剧预览视频必须为第一集")
		}
		resourceID = episodes[0].ResourceID
	} else if req.Episodes != nil || (req.IsComplete != nil && *req.IsComplete) {
		return nil, BadAuthRequest("单视频作品不支持剧集或完结状态")
	}
	if resourceID == "" {
		return nil, BadAuthRequest("请先上传视频")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("视频不存在或不可访问")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady || resource.Kind != "video" || !strings.HasPrefix(resource.MimeType, "video/") {
		return nil, BadAuthRequest("只能发布已上传完成的视频")
	}
	coverID := ""
	if req.CoverResourceID != nil {
		coverID = strings.TrimSpace(*req.CoverResourceID)
	}
	if err := s.validateTheatreCover(userID, coverID); err != nil {
		return nil, err
	}
	now := time.Now()
	complete := req.IsComplete != nil && *req.IsComplete
	work := &model.TheatreWork{ID: workID, UserID: userID, Kind: kind, IsComplete: complete, ResourceID: resourceID, CoverResourceID: coverID, Title: title, Description: description, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateTheatreWork(work, episodes); err != nil {
		return nil, theatreWriteError(err)
	}
	return work, nil
}

func (s *Service) ownedTheatreWork(userID, id string) (*model.TheatreWork, error) {
	if err := s.requireTheatreUser(userID); err != nil {
		return nil, err
	}
	work, err := s.repo.TheatreWork(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("作品不存在")
	}
	if err != nil {
		return nil, err
	}
	if work.UserID != userID {
		return nil, Forbidden("只能管理自己的剧场作品")
	}
	return work, nil
}

func (s *Service) UpdateTheatreWork(userID, id string, req TheatreWorkRequest) error {
	work, err := s.ownedTheatreWork(userID, id)
	if err != nil {
		return err
	}
	if req.Kind != "" && req.Kind != work.Kind {
		return BadAuthRequest("发布后不能更改作品类型")
	}
	var episodes *[]model.TheatreEpisode
	if req.Episodes != nil {
		if work.Kind != model.TheatreWorkShortDrama {
			return BadAuthRequest("单视频作品不支持剧集")
		}
		if req.ExpectedUpdatedAt == nil {
			return BadAuthRequest("编辑剧集须提交作品版本，请重新打开编辑窗口")
		}
		validated, err := s.theatreEpisodes(userID, id, *req.Episodes)
		if err != nil {
			return err
		}
		episodes = &validated
	}
	if work.Kind != model.TheatreWorkShortDrama && req.IsComplete != nil && *req.IsComplete {
		return BadAuthRequest("单视频作品不支持完结状态")
	}
	title, description, err := validateTheatreMetadata(req)
	if err != nil {
		return err
	}
	var coverID *string
	if req.CoverResourceID != nil {
		value := strings.TrimSpace(*req.CoverResourceID)
		if err := s.validateTheatreCover(userID, value); err != nil {
			return err
		}
		coverID = &value
	}
	if err := s.repo.UpdateTheatreWork(userID, id, title, description, coverID, req.IsComplete, episodes, req.ExpectedUpdatedAt); err != nil {
		return theatreWriteError(err)
	}
	return nil
}

func (s *Service) TheatreWorkDetail(userID, id string) (TheatreWorkDetail, error) {
	if _, err := s.sharedTheatreWork(userID, id); err != nil {
		return TheatreWorkDetail{}, err
	}
	work, err := s.repo.TheatreWorkRecord(id)
	if err != nil {
		return TheatreWorkDetail{}, theatreWriteError(err)
	}
	episodes, err := s.repo.TheatreEpisodes(id)
	if err == nil && work.Kind == model.TheatreWorkShortDrama && len(episodes) == 0 {
		return TheatreWorkDetail{}, NotFound("剧集不存在或作品已下架")
	}
	return TheatreWorkDetail{Work: work, Episodes: episodes}, err
}

func (s *Service) PrepareTheatreEpisodeDelivery(userID, workID, episodeID, rangeHeader string) (*ResourceDelivery, error) {
	work, err := s.sharedTheatreWork(userID, workID)
	if err != nil {
		return nil, err
	}
	if work.Kind != model.TheatreWorkShortDrama {
		return nil, NotFound("作品不包含剧集")
	}
	episode, err := s.repo.TheatreEpisode(workID, episodeID)
	if err != nil {
		return nil, theatreWriteError(err)
	}
	return s.PrepareResourceDelivery(work.UserID, episode.ResourceID, ResourceAccessOptions{Purpose: assets.PurposeDisplay, Variant: assets.VariantPlayback}, rangeHeader)
}

func (s *Service) DeleteTheatreWork(userID, id string) error {
	if _, err := s.ownedTheatreWork(userID, id); err != nil {
		return err
	}
	// Unpublishing removes the shared entry. Referenced media stays under the existing cleanup policy.
	if err := s.repo.DeleteTheatreWork(userID, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound("作品不存在")
		}
		return err
	}
	return nil
}

func (s *Service) sharedTheatreWork(userID, id string) (*model.TheatreWork, error) {
	if err := s.requireTheatreUser(userID); err != nil {
		return nil, err
	}
	work, err := s.repo.TheatreWork(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("作品不存在或已下架")
	}
	if err != nil {
		return nil, err
	}
	owner, err := s.repo.User(work.UserID)
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && owner.Status != model.UserStatusActive) {
		return nil, NotFound("作品不可访问")
	}
	if err != nil {
		return nil, err
	}
	return work, nil
}

func (s *Service) PrepareTheatreDelivery(userID, id, rangeHeader string) (*ResourceDelivery, error) {
	work, err := s.sharedTheatreWork(userID, id)
	if err != nil {
		return nil, err
	}
	// Sharing is scoped to this published work; private resource endpoints keep their ownership checks.
	return s.PrepareResourceDelivery(work.UserID, work.ResourceID, ResourceAccessOptions{Purpose: assets.PurposeDisplay, Variant: assets.VariantPlayback}, rangeHeader)
}

func (s *Service) PrepareTheatreCoverDelivery(userID, id, rangeHeader string) (*ResourceDelivery, error) {
	work, err := s.sharedTheatreWork(userID, id)
	if err != nil {
		return nil, err
	}
	if work.CoverResourceID == "" {
		return nil, NotFound("作品未设置封面")
	}
	return s.PrepareResourceDelivery(work.UserID, work.CoverResourceID, ResourceAccessOptions{Purpose: assets.PurposeDisplay, Variant: assets.VariantOriginal}, rangeHeader)
}
