// Package realtime 是一个最小可用的 WebSocket(RFC 6455) 实现，只服务于本项目：
// 后台 → Worker 节点的下行推送、后台页面的 SSE 与在线状态通知。
//
// 刻意不引第三方库（后端目前只依赖 mysql 驱动与 x/crypto），也没有实现：
// 压缩扩展、子协议协商、二进制分片以外的扩展能力。文本帧 + 分片 + ping/pong 足够用。
package realtime

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/tls"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	opContinuation byte = 0x0
	opText         byte = 0x1
	opBinary       byte = 0x2
	opClose        byte = 0x8
	opPing         byte = 0x9
	opPong         byte = 0xA

	webSocketGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	// 单条消息上限：牌桌快照这类 payload 也在几十 KB 内，1 MB 足够宽松。
	maxMessageBytes = 1 << 20
)

// Conn 是一条已建立的 WebSocket 连接。读只能有一个 goroutine，写有内部锁可多协程调用。
type Conn struct {
	conn net.Conn
	br   *bufio.Reader

	writeMu   sync.Mutex
	closeMu   sync.Once
	closeErr  error
	closed    chan struct{}
	closeText string
}

func newConn(conn net.Conn, br *bufio.Reader) *Conn {
	if br == nil {
		br = bufio.NewReader(conn)
	}
	return &Conn{conn: conn, br: br, closed: make(chan struct{})}
}

// RemoteAddr 返回底层连接的对端地址。
func (c *Conn) RemoteAddr() net.Addr { return c.conn.RemoteAddr() }

// SetReadDeadline 设置读超时；服务端用它把「连接还在但不再发心跳」的节点踢掉。
func (c *Conn) SetReadDeadline(deadline time.Time) error { return c.conn.SetReadDeadline(deadline) }

// Upgrade 把一条普通 HTTP 请求升级为 WebSocket（服务端）。
// 调用方应先完成鉴权，再调用本函数。
func Upgrade(w http.ResponseWriter, r *http.Request) (*Conn, error) {
	if !strings.EqualFold(strings.TrimSpace(r.Header.Get("Upgrade")), "websocket") {
		return nil, errors.New("不是 websocket 升级请求")
	}
	if !headerHasToken(r.Header.Get("Connection"), "upgrade") {
		return nil, errors.New("Connection 头缺少 upgrade")
	}
	if strings.TrimSpace(r.Header.Get("Sec-WebSocket-Version")) != "13" {
		return nil, errors.New("只支持 WebSocket 版本 13")
	}
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" {
		return nil, errors.New("缺少 Sec-WebSocket-Key")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("当前 http.ResponseWriter 不支持 Hijack")
	}
	netConn, buf, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	// 升级完成后这条连接不再受 http.Server 的超时/读写控制。
	_ = netConn.SetDeadline(time.Time{})
	response := "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
	if _, err := buf.WriteString(response); err != nil {
		_ = netConn.Close()
		return nil, err
	}
	if err := buf.Flush(); err != nil {
		_ = netConn.Close()
		return nil, err
	}
	return newConn(netConn, buf.Reader), nil
}

// Dial 作为客户端连接服务端（支持 ws:// 与 wss://）。
func Dial(ctx context.Context, rawURL string, header http.Header) (*Conn, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "ws" && scheme != "wss" {
		return nil, fmt.Errorf("不支持的 scheme %q（只支持 ws/wss）", parsed.Scheme)
	}
	host := parsed.Host
	if _, _, err := net.SplitHostPort(host); err != nil {
		if scheme == "wss" {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	raw, err := dialer.DialContext(ctx, "tcp", host)
	if err != nil {
		return nil, err
	}
	if scheme == "wss" {
		serverName := parsed.Hostname()
		tlsConn := tls.Client(raw, &tls.Config{ServerName: serverName, MinVersion: tls.VersionTLS12})
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			_ = raw.Close()
			return nil, err
		}
		raw = tlsConn
	}
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		_ = raw.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	target := parsed.RequestURI()
	if target == "" {
		target = "/"
	}
	var builder strings.Builder
	fmt.Fprintf(&builder, "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n", target, parsed.Host)
	fmt.Fprintf(&builder, "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n", key)
	for name, values := range header {
		switch strings.ToLower(name) {
		case "upgrade", "connection", "sec-websocket-key", "sec-websocket-version", "host":
			continue
		}
		for _, value := range values {
			fmt.Fprintf(&builder, "%s: %s\r\n", name, value)
		}
	}
	builder.WriteString("\r\n")
	if _, err := io.WriteString(raw, builder.String()); err != nil {
		_ = raw.Close()
		return nil, err
	}
	reader := bufio.NewReader(raw)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodGet})
	if err != nil {
		_ = raw.Close()
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusSwitchingProtocols {
		_ = raw.Close()
		return nil, fmt.Errorf("握手失败：HTTP %d", response.StatusCode)
	}
	if got := response.Header.Get("Sec-WebSocket-Accept"); got != acceptKey(key) {
		_ = raw.Close()
		return nil, errors.New("握手失败：Sec-WebSocket-Accept 不匹配")
	}
	return newConn(raw, reader), nil
}

