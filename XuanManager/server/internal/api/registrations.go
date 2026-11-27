package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/go-sql-driver/mysql"
)

type gameRegistrationRequest struct {
	InvitationCode   string `json:"invitationCode"`
	Nickname         string `json:"nickname"`
	LoginName        string `json:"loginName"`
	Username         string `json:"username"`
	Password         string `json:"password"`
	AvatarIndex      string `json:"avatarIndex"`
	Photo            string `json:"photo"`
	UpperGUID        string `json:"upper_guuid"`
	PlayerWXID       string `json:"player_wxid"`
	PlayerWXName     string `json:"player_wxname"`
	AntiTheftEnabled bool   `json:"antiTheftEnabled"`
	DeviceID         string `json:"deviceId"`
	DevicePlatform   string `json:"devicePlatform"`
	DeviceVersion    int    `json:"deviceVersion"`
	// 滑动验证：仅后台开关打开时校验，一次性使用。
	CaptchaID      string `json:"captchaId"`
	CaptchaOffset  int    `json:"captchaOffset"`
	CaptchaElapsed int    `json:"captchaElapsed"`
	CaptchaTrack   []int  `json:"captchaTrack"`
	// Website 是蜜罐字段：注册表单里没有这一项，正常客户端永远不会填。
	// 批量注册脚本常常照着接口字段表盲填，填了就说明是机器。
	Website string `json:"website"`
}

type normalizedGameRegistration struct {
	InvitationCode   string
	Nickname         string
	LoginName        string
	Password         string
	AvatarIndex      string
	AntiTheftEnabled bool
	DeviceID         string
	DevicePlatform   string
	DeviceVersion    int
}

type registrationUpperChain struct {
	Direct string
	Second string
	Third  string
	All    []string
}

func (chain registrationUpperChain) IDs() []string {
	if len(chain.All) > 0 {
		return compactUniqueRegistrationIDs(chain.All...)
	}
	return compactUniqueRegistrationIDs(chain.Direct, chain.Second, chain.Third)
}

const maxRegistrationAncestorDepth = 64

var registrationDeviceIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,255}$`)

type registrationRateEntry struct {
	StartedAt time.Time
	Attempts  int
}

type registrationRateLimiter struct {
	mu      sync.Mutex
	limit   int
	window  time.Duration
	entries map[string]registrationRateEntry
}

func newRegistrationRateLimiter(limit int, window time.Duration) *registrationRateLimiter {
	return &registrationRateLimiter{
		limit:   limit,
		window:  window,
		entries: make(map[string]registrationRateEntry),
	}
}

func (l *registrationRateLimiter) allow(key string, now time.Time) (bool, time.Duration) {
	// limit <= 0 表示关闭尝试次数限制。高防接入后源 IP 统一是节点地址，
	// 按 IP 计数会把同节点下所有玩家算成一个来源，造成大面积误伤。
	if l.limit <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	entry, exists := l.entries[key]
	if !exists || now.Sub(entry.StartedAt) >= l.window {
		l.entries[key] = registrationRateEntry{StartedAt: now, Attempts: 1}
		l.cleanup(now)
		return true, 0
	}
	if entry.Attempts >= l.limit {
		return false, l.window - now.Sub(entry.StartedAt)
	}
	entry.Attempts++
	l.entries[key] = entry
	return true, 0
}

func (l *registrationRateLimiter) cleanup(now time.Time) {
	if len(l.entries) < 2048 {
		return
	}
	for key, entry := range l.entries {
		if now.Sub(entry.StartedAt) >= l.window {
			delete(l.entries, key)
		}
	}
}

func (s *Server) handleRegistrationOptions(w http.ResponseWriter, _ *http.Request) {
	setRegistrationCORS(w)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleCreateGameRegistration(w http.ResponseWriter, r *http.Request) {
	setRegistrationCORS(w)
	ip := clientIP(r)
	// 注册链路排查用：客户端「点了没反应」时，先看这条日志是否出现——
	// 没有就是请求根本没到服务端（网络/混合内容/高防），有就看后面的拒绝原因。
	s.logger.Info("registration request received",
		"remote", ip, "origin", r.Header.Get("Origin"), "userAgent", r.Header.Get("User-Agent"))
	allowed, retryAfter := s.registrationLimiter.allow(ip, time.Now())
	if !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(retryAfter.Seconds()))))
		writeError(w, http.StatusTooManyRequests, "REGISTRATION_RATE_LIMITED", "注册请求过于频繁，请稍后再试")
		return
	}

	if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(strings.ToLower(contentType), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "JSON_REQUIRED", "请使用 application/json 提交注册信息")
		return
	}

	var input gameRegistrationRequest
	if !decodeJSON(w, r, &input) {
		return
	}

	// 滑动验证：后台开关打开时强制校验。放在蜜罐和配额之前，
	// 避免未通过验证的请求消耗配额或触发蜜罐封禁。
	if s.registrationCaptchaEnabled(r.Context()) {
		if code := s.checkRegistrationCaptcha(input.CaptchaID, input.CaptchaOffset, input.CaptchaElapsed, input.CaptchaTrack); code != "" {
			writeError(w, http.StatusBadRequest, code, captchaErrorMessage(code))
			return
		}
	}

	// 蜜罐：命中直接封 IP。正常玩家不可能填到这一栏，误伤概率接近零。
	ipHash := registrationIPHash(ip)
	if strings.TrimSpace(input.Website) != "" {
		s.registrationGuard.ban(r.Context(), ipHash, "honeypot", time.Now())
		s.registrationGuard.record(r.Context(), registrationEvent{IPHash: ipHash, Result: registrationResultHoneypot})
		s.audit(r.Context(), nil, "game.registration.honeypot", "third_marketing_info", "",
			map[string]any{"honeypot": "website"}, nil, nil, 0, "注册蜜罐命中，已封禁该 IP", ip)
		writeError(w, http.StatusForbidden, "REGISTRATION_REJECTED", "请求被拒绝，请稍后重试")
		return
	}

	// 配额：单 IP 小时/日、单设备、全服日上限。库不可用时放行（fail open），
	// 因为注册本身要写游戏库，库挂了注册也成功不了。
	deviceKey := registrationDeviceKey(input.DeviceID)
	if reason, wait, guardErr := s.registrationGuard.blocked(r.Context(), ipHash, deviceKey, s.registrationGlobalDailyLimit(r.Context())); guardErr != nil {
		s.logger.Warn("registration quota check failed", "error", guardErr)
	} else if reason != registrationBlockNone {
		wait = max(wait, time.Second)
		w.Header().Set("Retry-After", strconv.Itoa(max(1, int(wait.Seconds()))))
		if reason == registrationBlockIPBanned {
			// 被封的 IP 不再写事件，避免封禁状态自己把表刷大。
			writeError(w, http.StatusForbidden, "REGISTRATION_REJECTED", "请求被拒绝，请稍后重试")
			return
		}
		if reason == registrationBlockGlobalDaily {
			// 全服日上限：对玩家来说是「今天注册不了」，不透露配额细节，也不写事件防止刷表。
			writeError(w, http.StatusTooManyRequests, "REGISTRATION_LIMIT_REACHED", "注册异常，请联系管理员")
			return
		}
		s.registrationGuard.record(r.Context(), registrationEvent{
			IPHash: ipHash, DeviceKey: deviceKey, LoginName: input.LoginName,
			Result: registrationResultRateLimited,
		})
		s.audit(r.Context(), nil, "game.registration.rate_limited", "third_marketing_info", "",
			map[string]any{"reason": string(reason), "loginName": input.LoginName}, nil, nil, 0, "注册配额已满，已拒绝", ip)
		writeError(w, http.StatusTooManyRequests, "REGISTRATION_RATE_LIMITED", "注册请求过于频繁，请稍后再试")
		return
	}

	registration, err := normalizeGameRegistration(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REGISTRATION", err.Error())
		return
	}

	if registrationInvitationRequired(s.cfg.GameMode) && registration.InvitationCode == "" {
		writeError(w, http.StatusBadRequest, "INVALID_REGISTRATION", "邀请码必须是 6 位数字")
		return
	}
	upperChain := registrationUpperChain{}
	if registration.InvitationCode != "" {
		var validInvitation bool
		upperChain, validInvitation, err = s.registrationInvitationUpperChain(r.Context(), registration.InvitationCode)
		if err != nil {
			s.logger.Error("validate game registration invitation", "error", err)
			writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "暂时无法验证邀请码，请稍后再试")
			return
		}
		if !validInvitation {
			writeError(w, http.StatusBadRequest, "INVALID_INVITATION_CODE", "邀请码无效，请核对后重试")
			return
		}
	}

	registrationConn, err := s.db.Conn(r.Context())
	if err != nil {
		s.logger.Error("reserve game registration database connection", "error", err)
		writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "暂时无法检查注册资料，请稍后再试")
		return
	}
	defer registrationConn.Close()

	nicknameLockName := registrationNicknameLockName(registration.Nickname)
	locked, err := acquireRegistrationNicknameLock(r.Context(), registrationConn, nicknameLockName)
	if err != nil {
		s.logger.Error("acquire game registration nickname lock", "error", err)
		writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "暂时无法检查昵称，请稍后再试")
		return
	}
	if !locked {
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusServiceUnavailable, "REGISTRATION_BUSY", "注册请求较多，请稍后再试")
		return
	}
	defer s.releaseRegistrationNicknameLock(registrationConn, nicknameLockName)

	exists, err := gameNicknameExists(r.Context(), registrationConn, registration.Nickname)
	if err != nil {
		s.logger.Error("check game registration nickname", "error", err)
		writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "暂时无法检查昵称，请稍后再试")
		return
	}
	if exists {
		writeError(w, http.StatusConflict, "ACCOUNT_UNAVAILABLE", "账号或昵称不可用，请更换后重试")
		return
	}

	exists, err = gameLoginNameExists(r.Context(), registrationConn, registration.LoginName)
	if err != nil {
		s.logger.Error("check game registration login name", "error", err)
		writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "暂时无法检查登录账号，请稍后再试")
		return
	}
	if exists {
		writeError(w, http.StatusConflict, "ACCOUNT_UNAVAILABLE", "账号或昵称不可用，请更换后重试")
		return
	}

	// 旧游戏登录链路要求 third_marketing_info.player_wxpwd 保存 MySQL MD5。
	// 明文密码只作为 SQL 参数传入，不记录日志、审计或接口响应。
	antiTheftValue := 0
	deviceID := ""
	var devicePlatform any
	bindingRevision := int64(0)
	if registration.AntiTheftEnabled {
		antiTheftValue = 1
		deviceID = registration.DeviceID
		devicePlatform = registration.DevicePlatform
		bindingRevision = 1
	}
	result, err := registrationConn.ExecContext(r.Context(), `INSERT INTO kbedm.third_marketing_info
