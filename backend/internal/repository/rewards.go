package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

type TaskRewardCandidate struct {
	model.Task
	RewardClaimed bool
}

func (r *Repository) CompletedTaskRewardCandidates(userID string, limit int) ([]TaskRewardCandidate, error) {
	if limit < 1 || limit > 100 {
		limit = 50
	}
	tasks := []TaskRewardCandidate{}
	err := r.db.Model(&model.Task{}).
		Select(`tasks.*, EXISTS (SELECT 1 FROM reward_claims WHERE reward_claims.user_id = tasks.user_id AND reward_claims.target_id = tasks.id AND reward_claims.reward_type = ? AND reward_claims.period_key = '') AS reward_claimed`, model.CreditLedgerRewardTask).
		Where("tasks.user_id = ? AND tasks.status = ? AND tasks.attempts > 0 AND tasks.started_at IS NOT NULL AND tasks.completed_at IS NOT NULL", userID, model.TaskStatusSucceeded).
		Order("tasks.created_at DESC, tasks.id DESC").Limit(limit).Scan(&tasks).Error
	return tasks, err
}

func (r *Repository) ClaimRewardOnce(userID string, rewardType model.CreditLedgerType, amount int64, targetID, periodKey, note string) (*model.CreditAccount, bool, error) {
	var account model.CreditAccount
	referenceKey := "reward:" + string(rewardType) + ":" + userID + ":" + targetID
	if periodKey != "" {
		referenceKey += ":" + periodKey
	}
	granted := false
	var err error
	err = r.db.Transaction(func(tx *gorm.DB) error {
		var creditGranted bool
		account, creditGranted, err = grantCreditsTx(tx, userID, rewardType, amount, referenceKey, note)
		if err != nil || !creditGranted {
			return err
		}
		claim := model.RewardClaim{ID: newRepositoryID(), UserID: userID, RewardType: rewardType, TargetID: targetID, PeriodKey: periodKey, AmountMicrocredits: amount, ReferenceKey: referenceKey}
		created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&claim)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			return errors.New("奖励流水与领取记录不一致")
		}
		granted = creditGranted
		return nil
	})
	return &account, granted, err
}

func grantCreditsTx(tx *gorm.DB, userID string, entryType model.CreditLedgerType, amount int64, referenceKey, note string) (model.CreditAccount, bool, error) {
	if amount < 0 || amount > maxPaymentCreditBalance {
		return model.CreditAccount{}, false, errors.New("奖励积分无效")
	}
	account := model.CreditAccount{UserID: userID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return account, false, err
	}
	if amount == 0 {
		return account, true, nil
	}
	entry := model.CreditLedgerEntry{ID: newRepositoryID(), UserID: userID, Type: entryType, AmountMicrocredits: amount, ReferenceKey: &referenceKey, Note: note}
	created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&entry)
	if created.Error != nil {
		return account, false, created.Error
	}
	if created.RowsAffected == 0 {
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return account, false, err
		}
		return account, false, nil
	}
	updated := tx.Model(&model.CreditAccount{}).Where("user_id = ? AND available_microcredits <= ?", userID, maxPaymentCreditBalance-amount).Updates(map[string]any{
		"available_microcredits": gorm.Expr("available_microcredits + ?", amount), "version": gorm.Expr("version + 1"), "updated_at": time.Now(),
	})
	if updated.Error != nil {
		return account, false, updated.Error
	}
	if updated.RowsAffected != 1 {
		return account, false, ErrPaymentCreditOverflow
	}
	if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
		return account, false, err
	}
	if err := tx.Model(&entry).Updates(map[string]any{"available_delta_microcredits": amount, "available_after_microcredits": account.AvailableMicrocredits, "reserved_after_microcredits": account.ReservedMicrocredits}).Error; err != nil {
		return account, false, err
	}
	return account, true, nil
}

