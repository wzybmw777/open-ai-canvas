// Package videocleanup validates short videos before model admission and billing.
package videocleanup

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const MaxBytes = 100 << 20

type Metadata struct {
	Width      int
	Height     int
	DurationMs int64
}

func Probe(reader io.Reader) (Metadata, error) {
	file, err := os.CreateTemp("", "yingce-video-cleanup-*.mp4")
	if err != nil {
		return Metadata{}, err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	n, err := io.Copy(file, io.LimitReader(reader, MaxBytes+1))
	if err != nil {
		return Metadata{}, err
	}
	if n == 0 || n > MaxBytes {
		return Metadata{}, errors.New("视频文件须小于等于 100MB")
	}
	if err := file.Close(); err != nil {
		return Metadata{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	data, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", "v:0", "-show_entries", "stream=width,height,avg_frame_rate:format=duration,format_name", "-of", "json", file.Name()).Output()
	if err != nil {
		return Metadata{}, errors.New("视频无法解析，请使用完整的 MP4 或 MOV 文件")
	}
	return ParseMetadata(data)
}

func ParseMetadata(data []byte) (Metadata, error) {
	var result struct {
		Streams []struct {
			Width     int    `json:"width"`
			Height    int    `json:"height"`
			FrameRate string `json:"avg_frame_rate"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
			Name     string `json:"format_name"`
		} `json:"format"`
	}
	if json.Unmarshal(data, &result) != nil || len(result.Streams) != 1 || !strings.Contains(result.Format.Name, "mp4") {
		return Metadata{}, errors.New("仅支持包含视频画面的 MP4 或 MOV 文件")
	}
	stream := result.Streams[0]
	duration, err := strconv.ParseFloat(result.Format.Duration, 64)
	if err != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration < 3 || duration > 15 {
		return Metadata{}, errors.New("当前版本支持 3–15 秒视频，请先裁剪后上传")
	}
	if min(stream.Width, stream.Height) < 360 || max(stream.Width, stream.Height) > 4096 || float64(max(stream.Width, stream.Height))/float64(min(stream.Width, stream.Height)) > 2.5 {
		return Metadata{}, errors.New("视频短边须至少 360 像素，长边不超过 4096，比例在 1:2.5 至 2.5:1 之间")
	}
	parts := strings.Split(stream.FrameRate, "/")
	var fps float64
	if len(parts) == 2 {
		a, _ := strconv.ParseFloat(parts[0], 64)
		b, _ := strconv.ParseFloat(parts[1], 64)
		if b != 0 {
			fps = a / b
		}
	}
	if math.IsNaN(fps) || math.IsInf(fps, 0) || fps < 8 || fps > 60 {
		return Metadata{}, errors.New("视频帧率须在 8–60 fps 之间")
	}
	return Metadata{Width: stream.Width, Height: stream.Height, DurationMs: int64(math.Ceil(duration * 1000))}, nil
}