(date, time, upper_guuid, upper2_guuid, upper3_guuid, player_wxid, player_wxname, player_wxpwd, status, level,
 anti_theft_on, device_id, device_platform, device_version, device_bound_at, binding_revision)
VALUES (CURDATE(), CURTIME(), ?, ?, ?, ?, ?, MD5(?), '', 0, ?, ?, ?, ?, IF(? = 1, NOW(), NULL), ?)`,
		upperChain.Direct, upperChain.Second, upperChain.Third,
		registration.LoginName, registration.Nickname, registration.Password,
		antiTheftValue, deviceID, devicePlatform, registration.DeviceVersion, antiTheftValue, bindingRevision)
	if err != nil {
		if isDuplicateKey(err) {
			writeError(w, http.StatusConflict, "ACCOUNT_UNAVAILABLE", "账号或昵称不可用，请更换后重试")
			return
		}
		s.logger.Error("create game registration", "error", err, "loginName", registration.LoginName)
		writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "注册失败，请稍后再试")
		return
	}
	id, err := result.LastInsertId()
	if err != nil {
		s.logger.Error("read game registration id", "error", err, "loginName", registration.LoginName)
		writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "注册已写入但返回结果异常，请勿重复提交")
		return
	}
	// 注册是少数能拿到明文密码的入口，加密存一份给后台管理员查看；失败只记日志，不影响注册结果。
	if err := s.savePlayerLoginPassword(r.Context(), registration.LoginName, registration.Password, playerPasswordSourceRegistration); err != nil {
		s.logger.Error("save registration login password", "error", err, "loginName", registration.LoginName)
	}

	upperIDs := upperChain.IDs()
	lowerCountsRefreshed := true
	if err := refreshRegistrationLowerCounts(r.Context(), registrationConn, upperIDs); err != nil {
		lowerCountsRefreshed = false
		s.logger.Error("refresh registration lower counts", "error", err, "registrationId", id, "upperChain", upperIDs)
		go s.retryRegistrationLowerCounts(upperIDs)
	}

	s.audit(r.Context(), nil, "game.registration.create", "third_marketing_info", numericID(id),
		map[string]any{
			"invitationCode":   registration.InvitationCode,
			"loginName":        registration.LoginName,
			"nickname":         registration.Nickname,
			"avatarIndex":      registration.AvatarIndex,
			"antiTheftEnabled": registration.AntiTheftEnabled,
			"devicePlatform":   registration.DevicePlatform,
			"deviceVersion":    registration.DeviceVersion,
		}, nil, map[string]any{
			"registrationId":       id,
			"upperChain":           upperIDs,
			"lowerCountsRefreshed": lowerCountsRefreshed,
		}, 0, "游戏账号注册成功", clientIP(r))
	go s.applyRegistrationAvatar(id, registration.AvatarIndex)
	// 只有真正建号成功才计入配额，被拒的请求不会占用正常用户的额度。
	s.registrationGuard.record(r.Context(), registrationEvent{
		IPHash:    ipHash,
		DeviceKey: deviceKey,
		LoginName: registration.LoginName,
		Result:    registrationResultOK,
	})
	s.logger.Info("registration completed", "loginName", registration.LoginName, "registrationId", id, "remote", ip)
	writeData(w, http.StatusCreated, map[string]any{
		"registrationId":   id,
		"invitationCode":   registration.InvitationCode,
		"loginName":        registration.LoginName,
		"nickname":         registration.Nickname,
		"avatarIndex":      registration.AvatarIndex,
		"antiTheftEnabled": registration.AntiTheftEnabled,
		"message":          registrationSuccessMessage(registration.AntiTheftEnabled),
	})
}

func setRegistrationCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Max-Age", "600")
}

func normalizeGameRegistration(input gameRegistrationRequest) (normalizedGameRegistration, error) {
	invitationCode, err := registrationAlias("邀请码", input.InvitationCode, input.UpperGUID)
	if err != nil {
		return normalizedGameRegistration{}, err
	}
	loginName, err := registrationAlias("登录账号", input.LoginName, input.Username, input.PlayerWXID)
	if err != nil {
		return normalizedGameRegistration{}, err
	}
	nickname, err := registrationAlias("昵称", input.Nickname, input.PlayerWXName)
	if err != nil {
		return normalizedGameRegistration{}, err
	}

	registration := normalizedGameRegistration{
		InvitationCode:   strings.TrimSpace(invitationCode),
		Nickname:         strings.TrimSpace(nickname),
		LoginName:        strings.TrimSpace(loginName),
		Password:         input.Password,
		AvatarIndex:      strings.TrimSpace(input.AvatarIndex),
		AntiTheftEnabled: input.AntiTheftEnabled,
		DeviceVersion:    1,
	}
	photo := strings.TrimSpace(input.Photo)
	if registration.AvatarIndex == "" {
		registration.AvatarIndex = photo
	} else if photo != "" && photo != registration.AvatarIndex {
		return normalizedGameRegistration{}, errors.New("头像字段内容不一致")
	}
	if registration.AvatarIndex == "" {
		registration.AvatarIndex = "1"
	}
	if registration.InvitationCode != "" && !isSixDigitCode(registration.InvitationCode) {
		return normalizedGameRegistration{}, errors.New("邀请码必须是 6 位数字")
	}
	if !isRegistrationLoginName(registration.LoginName) {
		return normalizedGameRegistration{}, errors.New("登录账号必须是 6 到 16 位英文字母或数字")
	}
	if err := validateRegistrationText(registration.Nickname, 1, 32, "昵称"); err != nil {
		return normalizedGameRegistration{}, err
	}
	if !isChineseEnglishOrDigitNickname(registration.Nickname) {
		return normalizedGameRegistration{}, errors.New("昵称只能使用中文、英文字母或数字")
	}
	if !isRegistrationAvatarIndex(registration.AvatarIndex) {
		return normalizedGameRegistration{}, errors.New("头像编号必须为 1 到 100")
	}
	if strings.TrimSpace(registration.Password) != registration.Password {
		return normalizedGameRegistration{}, errors.New("登录密码首尾不能包含空格")
	}
	if err := validateRegistrationText(registration.Password, 6, 32, "登录密码"); err != nil {
		return normalizedGameRegistration{}, err
	}
	deviceFieldsProvided := input.DeviceID != "" || input.DevicePlatform != "" || input.DeviceVersion != 0
	if registration.AntiTheftEnabled || deviceFieldsProvided {
		if input.DeviceID != strings.TrimSpace(input.DeviceID) {
			return normalizedGameRegistration{}, errors.New("设备标识首尾不能包含空格")
		}
		if !registrationDeviceIDPattern.MatchString(input.DeviceID) {
			return normalizedGameRegistration{}, errors.New("设备标识格式不正确")
		}
		if input.DevicePlatform != "android" && input.DevicePlatform != "ios" && input.DevicePlatform != "web" {
			return normalizedGameRegistration{}, errors.New("设备平台必须是 android、ios 或 web")
		}
		if input.DeviceVersion != 1 {
			return normalizedGameRegistration{}, errors.New("设备协议版本必须为 1")
		}
	}
	if registration.AntiTheftEnabled {
		registration.DeviceID = input.DeviceID
		registration.DevicePlatform = input.DevicePlatform
	}
	return registration, nil
}

func registrationInvitationRequired(gameMode string) bool {
	return strings.EqualFold(strings.TrimSpace(gameMode), "standard")
}

func registrationSuccessMessage(antiTheftEnabled bool) string {
	if antiTheftEnabled {
		return "注册成功，防盗号已开启，请使用当前设备登录"
	}
	return "注册成功，请使用登录账号和密码进入游戏"
}

func registrationAlias(label string, values ...string) (string, error) {
	selected := ""
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if selected != "" && selected != value {
			return "", errors.New(label + "字段内容不一致")
		}
		selected = value
	}
	return selected, nil
}

func isSixDigitCode(value string) bool {
	if len(value) != 6 {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func isRegistrationLoginName(value string) bool {
	if len(value) < 6 || len(value) > 16 {
		return false
	}
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') {
			return false
		}
	}
	return true
}

func isChineseEnglishOrDigitNickname(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if unicode.Is(unicode.Han, char) || (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') {
			continue
		}
		return false
	}
	return true
}

func isRegistrationAvatarIndex(value string) bool {
	index, err := strconv.Atoi(value)
	return err == nil && strconv.Itoa(index) == value && index >= 1 && index <= 100
}

// registrationAvatarSlots 限制「等玩家首次登录后补头像」的 goroutine 并发数。
// 这条链路只有玩家登录游戏、player_guuid 落库之后才有结果，注册完不登录就一直空转；
// 大批量注册会把这些 goroutine 全堆在这里，每个都在定期打游戏库。
var registrationAvatarSlots = make(chan struct{}, 16)

// registrationAvatarRetryDelays 分段退避：总时长仍约 2 分钟，
// 但单次注册的查询次数从每秒 1 次（最多 120 次）降到 8 次以内。
var registrationAvatarRetryDelays = []time.Duration{
	time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second,
	15 * time.Second, 15 * time.Second, 30 * time.Second, 45 * time.Second,
}

func (s *Server) applyRegistrationAvatar(registrationID int64, avatarIndex string) {
	select {
	case registrationAvatarSlots <- struct{}{}:
		defer func() { <-registrationAvatarSlots }()
	default:
		// 队列满说明注册量已经异常，补头像是次要功能，直接放弃，别去和主流程抢数据库。
		s.logger.Warn("registration avatar queue is full, skipped", "registrationId", registrationID)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt <= len(registrationAvatarRetryDelays); attempt++ {
		var playerGUID string
		err := s.db.QueryRowContext(ctx, `SELECT player_guuid
