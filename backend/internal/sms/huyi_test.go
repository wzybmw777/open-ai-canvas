package sms

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	sender "github.com/casdoor/go-sms-sender"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type huyiTransport func(*http.Request) (*http.Response, error)

func (f huyiTransport) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestHuyiTemplateTransport(t *testing.T) {
	client, err := sender.NewSmsClient(sender.Huyi, "test-api-id", "test-api-key", "", "template-123")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), struct{}{}, "request-scope")
	calls := 0
	transport := huyiTransport(func(req *http.Request) (*http.Response, error) {
		calls++
		if req.URL.String() != "https://api.ihuyi.com/sms/Submit.json" || req.Method != http.MethodPost || req.Context() != ctx {
			t.Fatalf("unexpected request: %s %s", req.Method, req.URL)
		}
		if req.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
			t.Fatal("missing form content type")
		}
		if err := req.ParseForm(); err != nil {
			t.Fatal(err)
		}
		for key, want := range map[string]string{"account": "test-api-id", "password": "test-api-key", "mobile": "13800138000", "templateid": "template-123", "content": "123456|10"} {
			if req.Form.Get(key) != want {
				t.Fatalf("incorrect %s", key)
			}
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"code":2,"smsid":"sms-123"}`))}, nil
	})
	result, err := sender.SendMessageContext(ctx, client, transport, map[string]string{"1": "10", "0": "123456"}, "+8613800138000")
	if err != nil || result.State != "accepted" || result.MessageID != "sms-123" || calls != 1 {
		t.Fatalf("result=%#v err=%v calls=%d", result, err, calls)
	}
}

func TestHuyiAcceptanceAndNoRetry(t *testing.T) {
	for _, tc := range []struct {
		name, body, state, code string
		status                  int
		failure                 bool
	}{
		{"accepted", `{"code":2,"smsid":"123"}`, "accepted", "", 200, false},
		{"rejected", `{"code":405,"msg":"test-api-key 13800138000 123456"}`, "rejected", "405", 200, false},
		{"zero-is-rejected", `{"code":0}`, "rejected", "0", 200, false},
		{"missing-code", `{"smsid":"123"}`, "unknown", "acceptance_unknown", 200, false},
		{"missing-id", `{"code":2}`, "unknown", "acceptance_unknown", 200, false},
		{"zero-id", `{"code":2,"smsid":"0"}`, "unknown", "acceptance_unknown", 200, false},
		{"invalid-json", `not json`, "unknown", "acceptance_unknown", 200, false},
		{"http-error", `{"code":2,"smsid":"123"}`, "unknown", "acceptance_unknown", 500, false},
		{"redirect", "", "unknown", "acceptance_unknown", 302, false},
		{"network-error", "", "unknown", "acceptance_unknown", 0, true},
		{"oversized", `{"code":2,"smsid":"123"}` + strings.Repeat(" ", 1<<20), "unknown", "acceptance_unknown", 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			client, _ := sender.NewSmsClient(sender.Huyi, "test-api-id", "test-api-key", "", "1")
			calls := 0
			transport := huyiTransport(func(*http.Request) (*http.Response, error) {
				calls++
				if tc.failure {
					return nil, errors.New("test-api-key 13800138000 123456")
				}
				return &http.Response{StatusCode: tc.status, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			result, err := sender.SendMessageContext(context.Background(), client, transport, map[string]string{"0": "123456"}, "13800138000")
			if result.State != tc.state || result.Code != tc.code || calls != 1 || (err == nil) != (tc.state == "accepted") {
				t.Fatalf("result=%#v err=%v calls=%d", result, err, calls)
			}
			if err != nil && (strings.Contains(err.Error(), "test-api-key") || strings.Contains(err.Error(), "13800138000") || strings.Contains(err.Error(), "123456")) {
				t.Fatal("sensitive upstream error exposed")
			}
		})
	}
}

func TestHuyiInvalidParametersAndCancellation(t *testing.T) {
	client, _ := sender.NewSmsClient(sender.Huyi, "test-id", "test-key", "", "1")
	for _, params := range []map[string]string{nil, {"code": "123456"}, {"0": "123456", "2": "10"}, {"0": "123456|10"}} {
		result, err := sender.SendMessageContext(context.Background(), client, huyiTransport(func(*http.Request) (*http.Response, error) {
			t.Fatal("invalid configuration reached network")
			return nil, nil
		}), params, "13800138000")
		if err == nil || result.State != "rejected" {
			t.Fatalf("invalid parameters accepted: %#v", result)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := sender.SendMessageContext(ctx, client, huyiTransport(func(req *http.Request) (*http.Response, error) {
		if req.Context().Err() != context.Canceled {
			t.Fatal("context cancellation lost")
		}
		return nil, req.Context().Err()
	}), map[string]string{"0": "123456"}, "13800138000")
	if err == nil || result.State != "unknown" {
		t.Fatalf("canceled request accepted: %#v", result)
	}
}

func TestExistingSMSProviderAcceptance(t *testing.T) {
	for _, tc := range []struct {
		provider, host, body string
		params               map[string]string
	}{
		{sender.Aliyun, "dysmsapi.aliyuncs.com", `{"Code":"OK","RequestId":"request-123","BizId":"message-123"}`, map[string]string{"code": "123456"}},
		{sender.TencentCloud, "sms.tencentcloudapi.com", `{"Response":{"RequestId":"request-123","SendStatusSet":[{"Code":"Ok","SerialNo":"message-123"}]}}`, map[string]string{"0": "123456"}},
	} {
		t.Run(tc.provider, func(t *testing.T) {
			client, err := sender.NewSmsClient(tc.provider, "test-id", "test-key", "test-sign", "123", "123")
			if err != nil {
				t.Fatal(err)
			}
			calls := 0
			result, err := sender.SendMessageContext(context.Background(), client, huyiTransport(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.URL.Scheme != "https" || req.URL.Host != tc.host {
					t.Fatalf("unexpected provider endpoint: %s", req.URL.Host)
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			}), tc.params, "+8613800138000")
			if err != nil || result.State != "accepted" || result.MessageID != "message-123" || calls != 1 {
				t.Fatalf("result=%#v err=%v calls=%d", result, err, calls)
			}
		})
	}
}

type huyiTestHost struct{}

func (huyiTestHost) RequireAdmin(user *model.User) error {
	if user == nil || user.Role != model.UserRoleAdmin {
		return kernel.Forbidden("需要管理员权限")
	}
	return nil
}
func (huyiTestHost) EncryptSecret(value string) (string, error) { return "encrypted:" + value, nil }
func (huyiTestHost) DecryptSecret(value string) (string, error) {
	return strings.TrimPrefix(value, "encrypted:"), nil
}
func (huyiTestHost) SettingsEncryptionKey() ([]byte, error) { return []byte("test-key"), nil }

func TestHuyiChannelConfiguration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { sqlDB.Close() })
	if err := db.AutoMigrate(&model.SMSChannel{}); err != nil {
		t.Fatal(err)
	}
	enabled := false
	svc := New(repository.New(db), huyiTestHost{}, func(id string) (bool, error) {
		if id != PluginHuyi {
			t.Fatalf("unexpected plugin: %s", id)
		}
		return enabled, nil
	})
	admin := &model.User{Role: model.UserRoleAdmin}
	req := ChannelRequest{Name: "互亿无线", Provider: Huyi, Enabled: true, Priority: 100, DailyLimit: 100, AccessID: "test-id", AccessKey: "test-key", Templates: []Template{{Purpose: "login", TemplateID: "1", Parameters: []Parameter{{Name: "0", Value: "code"}}}}}
	if _, err := svc.SaveChannel(nil, "", req); err == nil {
		t.Fatal("non-admin saved channel")
	}
	if _, err := svc.SaveChannel(admin, "", req); err == nil {
		t.Fatal("disabled plugin permitted enabled channel")
	}
	enabled = true
	channel, err := svc.SaveChannel(admin, "", req)
	if err != nil || channel.SignName != "" || channel.AppID != "" || !channel.PluginEnabled {
		t.Fatalf("channel=%#v err=%v", channel, err)
	}
	if ok, err := svc.Available("login"); err != nil || !ok {
		t.Fatalf("channel unavailable: %v", err)
	}
	if err := validateTemplates(Huyi, []Template{{Purpose: "login", TemplateID: "1", Parameters: []Parameter{{Name: "code", Value: "code"}}}}); err == nil {
		t.Fatal("unordered parameter accepted")
	}
	enabled = false
	if ok, err := svc.Available("login"); err != nil || ok {
		t.Fatalf("disabled plugin available: %v", err)
	}
	if _, err := svc.SaveChannel(admin, "", ChannelRequest{Name: "Aliyun", Provider: Aliyun, Priority: 100, DailyLimit: 100}); err == nil {
		t.Fatal("Aliyun missing signature accepted")
	}
}
