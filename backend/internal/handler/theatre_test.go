package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestTheatreHTTPSharedPlaybackAndManagement(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	// Minimal MP4 signature exercises upload content detection and byte delivery, not codec decoding.
	video := []byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom\x00\x00\x00\x1bmdat-theatre-video-bytes")
	for _, id := range []string{"author", "viewer"} {
		if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id + "-session", UserID: id, TokenHash: auth.HashToken("token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	svc := service.New(repository.New(db), dataDir)
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() {
		ConfigureRuntime(previous)
		_ = svc.Close()
	})
	RegisterUserDataRoutes(router.Group("/api"), svc)
	call := func(method, path, body, actor, byteRange string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		if actor != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: actor + "-session.token"})
		}
		if byteRange != "" {
			r.Header.Set("Range", byteRange)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	assertStatus := func(w *httptest.ResponseRecorder, status int) {
		t.Helper()
		if w.Code != status {
			t.Fatalf("status = %d want %d, body=%s", w.Code, status, w.Body.String())
		}
	}
	var uploadBody bytes.Buffer
	writer := multipart.NewWriter(&uploadBody)
	if err := writer.WriteField("kind", "video"); err != nil {
		t.Fatal(err)
	}
	part, err := writer.CreateFormFile("file", "edited.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(video); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	uploadRequest := httptest.NewRequest("POST", "/api/resources", &uploadBody)
	uploadRequest.Header.Set("Content-Type", writer.FormDataContentType())
	uploadRequest.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "author-session.token"})
	uploadResponse := httptest.NewRecorder()
	router.ServeHTTP(uploadResponse, uploadRequest)
	assertStatus(uploadResponse, 200)
	var uploaded struct {
		Data struct {
			Resource model.Resource `json:"resource"`
		} `json:"data"`
	}
	if err := json.Unmarshal(uploadResponse.Body.Bytes(), &uploaded); err != nil {
		t.Fatal(err)
	}
	if uploaded.Data.Resource.ID == "" || uploaded.Data.Resource.MimeType != "video/mp4" || uploaded.Data.Resource.Status != model.ResourceStatusReady {
		t.Fatalf("uploaded resource = %#v", uploaded)
	}
	resourcePath := "/api/resources/" + uploaded.Data.Resource.ID + "/file"
	uploadCover := func(actor string, pixel color.RGBA) (model.Resource, []byte) {
		t.Helper()
		picture := image.NewRGBA(image.Rect(0, 0, 2, 2))
		picture.SetRGBA(0, 0, pixel)
		var imageBytes, body bytes.Buffer
		if err := png.Encode(&imageBytes, picture); err != nil {
			t.Fatal(err)
		}
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("kind", "image")
		part, err := writer.CreateFormFile("file", "cover.png")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write(imageBytes.Bytes())
		_ = writer.Close()
		r := httptest.NewRequest("POST", "/api/resources", &body)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: actor + "-session.token"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		assertStatus(w, 200)
		var result struct {
			Data struct {
				Resource model.Resource `json:"resource"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.Data.Resource, imageBytes.Bytes()
	}
	cover, coverBytes := uploadCover("author", color.RGBA{R: 255, A: 255})
	replacement, replacementBytes := uploadCover("author", color.RGBA{G: 255, A: 255})
	foreignCover, _ := uploadCover("viewer", color.RGBA{B: 255, A: 255})
	request := fmt.Sprintf(`{"resourceId":%q,"coverResourceId":%q,"title":"首映","description":"作品介绍"}`, uploaded.Data.Resource.ID, cover.ID)
	assertStatus(call("POST", "/api/theatre/works", request, "", ""), 401)
	assertStatus(call("POST", "/api/theatre/works", request, "viewer", ""), 404)
	response := call("POST", "/api/theatre/works", request, "author", "")
	assertStatus(response, 200)
	var created struct {
		Data struct {
			Work model.TheatreWork `json:"work"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Data.Work.ID == "" {
		t.Fatal("missing work id")
	}
	path := "/api/theatre/works/" + created.Data.Work.ID
	if created.Data.Work.CoverResourceID != cover.ID {
		t.Fatal("published cover id missing")
	}
	assertStatus(call("GET", path+"/cover", "", "", ""), 401)
	assertStatus(call("GET", "/api/resources/"+cover.ID+"/file", "", "viewer", ""), 404)
	imageResponse := call("GET", path+"/cover", "", "viewer", "")
	assertStatus(imageResponse, 200)
	if !bytes.Equal(imageResponse.Body.Bytes(), coverBytes) || !strings.HasPrefix(imageResponse.Header().Get("Content-Type"), "image/png") || imageResponse.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("shared cover response differs from uploaded PNG")
	}
	assertStatus(call("PATCH", path, fmt.Sprintf(`{"title":"首映","coverResourceId":%q}`, foreignCover.ID), "author", ""), 404)
	assertStatus(call("PATCH", path, fmt.Sprintf(`{"title":"首映","coverResourceId":%q}`, uploaded.Data.Resource.ID), "author", ""), 400)
	assertStatus(call("PATCH", path, `{"title":"保留封面"}`, "author", ""), 200)
	if !bytes.Equal(call("GET", path+"/cover", "", "viewer", "").Body.Bytes(), coverBytes) {
		t.Fatal("omitted cover changed shared image")
	}
	assertStatus(call("PATCH", path, fmt.Sprintf(`{"title":"首映","description":"作品介绍","coverResourceId":%q}`, replacement.ID), "author", ""), 200)
	if !bytes.Equal(call("GET", path+"/cover", "", "viewer", "").Body.Bytes(), replacementBytes) {
		t.Fatal("replaced cover not visible to viewer")
	}
	feed := call("GET", "/api/theatre/works", "", "viewer", "")
	assertStatus(feed, 200)
	if !strings.Contains(feed.Body.String(), "首映") || strings.Contains(feed.Body.String(), "objectKey") || strings.Contains(feed.Body.String(), "example.invalid") {
		t.Fatalf("feed = %s", feed.Body.String())
	}
	assertStatus(call("GET", path+"/video", "", "", ""), 401)
	assertStatus(call("GET", resourcePath, "", "viewer", ""), 404)
	playback := call("GET", path+"/video", "", "viewer", "")
	assertStatus(playback, 200)
	if !bytes.Equal(playback.Body.Bytes(), video) || playback.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("playback = %#v", playback)
	}
	partial := call("GET", path+"/video", "", "viewer", "bytes=0-6")
	assertStatus(partial, 206)
	if !bytes.Equal(partial.Body.Bytes(), video[:7]) {
		t.Fatalf("partial = %s", partial.Body.String())
	}
	assertStatus(call("PATCH", path, `{"title":"修改","description":""}`, "viewer", ""), 403)
	assertStatus(call("PATCH", path, `{"title":"修改","coverResourceId":""}`, "viewer", ""), 403)
	assertStatus(call("DELETE", path, "", "viewer", ""), 403)
	assertStatus(call("PATCH", path, `{"title":"修改","description":""}`, "author", ""), 200)
	assertStatus(call("PATCH", path, `{"title":"修改","coverResourceId":""}`, "author", ""), 200)
	assertStatus(call("GET", path+"/cover", "", "viewer", ""), 404)
	assertStatus(call("PATCH", path, fmt.Sprintf(`{"title":"修改","coverResourceId":%q}`, cover.ID), "author", ""), 200)
	assertStatus(call("DELETE", path, "", "author", ""), 200)
	assertStatus(call("GET", path+"/video", "", "viewer", ""), 404)
	assertStatus(call("GET", path+"/cover", "", "viewer", ""), 404)
	assertStatus(call("GET", resourcePath, "", "author", ""), 200)

	// A second owned upload makes the series exercise a non-preview episode.
	second := uploaded.Data.Resource
	second.ID = "episode-two"
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	seriesBody := fmt.Sprintf(`{"kind":"short_drama","title":"两集短剧","episodes":[{"resourceId":%q,"title":"开场"},{"resourceId":%q,"title":"结尾"}]}`, uploaded.Data.Resource.ID, second.ID)
	seriesResponse := call("POST", "/api/theatre/works", seriesBody, "author", "")
	assertStatus(seriesResponse, 200)
	if err := json.Unmarshal(seriesResponse.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	seriesPath := "/api/theatre/works/" + created.Data.Work.ID
	assertStatus(call("GET", seriesPath, "", "", ""), 401)
	var detail struct {
		Data service.TheatreWorkDetail `json:"data"`
	}
	loadSeries := func() {
		t.Helper()
		response := call("GET", seriesPath, "", "viewer", "")
		assertStatus(response, 200)
		if err := json.Unmarshal(response.Body.Bytes(), &detail); err != nil {
			t.Fatal(err)
		}
	}
	loadSeries()
	if detail.Data.Work.Kind != model.TheatreWorkShortDrama || detail.Data.Work.EpisodeCount != 2 || len(detail.Data.Episodes) != 2 {
		t.Fatalf("series detail=%#v", detail)
	}
	firstID, secondID := detail.Data.Episodes[0].ID, detail.Data.Episodes[1].ID
	episodePath := seriesPath + "/episodes/" + secondID + "/video"
	assertStatus(call("GET", episodePath, "", "", ""), 401)
	assertStatus(call("GET", path+"/episodes/"+secondID+"/video", "", "viewer", ""), 404)
	assertStatus(call("GET", "/api/resources/"+second.ID+"/file", "", "viewer", ""), 404)
	episodeRange := call("GET", episodePath, "", "viewer", "bytes=0-6")
	assertStatus(episodeRange, 206)
	if !bytes.Equal(episodeRange.Body.Bytes(), video[:7]) || episodeRange.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal("episode playback bytes or cache contract changed")
	}
	inputs := []service.TheatreEpisodeInput{{ResourceID: second.ID, Title: "新的开场"}, {ResourceID: uploaded.Data.Resource.ID, Title: "第二集"}}
	complete := true
	edit := service.TheatreWorkRequest{Title: "两集完结短剧", Episodes: &inputs, IsComplete: &complete, ExpectedUpdatedAt: &detail.Data.Work.UpdatedAt}
	encoded, err := json.Marshal(edit)
	if err != nil {
		t.Fatal(err)
	}
	assertStatus(call("PATCH", seriesPath, string(encoded), "viewer", ""), 403)
	assertStatus(call("PATCH", seriesPath, string(encoded), "author", ""), 200)
	assertStatus(call("PATCH", seriesPath, string(encoded), "author", ""), 409)
	loadSeries()
	if !detail.Data.Work.IsComplete || detail.Data.Work.ResourceID != second.ID || detail.Data.Episodes[0].ID != secondID || detail.Data.Episodes[1].ID != firstID {
		t.Fatal("reordering changed episode IDs or preview binding")
	}
	assertStatus(call("GET", "/api/theatre/works?kind=short_drama", "", "viewer", ""), 200)
	assertStatus(call("GET", "/api/theatre/works?kind=unknown", "", "viewer", ""), 400)
	assertStatus(call("DELETE", seriesPath, "", "author", ""), 200)
	assertStatus(call("GET", seriesPath, "", "viewer", ""), 404)
	assertStatus(call("GET", episodePath, "", "viewer", ""), 404)
	var episodeRows int64
	if err := db.Model(&model.TheatreEpisode{}).Where("work_id = ?", created.Data.Work.ID).Count(&episodeRows).Error; err != nil || episodeRows != 0 {
		t.Fatalf("episode rows after unpublish=%d, %v", episodeRows, err)
	}
}