FROM kbedm.third_marketing_info WHERE id = ? LIMIT 1`, registrationID).Scan(&playerGUID)
		if err == nil && strings.TrimSpace(playerGUID) != "" {
			commandErr := s.setRegistrationAvatar(ctx, strings.TrimSpace(playerGUID), avatarIndex)
			if commandErr == nil {
				s.logger.Info("registration avatar applied", "registrationId", registrationID, "avatarIndex", avatarIndex)
				return
			}
			lastErr = commandErr
		} else if err != nil {
			lastErr = err
		}

		if attempt == len(registrationAvatarRetryDelays) {
			break
		}
		select {
		case <-ctx.Done():
			s.logger.Error("registration avatar apply timed out", "registrationId", registrationID, "avatarIndex", avatarIndex, "error", lastErr)
			return
		case <-time.After(registrationAvatarRetryDelays[attempt]):
		}
	}
	s.logger.Warn("registration avatar apply gave up", "registrationId", registrationID, "avatarIndex", avatarIndex, "error", lastErr)
}

func (s *Server) setRegistrationAvatar(ctx context.Context, playerGUID, avatarIndex string) error {
	operationContext := gameOperationContext("register-avatar")
	result, err := s.callGameCommand(ctx, "异步_设置_玩家_属性", map[string]any{
		"guuid":   playerGUID,
		"name":    "photo",
		"value":   avatarIndex,
		"context": operationContext,
	})
	if err != nil {
		return err
	}
	if result.RetCode != 512 && result.RetCode != 1280 {
		return fmt.Errorf("game command ret_code %d", result.RetCode)
	}
	return nil
}

func validateRegistrationText(value string, minLength, maxLength int, label string) error {
	length := utf8.RuneCountInString(value)
	if length < minLength || length > maxLength {
		return errors.New(label + "长度必须为 " + strconv.Itoa(minLength) + " 到 " + strconv.Itoa(maxLength) + " 个字符")
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return errors.New(label + "不能包含控制字符")
		}
	}
	return nil
}

func (s *Server) registrationInvitationUpperChain(ctx context.Context, invitationCode string) (registrationUpperChain, bool, error) {
	current := strings.TrimSpace(invitationCode)
	if current == "" {
		return registrationUpperChain{}, false, nil
	}
	chainIDs := make([]string, 0, 4)
	seen := make(map[string]struct{}, 4)

	for depth := 0; depth < maxRegistrationAncestorDepth; depth++ {
		if _, exists := seen[current]; exists {
			return registrationUpperChain{}, false, errors.New("invitation agent relationship contains a cycle")
		}
		seen[current] = struct{}{}

		parentID, isBoss, exists, err := s.registrationAgentParent(ctx, current)
		if err != nil {
			return registrationUpperChain{}, false, err
		}
		if !exists {
			if depth == 0 {
				return registrationUpperChain{}, false, nil
			}
			return registrationUpperChain{}, false, errors.New("invitation agent upstream account is invalid")
		}
		chainIDs = append(chainIDs, current)
		if isBoss {
			return registrationUpperChainFromIDs(chainIDs), true, nil
		}
		if parentID == "" {
			return registrationUpperChain{}, false, errors.New("invitation agent is not linked to an upstream agent")
		}
		current = parentID
	}
	return registrationUpperChain{}, false, errors.New("invitation agent relationship exceeds maximum depth")
}

func (s *Server) registrationAgentParent(ctx context.Context, agentID string) (string, bool, bool, error) {
	var parentID string
	var isBoss bool
	err := s.db.QueryRowContext(ctx, `SELECT
