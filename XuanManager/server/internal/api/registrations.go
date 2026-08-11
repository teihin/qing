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
	allowed, retryAfter := s.registrationLimiter.allow(clientIP(r), time.Now())
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
	registration, err := normalizeGameRegistration(input)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REGISTRATION", err.Error())
		return
	}

	validInvitation, err := s.validRegistrationInvitation(r, registration.InvitationCode)
	if err != nil {
		s.logger.Error("validate game registration invitation", "error", err)
		writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "暂时无法验证邀请码，请稍后再试")
		return
	}
	if !validInvitation {
		writeError(w, http.StatusBadRequest, "INVALID_INVITATION_CODE", "邀请码无效，请核对后重试")
		return
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
		writeError(w, http.StatusConflict, "NICKNAME_EXISTS", "该昵称已被使用")
		return
	}

	exists, err = gameLoginNameExists(r.Context(), registrationConn, registration.LoginName)
	if err != nil {
		s.logger.Error("check game registration login name", "error", err)
		writeError(w, http.StatusInternalServerError, "REGISTRATION_FAILED", "暂时无法检查登录账号，请稍后再试")
		return
	}
	if exists {
		writeError(w, http.StatusConflict, "LOGIN_NAME_EXISTS", "该登录账号已被使用")
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
(date, time, upper_guuid, player_wxid, player_wxname, player_wxpwd, status, level,
 anti_theft_on, device_id, device_platform, device_version, device_bound_at, binding_revision)
VALUES (CURDATE(), CURTIME(), ?, ?, ?, MD5(?), '', 0, ?, ?, ?, ?, IF(? = 1, NOW(), NULL), ?)`,
		registration.InvitationCode, registration.LoginName, registration.Nickname, registration.Password,
		antiTheftValue, deviceID, devicePlatform, registration.DeviceVersion, antiTheftValue, bindingRevision)
	if err != nil {
		if isDuplicateKey(err) {
			writeError(w, http.StatusConflict, "LOGIN_NAME_EXISTS", "该登录账号已被使用")
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

	s.audit(r.Context(), nil, "game.registration.create", "third_marketing_info", numericID(id),
		map[string]any{
			"invitationCode":   registration.InvitationCode,
			"loginName":        registration.LoginName,
			"nickname":         registration.Nickname,
			"avatarIndex":      registration.AvatarIndex,
			"antiTheftEnabled": registration.AntiTheftEnabled,
			"devicePlatform":   registration.DevicePlatform,
			"deviceVersion":    registration.DeviceVersion,
		}, nil, map[string]any{"registrationId": id}, 0, "游戏账号注册成功", clientIP(r))
	go s.applyRegistrationAvatar(id, registration.AvatarIndex)
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
	if !isSixDigitCode(registration.InvitationCode) {
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

func (s *Server) applyRegistrationAvatar(registrationID int64, avatarIndex string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	var lastErr error
	for {
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

		select {
		case <-ctx.Done():
			s.logger.Error("registration avatar apply timed out", "registrationId", registrationID, "avatarIndex", avatarIndex, "error", lastErr)
			return
		case <-time.After(time.Second):
		}
	}
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

func (s *Server) validRegistrationInvitation(r *http.Request, invitationCode string) (bool, error) {
	var exists bool
	err := s.db.QueryRowContext(r.Context(), `SELECT EXISTS(
SELECT 1
FROM kbedm.tbl_Account a
LEFT JOIN kbedm.third_marketing_info m ON m.player_guuid = a.sm_guuid
WHERE a.sm_guuid = ? AND `+agentCandidateSQL+`
)`, invitationCode).Scan(&exists)
	return exists, err
}

func gameNicknameExists(ctx context.Context, conn *sql.Conn, nickname string) (bool, error) {
	var exists bool
	err := conn.QueryRowContext(ctx, `SELECT
EXISTS(SELECT 1 FROM kbedm.third_marketing_info WHERE LOWER(TRIM(player_wxname)) = LOWER(?)) OR
EXISTS(SELECT 1 FROM kbedm.tbl_Account WHERE LOWER(TRIM(sm_name)) = LOWER(?))`,
		nickname, nickname).Scan(&exists)
	return exists, err
}

func gameLoginNameExists(ctx context.Context, conn *sql.Conn, loginName string) (bool, error) {
	var exists bool
	err := conn.QueryRowContext(ctx, `SELECT
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
