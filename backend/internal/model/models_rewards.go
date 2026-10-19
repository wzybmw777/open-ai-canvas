package model

import "time"

type RewardTask struct {
	ID                 string           `json:"id"`
	Name               string           `json:"name"`
	Description        string           `json:"description"`
	RewardType         CreditLedgerType `json:"rewardType"`
	AmountMicrocredits int64            `json:"amountMicrocredits"`
}

// RewardClaim is the durable idempotency record for user-earned credits.
type RewardClaim struct {
	ID                 string           `json:"id" gorm:"primaryKey;size:36"`
	UserID             string           `json:"userId" gorm:"index;size:36"`
	RewardType         CreditLedgerType `json:"rewardType" gorm:"index;size:32"`
	TargetID           string           `json:"targetId" gorm:"size:80"`
	PeriodKey          string           `json:"periodKey,omitempty" gorm:"size:32"`
	AmountMicrocredits int64            `json:"amountMicrocredits"`
	ReferenceKey       string           `json:"referenceKey" gorm:"uniqueIndex;size:180"`
	CreatedAt          time.Time        `json:"createdAt" gorm:"index"`
}

type Membership struct {
	UserID               string    `json:"userId" gorm:"primaryKey;size:36"`
	Plan                 string    `json:"plan" gorm:"size:80"`
	StartsAt             time.Time `json:"startsAt"`
	ExpiresAt            time.Time `json:"expiresAt" gorm:"index"`
	SourceType           string    `json:"sourceType" gorm:"size:24"`
	SourcePaymentOrderID string    `json:"sourcePaymentOrderId,omitempty" gorm:"index;size:36"`
	SourceRedeemCodeID   string    `json:"sourceRedeemCodeId,omitempty" gorm:"index;size:36"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}
