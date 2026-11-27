package api

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"math"
	"math/big"
	"net/http"
	"sync"
	"time"
)

// 注册滑动验证（自研，不依赖第三方 SDK）。
//
// 设计要点：
//   - 一次一码：校验时立即取出并标记为已用，成功失败都作废，防重放；
//   - 短 TTL：默认 2 分钟，避免攻击者批量囤码慢慢解；
//   - 不依赖客户端 IP：高防四层转发拿不到真实 IP，所以校验只认 captchaId；
//   - 校验偏移 + 拖动轨迹 + 耗时三项，抬高脚本与打码平台的成本。
const (
	captchaImageWidth  = 320
	captchaImageHeight = 160
	captchaPieceSize   = 50
	captchaMinOffset   = 80
	captchaTTL         = 120 * time.Second
	captchaTolerance   = 10
	captchaMinElapsed  = 250
	captchaMinTrackLen = 3
)

type captchaEntry struct {
	answer   int
	expireAt time.Time
	used     bool
}

type captchaStore struct {
	mu    sync.Mutex
	items map[string]*captchaEntry
}

func newCaptchaStore() *captchaStore {
	return &captchaStore{items: make(map[string]*captchaEntry)}
}

func (s *captchaStore) put(id string, answer int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.items[id] = &captchaEntry{answer: answer, expireAt: time.Now().Add(captchaTTL)}
}

// take 取出并立即标记已用：即使后续校验失败也不能二次提交。
func (s *captchaStore) take(id string) (*captchaEntry, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.items[id]
	if !ok {
		return nil, false
	}
	if entry.used || time.Now().After(entry.expireAt) {
		delete(s.items, id)
		return nil, false
	}
	entry.used = true
	return entry, true
}

func (s *captchaStore) sweep() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for id, entry := range s.items {
		if entry.used || now.After(entry.expireAt) {
			delete(s.items, id)
		}
	}
}

// captchaJanitor 定期清理过期/已用的验证码，避免内存无限增长。
// 进程退出时 goroutine 随进程结束，不需要额外的取消信号。
func (s *Server) captchaJanitor() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.captcha.sweep()
	}
}

// captchaErrorMessage 把校验码转成给玩家看的提示。
func captchaErrorMessage(code string) string {
	switch code {
	case "CAPTCHA_REQUIRED":
		return "请先完成滑动验证"
	case "CAPTCHA_TOO_FAST":
		return "操作过快，请重新拖动滑块"
	default:
		return "验证未通过，请重试"
	}
}

func randomInt(max int) int {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(max)))
	if err != nil {
		return int(time.Now().UnixNano()) % max
	}
	return int(n.Int64())
}

func randomID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		binary.BigEndian.PutUint64(buf, uint64(time.Now().UnixNano()))
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

// renderCaptchaImage 生成背景图（带缺口）与拼图块，返回 base64 PNG。
//
// 体积是硬约束：注册口是独立端口直连（高防四层转发），响应体过大时会被链路截断，
// 客户端表现为 ERR_EMPTY_RESPONSE。所以噪点按 4×4 块铺（逐像素随机噪点会让 PNG 完全压不动，
// 单张能到 90KB），输出前再量化成调色板图，最终整包控制在 20KB 以内。
func renderCaptchaImage(answer, posY int) (string, string, error) {
	bg := image.NewRGBA(image.Rect(0, 0, captchaImageWidth, captchaImageHeight))
	baseR := uint8(60 + randomInt(80))
	baseG := uint8(70 + randomInt(80))
	baseB := uint8(80 + randomInt(80))
	const noiseBlock = 4
	for blockY := 0; blockY < captchaImageHeight; blockY += noiseBlock {
		for blockX := 0; blockX < captchaImageWidth; blockX += noiseBlock {
			noise := uint8(randomInt(36))
			maxY := blockY + noiseBlock
			if maxY > captchaImageHeight {
				maxY = captchaImageHeight
			}
			maxX := blockX + noiseBlock
			if maxX > captchaImageWidth {
				maxX = captchaImageWidth
			}
			for y := blockY; y < maxY; y++ {
				ratio := float64(y) / float64(captchaImageHeight)
				for x := blockX; x < maxX; x++ {
					bg.SetRGBA(x, y, color.RGBA{
						R: uint8(float64(baseR)*(1-ratio*0.5)) + noise/2,
						G: uint8(float64(baseG)*(1-ratio*0.3)) + noise/2,
						B: uint8(float64(baseB)*(1-ratio*0.2)) + noise/2,
						A: 255,
					})
				}
			}
		}
	}
	// 若干干扰线
	for i := 0; i < 6; i++ {
		x0, y0 := randomInt(captchaImageWidth), randomInt(captchaImageHeight)
		x1, y1 := randomInt(captchaImageWidth), randomInt(captchaImageHeight)
		drawLine(bg, x0, y0, x1, y1, color.RGBA{uint8(randomInt(255)), uint8(randomInt(255)), uint8(randomInt(255)), 120})
	}

	// 拼图块从背景同位置裁出（保留原纹理，避免纯色块被一眼识别）
	piece := image.NewRGBA(image.Rect(0, 0, captchaPieceSize, captchaPieceSize))
	draw.Draw(piece, piece.Bounds(), bg, image.Pt(answer, posY), draw.Src)
	// 缺口用暗块标出来
	hole := color.RGBA{0, 0, 0, 110}
	draw.Draw(bg, image.Rect(answer, posY, answer+captchaPieceSize, posY+captchaPieceSize),
		&image.Uniform{hole}, image.Point{}, draw.Over)

	bgBuf, err := encodeCaptchaPNG(bg)
	if err != nil {
		return "", "", err
	}
	pieceBuf, err := encodeCaptchaPNG(piece)
	if err != nil {
		return "", "", err
	}
	return base64.StdEncoding.EncodeToString(bgBuf.Bytes()),
		base64.StdEncoding.EncodeToString(pieceBuf.Bytes()), nil
}

