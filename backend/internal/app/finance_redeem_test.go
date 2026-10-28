package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRedeemBatchCanBeReviewedAndRecordsAuditIP(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RedeemBatch{}, &model.RedeemCode{}, &model.AdminAuditEvent{}, &model.ReferralBinding{}, &model.ReferralCommission{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin-1", Username: "admin", DisplayName: "管理员", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "user-1", Username: "alice", DisplayName: "Alice", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	created, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{AmountMicrocredits: CreditScale, Count: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(created.Codes) != 2 {
		t.Fatalf("created codes = %d", len(created.Codes))
	}
	page, err := svc.AdminRedeemCodePage(admin, created.Batch.ID, "", 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if !page.PlaintextAvailable || len(page.Codes) != 2 || page.Codes[0].Code == "" {
		t.Fatalf("initial code page = %#v", page)
	}
	if _, err := svc.RedeemCredits(user, created.Codes[0], "203.0.113.8"); err != nil {
		t.Fatal(err)
	}
	redeemed, err := svc.AdminRedeemCodePage(admin, created.Batch.ID, "redeemed", 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(redeemed.Codes) != 1 || redeemed.Codes[0].RedeemedBy != user.ID || redeemed.Codes[0].RedeemedUsername != user.Username || redeemed.Codes[0].RedeemedIP != "203.0.113.8" || redeemed.Codes[0].RedeemedAt == nil {
		t.Fatalf("redeemed code = %#v", redeemed.Codes)
	}
}

func TestRedeemCreditsCanGrantReferralCommission(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RedeemBatch{}, &model.RedeemCode{}, &model.AdminAuditEvent{}, &model.ReferralBinding{}, &model.ReferralCommission{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin-2", Username: "admin2", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	inviter := &model.User{ID: "inviter-2", Username: "inviter2", Role: model.UserRoleUser, Status: model.UserStatusActive}
	invitee := &model.User{ID: "invitee-2", Username: "invitee2", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create([]*model.User{admin, inviter, invitee}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: referralSettingKey, ValueJSON: func() string {
		encoded, _ := json.Marshal(ReferralSetting{Enabled: true, Mode: ReferralModeAll, CommissionRateBasisPoints: 1_000, RedeemCommissionEnabled: true})
		return string(encoded)
	}()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ReferralBinding{InviteeUserID: invitee.ID, InviterUserID: inviter.ID, Code: "INVITE2"}).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	created, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{AmountMicrocredits: 100 * CreditScale, Count: 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RedeemCredits(invitee, created.Codes[0], "203.0.113.9"); err != nil {
		t.Fatal(err)
	}
	var commission model.ReferralCommission
	if err := db.First(&commission, "invitee_user_id = ?", invitee.ID).Error; err != nil {
		t.Fatal(err)
	}
	if commission.RedeemCodeID == nil || *commission.RedeemCodeID == "" || commission.PaymentOrderID != nil {
		t.Fatalf("unexpected redeem commission source: %#v", commission)
	}
	if commission.OrderAmountFen != 0 || commission.OrderCreditsMicrocredits != 100*CreditScale || commission.CommissionMicrocredits != 10*CreditScale {
		t.Fatalf("unexpected redeem commission amount: %#v", commission)
	}
	var inviterAccount model.CreditAccount
	if err := db.First(&inviterAccount, "user_id = ?", inviter.ID).Error; err != nil {
		t.Fatal(err)
	}
	if inviterAccount.AvailableMicrocredits != 10*CreditScale {
		t.Fatalf("inviter credits = %d", inviterAccount.AvailableMicrocredits)
	}
	var redeemedCode model.RedeemCode
	if err := db.First(&redeemedCode, "code_hash = ?", hashRedeemCode(created.Codes[0])).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.tryGrantRedeemReferralCommission(&repository.RedeemCodeResult{CodeID: redeemedCode.ID, AmountMicrocredits: redeemedCode.AmountMicrocredits}, invitee.ID); err != nil {
		t.Fatal(err)
	}
	var duplicateCount int64
	if err := db.Model(&model.ReferralCommission{}).Where("invitee_user_id = ?", invitee.ID).Count(&duplicateCount).Error; err != nil {
		t.Fatal(err)
	}
	if duplicateCount != 1 {
		t.Fatalf("duplicate redeem commission count = %d", duplicateCount)
	}

	setting := ReferralSetting{Enabled: true, Mode: ReferralModeAll, CommissionRateBasisPoints: 1_000, RedeemCommissionEnabled: false}
	encoded, _ := json.Marshal(setting)
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", referralSettingKey).Update("value_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RedeemCredits(invitee, created.Codes[1], "203.0.113.10"); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.ReferralCommission{}).Where("invitee_user_id = ?", invitee.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("disabled redeem commission created %d records", count)
	}
}
