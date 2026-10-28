// Command xuanagent 是 Worker 节点侧的参考实现。
//
// 它跑通整条通道：注册换租约 -> 心跳领指派 -> 拉命令执行并回执 -> 批量上报事件。
// 终端是模拟的，用来验证后台能看到节点、终端、命令和事件的完整闭环；
// 接真实客户端时，只需把 terminal.go 里的 joinRoom/playRound 换成驱动真实客户端、
// 从协议回包里抛事件。
//
// 交叉编译（运维在 Windows 机器上跑）：
//
//	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o xuanagent.exe ./cmd/xuanagent
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// version 由 -ldflags "-X main.version=..." 覆盖。
var version = "0.1.0"

type config struct {
	server        string
	code          string
	token         string
	capacity      int
	labels        string
	heartbeat     time.Duration
	roundInterval time.Duration
	roundsPerRoom int
	clientMode    string
	clientDir     string
	nodePath      string
	gameHost      string
	gamePort      int
	gameWss       string
	once          bool
	debug         bool
	configPath    string
	configCreated bool
}

type agent struct {
	ctx    context.Context
	cancel context.CancelFunc
	log    *slog.Logger
	client *apiClient
	cfg    config

	roundInterval time.Duration
	roundsPerRoom int

	mu        sync.Mutex
	terminals map[string]*terminal

	events chan event
	seq    atomic.Int64
	cursor int64

	lastAssignments []assignment
	strategyVersion int
	droppedEvents   atomic.Int64
	failedFlushes   atomic.Int64
	// runID 给本次运行的 eventId 加前缀：终端序号每次启动都从 1 开始，
	// 不加前缀的话重启后的事件会被后台按 (workerId,eventId) 当成重复丢掉。
	runID string
}