// captchaPalette 是 6×6×6 的固定调色板：既要保住渐变和干扰线的观感，
// 又要让 PNG8 编码出来的体积远小于真彩色。
func captchaPalette() color.Palette {
	palette := make(color.Palette, 0, 216)
	for r := 0; r < 6; r++ {
		for g := 0; g < 6; g++ {
			for b := 0; b < 6; b++ {
				palette = append(palette, color.RGBA{uint8(r * 51), uint8(g * 51), uint8(b * 51), 255})
			}
		}
	}
	return palette
}

// encodeCaptchaPNG 先量化到调色板再按最高压缩率编码，体积约为原来的 1/6。
func encodeCaptchaPNG(src image.Image) (*bytes.Buffer, error) {
	paletted := image.NewPaletted(src.Bounds(), captchaPalette())
	draw.Draw(paletted, paletted.Bounds(), src, src.Bounds().Min, draw.Src)
	var buf bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.BestCompression}
	if err := encoder.Encode(&buf, paletted); err != nil {
		return nil, err
	}
	return &buf, nil
}

func drawLine(img *image.RGBA, x0, y0, x1, y1 int, c color.RGBA) {
	dx := math.Abs(float64(x1 - x0))
	dy := math.Abs(float64(y1 - y0))
	steps := int(math.Max(dx, dy))
	if steps == 0 {
		return
	}
	for i := 0; i <= steps; i++ {
		t := float64(i) / float64(steps)
		x := int(float64(x0) + t*float64(x1-x0))
		y := int(float64(y0) + t*float64(y1-y0))
		if x >= 0 && x < captchaImageWidth && y >= 0 && y < captchaImageHeight {
			img.SetRGBA(x, y, c)
		}
	}
}

type captchaResponse struct {
	CaptchaID  string `json:"captchaId"`
	Background string `json:"background"`
	Puzzle     string `json:"puzzle"`
	PuzzleY    int    `json:"puzzleY"`
	ExpiresIn  int    `json:"expiresIn"`
}

// handleRegistrationCaptcha GET /api/game/registration-captcha
func (s *Server) handleRegistrationCaptcha(w http.ResponseWriter, r *http.Request) {
	setRegistrationCORS(w)
	answer := captchaMinOffset + randomInt(captchaImageWidth-captchaPieceSize-captchaMinOffset)
	posY := randomInt(captchaImageHeight - captchaPieceSize)
	bg, piece, err := renderCaptchaImage(answer, posY)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "CAPTCHA_RENDER_FAILED", "验证码生成失败，请稍后重试")
		return
	}
	id := randomID()
	s.captcha.put(id, answer)
	writeData(w, http.StatusOK, captchaResponse{
		CaptchaID: id, Background: bg, Puzzle: piece, PuzzleY: posY,
		ExpiresIn: int(captchaTTL / time.Second),
	})
}

// checkRegistrationCaptcha 校验验证码；返回错误码，空串表示通过。
//
// track 是拖动过程中的 x 采样点。要求非空且至少 3 点，用来挡住「算好坐标直接 POST」。
func (s *Server) checkRegistrationCaptcha(id string, offset, elapsed int, track []int) string {
	if id == "" {
		return "CAPTCHA_REQUIRED"
	}
	entry, ok := s.captcha.take(id)
	if !ok {
		return "CAPTCHA_INVALID"
	}
	if math.Abs(float64(offset-entry.answer)) > captchaTolerance {
		return "CAPTCHA_INVALID"
	}
	if elapsed < captchaMinElapsed {
		return "CAPTCHA_TOO_FAST"
	}
	if len(track) < captchaMinTrackLen {
		return "CAPTCHA_INVALID"
	}
	if !trackLooksHuman(track) {
		return "CAPTCHA_INVALID"
	}
	return ""
}

// trackLooksHuman 粗判拖动轨迹：纯线性匀速（脚本算出来的）方差极小。
func trackLooksHuman(track []int) bool {
	if len(track) < 3 {
		return false
	}
	var sum, sumSq float64
	n := float64(len(track) - 1)
	for i := 1; i < len(track); i++ {
		d := float64(track[i] - track[i-1])
		sum += d
		sumSq += d * d
	}
	mean := sum / n
	variance := sumSq/n - mean*mean
	// 只排除「完全匀速」这种脚本特征：人拖的相邻位移多少有抖动。
	// 阈值不能定高，否则正常玩家快速拖动（位移接近）也会被误判。
	return variance > 0.05
}

// decodeTrack 解析客户端提交的轨迹（JSON 数组）。
func decodeTrack(raw string) []int {
	if raw == "" {
		return nil
	}
	var track []int
	if err := json.Unmarshal([]byte(raw), &track); err != nil {
		return nil
	}
	return track
}

// handleRegistrationConfig GET /api/game/registration-config
//
// 让客户端在提交注册前先问「要不要滑动验证」，避免先故意发一个必然 400 的请求：
// 控制台一片红字，配置排查时很容易误判成接口坏了。
func (s *Server) handleRegistrationConfig(w http.ResponseWriter, r *http.Request) {
	setRegistrationCORS(w)
	writeData(w, http.StatusOK, map[string]any{
		"captchaRequired": s.registrationCaptchaEnabled(r.Context()),
	})
}
