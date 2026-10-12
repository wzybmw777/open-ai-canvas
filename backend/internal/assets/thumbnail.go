package assets

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const ThumbnailMaxEdge = 960
const ThumbnailMaxBytes = 32 << 20
const ThumbnailMaxPixels = 40_000_000

type Thumbnail struct {
	Data                          []byte
	MimeType                      string
	Width, Height                 int
	OriginalWidth, OriginalHeight int
}

func ThumbnailObjectKey(original string) string { return original + ".thumbnail-v1" }

// DecodeConfig bounds memory before decoding an untrusted upload. Transparent
// images keep their alpha channel; opaque images use a compact JPEG preview.
func MakeThumbnail(reader io.Reader) (*Thumbnail, error) {
	data, err := io.ReadAll(io.LimitReader(reader, ThumbnailMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > ThumbnailMaxBytes {
		return nil, errors.New("图片超过缩略图处理大小限制")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > ThumbnailMaxPixels {
		return nil, errors.New("图片超过缩略图处理像素限制")
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	source = orientedJPEG(source, data)
	width, height := source.Bounds().Dx(), source.Bounds().Dy()
	if width > ThumbnailMaxEdge || height > ThumbnailMaxEdge {
		if width >= height {
			height = max(1, height*ThumbnailMaxEdge/width)
			width = ThumbnailMaxEdge
		} else {
			width = max(1, width*ThumbnailMaxEdge/height)
			height = ThumbnailMaxEdge
		}
	}
	preview := image.NewNRGBA(image.Rect(0, 0, width, height))
	draw.ApproxBiLinear.Scale(preview, preview.Bounds(), source, source.Bounds(), draw.Src, nil)
	var encoded bytes.Buffer
	mimeType := "image/png"
	if preview.Opaque() {
		mimeType = "image/jpeg"
		err = jpeg.Encode(&encoded, preview, &jpeg.Options{Quality: 80})
		if err == nil && encoded.Len() >= len(data) {
			// Flat diagrams often compress better as PNG than as JPEG.
			var lossless bytes.Buffer
			if pngErr := png.Encode(&lossless, preview); pngErr == nil && lossless.Len() < encoded.Len() {
				encoded, mimeType = lossless, "image/png"
			}
		}
	} else {
		err = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&encoded, preview)
	}
	if err != nil {
		return nil, err
	}
	return &Thumbnail{Data: encoded.Bytes(), MimeType: mimeType, Width: width, Height: height, OriginalWidth: source.Bounds().Dx(), OriginalHeight: source.Bounds().Dy()}, nil
}

type orientedImage struct {
	image.Image
	orientation int
}

func (i orientedImage) ColorModel() color.Model { return i.Image.ColorModel() }
func (i orientedImage) Bounds() image.Rectangle {
	b := i.Image.Bounds()
	if i.orientation >= 5 {
		return image.Rect(0, 0, b.Dy(), b.Dx())
	}
	return image.Rect(0, 0, b.Dx(), b.Dy())
}
func (i orientedImage) At(x, y int) color.Color {
	b := i.Image.Bounds()
	w, h := b.Dx(), b.Dy()
	switch i.orientation {
	case 2:
		x = w - 1 - x
	case 3:
		x, y = w-1-x, h-1-y
	case 4:
		y = h - 1 - y
	case 5:
		x, y = y, x
	case 6:
		x, y = y, h-1-x
	case 7:
		x, y = w-1-y, h-1-x
	case 8:
		x, y = w-1-y, x
	}
	return i.Image.At(x+b.Min.X, y+b.Min.Y)
}

// Browsers apply JPEG EXIF orientation. Apply the same transform before
// dropping EXIF from the smaller image, so phone photos do not rotate.
func orientedJPEG(source image.Image, data []byte) image.Image {
	if len(data) < 4 || data[0] != 0xff || data[1] != 0xd8 {
		return source
	}
	for pos := 2; pos+4 <= len(data) && data[pos] == 0xff; {
		marker := data[pos+1]
		if marker == 0xda || marker == 0xd9 {
			break
		}
		size := int(binary.BigEndian.Uint16(data[pos+2 : pos+4]))
		if size < 2 || pos+2+size > len(data) {
			break
		}
		segment := data[pos+4 : pos+2+size]
		if marker == 0xe1 && len(segment) >= 14 && bytes.Equal(segment[:6], []byte("Exif\x00\x00")) {
			tiff := segment[6:]
			var order binary.ByteOrder
			if string(tiff[:2]) == "II" {
				order = binary.LittleEndian
			} else if string(tiff[:2]) == "MM" {
				order = binary.BigEndian
			} else {
				return source
			}
			offset := int(order.Uint32(tiff[4:8]))
			if offset < 8 || offset+2 > len(tiff) {
				return source
			}
			count := int(order.Uint16(tiff[offset : offset+2]))
			for index := 0; index < count; index++ {
				start := offset + 2 + 12*index
				if start+12 > len(tiff) {
					break
				}
				entry := tiff[start : start+12]
				if order.Uint16(entry[:2]) == 0x112 && order.Uint16(entry[2:4]) == 3 && order.Uint32(entry[4:8]) == 1 {
					orientation := int(order.Uint16(entry[8:10]))
					if orientation >= 2 && orientation <= 8 {
						return orientedImage{source, orientation}
					}
				}
			}
		}
		pos += size + 2
	}
	return source
}
