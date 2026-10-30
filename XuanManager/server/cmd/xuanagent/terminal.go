package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 参考实现里的「终端」是模拟的：不接真实游戏客户端，只按后台给的状态机走一遍
// 入座 -> 开局 -> 行动 -> 结算 的流程，把事件如实上报，用来验证整条通道。
// 接真客户端时，把 run/playRound 换成驱动真实客户端、从协议回包里抛事件即可。

type terminalState int

const (
	termStopped terminalState = iota
	termRunning
	termPaused
	termDraining
)

func (s terminalState) String() string {
	switch s {
	case termRunning:
		return "running"
	case termPaused:
		return "paused"
	case termDraining:
		return "draining"
	default:
		return "stopped"
	}
}

type terminal struct {
	no      string
	robotID int64
	account string
	clubID  string
	group   string
	roomID  int64
	seatNo  int

	// 真实客户端启动时用到的账号资料，由心跳的指派清单刷新。
	password      string
	nickname      string
	inviteCode    string
	joinStatus    string
	buyinMultiple int
	roomPi        string
	intelligence  int
	// 只登录激活：拉起客户端后等它登录成功就退出，不进俱乐部房间。
	loginOnly bool

	// 真机身份与输赢目标：随心跳刷新，变化时经 stdin 推给运行中的客户端。
	gps          string
	profitMode   string
	profitTarget int64
	periodStart  string
	periodEnd    string
	todayNet     int64
	periodNet    int64

	// 绑定策略原文（整份 JSON）：启动时注入 XUAN_STRATEGY，运行中走 config 热更新。
	strategy string

	mu      sync.Mutex
	state   terminalState
	started bool
	seq     int64
	round   int

	// 只有 real 模式会填 cmd/stdin；nextStart 是进程异常退出后的重启退避。
	cmd       *exec.Cmd
	stdin     io.WriteCloser
	nextStart time.Time
	desired   string

	done chan struct{}
}

func (t *terminal) setState(state terminalState) {
	t.mu.Lock()
	t.state = state
	t.mu.Unlock()
}

func (t *terminal) getState() terminalState {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.state
}

func (t *terminal) describe() string {
	return fmt.Sprintf("%s(robot=%d)", t.no, t.robotID)
}

// loginOnlyMode 读取当前终端的激活模式；后台心跳里 loginOnly 会随指派刷新。
func (t *terminal) loginOnlyMode() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.loginOnly
}

// writeControl 向真实客户端进程发控制命令；模拟终端没有 stdin，直接忽略。
func (t *terminal) writeControl(command string) {
	t.writeControlJSON(map[string]any{"cmd": command})
}

// writeControlJSON 发一条带参数的控制命令（配置热更新），进程不在时静默跳过。
func (t *terminal) writeControlJSON(payload map[string]any) {
	t.mu.Lock()
	stdin := t.stdin
	t.mu.Unlock()
	if stdin == nil {
		return
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return
	}
	if _, err := io.WriteString(stdin, string(encoded)+"\n"); err != nil {
		// 进程刚好退出时写失败是正常竞争，下一轮心跳会重新拉起。
		return
	}
}

// runTerminal 是每个终端的模拟主循环：只有 running 才推进牌局，
// paused 停住不动，draining 打完手上的房间再停，stopped 直接退出。
// 退出后由 spawn 关闭 done，下次需要时重新拉起。
//
// 事件按真实客户端的顺序抛：拉起终端 -> 开始登录 -> 登录成功/失败 -> 等待空位 -> 进房入座
// -> 逐局开局/行动/结算 -> 离房 -> 退出账号 -> 终端停止。
func (a *agent) runTerminal(t *terminal) {
	ticker := time.NewTicker(a.roundInterval)
	defer ticker.Stop()
	loggedIn, joined := false, false
	for {
		select {
		case <-a.ctx.Done():
			if joined {
				a.leaveRoom(t, "shutdown")
			}
			if loggedIn {
				a.logout(t, "shutdown")
			}
			a.emit(t, "TerminalStopped", map[string]any{"reason": "shutdown"})
			return
		case <-ticker.C:
			switch t.getState() {
			case termStopped:
				if joined {
					a.leaveRoom(t, "stop")
				}
				if loggedIn {
					a.logout(t, "stop")
				}
				a.emit(t, "TerminalStopped", map[string]any{"reason": "stop"})
				return
			case termPaused:
				continue
			case termDraining:
				if joined {
					a.leaveRoom(t, "drain")
				}
				if loggedIn {
					a.logout(t, "drain")
				}
				a.emit(t, "TerminalStopped", map[string]any{"reason": "drain"})
				t.setState(termStopped)
				a.log.Info("terminal drained", "terminal", t.describe())
				return
			}
			if !loggedIn {
				if !a.login(t) {
					a.emit(t, "TerminalStopped", map[string]any{"reason": "login-failed"})
					t.setState(termStopped)
					return
				}
				loggedIn = true
				if t.loginOnlyMode() {
					// 只做激活的终端：登录成功就算完成，不再进房。
					a.logout(t, "login-only")
					a.emit(t, "TerminalStopped", map[string]any{"reason": "login-only"})
					t.setState(termStopped)
					return
				}
				continue
			}
			if !joined {
				a.waitForRoom(t)
				a.joinRoom(t)
				joined = true
				continue
			}
			a.playRound(t)
			if a.roundsPerRoom > 0 && t.round >= a.roundsPerRoom {
				a.leaveRoom(t, "rotate")
				joined = false
			}
		}
	}
}

