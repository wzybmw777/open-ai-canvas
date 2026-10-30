package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/hostupdate"
	"yingce/backend/internal/service"
)

type publicUpdateManager struct {
	service.UpdateManager
	status hostupdate.Status
	err    error
}

func (m publicUpdateManager) Status(context.Context) (hostupdate.Status, error) {
	return m.status, m.err
}

func TestPublicSystemUpdateStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name         string
		manager      service.UpdateManager
		wantStatus   int
		wantUpdating bool
	}{
		{"unmanaged", nil, 200, false},
		{"updating", publicUpdateManager{status: hostupdate.Status{Operation: hostupdate.Operation{Phase: hostupdate.PhaseDraining, Error: "private operation detail"}, LastBackup: &hostupdate.Backup{Path: "/private/backup"}}}, 200, true},
		{"rolling back", publicUpdateManager{status: hostupdate.Status{Operation: hostupdate.Operation{Phase: hostupdate.PhaseRollingBack}}}, 200, true},
		{"completed", publicUpdateManager{status: hostupdate.Status{Operation: hostupdate.Operation{Phase: hostupdate.PhaseSucceeded}}}, 200, false},
		{"updater unavailable", publicUpdateManager{err: errors.New("private socket detail")}, 503, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := &service.Service{}
			svc.ConfigureUpdateManager(tc.manager)
			router := gin.New()
			RegisterAdminUpdateRoutes(router.Group("/api"), svc)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/public/system-update", nil))
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("public update status must not be cached")
			}
			var envelope struct {
				Code int            `json:"code"`
				Data map[string]any `json:"data"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if tc.wantStatus == 200 {
				if envelope.Code != 0 || len(envelope.Data) != 1 || envelope.Data["updating"] != tc.wantUpdating {
					t.Fatalf("unexpected public projection: %s", rec.Body.String())
				}
			}
			for _, secret := range []string{"private", "lastBackup", "operation", "logs"} {
				if strings.Contains(rec.Body.String(), secret) {
					t.Fatalf("leaked %s: %s", secret, rec.Body.String())
				}
			}
		})
	}
}
