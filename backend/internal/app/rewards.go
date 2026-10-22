package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	taskRewardMicrocredits  int64 = CreditScale
	shareRewardMicrocredits int64 = 2 * CreditScale
)

type generationRewardCategory string

const (
	generationRewardImage  generationRewardCategory = "image"
	generationRewardVideo  generationRewardCategory = "video"
	generationRewardText   generationRewardCategory = "text"
	generationRewardCanvas generationRewardCategory = "canvas"
)

type RewardTaskView struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	AmountMicrocredits int64  `json:"amountMicrocredits"`
}

type GenerationTaskRewardView struct {
	ID       string                   `json:"id"`
	Prompt   string                   `json:"prompt"`
	Category generationRewardCategory `json:"category"`
	Claimed  bool                     `json:"claimed"`
}

type RewardsSummary struct {
	Account                 model.CreditAccount        `json:"account"`
	Membership              model.Membership           `json:"membership"`
	Tasks                   []RewardTaskView           `json:"tasks"`
	GenerationTasks         []GenerationTaskRewardView `json:"generationTasks"`
	ShareRewardMicrocredits int64                      `json:"shareRewardMicrocredits"`
	ShareClaimedToday       bool                       `json:"shareClaimedToday"`
}

func rewardTaskCatalog() []RewardTaskView {
	return []RewardTaskView{
		{ID: "generation-image", Name: "完成图片生成", Description: "使用图片生成工具成功生成一次图片，可领取 1 积分", AmountMicrocredits: taskRewardMicrocredits},
		{ID: "generation-video", Name: "完成视频生成", Description: "使用视频生成工具成功生成一次视频，可领取 1 积分", AmountMicrocredits: taskRewardMicrocredits},
		{ID: "generation-text", Name: "完成文本生成", Description: "使用文本生成工具成功生成一次文本，可领取 1 积分", AmountMicrocredits: taskRewardMicrocredits},
		{ID: "generation-canvas", Name: "完成画布生成", Description: "在画布中成功完成一次生成，可领取 1 积分", AmountMicrocredits: taskRewardMicrocredits},
	}
}

func rewardPeriodKey(now time.Time) string {
	return now.UTC().Format("2006-01-02")
}

func (s *Service) Rewards(user *model.User) (*RewardsSummary, error) {
	if user == nil || strings.TrimSpace(user.ID) == "" {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	account, err := s.repo.CreditAccount(user.ID)
	if err != nil {
		return nil, err
	}
	membership, err := s.repo.MembershipForUser(user.ID)
	if err != nil {
		return nil, err
	}
	claimed, err := s.repo.RewardClaimExists(user.ID, model.CreditLedgerRewardShare, rewardPeriodKey(time.Now()))
	if err != nil {
		return nil, err
	}
	candidates, err := s.repo.CompletedTaskRewardCandidates(user.ID, 100)
	if err != nil {
		return nil, err
	}
	tasks := make([]GenerationTaskRewardView, 0, len(candidates))
	seenCategories := make(map[generationRewardCategory]bool, 4)
	for _, candidate := range candidates {
		category, eligible := taskRewardCategory(candidate.Task)
		if !eligible || seenCategories[category] {
			continue
		}
		claimed := candidate.RewardClaimed
		if !claimed {
			claimed, err = s.repo.RewardClaimTargetExists(user.ID, model.CreditLedgerRewardTask, generationRewardTarget(category))
			if err != nil {
				return nil, err
			}
		}
		seenCategories[category] = true
		tasks = append(tasks, GenerationTaskRewardView{ID: candidate.ID, Prompt: truncateRunes(candidate.Prompt, 500), Category: category, Claimed: claimed})
	}
	return &RewardsSummary{Account: *account, Membership: *membership, Tasks: rewardTaskCatalog(), GenerationTasks: tasks, ShareRewardMicrocredits: shareRewardMicrocredits, ShareClaimedToday: claimed}, nil
}

func (s *Service) ClaimTaskReward(userID, taskID string) (*model.CreditAccount, bool, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, false, Unauthorized("请先登录")
	}
	if strings.TrimSpace(taskID) == "" {
		return nil, false, BadAuthRequest("任务 ID 不能为空")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, false, err
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return nil, false, err
	}
	category, eligible := taskRewardCategory(*task)
	if !eligible {
		return nil, false, BadAuthRequest("仅图片、视频、文本或画布生成成功后可领取奖励")
	}
	return s.repo.ClaimRewardOnce(userID, model.CreditLedgerRewardTask, taskRewardMicrocredits, generationRewardTarget(category), "", "完成"+generationRewardCategoryName(category)+"奖励")
}

func taskRewardEligible(task model.Task) bool {
	_, eligible := taskRewardCategory(task)
	return eligible
}