COALESCE(NULLIF(TRIM(m.upper_guuid), ''), NULLIF(TRIM(a.sm_agentID), ''), ''),
(a.sm_role LIKE '%老板%')
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.third_marketing_info m ON m.player_guuid = a.sm_guuid
WHERE a.sm_guuid = ? AND `+agentCandidateSQL+`
ORDER BY m.id DESC
LIMIT 1`, agentID).Scan(&parentID, &isBoss)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, false, nil
	}
	if err != nil {
		return "", false, false, err
	}
	return strings.TrimSpace(parentID), isBoss, true, nil
}

func registrationUpperChainFromIDs(values []string) registrationUpperChain {
	ids := compactUniqueRegistrationIDs(values...)
	chain := registrationUpperChain{All: ids}
	if len(ids) > 0 {
		chain.Direct = ids[0]
	}
	if len(ids) > 1 {
		chain.Second = ids[1]
	}
	if len(ids) > 2 {
		chain.Third = ids[2]
	}
	return chain
}

type registrationCountStore interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type registrationRelationship struct {
	RegistrationID  int64
	PlayerID        string
	ParentID        string
	RegisteredToday bool
}

type registrationLowerCount struct {
	All   int64
	Today int64
}

const registrationRelationshipSelectSQL = `SELECT
m.id, COALESCE(TRIM(m.player_guuid), ''),
COALESCE(NULLIF(TRIM(m.upper_guuid), ''), NULLIF(TRIM(a.sm_agentID), ''), ''),
(LEFT(TRIM(m.date), 10) = DATE_FORMAT(CURDATE(), '%Y-%m-%d'))
FROM kbedm.third_marketing_info m
LEFT JOIN kbedm.tbl_Account a ON a.sm_guuid = m.player_guuid
WHERE COALESCE(NULLIF(TRIM(m.upper_guuid), ''), NULLIF(TRIM(a.sm_agentID), ''), '') <> ''`

func refreshRegistrationLowerCounts(ctx context.Context, store registrationCountStore, upperIDs []string) error {
	upperIDs = compactUniqueRegistrationIDs(upperIDs...)
	if len(upperIDs) == 0 {
		return nil
	}
	counts, err := queryRegistrationLowerCounts(ctx, store, upperIDs)
	if err != nil {
		return err
	}
	query, args := registrationLowerCountUpdateStatement(upperIDs, counts)
	_, err = store.ExecContext(ctx, query, args...)
	return err
}

func registrationLowerCountUpdateStatement(upperIDs []string, counts map[string]registrationLowerCount) (string, []any) {
	upperIDs = compactUniqueRegistrationIDs(upperIDs...)
	selects := make([]string, 0, len(upperIDs))
	args := make([]any, 0, len(upperIDs)*3)
	for _, upperID := range upperIDs {
		count := counts[upperID]
		selects = append(selects, "SELECT ? AS ancestor_id, ? AS all_lower_count, ? AS today_lower_count")
		args = append(args, upperID, count.All, count.Today)
	}
	return `UPDATE kbedm.third_marketing_info AS parent