func grantMembershipTx(tx *gorm.DB, userID string, days int, sourceType, paymentOrderID, redeemCodeID, referenceKey, note string) (model.Membership, bool, error) {
	var membership model.Membership
	created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&model.RewardClaim{ID: newRepositoryID(), UserID: userID, RewardType: model.CreditLedgerMembershipBonus, TargetID: referenceKey, AmountMicrocredits: 0, ReferenceKey: referenceKey})
	if created.Error != nil {
		return membership, false, created.Error
	}
	if created.RowsAffected == 0 {
		if err := tx.First(&membership, "user_id = ?", userID).Error; err != nil {
			return membership, false, err
		}
		return membership, false, nil
	}
	now := time.Now().UTC()
	if err := tx.First(&membership, "user_id = ?", userID).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return membership, false, err
	}
	start := now
	if !membership.ExpiresAt.IsZero() && membership.ExpiresAt.After(now) {
		start = membership.ExpiresAt
	}
	if days <= 0 {
		return membership, false, errors.New("会员时长无效")
	}
	membership.UserID, membership.Plan, membership.StartsAt, membership.ExpiresAt = userID, "annual", start, start.Add(time.Duration(days)*24*time.Hour)
	membership.SourceType, membership.SourcePaymentOrderID, membership.SourceRedeemCodeID = sourceType, paymentOrderID, redeemCodeID
	if err := tx.Save(&membership).Error; err != nil {
		return membership, false, err
	}
	_ = note
	return membership, true, nil
}

func (r *Repository) MembershipForUser(userID string) (*model.Membership, error) {
	var membership model.Membership
	err := r.db.First(&membership, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &model.Membership{UserID: userID}, nil
	}
	return &membership, err
}

func (r *Repository) RewardClaimExists(userID string, rewardType model.CreditLedgerType, periodKey string) (bool, error) {
	var count int64
	err := r.db.Model(&model.RewardClaim{}).Where("user_id = ? AND reward_type = ? AND period_key = ?", userID, rewardType, periodKey).Count(&count).Error
	return count > 0, err
}

func (r *Repository) RewardClaimReferenceExists(referenceKey string) (bool, error) {
	var count int64
	err := r.db.Model(&model.RewardClaim{}).Where("reference_key = ?", referenceKey).Count(&count).Error
	return count > 0, err
}

func (r *Repository) GrantMembership(userID string, days int, sourceType, paymentOrderID, redeemCodeID, referenceKey, note string) (*model.Membership, bool, error) {
	var membership model.Membership
	var granted bool
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var err error
		membership, granted, err = grantMembershipTx(tx, userID, days, sourceType, paymentOrderID, redeemCodeID, referenceKey, note)
		return err
	})
	return &membership, granted, err
}

func (r *Repository) RedeemMembershipCode(userID, codeHash, redeemedIP string) (*model.CreditAccount, bool, error) {
	var account model.CreditAccount
	var redeemed bool
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var code model.RedeemCode
		if err := tx.First(&code, "code_hash = ?", codeHash).Error; err != nil {
			return ErrRedeemCodeInvalid
		}
		if code.ProductType != model.ProductTypeMembership || code.MembershipDays <= 0 || code.BonusCreditsMicrocredits < 0 {
			return ErrRedeemCodeInvalid
		}
		now := time.Now().UTC()
		query := tx.Model(&model.RedeemCode{}).Where("id = ? AND status = ?", code.ID, model.RedeemCodeUnused)
		if code.ExpiresAt != nil {
			query = query.Where("expires_at > ?", now)
		}
		if result := query.Updates(map[string]any{"status": model.RedeemCodeRedeemed, "redeemed_by": userID, "redeemed_at": &now, "redeemed_ip": redeemedIP, "updated_at": now}); result.Error != nil || result.RowsAffected != 1 {
			return ErrRedeemCodeInvalid
		}
		if _, granted, err := grantMembershipTx(tx, userID, code.MembershipDays, "redeem", "", code.ID, "redeem:"+code.ID, "会员兑换"); err != nil {
			return err
		} else if !granted {
			return ErrRedeemCodeInvalid
		}
		var creditErr error
		account, _, creditErr = grantCreditsTx(tx, userID, model.CreditLedgerMembershipBonus, code.BonusCreditsMicrocredits, "redeem:"+code.ID+":credits", "会员兑换赠送积分")
		if creditErr != nil {
			return creditErr
		}
		redeemed = true
		return nil
	})
	return &account, redeemed, err
}

func (r *Repository) CompleteMembershipPayment(providerID, merchantOrderNo string, evidence PaymentEvidence) (*model.PaymentOrder, bool, error) {
	return r.CompletePaymentOrder(providerID, merchantOrderNo, evidence)
}
