package auth

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type verificationTestHost struct{ nopHost }

func (verificationTestHost) SettingsEncryptionKey() ([]byte, error) {
	return []byte("verification-test-key-32-bytes!!"), nil
}
func (verificationTestHost) RequireAdmin(user *model.User) error {
	if user == nil || user.Role != model.UserRoleAdmin || user.Status != model.UserStatusActive {
		return kernel.Forbidden("需要管理员权限")
	}
	return nil
}

type verificationTestSMS struct {
	code      string
	available bool
	failure   error
	sends     int
}

func (s *verificationTestSMS) Available(string) (bool, error) { return s.available, nil }
func (s *verificationTestSMS) SendCode(_ context.Context, _, _, code string) error {
	s.code = code
	s.sends++
	return s.failure
}

func newVerificationTestService(t *testing.T, policy VerificationPolicy) (*Service, *gorm.DB, *verificationTestSMS, *string) {
	t.Helper()
	svc, db := newRegistrationTestService(t)
	if err := db.AutoMigrate(&model.AuthVerification{}, &model.NotificationQuota{}); err != nil {
		t.Fatal(err)
	}
	svc.host = verificationTestHost{}
	delivery := &verificationTestSMS{available: true}
	svc.SetSMSDelivery(delivery)
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateVerificationPolicy(admin, policy); err != nil {
		t.Fatal(err)
	}
	emailCode := new(string)
	svc.SetMailSender(func(_ EmailSettingValue, _, _, body string) error {
		*emailCode = regexp.MustCompile(`[0-9]{6}`).FindString(body)
		return nil
	})
	return svc, db, delivery, emailCode
}

func TestVerificationRegistrationAndLogin(t *testing.T) {
	for _, method := range []string{"sms", "email", "sms_email"} {
		t.Run(method, func(t *testing.T) {
			policy := VerificationPolicy{SMSLogin: true, EmailLogin: true, SMSRegistration: method != "sms_email", EmailRegistration: method != "sms_email", SMSAndEmailRegistration: method == "sms_email"}
			svc, db, sms, emailCode := newVerificationTestService(t, policy)
			req := VerificationRequest{Purpose: "register", Method: method}
			if method != "sms" {
				req.Email = "member@example.com"
			}
			if method != "email" {
				req.Phone = "13800138000"
			}
			ticket, err := svc.StartVerification(context.Background(), nil, req)
			if err != nil {
				t.Fatal(err)
			}
			register := RegisterRequest{Username: "member", Email: req.Email, Phone: req.Phone, Ticket: ticket.Ticket, EmailCode: *emailCode, SMSCode: sms.code, Password: "strong-password", AcceptedTerms: true}
			result, err := svc.Register(register)
			if err != nil {
				t.Fatal(err)
			}
			if result.Session == "" || result.User.Role != model.UserRoleUser {
				t.Fatalf("registration result=%#v", result)
			}
			if method != "email" && (result.User.Phone != "+8613800138000" || result.User.PhoneVerifiedAt == nil) {
				t.Fatalf("phone not verified: %#v", result.User)
			}
			if method != "sms" && result.User.EmailVerifiedAt == nil {
				t.Fatal("email not verified")
			}
			if method == "sms" && result.User.Email != "" {
				t.Fatal("SMS registration required email")
			}
			if method != "email" {
				users, count, err := svc.repo.AdminUsers("13800138000", "", "", 20, 0)
				if err != nil || count != 1 || users[0].ID != result.User.ID {
					t.Fatalf("phone search count=%d err=%v", count, err)
				}
			}
			if _, err := svc.Register(register); err == nil {
				t.Fatal("registration ticket reused")
			}
			if err := db.Where("1 = 1").Delete(&model.NotificationQuota{}).Error; err != nil {
				t.Fatal(err)
			}
			req.Purpose = "login"
			if method == "sms_email" {
				req.Method = "sms"
				req.Email = ""
			}
			ticket, err = svc.StartVerification(context.Background(), nil, req)
			if err != nil {
				t.Fatal(err)
			}
			confirm := VerificationConfirm{Ticket: ticket.Ticket, EmailCode: *emailCode, SMSCode: sms.code}
			login, err := svc.LoginVerification(confirm)
			if err != nil || login == nil || login.User.ID != result.User.ID || login.Session == "" {
				t.Fatalf("login=%#v err=%v", login, err)
			}
			if _, err := svc.LoginVerification(confirm); err == nil {
				t.Fatal("login ticket reused")
			}
			if _, err := svc.Login(LoginRequest{Username: result.User.Username, Password: "strong-password"}); err != nil {
				t.Fatalf("password login no longer compatible: %v", err)
			}
		})
	}
}

