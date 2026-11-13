package api

import (
	"encoding/binary"
	"errors"
	"math"
	"net"
	"strings"
)

// 与客户端 panelClubPlayerInfo.EncodeIp 保持同一规则：
// IPv4 -> uint32 -> 6 位 Base62（左补 0），字母表区分大小写。
const ipCodeAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

// EncodeIPCode 把 IPv4 转成 6 位短码；非 IPv4 返回空串。
func EncodeIPCode(ip string) string {
	parsed := net.ParseIP(strings.TrimSpace(ip)).To4()
	if parsed == nil {
		return ""
	}
	value := binary.BigEndian.Uint32(parsed)
	code := make([]byte, 6)
	for i := 5; i >= 0; i-- {
		code[i] = ipCodeAlphabet[value%62]
		value /= 62
	}
	return string(code)
}

// DecodeIPCode 把 6 位短码还原成 IPv4。
func DecodeIPCode(code string) (string, error) {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return "", errors.New("IP短码必须是 6 位")
	}
	var value uint64
	for i := 0; i < len(code); i++ {
		index := strings.IndexByte(ipCodeAlphabet, code[i])
		if index < 0 {
			return "", errors.New("IP短码包含非法字符")
		}
		value = value*62 + uint64(index)
		if value > math.MaxUint32 {
			return "", errors.New("IP短码超出范围")
		}
	}
	var buf [4]byte
	binary.BigEndian.PutUint32(buf[:], uint32(value))
	return net.IP(buf[:]).String(), nil
}