// realMessage 是 agent-client/client.js 每行输出的 JSON 结构。
type realMessage struct {
	Type      string         `json:"type"`
	EventType string         `json:"eventType"`
	Payload   map[string]any `json:"payload"`
	RoomID    int64          `json:"roomId"`
	RoundID   string         `json:"roundId"`
	Level     string         `json:"level"`
	Message   string         `json:"message"`
}

// runRealTerminal 拉起一个真实客户端进程，把它的 JSON 行转成后台事件；
// 进程退出后由 spawn 统一清理 started 并重新按心跳指派决定是否再拉起。
func (a *agent) runRealTerminal(t *terminal) {
	script := filepath.Join(a.cfg.clientDir, "client.js")
	if _, err := os.Stat(script); err != nil {
		a.emit(t, "LoginFailed", map[string]any{"message": "找不到真实客户端脚本：" + script})
		a.log.Error("real client script missing", "terminal", t.describe(), "script", script)
		return
	}

	t.mu.Lock()
	account, password := t.account, t.password
	clubID, inviteCode, joinStatus := t.clubID, t.inviteCode, t.joinStatus
	buyin, robotID, roomPi := t.buyinMultiple, t.robotID, t.roomPi
	gps, profitMode, profitTarget := t.gps, t.profitMode, t.profitTarget
	periodStart, periodEnd, todayNet, periodNet := t.periodStart, t.periodEnd, t.todayNet, t.periodNet
	strategy := t.strategy
	loginOnly := t.loginOnly
	paused := t.state == termPaused
	t.mu.Unlock()
	if strings.TrimSpace(account) == "" || strings.TrimSpace(password) == "" {
		a.emit(t, "LoginFailed", map[string]any{"message": "缺少账号或登录密码，Worker 无法登录"})
		a.log.Warn("real client missing credentials", "terminal", t.describe(), "passwordSet", password != "")
		return
	}

	env := append(os.Environ(),
		"XUAN_ROBOT_ACCOUNT="+account,
		"XUAN_ROBOT_PASSWORD="+password,
		"XUAN_TERMINAL_NO="+t.no,
		"XUAN_ROBOT_ID="+strconv.FormatInt(robotID, 10),
		"XUAN_CLUB_ID="+clubID,
		"XUAN_INVITE_CODE="+inviteCode,
		"XUAN_JOIN_STATUS="+joinStatus,
	)
	if buyin > 0 {
		env = append(env, "XUAN_BUYIN_MULTIPLE="+strconv.Itoa(buyin))
	}
	if roomPi != "" {
		env = append(env, "XUAN_ROOM_PI="+roomPi)
	}
	// 绑定策略：整份 JSON 交给客户端解析（跑法参数 + 打牌阈值）。
	if strategy != "" {
		env = append(env, "XUAN_STRATEGY="+strategy)
	}
	if gps != "" {
		env = append(env, "XUAN_GPS="+gps)
	}
	if profitMode != "" {
		env = append(env, "XUAN_PROFIT_MODE="+profitMode)
	}
	env = append(env,
		"XUAN_PROFIT_TARGET="+strconv.FormatInt(profitTarget, 10),
		"XUAN_NET_TODAY="+strconv.FormatInt(todayNet, 10),
		"XUAN_NET_PERIOD="+strconv.FormatInt(periodNet, 10),
		"XUAN_PERIOD_START="+periodStart,
		"XUAN_PERIOD_END="+periodEnd,
	)
	if paused {
		env = append(env, "XUAN_START_PAUSED=1")
	}
	if loginOnly {
		env = append(env, "XUAN_LOGIN_ONLY=1")
	}
	if a.cfg.gameHost != "" {
		env = append(env, "XUAN_GAME_HOST="+a.cfg.gameHost)
	}
	if a.cfg.gamePort > 0 {
		env = append(env, "XUAN_GAME_PORT="+strconv.Itoa(a.cfg.gamePort))
	}
	if a.cfg.gameWss != "" {
		env = append(env, "XUAN_GAME_WSS="+a.cfg.gameWss)
	}

	cmd := exec.Command(a.cfg.nodePath, script)
	cmd.Env = env
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		a.emit(t, "LoginFailed", map[string]any{"message": "无法读取真实客户端输出：" + err.Error()})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		a.emit(t, "LoginFailed", map[string]any{"message": "无法读取真实客户端错误输出：" + err.Error()})
		return
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		a.emit(t, "LoginFailed", map[string]any{"message": "无法向真实客户端发送控制命令：" + err.Error()})
		return
	}
	t.mu.Lock()
	t.cmd, t.stdin = cmd, stdin
	t.mu.Unlock()

	if err := cmd.Start(); err != nil {
		t.mu.Lock()
		t.cmd, t.stdin = nil, nil
		t.mu.Unlock()
		a.emit(t, "LoginFailed", map[string]any{"message": "拉起真实客户端失败：" + err.Error()})
		a.log.Error("start real client failed", "terminal", t.describe(), "node", a.cfg.nodePath, "error", err)
		return
	}
	a.log.Info("real client started", "terminal", t.describe(), "account", account, "pid", cmd.Process.Pid)

	go func() {
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 0, 4096), 64*1024)
		for scanner.Scan() {
			a.log.Warn("real client stderr", "terminal", t.describe(), "line", scanner.Text())
		}
	}()

	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		a.handleRealLine(t, scanner.Bytes())
	}
	waitErr := cmd.Wait()

	t.mu.Lock()
	t.cmd, t.stdin = nil, nil
	reason := "exit"
	switch t.state {
	case termStopped:
		reason = "stop"
	case termDraining:
		reason = "drain"
	}
	t.mu.Unlock()
	if waitErr != nil {
		a.log.Warn("real client exited", "terminal", t.describe(), "reason", reason, "error", waitErr)
	} else {
		a.log.Info("real client exited", "terminal", t.describe(), "reason", reason)
	}
	a.emit(t, "TerminalStopped", map[string]any{"reason": reason})
}

