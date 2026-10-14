package imagecleanup

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func fixture(t *testing.T, width, height int, fill color.Color) []byte {
	t.Helper()
	i := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			i.Set(x, y, fill)
		}
	}
	var b bytes.Buffer
	if err := png.Encode(&b, i); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func TestImageCleanupAlphaMaskValidation(t *testing.T) {
	source := fixture(t, 2, 2, color.White)
	for _, test := range []struct {
		name string
		mask []byte
	}{
		{"empty", fixture(t, 2, 2, color.White)},
		{"size", fixture(t, 3, 2, color.Transparent)},
		{"partial alpha", fixture(t, 2, 2, color.NRGBA{R: 255, A: 128})},
		{"invalid", []byte("not an image")},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := Validate(source, test.mask); err == nil {
				t.Fatal("invalid mask accepted")
			}
		})
	}
	if _, err := Validate(source, fixture(t, 2, 2, color.Transparent)); err != nil {
		t.Fatal(err)
	}
	if _, err := Dimensions(source[:len(source)-12]); err == nil {
		t.Fatal("truncated source accepted")
	}
	if _, err := Dimensions(make([]byte, MaxBytes+1)); err == nil {
		t.Fatal("oversized file accepted")
	}
	if _, err := Dimensions(fixture(t, MaxDimension+1, 1, color.White)); err == nil {
		t.Fatal("oversized dimensions accepted")
	}
}
