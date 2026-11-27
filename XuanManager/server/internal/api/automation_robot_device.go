package api

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"time"
)

// 机器人账号的设备绑定（防盗号）
//
// 目的：机器人账号只能由 worker 登录，别人拿到账号密码也不能登。
// 做法：把账号的 `anti_theft_on` 打开，并把 `device_id` 统一绑成**整个 worker 集群共用的一个设备码**。
//
// 为什么是共用而不是按账号推导：worker 是可替换的执行器，任何一台机器都可能接手任何一个机器人。
// 设备码跟着「集群」走而不是跟着账号/机器走，换机器、换节点、换终端号都不影响登录，
// 也不需要为每个账号算不同的值。手机/PC 客户端是随机设备码，对不上就被游戏服拒（实测 code 2563）。
//
// 注意：这里只改游戏库 `kbedm.third_marketing_info`，真正的拦截由游戏服执行。

// robotAutoAccountPrefix 是自动建号用的固定前缀：登录名 = worker + 三位序号。
const robotAutoAccountPrefix = "worker"

// nextRobotAccountNo 取现有 workerNNN 账号的最大序号 + 1，作为下一次自动建号的起点。
// 后台机器人和游戏库营销表都看一遍，避免历史账号被重复创建。
func (s *Server) nextRobotAccountNo(ctx context.Context) (int, error) {
	var backend, game int
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(CAST(SUBSTRING(account, 7) AS UNSIGNED)), 0)
FROM mgr_automation_robot WHERE account REGEXP '^worker[0-9]+$'`).Scan(&backend); err != nil {
		return 0, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COALESCE(MAX(CAST(SUBSTRING(player_wxid, 7) AS UNSIGNED)), 0)
FROM kbedm.third_marketing_info WHERE player_wxid REGEXP '^worker[0-9]+$'`).Scan(&game); err != nil {
		return 0, err
	}
	next := backend
	if game > next {
		next = game
	}
	if next < 1 {
		next = 1
	}
	return next + 1, nil
}

// robotDeviceFleetID 是 worker 集群统一的设备码。
// 客户端 `agent-client/client.js` 的默认值必须与此一致（可用 XUAN_DEVICE_ID 覆盖，改了要同步这里）。
const robotDeviceFleetID = "xuanagent-worker-fleet-v1"

const robotDevicePlatform = "web"
const robotDeviceVersion = "1"

var (
	robotBindingMu       sync.Mutex
	robotBindingSyncedAt time.Time
)

// syncRobotDeviceBindings 给所有机器人账号补/纠正设备绑定。每 5 分钟最多跑一次，
// 只更新「没开防盗号、没绑设备、或绑的值不是本算法」的行，避免反复写。
func syncRobotDeviceBindings(ctx context.Context, db *sql.DB, logger *slog.Logger) {
	robotBindingMu.Lock()
	if time.Since(robotBindingSyncedAt) < 5*time.Minute {
		robotBindingMu.Unlock()
		return
	}
	robotBindingSyncedAt = time.Now()
	robotBindingMu.Unlock()

	result, err := db.ExecContext(ctx, `UPDATE kbedm.third_marketing_info m
JOIN mgr_automation_robot r ON r.account = m.player_wxid
SET m.anti_theft_on = 1,
    m.device_id = ?,
    m.device_platform = ?,
    m.device_version = ?,
    m.device_bound_at = IFNULL(m.device_bound_at, NOW()),
    m.binding_revision = m.binding_revision + 1
WHERE m.anti_theft_on = 0
   OR COALESCE(m.device_id, '') = ''
   OR m.device_id <> ?`,
		robotDeviceFleetID, robotDevicePlatform, robotDeviceVersion, robotDeviceFleetID)
	if err != nil {
		logger.Error("sync robot device bindings", "error", err)
		return
	}
	if affected, _ := result.RowsAffected(); affected > 0 {
		logger.Info("robot device bindings synced", "updated", affected)
		agentStreams.notifyChange("robots", nil)
	}
}
