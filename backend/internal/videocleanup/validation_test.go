package videocleanup

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestVideoCleanupMetadataLimits(t *testing.T) {
	for _, tc := range []struct {
		name, duration, format, rate string
		width, height                int
		valid                        bool
	}{
		{"valid", "3.125", "mov,mp4,m4a,3gp,3g2,mj2", "24/1", 640, 360, true},
		{"upper_limit", "15", "mov,mp4", "60/1", 4096, 2304, true},
		{"truncation", "15.1", "mov,mp4", "24/1", 640, 360, false},
		{"short", "2.9", "mov,mp4", "24/1", 640, 360, false},
		{"invalid_duration", "NaN", "mov,mp4", "24/1", 640, 360, false},
		{"format", "3", "matroska,webm", "24/1", 640, 360, false},
		{"small", "3", "mov,mp4", "24/1", 480, 270, false},
		{"ratio", "3", "mov,mp4", "24/1", 1920, 360, false},
		{"fps", "3", "mov,mp4", "120/1", 640, 360, false},
		{"zero_fps", "3", "mov,mp4", "0/0", 640, 360, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := []byte(fmt.Sprintf(`{"streams":[{"width":%d,"height":%d,"avg_frame_rate":%q}],"format":{"duration":%q,"format_name":%q}}`, tc.width, tc.height, tc.rate, tc.duration, tc.format))
			meta, err := ParseMetadata(data)
			if (err == nil) != tc.valid {
				t.Fatalf("metadata=%#v err=%v", meta, err)
			}
			if tc.valid && (meta.Width != tc.width || meta.DurationMs <= 0) {
				t.Fatalf("metadata=%#v", meta)
			}
		})
	}
	if _, err := ParseMetadata([]byte(`{"streams":[]}`)); err == nil {
		t.Fatal("missing video stream accepted")
	}
}

func TestVideoCleanupProbeUsesFileInsteadOfUploadedMetadata(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
	path := filepath.Join(t.TempDir(), "source.mp4")
	if output, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=white:s=640x360:r=24", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", path).CombinedOutput(); err != nil {
		t.Fatalf("fixture: %v %s", err, output)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	meta, err := Probe(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	if meta.Width != 640 || meta.Height != 360 || meta.DurationMs != 3000 {
		t.Fatalf("metadata=%#v", meta)
	}
	if _, err := Probe(bytes.NewReader([]byte("not a video"))); err == nil {
		t.Fatal("corrupt video accepted")
	}
}