func main() {
	cfg := parseOptions()
	level := slog.LevelInfo
	if cfg.debug {
		level = slog.LevelDebug
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	a := &agent{
		log:           logger,
		client:        newAPIClient(cfg.server),
		cfg:           cfg,
		roundInterval: cfg.roundInterval,
		roundsPerRoom: cfg.roundsPerRoom,
		terminals:     map[string]*terminal{},
		events:        make(chan event, 1024),
		runID:         newRunID(),
	}
	a.ctx, a.cancel = context.WithCancel(ctx)

	if err := a.run(); err != nil {
		logger.Error("agent 退出", "error", err)
		a.cancel()
		a.shutdown()
		a.flush(context.Background())
		a.offline("异常退出")
		os.Exit(1)
	}
	a.cancel()
	a.shutdown()
	a.flush(context.Background())
	a.offline("正常退出")
	logger.Info("agent 已退出")
}

// offline 退出前告诉后台立刻置离线，后台列表不用等租约超时。
// 被强杀（kill -9）时走不到这里，由服务端租约超时兜底。
func (a *agent) offline(reason string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := a.client.offline(ctx, reason); err != nil {
		a.log.Warn("上报节点下线失败，等待租约超时", "error", err)
		return
	}
	a.log.Info("已上报节点下线", "reason", reason)
}

// parseOptions 合并三处配置：配置文件（默认同目录 xuanagent.json）< 环境变量 < 命令行参数。
// 只写服务器地址这类常见需求改配置文件就行；临时换环境用 -server 覆盖。
func parseOptions() config {
	fs := flag.NewFlagSet("xuanagent", flag.ExitOnError)
	configFile := fs.String("config", "", "配置文件路径，默认是可执行文件同目录的 "+defaultConfigName)
	server := fs.String("server", "", "后台地址，例如 "+defaultServer)
	code := fs.String("code", "", "节点编号，默认取主机名")
	token := fs.String("token", "", "接入令牌；后台没启用令牌校验时可以留空")
	capacity := fs.Int("capacity", 0, "节点最多承载的终端数，默认 20")
	labels := fs.String("labels", "", "节点标签，例如 hk-01,8c16g")
	heartbeat := fs.Duration("heartbeat", 0, "心跳间隔，默认跟随配置文件（10s）")
	round := fs.Duration("round-interval", 0, "模拟终端每步动作的间隔，默认 1500ms")
	rounds := fs.Int("rounds-per-room", -1, "模拟终端在一个房间打几局后换桌，0 表示不换")
	clientMode := fs.String("client", "", "终端实现：real（默认，真实游戏客户端）或 sim（仅本地联调用的模拟终端）")
	clientDir := fs.String("client-dir", "", "真实客户端目录（含 client.js），默认是可执行文件同目录的 agent-client")
	nodePath := fs.String("node", "", "运行真实客户端用的 Node 可执行文件，默认 node")
	once := fs.Bool("once", false, "只做一轮注册+心跳+拉命令+上报事件，便于联调")
	debug := fs.Bool("debug", false, "输出调试日志")
	printConfig := fs.Bool("print-config", false, "只打印当前生效的配置后退出")
	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "用法: %s [参数]\n\n配置文件: %s\n参数（覆盖配置文件）:\n", filepath.Base(os.Args[0]), configPath())
		fs.PrintDefaults()
	}
	_ = fs.Parse(os.Args[1:])

	setFlags := map[string]bool{}
	fs.Visit(func(item *flag.Flag) { setFlags[item.Name] = true })

	path := *configFile
	if path == "" {
		path = configPath()
	}
	file, created, err := loadOrInitConfig(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	cfg := config{
		server:        firstNonEmpty(file.Server, defaultServer),
		code:          firstNonEmpty(file.Code, defaultNodeCode()),
		token:         file.Token,
		capacity:      file.Capacity,
		labels:        file.Labels,
		heartbeat:     time.Duration(file.HeartbeatSecond) * time.Second,
		roundInterval: time.Duration(file.RoundIntervalMS) * time.Millisecond,
		roundsPerRoom: file.RoundsPerRoom,
		clientMode:    firstNonEmpty(file.Client, clientReal),
		clientDir:     file.ClientDir,
		nodePath:      firstNonEmpty(file.NodePath, "node"),
		gameHost:      strings.TrimSpace(file.GameHost),
		gamePort:      file.GamePort,
		debug:         file.Debug,
	}
	if file.GameWss != nil {
		cfg.gameWss = map[bool]string{true: "1", false: "0"}[*file.GameWss]
	}

	// 环境变量优先于配置文件，方便容器/批量下发时不必改文件。
	cfg.server = firstNonEmpty(envText("XUAN_AGENT_SERVER", ""), cfg.server)
	cfg.code = firstNonEmpty(envText("XUAN_AGENT_CODE", ""), cfg.code)
	cfg.token = firstNonEmpty(envText("XUAN_AGENT_TOKEN", ""), cfg.token)
	if value := envInt("XUAN_AGENT_CAPACITY", 0); value > 0 {
		cfg.capacity = value
	}
	cfg.labels = firstNonEmpty(envText("XUAN_AGENT_LABELS", ""), cfg.labels)
	cfg.clientMode = firstNonEmpty(envText("XUAN_AGENT_CLIENT", ""), cfg.clientMode)
	cfg.clientDir = firstNonEmpty(envText("XUAN_AGENT_CLIENT_DIR", ""), cfg.clientDir)
	cfg.nodePath = firstNonEmpty(envText("XUAN_AGENT_NODE", ""), cfg.nodePath)

	// 命令行最优先：只有显式写了才覆盖，没写就保留配置文件里的值。
	if setFlags["server"] {
		cfg.server = *server
	}
	if setFlags["code"] {
		cfg.code = *code
	}
	if setFlags["token"] {
		cfg.token = *token
	}
	if setFlags["capacity"] {
		cfg.capacity = *capacity
	}
	if setFlags["labels"] {
		cfg.labels = *labels
	}
	if setFlags["heartbeat"] {
		cfg.heartbeat = *heartbeat
	}
	if setFlags["round-interval"] {
		cfg.roundInterval = *round
	}
	if setFlags["rounds-per-room"] {
		cfg.roundsPerRoom = *rounds
	}
	if setFlags["client"] {
		cfg.clientMode = *clientMode
	}
	if setFlags["client-dir"] {
		cfg.clientDir = *clientDir
	}
	if setFlags["node"] {
		cfg.nodePath = *nodePath
	}
	if setFlags["debug"] {
		cfg.debug = *debug
	}
	cfg.once = *once
	cfg.configPath = path

	if cfg.server == "" {
		fmt.Fprintln(os.Stderr, "缺少后台地址：请在 "+path+" 里填 server，或用 -server 传入")
		os.Exit(2)
	}
	if cfg.capacity <= 0 {
		cfg.capacity = 20
	}
	if cfg.roundInterval < 200*time.Millisecond {
		cfg.roundInterval = 200 * time.Millisecond
	}
	if cfg.roundsPerRoom < 0 {
		cfg.roundsPerRoom = 6
	}
	if cfg.clientMode != clientSim && cfg.clientMode != clientReal {
		fmt.Fprintf(os.Stderr, "client 只能是 %s 或 %s，当前为 %q\n", clientSim, clientReal, cfg.clientMode)
		os.Exit(2)
	}
	if strings.TrimSpace(cfg.clientDir) == "" {
		cfg.clientDir = defaultClientDir()
	}
	if strings.TrimSpace(cfg.nodePath) == "" {
		cfg.nodePath = "node"
	}

	if *printConfig {
		fmt.Printf("配置文件: %s%s\n", path, map[bool]string{true: "（本次已自动生成）", false: ""}[created])
		fmt.Printf("  server          = %s\n  code            = %s\n  token           = %s\n  capacity        = %d\n", cfg.server, cfg.code, maskSecret(cfg.token), cfg.capacity)
		fmt.Printf("  labels          = %s\n  heartbeat       = %s\n  roundInterval   = %s\n  roundsPerRoom   = %d\n  debug           = %v\n",
			cfg.labels, cfg.heartbeat, cfg.roundInterval, cfg.roundsPerRoom, cfg.debug)
		fmt.Printf("  client          = %s\n  clientDir       = %s\n  nodePath        = %s\n", cfg.clientMode, cfg.clientDir, cfg.nodePath)
		os.Exit(0)
	}
	cfg.configCreated = created
	return cfg
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// newRunID 生成 6 位十六进制的运行标识，只用于拼 eventId 前缀。
func newRunID() string {
	var buf [3]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano()%1000000, 36)
	}
	return hex.EncodeToString(buf[:])
}

