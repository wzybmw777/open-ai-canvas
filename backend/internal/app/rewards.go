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

type RewardTaskView struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	AmountMicrocredits int64  `json:"amountMicrocredits"`
}

type GenerationTaskRewardView struct {
	ID      string `json:"id"`
	Prompt  string `json:"prompt"`
	Claimed bool   `json:"claimed"`
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
	return []RewardTaskView{{ID: "successful-generation", Name: "完成创作任务", Description: "每个经服务端执行并成功完成的生成任务可领取一次积分", AmountMicrocredits: taskRewardMicrocredits}}
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
	candidates, err := s.repo.CompletedTaskRewardCandidates(user.ID, 50)
	if err != nil {
		return nil, err
	}
	tasks := make([]GenerationTaskRewardView, 0, len(candidates))
	for _, candidate := range candidates {
		if taskRewardEligible(candidate.Task) {
			tasks = append(tasks, GenerationTaskRewardView{ID: candidate.ID, Prompt: truncateRunes(candidate.Prompt, 500), Claimed: candidate.RewardClaimed})
		}
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
	if !taskRewardEligible(*task) {
		return nil, false, BadAuthRequest("仅服务端执行并成功完成的生成任务可领取奖励")
	}
	return s.repo.ClaimRewardOnce(userID, model.CreditLedgerRewardTask, taskRewardMicrocredits, task.ID, "", "完成创作任务奖励")
}

func taskRewardEligible(task model.Task) bool {
	// 客户端可自行完成文本回放；succeeded 本身不能证明执行过模型生成。
	if task.Status != model.TaskStatusSucceeded || task.Attempts <= 0 || task.StartedAt == nil || task.StartedAt.IsZero() || task.CompletedAt == nil || task.CompletedAt.IsZero() {
		return false
	}
	switch task.Type {
	case "canvas_text", "canvas_image", "canvas_video", "canvas_audio":
	default:
		if !strings.HasPrefix(task.Type, "video_") || strings.TrimPrefix(task.Type, "video_") == "" {
			return false
		}
	}
	var input, result map[string]any
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input == nil || isTextReplayTaskRequest(input) {
		return false
	}
	return json.Unmarshal([]byte(task.ResultJSON), &result) == nil && len(result) > 0
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
