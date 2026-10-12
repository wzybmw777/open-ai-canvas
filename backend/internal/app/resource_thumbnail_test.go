package app

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func TestResourceThumbnailLifecycleAndAuthorization(t *testing.T) {
	svc, _, dataDir := newResourceDeletionTestService(t)
	source := image.NewNRGBA(image.Rect(0, 0, 1600, 800))
	for y := 0; y < 800; y++ {
		for x := 0; x < 1600; x++ {
			source.SetNRGBA(x, y, color.NRGBA{uint8(x), uint8(y), 90, 255})
		}
	}
	var original bytes.Buffer
	if err := png.Encode(&original, source); err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{ID: "thumb-resource", UserID: "user-1", Provider: "local", ObjectKey: "users/user-1/image/test.png", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: int64(original.Len()), ETag: "original-etag", ThumbnailStatus: "processing"}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
	if err := writeLocalResourceObject(path, bytes.NewReader(original.Bytes())); err != nil {
		t.Fatal(err)
	}
	if err := svc.generateResourceThumbnail(resource); err != nil {
		t.Fatal(err)
	}
	ready, err := svc.repo.ResourceForUser("user-1", resource.ID)
	if err != nil {
		t.Fatal(err)
	}
	if ready.ThumbnailStatus != "ready" || ready.ThumbnailWidth != 960 || ready.ThumbnailHeight != 480 {
		t.Fatalf("preview not ready: %#v", ready)
	}
	delivery, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceAccessOptions{Purpose: assets.PurposeDisplay, Variant: assets.VariantThumbnail}, "")
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Access.ActualVariant != assets.VariantThumbnail || delivery.Stream.Resource.MimeType != ready.ThumbnailMimeType {
		t.Fatal("served original instead of preview")
	}
	data, err := io.ReadAll(delivery.Stream.Body)
	delivery.Stream.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	preview, _, err := image.Decode(bytes.NewReader(data))
	if err != nil || preview.Bounds().Dx() != 960 {
		t.Fatal("invalid preview", err)
	}
	if _, err := svc.PrepareResourceDelivery("user-2", resource.ID, ResourceAccessOptions{Variant: assets.VariantThumbnail}, ""); err == nil {
		t.Fatal("cross-account preview allowed")
	}
	access, err := svc.resolveResourceAccess(ready, ResourceAccessOptions{Purpose: assets.PurposeDownload, Variant: assets.VariantThumbnail})
	if err != nil || access.ActualVariant != assets.VariantOriginal {
		t.Fatal("download lost original", err)
	}
	unmodified, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(unmodified, original.Bytes()) {
		t.Fatal("original modified", err)
	}
	if err := svc.deleteStoredResourceObject("user-1", ready); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{path, path + ".thumbnail-v1"} {
		if _, err := os.Stat(file); !os.IsNotExist(err) {
			t.Fatal("media remained after deletion", file, err)
		}
	}
}

func TestResourceThumbnailClaimCannotDuplicateOrResurrect(t *testing.T) {
	svc := newResourceTestService(t)
	resource := &model.Resource{ID: "claim-thumb", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, ObjectKey: "photo.png"}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 2; index++ {
		claimed, err := svc.repo.ClaimResourceThumbnail(resource.UserID, resource.ID, time.Now())
		if err != nil || claimed != (index == 0) {
			t.Fatal("duplicate claim", claimed, err)
		}
	}
	if err := svc.repo.DeleteResource(resource.UserID, resource.ID); err != nil {
		t.Fatal(err)
	}
	updated, err := svc.repo.FinishResourceThumbnail(resource, map[string]any{"thumbnail_status": "ready"})
	if err != nil || updated {
		t.Fatal("deleted row resurrected", updated, err)
	}
}