func maskSecret(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "(未启用令牌)"
	}
	if len(value) <= 8 {
		return strings.Repeat("*", len(value))
	}
	return value[:4] + strings.Repeat("*", len(value)-8) + value[len(value)-4:]
}

func envText(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func (a *agent) run() error {
	go a.flushLoop()

	if a.cfg.configCreated {
		a.log.Info("已生成默认配置文件，按需修改后直接重启即可", "path", a.cfg.configPath)
	}
	a.log.Info("读取配置", "path", a.cfg.configPath, "server", a.cfg.server, "node", a.cfg.code,
		"token", maskSecret(a.cfg.token), "client", a.cfg.clientMode)

	interval, err := a.enroll()
	if err != nil {
		return err
	}
	if a.cfg.once {
		a.heartbeat()
		a.pullCommands()
		a.flush(a.ctx)
		return nil
	}

	// 先立刻心跳一次：拿到指派清单，终端才建得起来，后面收到的终端命令才有对象可执行。
	a.heartbeat()

	heartbeat := time.NewTicker(interval)
	defer heartbeat.Stop()
	commands := time.NewTicker(2 * time.Second)
	defer commands.Stop()

	a.log.Info("agent 已就绪", "node", a.cfg.code, "heartbeat", interval, "capacity", a.cfg.capacity)
	for {
		select {
		case <-a.ctx.Done():
			return nil
		case <-heartbeat.C:
			a.heartbeat()
		case <-commands.C:
			a.pullCommands()
		}
	}
}

// enroll 用接入令牌换租约；返回心跳间隔。
func (a *agent) enroll() (time.Duration, error) {
	ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
	defer cancel()
	result, err := a.client.register(ctx, registerRequest{
		WorkerCode:  a.cfg.code,
		Platform:    runtime.GOOS,
		Arch:        runtime.GOARCH,
		Version:     version,
		Capacity:    a.cfg.capacity,
		Labels:      a.cfg.labels,
		EnrollToken: a.cfg.token,
	})
	if err != nil {
		var detail *apiError
		if errors.As(err, &detail) && detail.Code == "AGENT_ENROLL_REJECTED" {
			return 0, fmt.Errorf("后台启用了接入令牌校验，但本地没有配对：请在 %s 里填 token（后台「Worker 节点」页生成），或用 -token 传入", a.cfg.configPath)
		}
		return 0, fmt.Errorf("注册失败（%s）: %w", a.cfg.server, err)
	}
	if result.Status == "disabled" {
		return 0, errors.New("节点在后台已被停用，请先在后台恢复调度再启动")
	}
	interval := time.Duration(result.HeartbeatInterval) * time.Second
	if a.cfg.heartbeat > 0 {
		interval = a.cfg.heartbeat
	}
	if interval < 3*time.Second {
		interval = 3 * time.Second
	}
	a.log.Info("注册成功", "workerId", result.WorkerID, "node", result.WorkerCode,
		"status", result.Status, "leaseExpiresAt", result.LeaseExpiresAt)
	return interval, nil
}

func (a *agent) heartbeat() {
	ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
	defer cancel()
	active := a.activeTerminalCount()
	result, err := a.client.heartbeat(ctx, heartbeatRequest{
		Version:         version,
		CPUPct:          0,
		MemPct:          0,
		ActiveTerminals: active,
		ActiveTasks:     active,
		LastEventSeq:    a.seq.Load(),
		Capacity:        a.cfg.capacity,
	})
	if err != nil {
		var detail *apiError
		if errors.As(err, &detail) && detail.unauthorized() {
			a.log.Warn("租约失效，重新注册", "reason", detail.Message)
			if _, err := a.enroll(); err != nil {
				a.log.Error("重新注册失败", "error", err)
			}
			return
		}
		a.log.Warn("心跳失败", "error", err)
		return
	}
	if result.Status != "" && result.Status != "online" {
		a.log.Warn("节点当前不在调度状态", "status", result.Status)
	}
	a.lastAssignments = result.Assignments
	a.reconcile(result.Assignments)
	a.log.Debug("心跳完成", "terminals", len(result.Assignments), "pendingCommands", result.PendingCommands)
}

func (a *agent) pullCommands() {
	for round := 0; round < 5; round++ {
		ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
		batch, err := a.client.pullCommands(ctx, a.cursor, 20)
		cancel()
		if err != nil {
			var detail *apiError
			if errors.As(err, &detail) && detail.unauthorized() {
				a.log.Warn("租约失效，重新注册", "reason", detail.Message)
				if _, err := a.enroll(); err != nil {
					a.log.Error("重新注册失败", "error", err)
				}
				return
			}
			a.log.Warn("拉取命令失败", "error", err)
			return
		}
		if len(batch.Items) == 0 {
			return
		}
		for _, item := range batch.Items {
			a.executeCommand(item)
		}
		if batch.Cursor > a.cursor {
			a.cursor = batch.Cursor
		}
		if len(batch.Items) < 20 {
			return
		}
	}
}

// executeCommand 走「接受 -> 执行 -> 完成/拒绝」三段回执，失败也要把原因写回后台。
func (a *agent) executeCommand(item command) {
	ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
	defer cancel()
	if err := a.client.ack(ctx, item.CommandNo, "ACCEPTED", nil, "", ""); err != nil {
		a.log.Warn("命令接受回执失败", "commandNo", item.CommandNo, "error", err)
		return
	}
	result, errCode, errMessage := a.handleCommand(item)
	status := "COMPLETED"
	if errCode != "" {
		status = "REJECTED"
	}
	if err := a.client.ack(ctx, item.CommandNo, status, result, errCode, errMessage); err != nil {
		a.log.Warn("命令完成回执失败", "commandNo", item.CommandNo, "error", err)
		return
	}
	if errCode != "" {
		a.log.Warn("命令执行失败", "commandNo", item.CommandNo, "type", item.Type, "reason", errMessage)
		return
	}
	a.log.Info("命令已执行", "commandNo", item.CommandNo, "type", item.Type, "terminal", item.TerminalNo)
}

func (a *agent) handleCommand(item command) (any, string, string) {
	robotID := int64(0)
	if item.RobotID != nil {
		robotID = *item.RobotID
	}
	switch item.Type {
	case "START_TERMINAL":
		if a.startTerminal(item.TerminalNo, robotID) == nil {
			return nil, "TERMINAL_NOT_FOUND", "节点上没有这个终端，后台指派可能还没同步"
		}
		return map[string]any{"terminal": item.TerminalNo, "state": "running"}, "", ""
	case "PAUSE_TERMINAL":
		if a.pauseTerminal(item.TerminalNo, robotID) == nil {
			return nil, "TERMINAL_NOT_FOUND", "节点上没有这个终端"
		}
		return map[string]any{"terminal": item.TerminalNo, "state": "paused"}, "", ""
	case "DRAIN_TERMINAL":
		if a.drainTerminal(item.TerminalNo, robotID) == nil {
			return nil, "TERMINAL_NOT_FOUND", "节点上没有这个终端"
		}
		return map[string]any{"terminal": item.TerminalNo, "state": "draining"}, "", ""
	case "STOP_TERMINAL":
		if a.stopTerminal(item.TerminalNo, robotID, "command") == nil {
			return nil, "TERMINAL_NOT_FOUND", "节点上没有这个终端"
		}
		return map[string]any{"terminal": item.TerminalNo, "state": "stopped"}, "", ""
	case "RECONCILE_STATE":
		a.reconcile(a.lastAssignments)
		return map[string]any{"terminals": len(a.lastAssignments), "active": a.activeTerminalCount()}, "", ""
	case "APPLY_STRATEGY":
		var params struct {
			StrategyVersion int    `json:"strategyVersion"`
			Name            string `json:"strategyName"`
		}
		if len(item.Params) > 0 {
			_ = json.Unmarshal(item.Params, &params)
		}
		a.strategyVersion = params.StrategyVersion
		a.log.Info("已应用策略", "strategy", params.Name, "version", params.StrategyVersion)
		return map[string]any{"strategyName": params.Name, "strategyVersion": params.StrategyVersion}, "", ""
	case "START_TASK", "PAUSE_TASK", "CANCEL_TASK":
		// 参考实现不模拟任务层；接真客户端时在这里驱动任务调度器。
		return map[string]any{"accepted": true, "terminal": item.TerminalNo}, "", ""
	default:
		return nil, "UNSUPPORTED_COMMAND", "节点不支持该命令：" + item.Type
	}
}

// ---- 事件 ----

func (a *agent) emit(t *terminal, eventType string, payload map[string]any) {
	a.emitRound(t, eventType, "", payload)
}

func (a *agent) emitRound(t *terminal, eventType, roundID string, payload map[string]any) {
	t.mu.Lock()
	roomID := t.roomID
	t.mu.Unlock()
	a.emitAt(t, eventType, roundID, roomID, payload)
}

func (a *agent) emitAt(t *terminal, eventType, roundID string, roomID int64, payload map[string]any) {
	t.mu.Lock()
	t.seq++
	seq := t.seq
	robotID := t.robotID
	t.mu.Unlock()

	a.seq.Add(1)
	item := event{
		EventID:         fmt.Sprintf("%s-%s-%d", t.no, a.runID, seq),
		TerminalNo:      t.no,
		RobotID:         robotID,
		Type:            eventType,
		Sequence:        seq,
		RoomID:          roomID,
		RoundID:         roundID,
		StrategyVersion: a.strategyVersion,
		OccurredAt:      time.Now().UTC().Format(time.RFC3339Nano),
		Payload:         payload,
	}
	select {
	case a.events <- item:
	default:
		a.droppedEvents.Add(1)
		a.log.Warn("事件队列已满，丢弃事件", "terminal", t.no, "type", eventType)
	}
}

func (a *agent) flushLoop() {
	ticker := time.NewTicker(800 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-ticker.C:
			a.flush(a.ctx)
		}
	}
}

func (a *agent) flush(ctx context.Context) {
	for {
		batch := make([]event, 0, 64)
		draining := true
		for draining && len(batch) < 64 {
			select {
			case item := <-a.events:
				batch = append(batch, item)
			default:
				draining = false
			}
		}
		if len(batch) == 0 {
			return
		}
		sendCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := a.client.reportEvents(sendCtx, batch)
		cancel()
		if err != nil {
			a.failedFlushes.Add(1)
			a.log.Warn("上报事件失败", "count", len(batch), "error", err)
			return
		}
		a.log.Debug("上报事件", "count", len(batch))
		if draining {
			return
		}
	}
}