func TestVerificationRequiresBothIndependentCodes(t *testing.T) {
	svc, _, sms, emailCode := newVerificationTestService(t, VerificationPolicy{SMSAndEmailRegistration: true})
	ticket, err := svc.StartVerification(context.Background(), nil, VerificationRequest{Purpose: "register", Method: "sms_email", Email: "member@example.com", Phone: "13800138000"})
	if err != nil {
		t.Fatal(err)
	}
	req := RegisterRequest{Username: "member", Email: "member@example.com", Phone: "13800138000", Ticket: ticket.Ticket, SMSCode: sms.code, Password: "strong-password", AcceptedTerms: true}
	if _, err := svc.Register(req); err == nil {
		t.Fatal("dual verification accepted only SMS code")
	}
	req.EmailCode = *emailCode
	if _, err := svc.Register(req); err != nil {
		t.Fatal(err)
	}
}

func TestVerificationPolicyPermissionsAndAvailability(t *testing.T) {
	svc, db, sms, _ := newVerificationTestService(t, VerificationPolicy{SMSLogin: true, SMSRegistration: true})
	if _, err := svc.UpdateVerificationPolicy(&model.User{Role: model.UserRoleUser, Status: model.UserStatusActive}, VerificationPolicy{}); err == nil {
		t.Fatal("non-admin changed policy")
	}
	sms.available = false
	admin, err := svc.repo.User("admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateVerificationPolicy(admin, VerificationPolicy{SMSLogin: true}); err == nil {
		t.Fatal("enabled SMS without available channel")
	}
	settings, err := svc.PublicAuthSettings()
	if err != nil || settings.SMSLogin || settings.SMSRegistration {
		t.Fatalf("unavailable SMS published: %#v %v", settings, err)
	}
	sms.available = true
	ticket, err := svc.StartVerification(context.Background(), nil, VerificationRequest{Purpose: "register", Method: "sms", Phone: "13800138000"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateVerificationPolicy(admin, VerificationPolicy{SMSRegistration: true}); err != nil {
		t.Fatal(err)
	}
	_, err = svc.Register(RegisterRequest{Username: "member", Phone: "13800138000", Ticket: ticket.Ticket, SMSCode: sms.code, Password: "strong-password", AcceptedTerms: true})
	if err == nil || !strings.Contains(err.Error(), "策略已更新") {
		t.Fatalf("stale policy accepted: %v", err)
	}
	var users int64
	if err := db.Model(&model.User{}).Count(&users).Error; err != nil || users != 1 {
		t.Fatal("failed registration wrote user")
	}
}

func TestVerificationUnknownUnverifiedAndDisabledLogin(t *testing.T) {
	for _, state := range []string{"missing", "unverified", "disabled"} {
		t.Run(state, func(t *testing.T) {
			svc, db, sms, _ := newVerificationTestService(t, VerificationPolicy{SMSLogin: true})
			if state != "missing" {
				user := model.User{ID: "member", Username: "member", Phone: "+8613800138000", Role: model.UserRoleUser, Status: model.UserStatusActive}
				if state == "disabled" {
					now := time.Now()
					user.PhoneVerifiedAt = &now
					user.Status = model.UserStatusDisabled
				}
				if err := db.Create(&user).Error; err != nil {
					t.Fatal(err)
				}
			}
			ticket, err := svc.StartVerification(context.Background(), nil, VerificationRequest{Purpose: "login", Method: "sms", Phone: "13800138000"})
			if err != nil || ticket == nil || ticket.Ticket == "" || sms.sends != 0 {
				t.Fatalf("account disclosed or SMS sent: %#v %v", ticket, err)
			}
			if _, err := svc.LoginVerification(VerificationConfirm{Ticket: ticket.Ticket, SMSCode: "123456"}); err == nil {
				t.Fatal("invalid account logged in")
			}
		})
	}
}

func TestVerificationDeliveryFailureCooldownAndAttemptLimit(t *testing.T) {
	svc, db, sms, _ := newVerificationTestService(t, VerificationPolicy{SMSRegistration: true})
	sms.failure = errors.New("delivery unavailable")
	req := VerificationRequest{Purpose: "register", Method: "sms", Phone: "13800138000"}
	if _, err := svc.StartVerification(context.Background(), nil, req); err == nil {
		t.Fatal("delivery failure hidden")
	}
	var failed model.AuthVerification
	if err := db.First(&failed).Error; err != nil || failed.Ready {
		t.Fatal("failed delivery left usable ticket")
	}
	if _, err := svc.StartVerification(context.Background(), nil, req); err == nil || sms.sends != 1 {
		t.Fatal("cooldown bypassed")
	}
	sms.failure = nil
	req.Phone = "13900139000"
	ticket, err := svc.StartVerification(context.Background(), nil, req)
	if err != nil {
		t.Fatal(err)
	}
	register := RegisterRequest{Username: "member", Phone: req.Phone, Ticket: ticket.Ticket, SMSCode: "invalid", Password: "strong-password", AcceptedTerms: true}
	for i := 0; i < 5; i++ {
		if _, err := svc.Register(register); err == nil {
			t.Fatal("bad code accepted")
		}
	}
	register.SMSCode = sms.code
	if _, err := svc.Register(register); err == nil {
		t.Fatal("attempt limit bypassed")
	}
}
