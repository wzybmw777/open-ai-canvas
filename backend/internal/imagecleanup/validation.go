// Package imagecleanup validates uploaded image and alpha-mask coordinates.
package imagecleanup

import (
	"bytes"
	"errors"
	"image"
	_ "image/jpeg"
	"image/png"

	_ "golang.org/x/image/webp"
)

const (
	MaxBytes     = 10 << 20
	MaxPixels    = 12_000_000
	MaxDimension = 4096
)

func Dimensions(data []byte) (image.Config, error) {
	if len(data) == 0 || len(data) > MaxBytes {
		return image.Config{}, errors.New("图片文件须小于等于 10MB")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg" && format != "webp") {
		return image.Config{}, errors.New("仅支持 PNG、JPEG 和 WebP 图片")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > MaxDimension || config.Height > MaxDimension || int64(config.Width)*int64(config.Height) > MaxPixels {
		return image.Config{}, errors.New("图片最长边须不超过 4096 像素，总像素须不超过 1200 万")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return image.Config{}, errors.New("图片文件不完整或无法解码")
	}
	return config, nil
}

func Validate(sourceData, maskData []byte) (image.Config, error) {
	config, err := Dimensions(sourceData)
	if err != nil {
		return config, err
	}
	maskConfig, err := Dimensions(maskData)
	if err != nil {
		return config, err
	}
	if config.Width != maskConfig.Width || config.Height != maskConfig.Height {
		return config, errors.New("遮罩尺寸必须与原图一致")
	}
	mask, err := png.Decode(bytes.NewReader(maskData))
	if err != nil {
		return config, errors.New("遮罩必须是 PNG 图片")
	}
	selected := false
	for y := 0; y < config.Height; y++ {
		for x := 0; x < config.Width; x++ {
			_, _, _, a := mask.At(x, y).RGBA()
			if a != 0 && a != 65535 {
				return config, errors.New("遮罩须使用完全透明选区和不透明保留区")
			}
			selected = selected || a == 0
		}
	}
	if !selected {
		return config, errors.New("请先涂抹需要去除的水印")
	}
	return config, nil
}