JOIN (` + strings.Join(selects, " UNION ALL ") + `) AS calculated
  ON calculated.ancestor_id = parent.player_guuid
SET parent.all_lower_count = calculated.all_lower_count,
    parent.today_lower_count = calculated.today_lower_count,
    parent.today_lower_date = DATE_FORMAT(CURDATE(), '%Y-%m-%d')
`, args
}

func queryRegistrationLowerCounts(ctx context.Context, store interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, ancestorIDs []string) (map[string]registrationLowerCount, error) {
	ancestorIDs = compactUniqueRegistrationIDs(ancestorIDs...)
	if len(ancestorIDs) == 0 {
		return map[string]registrationLowerCount{}, nil
	}
	rows, err := store.QueryContext(ctx, registrationRelationshipSelectSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	relationships := make([]registrationRelationship, 0)
	for rows.Next() {
		var relationship registrationRelationship
		if err := rows.Scan(
			&relationship.RegistrationID,
			&relationship.PlayerID,
			&relationship.ParentID,
			&relationship.RegisteredToday,
		); err != nil {
			return nil, err
		}
		relationships = append(relationships, relationship)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return calculateRegistrationLowerCounts(relationships, ancestorIDs), nil
}

func calculateRegistrationLowerCounts(relationships []registrationRelationship, ancestorIDs []string) map[string]registrationLowerCount {
	children := make(map[string][]registrationRelationship)
	for _, relationship := range relationships {
		parentID := strings.TrimSpace(relationship.ParentID)
		if parentID == "" {
			continue
		}
		children[parentID] = append(children[parentID], relationship)
	}

	result := make(map[string]registrationLowerCount)
	for _, ancestorID := range compactUniqueRegistrationIDs(ancestorIDs...) {
		count := registrationLowerCount{}
		visitedRegistrations := make(map[int64]struct{})
		expandedPlayers := map[string]struct{}{ancestorID: {}}
		queue := []string{ancestorID}
		for len(queue) > 0 {
			parentID := queue[0]
			queue = queue[1:]
			for _, relationship := range children[parentID] {
				if _, visited := visitedRegistrations[relationship.RegistrationID]; !visited {
					visitedRegistrations[relationship.RegistrationID] = struct{}{}
					count.All++
					if relationship.RegisteredToday {
						count.Today++
					}
				}
				playerID := strings.TrimSpace(relationship.PlayerID)
				if playerID == "" {
					continue
				}
				if _, expanded := expandedPlayers[playerID]; expanded {
					continue
				}
				expandedPlayers[playerID] = struct{}{}
				queue = append(queue, playerID)
			}
		}
		result[ancestorID] = count
	}
	return result
}

func compactUniqueRegistrationIDs(values ...string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func (s *Server) retryRegistrationLowerCounts(upperIDs []string) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	for attempt := 1; attempt <= 5; attempt++ {
		if err := refreshRegistrationLowerCounts(ctx, s.db, upperIDs); err == nil {
			s.logger.Info("registration lower counts repaired", "upperChain", upperIDs, "attempt", attempt)
			return
		} else if attempt == 5 {
			s.logger.Error("registration lower counts repair failed", "error", err, "upperChain", upperIDs, "attempt", attempt)
			return
		}

		timer := time.NewTimer(time.Duration(attempt) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

type gameAccountQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func gameNicknameExists(ctx context.Context, q gameAccountQuerier, nickname string) (bool, error) {
	var exists bool
	err := q.QueryRowContext(ctx, `SELECT
