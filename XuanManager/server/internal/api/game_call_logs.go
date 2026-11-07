package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// 游戏服接口日志：只暴露「后端 → 游戏服」的调用与回包，前端调后台自身的请求不会进这里。
// 数据来源就是后端进程自己的 slog 输出（supervise.sh 重定向到 logs/xuanmanager.log），
// 不额外落库，避免给管理库增加写入压力。
const (
	gameCallLogWindowBytes = 1 << 19 // 只读日志尾部 512 KiB，日志涨到几十 MB 也不会拖慢接口
	gameCallLogDefault     = 200
	gameCallLogMax         = 500
	gameCallLogFieldLimit  = 4000
)

type gameCallLogEntry struct {
	Key        string `json:"key"`
	Time       string `json:"time"`
	Level      string `json:"level"`
	Kind       string `json:"kind"` // call=下发游戏服 / result=游戏服回包 / error=调用或回包异常
	Tag        string `json:"tag"`
	Command    string `json:"command"`
	Params     string `json:"params"`
	Result     string `json:"result"`
	RetCode    string `json:"retCode"`
	HTTPStatus string `json:"httpStatus"`
	DurationMS string `json:"durationMs"`
	Error      string `json:"error"`
}

type gameCallLogRecord struct {
	Time       string      `json:"time"`
	Level      string      `json:"level"`
	Msg        string      `json:"msg"`
	Header     string      `json:"header"`
	Params     string      `json:"params"`
	RetCode    json.Number `json:"ret_code"`
	RetResult  string      `json:"ret_result"`
	HTTPStatus json.Number `json:"http_status"`
	DurationMS json.Number `json:"duration_ms"`
	Error      string      `json:"error"`
	Body       string      `json:"body"`
}

func (s *Server) handleGameCallLogs(w http.ResponseWriter, r *http.Request, _ principal) {
	limit := gameCallLogDefault
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			if parsed > gameCallLogMax {
				parsed = gameCallLogMax
			}
			limit = parsed
		}
	}
	path := gameCallLogPath()
	if path == "" {
		writeError(w, http.StatusServiceUnavailable, "GAME_LOG_MISSING", "没有找到后端日志文件，请确认服务由 supervise.sh 启动")
		return
	}
	lines, err := readLogTailLines(path, gameCallLogWindowBytes)
	if err != nil {
		s.logger.Error("read game call log", "error", err, "path", path)
		writeError(w, http.StatusServiceUnavailable, "GAME_LOG_UNREADABLE", "读取后端日志失败")
		return
	}
	entries := parseGameCallLogLines(lines, limit)
	writeData(w, http.StatusOK, map[string]any{
		"entries":   entries,
		"file":      filepath.Base(path),
		"updatedAt": time.Now().Format("2006-01-02 15:04:05"),
	})
}

// gameCallLogPath 优先用 XUAN_LOG_FILE，其次按可执行文件位置推导 bin/../logs/xuanmanager.log。
func gameCallLogPath() string {
	if path := strings.TrimSpace(os.Getenv("XUAN_LOG_FILE")); path != "" {
		return path
	}
	candidates := make([]string, 0, 2)
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(executable), "..", "logs", "xuanmanager.log"))
	}
	if workDir, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(workDir, "logs", "xuanmanager.log"))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func readLogTailLines(path string, window int64) ([]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	offset := int64(0)
	if info.Size() > window {
		offset = info.Size() - window
	}
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, window))
	if err != nil {
		return nil, err
	}
	if offset > 0 {
		// 从中间切入时第一行大概率是半行，直接丢掉。
		if index := bytes.IndexByte(data, '\n'); index >= 0 {
			data = data[index+1:]
		}
	}
	lines := make([]string, 0, 256)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "{") {
			lines = append(lines, line)
		}
	}
	return lines, nil
}

func parseGameCallLogLines(lines []string, limit int) []gameCallLogEntry {
	entries := make([]gameCallLogEntry, 0, limit)
	for _, line := range lines {
		entry, ok := parseGameCallLogLine(line)
		if !ok {
			continue
		}
		entries = append(entries, entry)
	}
	if len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}
	return entries
}

func parseGameCallLogLine(line string) (gameCallLogEntry, bool) {
	var record gameCallLogRecord
	if err := json.Unmarshal([]byte(line), &record); err != nil {
		return gameCallLogEntry{}, false
	}
	msg := record.Msg
	if !strings.HasPrefix(msg, "[游戏服") {
		return gameCallLogEntry{}, false
	}
	tag := msg
	if end := strings.Index(msg, "]"); end > 1 {
		tag = msg[1:end]
	}
	command := strings.TrimSpace(record.Header)
	if command == "" {
		command = fieldFromMessage(msg, "命令")
	}
	kind := "result"
	switch {
	case strings.Contains(tag, "调用失败"), strings.Contains(tag, "失败"), strings.Contains(tag, "错误"):
		kind = "error"
	case strings.Contains(tag, "调用"):
		kind = "call"
	}
	result := record.RetResult
	if result == "" {
		result = record.Body
	}
	return gameCallLogEntry{
		Key:        fmt.Sprintf("%s|%s|%s", record.Time, tag, command),
		Time:       record.Time,
		Level:      record.Level,
		Kind:       kind,
		Tag:        tag,
		Command:    command,
		Params:     clipLogField(record.Params),
		Result:     clipLogField(result),
		RetCode:    record.RetCode.String(),
		HTTPStatus: record.HTTPStatus.String(),
		DurationMS: record.DurationMS.String(),
		Error:      clipLogField(record.Error),
	}, true
}

// fieldFromMessage 是旧格式（msg 里拼 key=value）的兜底解析。
func fieldFromMessage(msg, key string) string {
	index := strings.Index(msg, key+"=")
	if index < 0 {
		return ""
	}
	rest := msg[index+len(key)+1:]
	if end := strings.Index(rest, " | "); end >= 0 {
		rest = rest[:end]
	}
	return strings.TrimSpace(rest)
}

func clipLogField(value string) string {
	if len(value) <= gameCallLogFieldLimit {
		return value
	}
	return value[:gameCallLogFieldLimit] + "…"
}
