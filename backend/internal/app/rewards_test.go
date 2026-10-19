package app

import (
	"errors"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func newRewardsService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.CanvasShare{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RewardClaim{}, &model.Membership{}, &model.RedeemCode{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func TestClaimTaskRewardRequiresSuccessfulOwnedTaskAndIsIdempotent(t *testing.T) {
	svc, db := newRewardsService(t)
	if err := db.Create(&model.Task{ID: "task-success", UserID: "user-1", Status: model.TaskStatusSucceeded}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "task-running", UserID: "user-1", Status: model.TaskStatusRunning}).Error; err != nil {
		t.Fatal(err)
	}
	if _, granted, err := svc.ClaimTaskReward("user-1", "task-running"); err == nil || granted {
		t.Fatalf("running task granted=%v err=%v", granted, err)
	}
	if _, granted, err := svc.ClaimTaskReward("user-2", "task-success"); err == nil || granted {
		t.Fatalf("foreign task granted=%v err=%v", granted, err)
	}
	account, granted, err := svc.ClaimTaskReward("user-1", "task-success")
	if err != nil || !granted || account.AvailableMicrocredits != 5*CreditScale {
		t.Fatalf("first task claim account=%#v granted=%v err=%v", account, granted, err)
	}
	account, granted, err = svc.ClaimTaskReward("user-1", "task-success")
	if err != nil || granted || account.AvailableMicrocredits != 5*CreditScale {
		t.Fatalf("duplicate task claim account=%#v granted=%v err=%v", account, granted, err)
	}
}

func TestClaimShareRewardUsesUTCPeriodAndOwnership(t *testing.T) {
	svc, db := newRewardsService(t)
	expires := time.Now().UTC().Add(time.Hour)
	if err := db.Create(&model.CanvasShare{ID: "share-1", UserID: "user-1", ProjectID: "project-1", Enabled: true, ExpiresAt: &expires}).Error; err != nil {
		t.Fatal(err)
	}
	account, granted, err := svc.ClaimShareReward("user-1", "share-1")
	if err != nil || !granted || account.AvailableMicrocredits != 2*CreditScale {
		t.Fatalf("first share claim account=%#v granted=%v err=%v", account, granted, err)
	}
	account, granted, err = svc.ClaimShareReward("user-1", "share-1")
	if err != nil || granted || account.AvailableMicrocredits != 2*CreditScale {
		t.Fatalf("duplicate share claim account=%#v granted=%v err=%v", account, granted, err)
	}
	if _, granted, err = svc.ClaimShareReward("user-2", "share-1"); !errors.Is(err, gorm.ErrRecordNotFound) || granted {
		t.Fatalf("foreign share claim granted=%v err=%v", granted, err)
	}
}

func TestMembershipServiceRedeemsOnlyMembershipCode(t *testing.T) {
	svc, db := newRewardsService(t)
	if err := db.Create(&model.RedeemCode{ID: "member", CodeHash: hashRedeemCode("member-code"), ProductType: model.ProductTypeMembership, MembershipDays: 365, BonusCreditsMicrocredits: 50 * CreditScale, Status: model.RedeemCodeUnused}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RedeemCode{ID: "credits", CodeHash: hashRedeemCode("credits-code"), ProductType: model.ProductTypeCredits, AmountMicrocredits: CreditScale, Status: model.RedeemCodeUnused}).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.RedeemMembershipCode("user-1", "credits-code", ""); err == nil {
		t.Fatalf("points code error=%v", err)
	}
	account, redeemed, err := svc.RedeemMembershipCode("user-1", "member-code", "")
	if err != nil || !redeemed || account.AvailableMicrocredits != 50*CreditScale {
		t.Fatalf("member code account=%#v redeemed=%v err=%v", account, redeemed, err)
	}
}
