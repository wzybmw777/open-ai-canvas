package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/channelsync"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type ChannelSyncRequest struct {
	Enabled    bool   `json:"enabled"`
	Script     string `json:"script"`
	SourceURL  string `json:"sourceUrl"`
	GroupID    int    `json:"groupId"`
	SyncPrices bool   `json:"syncPrices"`
	ImportNew  bool   `json:"importNew"`
}

type ChannelSyncView struct {
	ChannelID   string                `json:"channelId"`
	ChannelName string                `json:"channelName"`
	Configured  bool                  `json:"configured"`
	Job         model.ChannelSyncJob  `json:"job"`
	LastRun     *model.ChannelSyncRun `json:"lastRun"`
}

func (s *Service) AdminChannelSyncJobs(actor *model.User) ([]ChannelSyncView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	views := make([]ChannelSyncView, 0, len(channels))
	for _, channel := range channels {
		view := ChannelSyncView{ChannelID: channel.ID, ChannelName: channel.Name, Job: model.ChannelSyncJob{ChannelID: channel.ID, Script: "authorized-models"}}
		job, err := s.repo.ChannelSyncJob(channel.ID)
		if err == nil {
			view.Job = *job
			view.Configured = true
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		runs, err := s.repo.ChannelSyncRuns(channel.ID, 1)
		if err != nil {
			return nil, err
		}
		if len(runs) > 0 {
			view.LastRun = &runs[0]
		}
		views = append(views, view)
	}
	return views, nil
}

func (s *Service) SaveAdminChannelSync(actor *model.User, id string, input ChannelSyncRequest) (*model.ChannelSyncJob, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.AdminSystemChannel(id); err != nil {
		return nil, err
	}
	job := &model.ChannelSyncJob{ChannelID: id, Enabled: input.Enabled, Script: input.Script, SourceURL: strings.TrimSpace(input.SourceURL), GroupID: input.GroupID, SyncPrices: input.SyncPrices, ImportNew: input.ImportNew}
	switch job.Script {
	case "authorized-models":
		job.SourceURL = ""
		job.GroupID = 0
		if job.SyncPrices {
			return nil, BadAuthRequest("授权目录不包含价格，请选择模型广场同步脚本")
		}
	case "model-plaza":
		u, err := ValidateOutboundURL(job.SourceURL)
		if err != nil {
			return nil, err
		}
		if u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || job.GroupID <= 0 {
			return nil, BadAuthRequest("请填写 HTTPS 公开价格目录地址和有效分组 ID，地址不能包含凭证或查询参数")
		}
	default:
		return nil, BadAuthRequest("请选择已安装的渠道同步脚本")
	}
	if old, err := s.repo.ChannelSyncJob(id); err == nil && old.Enabled && job.Enabled {
		job.NextRunAt = old.NextRunAt
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if job.Enabled && job.NextRunAt == nil {
		next := channelsync.NextMidnight(time.Now())
		job.NextRunAt = &next
	}
	if !job.Enabled {
		job.NextRunAt = nil
	}
	if err := s.repo.SaveChannelSyncJob(job); err != nil {
		return nil, channelSyncAppError(err)
	}
	if err := s.appendAdminAudit(actor, "channel_sync.save", "model_channel", id, "更新上游同步配置", map[string]any{"enabled": job.Enabled, "script": job.Script}); err != nil {
		return nil, err
	}
	return job, nil
}

func (s *Service) AdminChannelSyncRuns(actor *model.User, id string) ([]model.ChannelSyncRun, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.AdminSystemChannel(id); err != nil {
		return nil, err
	}
	return s.repo.ChannelSyncRuns(id, 30)
}

func (s *Service) RunAdminChannelSync(actor *model.User, id string) (*model.ChannelSyncRun, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if s.IsDraining() {
		return nil, NewAppError(http.StatusServiceUnavailable, "服务正在更新，请稍后同步")
	}
	if _, err := s.repo.AdminSystemChannel(id); err != nil {
		return nil, err
	}
	job, err := s.repo.ChannelSyncJob(id)
	if err != nil {
		return nil, BadAuthRequest("请先保存渠道同步配置")
	}
	run, err := s.claimChannelSync(*job, "manual", actor.ID)
	if err != nil {
		return nil, channelSyncAppError(err)
	}
	if !s.runWorkerLoop(func(ctx context.Context) { s.executeChannelSync(ctx, *job, *run) }) {
		finished := time.Now()
		run.Status = "failed"
		run.Summary = "服务正在更新，本次未执行同步"
		run.FinishedAt = &finished
		if err := s.repo.FinishChannelSync(run, nil, nil, nil); err != nil {
			return nil, err
		}
		return nil, NewAppError(http.StatusServiceUnavailable, run.Summary)
	}
	return run, nil
}

func channelSyncAppError(err error) error {
	if errors.Is(err, repository.ErrChannelSyncBusy) {
		return NewAppError(http.StatusConflict, err.Error())
	}
	return err
}

func (s *Service) claimChannelSync(job model.ChannelSyncJob, trigger, actorID string) (*model.ChannelSyncRun, error) {
	run := &model.ChannelSyncRun{ID: newID(), ChannelID: job.ChannelID, Trigger: trigger, ActorID: actorID, Status: "running", StartedAt: time.Now()}
	err := s.repo.ClaimChannelSync(job, run, channelsync.NextMidnight(run.StartedAt))
	return run, err
}

func (s *Service) startChannelSyncWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			if err := s.repo.RecoverExpiredChannelSync(time.Now()); err != nil {
				slog.Warn("channel sync lease recovery failed", "errorType", fmt.Sprintf("%T", err))
			}
			jobs, err := s.repo.DueChannelSyncJobs(time.Now())
			if err != nil {
				slog.Warn("channel sync schedule query failed", "errorType", fmt.Sprintf("%T", err))
			}
			for _, job := range jobs {
				if ctx.Err() != nil {
					return
				}
				run, err := s.claimChannelSync(job, "scheduled", "")
				if err != nil {
					continue
				}
				if !s.runWorkerLoop(func(ctx context.Context) { s.executeChannelSync(ctx, job, *run) }) {
					finished := time.Now()
					run.Status = "failed"
					run.Summary = "服务停止，本次未执行同步"
					run.FinishedAt = &finished
					_ = s.repo.FinishChannelSync(run, nil, nil, nil)
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

func (s *Service) executeChannelSync(parent context.Context, job model.ChannelSyncJob, run model.ChannelSyncRun) {
	ctx, cancel := context.WithTimeout(parent, 3*time.Minute)
	defer cancel()
	channel, changed, added, summary, err := s.prepareChannelSync(ctx, job)
	finished := time.Now()
	run.FinishedAt = &finished
	run.Status = "success"
	run.Summary = summary
	if err == nil {
		err = s.repo.FinishChannelSync(&run, channel, changed, added)
	}
	if err != nil {
		run.Status = "failed"
		run.Summary = safeChannelSyncError(err)
		if finishErr := s.repo.FinishChannelSync(&run, nil, nil, nil); finishErr != nil {
			slog.Warn("channel sync result save failed", "channelId", job.ChannelID, "errorType", fmt.Sprintf("%T", finishErr))
		}
		return
	}
	s.invalidateRouteCatalog()
}

func safeChannelSyncError(err error) string {
	var appErr *AppError
	if errors.As(err, &appErr) {
		return truncateRunes(appErr.Message, 1000)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "上游同步超时，本次未提交变更"
	}
	if errors.Is(err, context.Canceled) {
		return "同步已中止，本次未提交变更"
	}
	if errors.Is(err, repository.ErrChannelModelPriceConflict) || errors.Is(err, repository.ErrChannelSyncBusy) {
		return "本地配置或执行租约已变化，本次未提交变更"
	}
	// Provider errors may embed URLs or credentials; unknown errors are never persisted verbatim.
	return "上游同步失败，请检查渠道授权、目录格式和服务器网络"
}

func (s *Service) prepareChannelSync(ctx context.Context, job model.ChannelSyncJob) (*model.ModelChannel, []model.ChannelModel, []model.ChannelModel, string, error) {
	if job.Script != "model-plaza" && job.Script != "authorized-models" {
		return nil, nil, nil, "", BadAuthRequest("同步脚本不存在，请重新配置")
	}
	channel, err := s.adminSystemChannel(job.ChannelID)
	if err != nil {
		return nil, nil, nil, "", err
	}
	if !channel.Enabled {
		return nil, nil, nil, "", BadAuthRequest("渠道已停用，本次不执行同步")
	}
	if strings.TrimSpace(channel.APIKey) == "" {
		return nil, nil, nil, "", BadAuthRequest("渠道尚未配置授权密钥")
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return nil, nil, nil, "", err
	}
	// The internal authorization check uses the saved channel credentials, not a synthetic admin.
	target := apiURL(channel.BaseURL, "/models")
	if channel.APIFormat != "openai" && channel.APIFormat != "" {
		return nil, nil, nil, "", BadAuthRequest("此同步脚本需要 OpenAI 格式的授权目录")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, nil, nil, "", err
	}
	request.Header.Set("Authorization", "Bearer "+channel.APIKey)
	ApplyOutboundHeaders(request, headers)
	var authorized channelModelsPayload
	if err := s.readChannelSyncJSON(request, channel.ProxyURL, &authorized); err != nil {
		return nil, nil, nil, "", err
	}
	if authorized.Error != nil || authorized.Code != nil && *authorized.Code != 0 {
		return nil, nil, nil, "", BadAuthRequest("上游授权目录返回失败")
	}
	keys := make([]string, 0, len(authorized.Data))
	for _, item := range authorized.Data {
		keys = append(keys, firstNonEmpty(item.ID, item.Name))
	}
	var group *channelsync.Group
	if job.Script == "model-plaza" {
		request, err = http.NewRequestWithContext(ctx, http.MethodGet, job.SourceURL, nil)
		if err != nil {
			return nil, nil, nil, "", err
		}
		request.Header.Set("User-Agent", "Mozilla/5.0 Yingce-Channel-Sync")
		var catalog channelsync.Catalog
		if err := s.readChannelSyncJSON(request, channel.ProxyURL, &catalog); err != nil {
			return nil, nil, nil, "", err
		}
		group, err = channelsync.SelectGroup(catalog, job.GroupID)
		if err != nil {
			return nil, nil, nil, "", BadAuthRequest(err.Error())
		}
	}
	existing, err := s.repo.ChannelModels(job.ChannelID, true)
	if err != nil {
		return nil, nil, nil, "", err
	}
	plan, err := channelsync.Build(existing, keys, retiredChannelModelKeys(channel.RetiredModelsJSON), group, job.SyncPrices, job.ImportNew)
	if err != nil {
		return nil, nil, nil, "", BadAuthRequest(err.Error())
	}
	added := make([]model.ChannelModel, 0, len(plan.NewKeys))
	for _, key := range plan.NewKeys {
		id, err := s.repo.NextPrefixedID("MODEL")
		if err != nil {
			return nil, nil, nil, "", err
		}
		added = append(added, model.ChannelModel{ID: id, ChannelID: job.ChannelID, ModelKey: key, ProviderModelKey: key, DisplayName: key, Enabled: false, BillingMode: "fixed_request", PriceVersion: 1})
	}
	summary, _ := json.Marshal(plan.Summary)
	return channel, plan.Models, added, string(summary), nil
}

func (s *Service) readChannelSyncJSON(request *http.Request, proxy string, target any) error {
	u, err := ValidateOutboundURL(request.URL.String())
	if err != nil {
		return err
	}
	response, err := s.OutboundHTTPClientForChannel(45*time.Second, u, proxy).Do(request)
	if err != nil {
		return NewAppError(http.StatusBadGateway, "连接上游失败，请检查服务器网络与渠道代理")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return NewAppError(http.StatusBadGateway, fmt.Sprintf("上游返回 HTTP %d，请检查授权与同步地址", response.StatusCode))
	}
	const maxSize = 8 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, maxSize+1))
	if err != nil || len(data) > maxSize {
		return NewAppError(http.StatusBadGateway, "上游目录读取失败或超过大小限制")
	}
	if err := json.Unmarshal(data, target); err != nil {
		return NewAppError(http.StatusBadGateway, "上游目录不是有效 JSON")
	}
	return nil
}