func taskRewardCategory(task model.Task) (generationRewardCategory, bool) {
	// 客户端可自行完成文本回放；succeeded 本身不能证明执行过模型生成。
	if task.Status != model.TaskStatusSucceeded || task.Attempts <= 0 || task.StartedAt == nil || task.StartedAt.IsZero() || task.CompletedAt == nil || task.CompletedAt.IsZero() {
		return "", false
	}
	var input, result map[string]any
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input == nil || isTextReplayTaskRequest(input) {
		return "", false
	}
	if json.Unmarshal([]byte(task.ResultJSON), &result) != nil || len(result) == 0 {
		return "", false
	}
	metadata, _ := input["metadata"].(map[string]any)
	if stringValue(metadata["source"]) == "workbench" && stringValue(metadata["edit"]) == "remove_watermark" {
		return "", false
	}
	mode := strings.ToLower(strings.TrimSpace(stringValue(input["mode"])))
	expectedMode, modeKnown := rewardTaskMode(task.Type)
	if !modeKnown || (mode != "" && mode != expectedMode) {
		return "", false
	}
	mode = expectedMode
	if stringValue(metadata["generationSurface"]) == string(generationRewardCanvas) {
		return generationRewardCanvas, true
	}
	source := strings.TrimSpace(stringValue(metadata["source"]))
	if source == "workflow_settings_test" || source == "skill-draft" {
		return "", false
	}
	switch source {
	case "create-page", "workbench", "tasks-page", "short-drama-chapter-storyboard":
		// These are first-party generation surfaces. Their mode is already
		// carried in the task input and is independent of the canvas project
		// used to persist the result.
	case "canvas-online-agent", "canvas-list-mode":
		if !isRewardGenerationTaskType(task.Type) {
			return "", false
		}
		return generationRewardCanvas, true
	case "":
		// Keep legacy canvas/video task records readable. New callers should
		// identify their first-party surface explicitly above.
	default:
		return "", false
	}
	if !isRewardGenerationTaskType(task.Type) {
		return "", false
	}
	switch mode {
	case "image":
		return generationRewardImage, true
	case "video":
		return generationRewardVideo, true
	case "text":
		return generationRewardText, true
	default:
		return "", false
	}
}

func isRewardGenerationTaskType(taskType string) bool {
	_, ok := rewardTaskMode(taskType)
	return ok
}

func rewardTaskMode(taskType string) (string, bool) {
	switch {
	case taskType == "text" || taskType == "canvas_text":
		return "text", true
	case taskType == "canvas_image":
		return "image", true
	case taskType == "canvas_video" || strings.HasPrefix(taskType, "video_"):
		return "video", true
	default:
		return "", false
	}
}

func generationRewardTarget(category generationRewardCategory) string {
	return "generation:" + string(category)
}

func generationRewardCategoryName(category generationRewardCategory) string {
	switch category {
	case generationRewardImage:
		return "图片生成"
	case generationRewardVideo:
		return "视频生成"
	case generationRewardText:
		return "文本生成"
	case generationRewardCanvas:
		return "画布生成"
	default:
		return "生成"
	}
}

func (s *Service) ClaimShareReward(userID, shareID string) (*model.CreditAccount, bool, error) {
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, false, err
	}
	share, err := s.repo.CanvasShareForUser(userID, shareID)
	if err != nil {
		return nil, false, err
	}
	if !share.Enabled || (share.ExpiresAt != nil && !share.ExpiresAt.After(time.Now())) {
		return nil, false, BadAuthRequest("分享已关闭或已过期")
	}
	day := rewardPeriodKey(time.Now())
	return s.repo.ClaimRewardOnce(userID, model.CreditLedgerRewardShare, shareRewardMicrocredits, "share:"+share.ID, day, "分享作品奖励")
}

func (s *Service) Membership(userID string) (*model.Membership, error) {
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	return s.repo.MembershipForUser(userID)
}

func (s *Service) RedeemMembershipCode(userID, code, redeemedIP string) (*model.CreditAccount, bool, error) {
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, false, err
	}
	if len(code) == 0 {
		return nil, false, BadAuthRequest("会员兑换码不能为空")
	}
	account, redeemed, err := s.repo.RedeemMembershipCode(userID, hashRedeemCode(code), redeemedIP)
	if errors.Is(err, repository.ErrRedeemCodeInvalid) {
		return nil, false, BadAuthRequest("会员兑换码无效或已使用")
	}
	return account, redeemed, err
}

func activeMembership(membership *model.Membership, now time.Time) bool {
	return membership != nil && !membership.ExpiresAt.IsZero() && membership.ExpiresAt.After(now)
}