func (a *agent) handleRealLine(t *terminal, line []byte) {
	var msg realMessage
	if err := json.Unmarshal(line, &msg); err != nil {
		if text := strings.TrimSpace(string(line)); text != "" {
			a.log.Debug("real client output", "terminal", t.describe(), "line", text)
		}
		return
	}
	switch msg.Type {
	case "event":
		if msg.EventType == "" {
			return
		}
		a.forwardRealEvent(t, msg)
	case "log":
		a.logClientLine(t, msg.Level, msg.Message)
	}
}

// forwardRealEvent 用客户端上报的 roomId/roundId 落事件，避免入房与离房之间房间号对不上。
func (a *agent) forwardRealEvent(t *terminal, msg realMessage) {
	t.mu.Lock()
	roomID := t.roomID
	if msg.RoomID > 0 {
		roomID = msg.RoomID
		t.roomID = msg.RoomID
	}
	if msg.EventType == "PlayerSeated" {
		if seat, ok := numberAsInt(msg.Payload["seatNo"]); ok {
			t.seatNo = seat
		}
	}
	t.mu.Unlock()

	a.emitAt(t, msg.EventType, msg.RoundID, roomID, msg.Payload)

	// 等待原因只在节点日志里留一行，方便现场判断是没房还是被拒。
	if msg.EventType == "Waiting" {
		if reason, ok := msg.Payload["reason"].(string); ok && strings.TrimSpace(reason) != "" {
			a.log.Info("client: "+strings.TrimSpace(reason), "terminal", t.describe())
		}
	}

	if msg.EventType == "RoomLeft" || msg.EventType == "RoomClosed" {
		t.mu.Lock()
		t.roomID, t.seatNo = 0, 0
		t.mu.Unlock()
	}

	// 结算下桌但仍留在房间里：只清座位号，房间号保留，重新带入还会用同一个 room_id。
	if msg.EventType == "PlayerUnseated" {
		t.mu.Lock()
		t.seatNo = 0
		t.mu.Unlock()
	}
}

