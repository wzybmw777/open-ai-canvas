package repository

import (
	"errors"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func openRewardsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RewardClaim{}, &model.Membership{}, &model.PaymentOrder{}, &model.RedeemCode{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestClaimRewardOnceIsIdempotentPerTarget(t *testing.T) {
	db := openRewardsTestDB(t)
	repo := New(db)
	account, granted, err := repo.ClaimRewardOnce("user-1", model.CreditLedgerRewardTask, 5_000_000, "task-1", "task", "任务奖励")
	if err != nil || !granted || account.AvailableMicrocredits != 5_000_000 {
		t.Fatalf("first claim account=%#v granted=%v err=%v", account, granted, err)
	}
	account, granted, err = repo.ClaimRewardOnce("user-1", model.CreditLedgerRewardTask, 5_000_000, "task-1", "task", "任务奖励")
	if err != nil || granted || account.AvailableMicrocredits != 5_000_000 {
		t.Fatalf("duplicate claim account=%#v granted=%v err=%v", account, granted, err)
	}
	var count int64
	if err := db.Model(&model.RewardClaim{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("claims=%d err=%v", count, err)
	}
}

func TestExtendMembershipUsesExistingExpiryAndIsIdempotent(t *testing.T) {
	db := openRewardsTestDB(t)
	repo := New(db)
	start := time.Now().UTC().Add(24 * time.Hour)
	expires := start.Add(30 * 24 * time.Hour)
	if err := db.Create(&model.Membership{UserID: "user-1", Plan: "annual", StartsAt: start, ExpiresAt: expires}).Error; err != nil {
		t.Fatal(err)
	}
	got, created, err := repo.GrantMembership("user-1", 365, "payment", "payment-1", "", "payment:payment-1", "年会员")
	if err != nil || !created || !got.ExpiresAt.Equal(expires.Add(365*24*time.Hour)) {
		t.Fatalf("membership=%#v created=%v err=%v", got, created, err)
	}
	got, created, err = repo.GrantMembership("user-1", 365, "payment", "payment-1", "", "payment:payment-1", "年会员")
	if err != nil || created || !got.ExpiresAt.Equal(expires.Add(365*24*time.Hour)) {
		t.Fatalf("duplicate membership=%#v created=%v err=%v", got, created, err)
	}
}

func TestCompleteMembershipPaymentGrantsCreditsAndMembershipOnce(t *testing.T) {
	db := openRewardsTestDB(t)
	repo := New(db)
	order := model.PaymentOrder{ID: "payment-1", UserID: "user-1", MerchantOrderNo: "merchant-1", ProviderID: "wechat-native", AmountFen: 9900, Currency: "CNY", CreditsMicrocredits: 50_000_000, BonusCreditsMicrocredits: 50_000_000, ProductType: model.ProductTypeMembership, MembershipDays: 365, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	evidence := PaymentEvidence{ProviderTradeNo: "trade-1", AmountFen: 9900, Currency: "CNY", PaidAt: time.Now()}
	if _, granted, err := repo.CompletePaymentOrder("wechat-native", "merchant-1", evidence); err != nil || !granted {
		t.Fatalf("first payment granted=%v err=%v", granted, err)
	}
	if _, granted, err := repo.CompletePaymentOrder("wechat-native", "merchant-1", evidence); err != nil || granted {
		t.Fatalf("duplicate payment granted=%v err=%v", granted, err)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil || account.AvailableMicrocredits != 50_000_000 {
		t.Fatalf("account=%#v err=%v", account, err)
	}
	var membership model.Membership
	if err := db.First(&membership, "user_id = ?", "user-1").Error; err != nil || membership.ExpiresAt.Before(time.Now().Add(364*24*time.Hour)) {
		t.Fatalf("membership=%#v err=%v", membership, err)
	}
}

func TestRedeemMembershipCodeIsIdempotentAndRejectsPointsCode(t *testing.T) {
	db := openRewardsTestDB(t)
	repo := New(db)
	for _, code := range []model.RedeemCode{
		{ID: "member-code", CodeHash: "member-hash", ProductType: model.ProductTypeMembership, MembershipDays: 365, AmountMicrocredits: 50_000_000, BonusCreditsMicrocredits: 50_000_000, Status: model.RedeemCodeUnused},
		{ID: "points-code", CodeHash: "points-hash", ProductType: model.ProductTypeCredits, AmountMicrocredits: 10_000_000, Status: model.RedeemCodeUnused},
	} {
		if err := db.Create(&code).Error; err != nil {
			t.Fatal(err)
		}
	}
	account, redeemed, err := repo.RedeemMembershipCode("user-1", "member-hash", "")
	if err != nil || !redeemed || account.AvailableMicrocredits != 50_000_000 {
		t.Fatalf("member redeem account=%#v redeemed=%v err=%v", account, redeemed, err)
	}
	if _, redeemed, err = repo.RedeemMembershipCode("user-1", "member-hash", ""); !errors.Is(err, ErrRedeemCodeInvalid) || redeemed {
		t.Fatalf("duplicate member redeem redeemed=%v err=%v", redeemed, err)
	}
	if _, redeemed, err = repo.RedeemMembershipCode("user-1", "points-hash", ""); !errors.Is(err, ErrRedeemCodeInvalid) || redeemed {
		t.Fatalf("points code redeemed=%v err=%v", redeemed, err)
	}
}