EXISTS(SELECT 1 FROM kbedm.third_marketing_info WHERE LOWER(TRIM(player_wxname)) = LOWER(?)) OR
EXISTS(SELECT 1 FROM kbedm.tbl_Account WHERE LOWER(TRIM(sm_name)) = LOWER(?))`,
		nickname, nickname).Scan(&exists)
	return exists, err
}

func gameLoginNameExists(ctx context.Context, q gameAccountQuerier, loginName string) (bool, error) {
	var exists bool
	err := q.QueryRowContext(ctx, `SELECT
EXISTS(SELECT 1 FROM kbedm.third_marketing_info WHERE LOWER(TRIM(player_wxid)) = LOWER(?)) OR
EXISTS(SELECT 1 FROM kbedm.tbl_Account WHERE LOWER(TRIM(sm_wxID)) = LOWER(?)) OR
EXISTS(SELECT 1 FROM kbedm.kbe_accountinfos WHERE LOWER(TRIM(accountName)) = LOWER(?))`,
		loginName, loginName, loginName).Scan(&exists)
	return exists, err
}

func registrationNicknameLockName(nickname string) string {
	normalized := strings.ToLower(strings.TrimSpace(nickname))
	digest := sha256.Sum256([]byte("xuanmanager:registration:nickname:" + normalized))
	return fmt.Sprintf("%x", digest)
}

func acquireRegistrationNicknameLock(ctx context.Context, conn *sql.Conn, lockName string) (bool, error) {
	var acquired sql.NullInt64
	if err := conn.QueryRowContext(ctx, `SELECT GET_LOCK(?, 5)`, lockName).Scan(&acquired); err != nil {
		return false, err
	}
	return acquired.Valid && acquired.Int64 == 1, nil
}

func (s *Server) releaseRegistrationNicknameLock(conn *sql.Conn, lockName string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var released sql.NullInt64
	if err := conn.QueryRowContext(ctx, `SELECT RELEASE_LOCK(?)`, lockName).Scan(&released); err == nil && released.Valid && released.Int64 == 1 {
		return
	} else if err != nil {
		s.logger.Error("release game registration nickname lock", "error", err)
	} else {
		s.logger.Error("release game registration nickname lock", "released", released)
	}

	// 释放失败时丢弃底层连接，避免带着命名锁回到连接池。
	_ = conn.Raw(func(any) error { return driver.ErrBadConn })
}

func isDuplicateKey(err error) bool {
	var mysqlError *mysql.MySQLError
	return errors.As(err, &mysqlError) && mysqlError.Number == 1062
}

// handleRegistrationMoved 处理主服务上的旧注册路径。
//
// 注册接口已经迁到独立端口（四层代理只能按连接数限速，需要一次注册一条连接），
// 这里不再受理，只回一句可读的提示，避免旧客户端停在注册页反复重试。
func (s *Server) handleRegistrationMoved(w http.ResponseWriter, r *http.Request) {
	setRegistrationCORS(w)
	writeError(w, http.StatusBadRequest, "REGISTRATION_MOVED", "注册服务已升级，请更新客户端到最新版本后再试")
}