func (a *agent) logClientLine(t *terminal, level, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	switch level {
	case "debug":
		a.log.Debug("client: "+message, "terminal", t.describe())
	case "warn":
		a.log.Warn("client: "+message, "terminal", t.describe())
	case "error":
		a.log.Error("client: "+message, "terminal", t.describe())
	default:
		a.log.Info("client: "+message, "terminal", t.describe())
	}
}

func numberAsInt(value any) (int, bool) {
	switch typed := value.(type) {
	case float64:
		return int(typed), true
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return int(parsed), err == nil
	default:
		return 0, false
	}
}

// login 模拟「用机器人账号登录客户端」。真客户端在这里换成登录协议，
// 收到回包再抛 LoginSucceeded / LoginFailed（把错误码和文案放进 payload）。
func (a *agent) login(t *terminal) bool {
	if strings.TrimSpace(t.account) == "" {
		a.emit(t, "LoginFailed", map[string]any{"message": "没有账号信息，无法登录"})
		a.log.Warn("terminal login failed", "terminal", t.describe(), "reason", "empty account")
		return false
	}
	a.emit(t, "LoginStarted", map[string]any{"account": t.account})
	a.log.Info("terminal logging in", "terminal", t.describe(), "account", t.account)
	a.emit(t, "LoginSucceeded", map[string]any{"account": t.account})
	a.log.Info("terminal logged in", "terminal", t.describe(), "account", t.account)
	return true
}

// waitForRoom 进房前的等待：真实客户端上就是「等空位/等俱乐部房间开台」。
func (a *agent) waitForRoom(t *terminal) {
	a.emit(t, "Waiting", map[string]any{
		"reason":         "等待空位",
		"clubId":         t.clubID,
		"groupName":      t.group,
		"retryInSeconds": int(a.roundInterval.Seconds()) + 1,
	})
	a.log.Debug("terminal waiting for room", "terminal", t.describe(), "club", t.clubID)
}

// logout 模拟「退出账号」：离房之后、终端停止之前调用。
func (a *agent) logout(t *terminal, reason string) {
	a.emit(t, "LogoutSucceeded", map[string]any{"account": t.account, "reason": reason})
	a.log.Info("terminal logged out", "terminal", t.describe(), "account", t.account, "reason", reason)
}

func (a *agent) joinRoom(t *terminal) {
	room := 1000 + t.robotID%300
	seat := int(t.robotID%6) + 1
	t.mu.Lock()
	t.roomID, t.seatNo, t.round = room, seat, 0
	t.mu.Unlock()
	a.emit(t, "RoomJoined", nil)
	a.emit(t, "PlayerSeated", map[string]any{"roomId": room, "seatNo": seat})
	a.emit(t, "GameReady", nil)
	a.log.Info("terminal seated", "terminal", t.describe(), "room", room, "seat", seat)
}

func (a *agent) leaveRoom(t *terminal, reason string) {
	t.mu.Lock()
	room := t.roomID
	t.mu.Unlock()
	a.emit(t, "RoomLeft", map[string]any{"reason": reason})
	t.mu.Lock()
	t.roomID, t.seatNo, t.round = 0, 0, 0
	t.mu.Unlock()
	a.emit(t, "RoomClosed", nil)
	a.log.Info("terminal left room", "terminal", t.describe(), "room", room, "reason", reason)
}

// playRound 走完一局：开局 -> 三轮行动 -> 结算。分值用固定波动，方便肉眼对账。
func (a *agent) playRound(t *terminal) {
	t.mu.Lock()
	t.round++
	round := t.round
	t.mu.Unlock()
	roundID := fmt.Sprintf("%s-%d", t.no, round)
	a.emitRound(t, "GameStarted", roundID, map[string]any{"roundId": roundID})
	for turn := 0; turn < 3; turn++ {
		a.emitRound(t, "TurnStarted", roundID, map[string]any{"roundId": roundID, "seatNo": t.seatNo})
		a.emitRound(t, "ActionSubmitted", roundID, map[string]any{"action": "call", "amount": 100})
		if turn%5 == 4 {
			a.emitRound(t, "ActionRejected", roundID, map[string]any{"code": "TURN_EXPIRED"})
		} else {
			a.emitRound(t, "ActionAccepted", roundID, nil)
		}
	}
	delta := (t.robotID%5-2)*20 + int64(round%3)*10
	a.emitRound(t, "GameSettled", roundID, map[string]any{"roundId": roundID, "delta": delta, "net": delta})
}

