package database

import (
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type legacyReferralCommissionSchema struct {
	ID             string `gorm:"primaryKey;size:36"`
	PaymentOrderID string `gorm:"size:36;not null;uniqueIndex"`
}

func (legacyReferralCommissionSchema) TableName() string { return "referral_commissions" }

func TestReferralRedeemCommissionMigrationAllowsRedeemSource(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&legacyReferralCommissionSchema{}); err != nil {
		t.Fatal(err)
	}
	if err := migrateReferralRedeemCommission(db); err != nil {
		t.Fatal(err)
	}
	columns, err := db.Migrator().ColumnTypes(&model.ReferralCommission{})
	if err != nil {
		t.Fatal(err)
	}
	var paymentOrderNullable bool
	var foundRedeemCode bool
	for _, column := range columns {
		switch column.Name() {
		case "payment_order_id":
			paymentOrderNullable, _ = column.Nullable()
		case "redeem_code_id":
			foundRedeemCode = true
		}
	}
	if !paymentOrderNullable || !foundRedeemCode {
		t.Fatalf("migration columns: payment nullable=%v redeem code present=%v", paymentOrderNullable, foundRedeemCode)
	}
	codeID := "redeem-code-1"
	if err := db.Create(&model.ReferralCommission{
		ID: "commission-1", InviterUserID: "inviter", InviteeUserID: "invitee", RedeemCodeID: &codeID,
		OrderCreditsMicrocredits: 1_000_000, RateBasisPoints: 1_000, CommissionMicrocredits: 100_000,
	}).Error; err != nil {
		t.Fatal(err)
	}
}
