package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// 节点侧的配置文件。约定：与可执行文件同目录、文件名 xuanagent.json。
//
// 优先级（后者覆盖前者）：内置默认 < 配置文件 < 环境变量 < 命令行参数。
// 只改服务器地址这类常见需求，直接改配置文件即可，不用记命令行参数。

const (
	defaultConfigName = "xuanagent.json"
	defaultServer     = "http://154.37.155.17/xuanmanager"

	clientSim  = "sim"
	clientReal = "real"
)

// fileConfig 就是配置文件里的全部内容，字段都可省略。
type fileConfig struct {
	Server          string `json:"server"`
	Code            string `json:"code"`
	Token           string `json:"token"`
	Capacity        int    `json:"capacity"`
	Labels          string `json:"labels"`
	HeartbeatSecond int    `json:"heartbeatSeconds"`
	RoundIntervalMS int    `json:"roundIntervalMs"`
	RoundsPerRoom   int    `json:"roundsPerRoom"`
	// Client 选择终端实现：sim（默认，模拟终端）或 real（拉起 agent-client 真实登录游戏）。
	Client    string `json:"client"`
	ClientDir string `json:"clientDir"`
	NodePath  string `json:"nodePath"`
	GameHost  string `json:"gameHost"`
	GamePort  int    `json:"gamePort"`
	GameWss   *bool  `json:"gameWss"`
	Debug     bool   `json:"debug"`
}

func defaultFileConfig() fileConfig {
	return fileConfig{
		Server:          defaultServer,
		Code:            defaultNodeCode(),
		Capacity:        20,
		HeartbeatSecond: 5,
		RoundIntervalMS: 1500,
		RoundsPerRoom:   6,
		Client:          clientReal,
		NodePath:        "node",
	}
}

// defaultClientDir 默认取可执行文件同目录的 agent-client（部署时与 xuanagent 放在一起）。
func defaultClientDir() string {
	return filepath.Join(executableDir(), "agent-client")
}

// configPath 优先用可执行文件所在目录；该目录不可写时退回当前工作目录。
func configPath() string {
	dir := executableDir()
	return filepath.Join(dir, defaultConfigName)
}

func executableDir() string {
	path, err := os.Executable()
	if err != nil {
		return "."
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	return filepath.Dir(path)
}

// loadOrInitConfig 读配置；不存在就写一份默认的再返回，这样「直接启动」也能跑。
func loadOrInitConfig(path string) (fileConfig, bool, error) {
	body, err := os.ReadFile(path)
	if err == nil {
		cfg := defaultFileConfig()
		if err := json.Unmarshal(body, &cfg); err != nil {
			return cfg, false, fmt.Errorf("配置文件 %s 解析失败（需要 JSON）: %w", path, err)
		}
		return cfg, false, nil
	}
	if !os.IsNotExist(err) {
		return defaultFileConfig(), false, fmt.Errorf("读取配置文件 %s 失败: %w", path, err)
	}
	cfg := defaultFileConfig()
	if err := writeConfig(path, cfg); err != nil {
		// 写不了不影响启动，用默认值继续跑，只是下次还得重新配。
		return cfg, false, nil
	}
	return cfg, true, nil
}

func writeConfig(path string, cfg fileConfig) error {
	body, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(body, '\n'), 0o644)
}

// defaultNodeCode 用主机名当默认节点编号，省得每台机器起名字。
func defaultNodeCode() string {
	host, err := os.Hostname()
	if err != nil || strings.TrimSpace(host) == "" {
		return "node-01"
	}
	host = strings.ToLower(host)
	// 后台要求 3-32 位字母数字/下划线/短横线，主机名里的点和其他符号一律换成短横线。
	var builder strings.Builder
	for _, char := range host {
		switch {
		case char >= 'a' && char <= 'z', char >= '0' && char <= '9', char == '-', char == '_':
			builder.WriteRune(char)
		default:
			builder.WriteByte('-')
		}
	}
	code := strings.Trim(builder.String(), "-")
	if len(code) < 3 {
		code = "node-" + code
	}
	if len(code) > 32 {
		code = code[:32]
	}
	return code
}