// ensureTerminal 保证终端存在并按期望状态运行；后台把机器人移走时会收到 false。
func (a *agent) ensureTerminal(item assignment) {
	if item.TerminalNo == "" {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	t, exists := a.terminals[item.TerminalNo]
	if !exists {
		t = &terminal{
			no:      item.TerminalNo,
			robotID: item.RobotID,
			account: item.Account,
			clubID:  item.ClubID,
			group:   item.GroupName,
			state:   termStopped,
			done:    make(chan struct{}),
		}
		a.terminals[item.TerminalNo] = t
	}
	t.mu.Lock()
	t.robotID = item.RobotID
	if item.Account != "" {
		t.account = item.Account
	}
	// 密码以服务端下发为准：解不开时服务端会下发空值，这里跟着清空并让下次登录明确失败。
	t.password = item.Password
	if item.BuyinMultiple > 0 {
		t.buyinMultiple = item.BuyinMultiple
	}
	t.roomPi = item.RoomPi
	t.nickname = item.Nickname
	t.clubID = item.ClubID
	t.group = item.GroupName
	t.inviteCode = item.InviteCode
	t.joinStatus = item.JoinStatus
	t.intelligence = item.Intelligence
	t.loginOnly = item.LoginOnly
	// 绑定策略：原文直接下发，具体字段由客户端解析；内容变了才推一次热更新。
	nextStrategy := strings.TrimSpace(string(item.StrategyConfig))
	// 身份与输赢目标跟着心跳走：客户端在跑时用控制行热更新，不重启进程（重启会离桌）。
	configChanged := nextStrategy != t.strategy
	t.strategy = nextStrategy
	if item.Gps != "" && item.Gps != t.gps {
		t.gps = item.Gps
		configChanged = true
	}
	if item.ProfitMode != t.profitMode {
		t.profitMode = item.ProfitMode
		configChanged = true
	}
	if item.ProfitTarget != t.profitTarget {
		t.profitTarget = item.ProfitTarget
		configChanged = true
	}
	if item.TodayNet != t.todayNet || item.PeriodNet != t.periodNet {
		t.todayNet, t.periodNet = item.TodayNet, item.PeriodNet
		configChanged = true
	}
	if item.PeriodStart != t.periodStart || item.PeriodEnd != t.periodEnd {
		t.periodStart, t.periodEnd = item.PeriodStart, item.PeriodEnd
		configChanged = true
	}
	config := map[string]any{
		"cmd":          "config",
		"gps":          t.gps,
		"profitMode":   t.profitMode,
		"profitTarget": t.profitTarget,
		"periodStart":  t.periodStart,
		"periodEnd":    t.periodEnd,
		"todayNet":     t.todayNet,
		"periodNet":    t.periodNet,
	}
	// 策略整份下发，客户端按需覆盖跑法参数与打牌阈值。
	if t.strategy != "" {
		config["strategy"] = json.RawMessage(t.strategy)
	}
	if item.DesiredStatus != t.desired {
		t.desired = item.DesiredStatus
		t.nextStart = time.Time{}
	}
	t.mu.Unlock()

	want := termStopped
	if item.Enabled {
		switch item.DesiredStatus {
		case "running", "active", "":
			want = termRunning
		case "paused":
			want = termPaused
		case "draining":
			want = termDraining
		case "stopped":
			want = termStopped
		}
	}
	if configChanged && want != termStopped && t.isStarted() {
		t.writeControlJSON(config)
	}
	if want != termStopped && want == t.getState() && t.isStarted() {
		return
	}
	if want == termStopped {
		t.setState(termStopped)
		t.writeControl("stop")
		return
	}
	// 没在跑（新建或已退出）就拉起 goroutine；在跑只改状态，让循环自己转过去。
	t.setState(want)
	if t.isStarted() {
		switch want {
		case termPaused:
			t.writeControl("pause")
		case termDraining:
			// drain 让客户端打完手里这一局再退出，别在半局里掀桌。
			t.writeControl("drain")
		default:
			t.writeControl("resume")
		}
		return
	}
	t.mu.Lock()
	wait := time.Until(t.nextStart)
	t.mu.Unlock()
	if wait > 0 {
		a.log.Debug("terminal restart deferred", "terminal", t.describe(), "in", wait.Round(time.Second))
		return
	}
	a.spawn(t)
}

// spawn 起一个终端模拟循环，退出后把 started 清掉并关闭 done，下次按需重建。
func (a *agent) spawn(t *terminal) {
	t.mu.Lock()
	if t.started {
		t.mu.Unlock()
		return
	}
	t.started = true
	done := make(chan struct{})
	t.done = done
	t.mu.Unlock()
	go func() {
		a.emit(t, "TerminalStarted", map[string]any{"account": t.account, "message": "拉起终端并准备登录"})
		if a.cfg.clientMode == clientReal {
			a.runRealTerminal(t)
		} else {
			a.runTerminal(t)
		}
		t.mu.Lock()
		t.started = false
		if a.cfg.clientMode == clientReal {
			// 异常退出（密码错、被踢、游戏服不可用）时退避，避免每轮心跳都猛拉进程。
			t.nextStart = time.Now().Add(30 * time.Second)
		}
		t.mu.Unlock()
		close(done)
	}()
}

func (t *terminal) isStarted() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.started
}

