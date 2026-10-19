package app

import (
	"errors"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	taskRewardMicrocredits  int64 = 5 * CreditScale
	shareRewardMicrocredits int64 = 2 * CreditScale
)

type RewardTaskView struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	AmountMicrocredits int64  `json:"amountMicrocredits"`
}

type RewardsSummary struct {
	Account                 model.CreditAccount `json:"account"`
	Membership              model.Membership    `json:"membership"`
	Tasks                   []RewardTaskView    `json:"tasks"`
	ShareRewardMicrocredits int64               `json:"shareRewardMicrocredits"`
	ShareClaimedToday       bool                `json:"shareClaimedToday"`
}

func rewardTaskCatalog() []RewardTaskView {
	return []RewardTaskView{{ID: "successful-generation", Name: "完成创作任务", Description: "每个成功完成的生成任务都可领取一次积分", AmountMicrocredits: taskRewardMicrocredits}}
}

func rewardPeriodKey(now time.Time) string {
	return now.UTC().Format("2006-01-02")
}

func (s *Service) Rewards(user *model.User) (*RewardsSummary, error) {
	if user == nil {
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
	return &RewardsSummary{Account: *account, Membership: *membership, Tasks: rewardTaskCatalog(), ShareRewardMicrocredits: shareRewardMicrocredits, ShareClaimedToday: claimed}, nil
}

func (s *Service) ClaimTaskReward(userID, taskID string) (*model.CreditAccount, bool, error) {
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, false, err
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return nil, false, err
	}
	if task.Status != model.TaskStatusSucceeded {
		return nil, false, BadAuthRequest("任务尚未成功完成")
	}
	return s.repo.ClaimRewardOnce(userID, model.CreditLedgerRewardTask, taskRewardMicrocredits, task.ID, "", "完成创作任务奖励")
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