func acceptKey(key string) string {
	sum := sha1.Sum([]byte(key + webSocketGUID))
	return base64.StdEncoding.EncodeToString(sum[:])
}

func headerHasToken(value, token string) bool {
	for _, part := range strings.Split(value, ",") {
		if strings.EqualFold(strings.TrimSpace(part), token) {
			return true
		}
	}
	return false
}

// ReadMessage 读一条完整消息（自动处理分片与 ping/pong）。收到 close 时返回 io.EOF。
func (c *Conn) ReadMessage() ([]byte, error) {
	var payload []byte
	started := false
	for {
		opcode, fin, data, err := c.readFrame()
		if err != nil {
			return nil, err
		}
		switch opcode {
		case opPing:
			if err := c.writeFrame(opPong, data); err != nil {
				return nil, err
			}
			continue
		case opPong:
			continue
		case opClose:
			_ = c.writeFrame(opClose, nil)
			c.closeWith(errors.New("对端关闭连接"))
			return nil, io.EOF
		case opText, opBinary:
			if started {
				return nil, errors.New("协议错误：上一条消息还没结束")
			}
			started = true
			payload = data
			if fin {
				return payload, nil
			}
		case opContinuation:
			if !started {
				return nil, errors.New("协议错误：缺少起始帧")
			}
			if len(payload)+len(data) > maxMessageBytes {
				return nil, errors.New("消息过大")
			}
			payload = append(payload, data...)
			if fin {
				return payload, nil
			}
		default:
			return nil, fmt.Errorf("不支持的操作码 0x%x", opcode)
		}
	}
}

func (c *Conn) readFrame() (opcode byte, fin bool, payload []byte, err error) {
	var header [2]byte
	if _, err = io.ReadFull(c.br, header[:]); err != nil {
		return
	}
	fin = header[0]&0x80 != 0
	if header[0]&0x70 != 0 {
		err = errors.New("协议错误：不支持 RSV 扩展位")
		return
	}
	opcode = header[0] & 0x0F
	masked := header[1]&0x80 != 0
	length := int64(header[1] & 0x7F)
	switch length {
	case 126:
		var extended [2]byte
		if _, err = io.ReadFull(c.br, extended[:]); err != nil {
			return
		}
		length = int64(binary.BigEndian.Uint16(extended[:]))
	case 127:
		var extended [8]byte
		if _, err = io.ReadFull(c.br, extended[:]); err != nil {
			return
		}
		value := binary.BigEndian.Uint64(extended[:])
		if value > maxMessageBytes {
			err = errors.New("消息过大")
			return
		}
		length = int64(value)
	}
	if length > maxMessageBytes {
		err = errors.New("消息过大")
		return
	}
	var mask [4]byte
	if masked {
		if _, err = io.ReadFull(c.br, mask[:]); err != nil {
			return
		}
	}
	payload = make([]byte, length)
	if _, err = io.ReadFull(c.br, payload); err != nil {
		return
	}
	if masked {
		for index := range payload {
			payload[index] ^= mask[index%4]
		}
	}
	return
}

func (c *Conn) writeFrame(opcode byte, payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	select {
	case <-c.closed:
		return errors.New("连接已关闭")
	default:
	}
	header := make([]byte, 0, 10)
	header = append(header, 0x80|opcode)
	length := len(payload)
	switch {
	case length < 126:
		header = append(header, byte(length))
	case length <= 0xFFFF:
		header = append(header, 126, byte(length>>8), byte(length))
	default:
		header = append(header, 127)
		var extended [8]byte
		binary.BigEndian.PutUint64(extended[:], uint64(length))
		header = append(header, extended[:]...)
	}
	_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if _, err := c.conn.Write(header); err != nil {
		return err
	}
	if length == 0 {
		return nil
	}
	_, err := c.conn.Write(payload)
	return err
}

// WriteText 发送一条文本消息。
func (c *Conn) WriteText(payload []byte) error { return c.writeFrame(opText, payload) }

// WriteJSON 以文本帧发送 JSON。
func (c *Conn) WriteJSON(value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.WriteText(encoded)
}

// Ping 主动发一个 ping（客户端可用来探测半开连接）。
func (c *Conn) Ping(payload []byte) error { return c.writeFrame(opPing, payload) }

// Close 发送 close 帧并关闭底层连接，可重复调用。
func (c *Conn) Close() error {
	c.closeWith(errors.New("本地关闭连接"))
	return nil
}

func (c *Conn) closeWith(reason error) {
	c.closeMu.Do(func() {
		c.closeErr = reason
		close(c.closed)
		_ = c.conn.Close()
	})
}
