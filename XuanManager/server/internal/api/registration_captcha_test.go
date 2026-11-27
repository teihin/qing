package api

import "testing"

// 验证码图片体积是有硬上限的：注册口独立端口直连，响应过大时会被链路截断
// （客户端表现为 ERR_EMPTY_RESPONSE，注册直接进行不下去）。
// 历史事故：逐像素随机的真彩色 PNG 单张 90KB 左右，过不了高防。
func TestCaptchaPayloadStaysSmall(t *testing.T) {
	const maxPayloadBytes = 20000
	for i := 0; i < 10; i++ {
		bg, piece, err := renderCaptchaImage(120, 60)
		if err != nil {
			t.Fatalf("renderCaptchaImage: %v", err)
		}
		if size := len(bg) + len(piece); size > maxPayloadBytes {
			t.Fatalf("captcha payload = %d bytes, want <= %d", size, maxPayloadBytes)
		}
	}
}

func TestCaptchaTrackRejectsUniformScript(t *testing.T) {
	if trackLooksHuman([]int{0, 10, 20, 30, 40}) {
		t.Fatal("uniform track should be treated as script")
	}
	if !trackLooksHuman([]int{0, 12, 19, 35, 38, 52}) {
		t.Fatal("jittered track should pass")
	}
}