// stopTerminal 停止某个终端；terminalNo 为空时按 robotID 找。
func (a *agent) stopTerminal(terminalNo string, robotID int64, reason string) *terminal {
	a.mu.Lock()
	t := a.findLocked(terminalNo, robotID)
	if t == nil {
		a.mu.Unlock()
		return nil
	}
	t.setState(termStopped)
	a.mu.Unlock()
	t.writeControl("stop")
	a.log.Info("terminal stop requested", "terminal", t.describe(), "reason", reason)
	return t
}

// pauseTerminal 只改状态，牌局停在当前回合。
func (a *agent) pauseTerminal(terminalNo string, robotID int64) *terminal {
	a.mu.Lock()
	t := a.findLocked(terminalNo, robotID)
	a.mu.Unlock()
	if t == nil {
		return nil
	}
	t.setState(termPaused)
	t.writeControl("pause")
	return t
}

func (a *agent) drainTerminal(terminalNo string, robotID int64) *terminal {
	a.mu.Lock()
	t := a.findLocked(terminalNo, robotID)
	a.mu.Unlock()
	if t == nil {
		return nil
	}
	t.setState(termDraining)
	t.writeControl("drain")
	return t
}

func (a *agent) startTerminal(terminalNo string, robotID int64) *terminal {
	a.mu.Lock()
	t := a.findLocked(terminalNo, robotID)
	if t == nil {
		a.mu.Unlock()
		return nil
	}
	t.mu.Lock()
	t.nextStart = time.Time{}
	t.mu.Unlock()
	t.setState(termRunning)
	if !t.isStarted() {
		a.spawn(t)
	} else {
		t.writeControl("resume")
	}
	a.mu.Unlock()
	return t
}

func (a *agent) findLocked(terminalNo string, robotID int64) *terminal {
	if terminalNo != "" {
		return a.terminals[terminalNo]
	}
	for _, t := range a.terminals {
		if robotID != 0 && t.robotID == robotID {
			return t
		}
	}
	return nil
}

// reconcile 把本地终端收敛到后台给的清单：清单里没有的停掉，清单里有但不该跑的也停掉。
func (a *agent) reconcile(items []assignment) {
	wanted := make(map[string]assignment, len(items))
	for _, item := range items {
		wanted[item.TerminalNo] = item
	}
	a.mu.Lock()
	extra := []*terminal{}
	for no, t := range a.terminals {
		if _, ok := wanted[no]; !ok {
			extra = append(extra, t)
		}
	}
	a.mu.Unlock()
	for _, t := range extra {
		a.stopTerminal(t.no, t.robotID, "not-assigned")
	}
	for _, item := range items {
		a.ensureTerminal(item)
	}
}

func (a *agent) activeTerminalCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	count := 0
	for _, t := range a.terminals {
		if t.getState() != termStopped {
			count++
		}
	}
	return count
}

// kill 是优雅退出超时后的兜底，避免留下真实客户端孤儿进程。
func (t *terminal) kill() {
	t.mu.Lock()
	cmd := t.cmd
	t.mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func (a *agent) shutdown() {
	a.mu.Lock()
	list := make([]*terminal, 0, len(a.terminals))
	for _, t := range a.terminals {
		list = append(list, t)
	}
	a.mu.Unlock()
	for _, t := range list {
		t.setState(termStopped)
		t.writeControl("stop")
	}
	deadline := time.After(4 * time.Second)
	for _, t := range list {
		if !t.isStarted() {
			continue
		}
		select {
		case <-t.done:
		case <-deadline:
			for _, item := range list {
				item.kill()
			}
			return
		}
	}
}
