package assets

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func TestMakeThumbnailResizesAndPreservesTransparency(t *testing.T) {
	for _, transparent := range []bool{false, true} {
		source := image.NewNRGBA(image.Rect(0, 0, 1920, 1080))
		for y := 0; y < 1080; y++ {
			for x := 0; x < 1920; x++ {
				alpha := uint8(255)
				if transparent && x < 200 {
					alpha = 0
				}
				source.SetNRGBA(x, y, color.NRGBA{uint8(x), uint8(y), 100, alpha})
			}
		}
		var original bytes.Buffer
		if err := png.Encode(&original, source); err != nil {
			t.Fatal(err)
		}
		preview, err := MakeThumbnail(bytes.NewReader(original.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		if preview.Width != 960 || preview.Height != 540 {
			t.Fatalf("wrong aspect ratio: %#v", preview)
		}
		decoded, _, err := image.Decode(bytes.NewReader(preview.Data))
		if err != nil {
			t.Fatal(err)
		}
		_, _, _, alpha := decoded.At(0, 0).RGBA()
		if transparent && (alpha != 0 || preview.MimeType != "image/png") {
			t.Fatal("lost transparency")
		}
		if !transparent && len(preview.Data) >= original.Len() {
			t.Fatal("opaque preview not compressed")
		}
	}
}

func TestMakeThumbnailDoesNotUpscaleAndRejectsInvalidImages(t *testing.T) {
	var original bytes.Buffer
	if err := png.Encode(&original, image.NewRGBA(image.Rect(0, 0, 24, 12))); err != nil {
		t.Fatal(err)
	}
	preview, err := MakeThumbnail(bytes.NewReader(original.Bytes()))
	if err != nil || preview.Width != 24 || preview.Height != 12 {
		t.Fatal("small image enlarged", err)
	}
	if _, err := MakeThumbnail(bytes.NewBufferString("not an image")); err == nil {
		t.Fatal("accepted invalid image")
	}
	if _, err := MakeThumbnail(bytes.NewReader(make([]byte, ThumbnailMaxBytes+1))); err == nil {
		t.Fatal("accepted oversized image")
	}
}

func TestMakeThumbnailAppliesPhonePhotoOrientation(t *testing.T) {
	var original bytes.Buffer
	if err := jpeg.Encode(&original, image.NewRGBA(image.Rect(0, 0, 40, 20)), nil); err != nil {
		t.Fatal(err)
	}
	exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	segment := []byte{0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(segment[2:], uint16(len(exif)+2))
	data := append([]byte{}, original.Bytes()[:2]...)
	data = append(data, segment...)
	data = append(data, exif...)
	data = append(data, original.Bytes()[2:]...)
	preview, err := MakeThumbnail(bytes.NewReader(data))
	if err != nil || preview.Width != 20 || preview.Height != 40 {
		t.Fatal("phone orientation lost", err)
	}
}
