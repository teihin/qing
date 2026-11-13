# 重复玩家识别与玩家关联方案（IP / 设备 / GPS）

> 状态：**方案评估稿，未实施**（2026-11-05）
> 需求：识别重复玩家；后台玩家列表中，每条玩家记录实时带出“相关玩家（玩家名 + 玩家ID）”字段。
> 结论：**需求可行，建议做；客户端不需要改协议。** 但原描述里有三处需要调整，见 §1.2。
> 关联文档：`doc/项目情况说明.md`、`doc/新后台管理系统接口文档.md`、`doc/防盗号功能接口文档.md`、`doc/防盗号功能服务端实现方案.md`

## 0. 一页速览

| 项 | 结论 |
| --- | --- |
| 客户端改造 | **不需要**。登录 `clientDatas` 已带 `device_id`；GPS 已在用 `reqSetProperty("gps", ...)` 上报；IP 由服务端从 `clientAddr` 取 |
| 服务端改造 | `Account.onClientEnabled()` 写登录 IP / 设备；`reqSetProperty("gps")` 节流更新设备最后位置 |
| 新表 | `usr_login_ip_info`（登录 IP 事实表）、`usr_player_device_info`（玩家设备 + 最近位置表） |
| 后台展示 | 现有 `xuanmanager` 玩家列表接口 `GET /api/game/players` 批量聚合 `related_players` 字段 |
| 关联信号 | 设备（高置信） > GPS（中） > IP（低）；必须带时间窗和共享阈值 |
| 展示上限 | 每个玩家最多展示 10 个相关玩家，另返回总数；`张三(10001)、李四(10002)` 格式 |
| 主要风险 | 同 IP 大量无关玩家（NAT/代理）、同设备多人共用、GPS 可伪造、设备码可重置、隐私权限 |
| 明确不做 | 不改防盗号绑定逻辑；不做自动封号；不在每次 GPS 上报时新增一行数据库记录 |

**建议的最终口径：设备码作为主信号，GPS 和 IP 作为辅助信号；登录时落 IP/设备，GPS 节流更新；后台按页批量查询，不逐行 N+1。**

---

## 1. 需求评估

### 1.1 能做，而且比预想的省事

- 设备码：当前客户端登录时已经把 `{"version":1,"platform":"web","device_id":"<uuid>","scene":"login"}` 放在登录 `datas` 里；服务端只是**只在防盗号开启的账号上消费**，其余账号直接丢弃。
- GPS：客户端在大厅/房间通过 `reqSetProperty("gps", "lat,lon")` 上报，服务端已有落点（`Account.gps` / `tbl_Account.sm_gps`），测试服日志中同一账号约每分钟上报一次。
- IP：服务端在 `Account.onClientEnabled()` 里从 `clientAddr` 计算并写入 `tbl_Account.sm_ip`，不需要新开客户端接口。

因此，本需求的核心不是“让客户端上报”，而是“把已有的设备码/GPS/IP 从单值字段扩展成可查询的关联数据”。

### 1.2 原描述需要调整的三处

| 问题 | 原描述 | 实际情况 | 建议 |
| --- | --- | --- | --- |
| GPS 没落到两张表 | 说“通过 GPS 和 IP 关联”，但只建 IP 表、设备表 | GPS 目前在 `tbl_Account.sm_gps`，只有一个最新值，没有索引，无法做关联查询 | 把“最近有效 GPS + 约 110 米网格”放进设备表，不额外建第三张表 |
| 设备码不是全量 | 认为客户端上报后服务端都有 | 测试服 61 条注册记录只有 9 条有 `third_marketing_info.device_id`，因为只有开启防盗号的账号才会写 | 在 `onClientEnabled()` 解析所有登录 `clientDatas`，不要依赖 `third_marketing_info.device_id` |
| IP 关联误报会很大 | 同 IP 就认为相关 | 测试服 59 个账号里 28 个是 `127.0.0.1`，另有 6 个账号共用同一个公网 IP；正式服手机网络/CGNAT/网吧/代理也会大量共用 IP | IP 只作为低置信信号，必须加时间窗、公网过滤和“单 IP 最多关联多少人”的阈值 |

### 1.3 建议的判定优先级

1. **同设备**：最强信号。同一 `device_id` 被多个账号使用，通常意味着同一台设备/同一浏览器。
2. **同 GPS 网格 + 时间接近**：中等信号。能发现“同一地点、不同设备”的账号，但家庭/网吧/商场会误报。
3. **同公网 IP + 时间接近**：弱信号。只能作为辅助线索，不能单独作为“同一人”的结论。

后台展示时应把“关联”定位为**排查线索**，不是作弊结论。

---

## 2. 现状核对（含测试服证据）

### 2.1 登录设备码

- 登录入口：`scripts/interface/kbemain.py:315` `onRequestAccountLogin()`。
- 客户端登录数据在 `datas` 中，测试服日志可见：
  `clientDatas=((b'{"version":1,"platform":"web","device_id":"<uuid>","scene":"login"}', b''))`
  （见 `scripts/base/Account.py:1117` 的日志输出）。
- 当前解析函数 `_parse_anti_theft_datas()`（`scripts/interface/kbemain.py:89`）只在防盗号校验时调用；普通账号即使带了 `device_id` 也不会落库。
- 登录 SQL 已查询 `device_id/device_platform/device_version/device_bound_at`（`scripts/interface/kbemain.py:365`），但这些字段来自 `third_marketing_info`，只对绑定防盗号的账号有值。
- 测试服当前 `third_marketing_info` 共 61 条记录，`device_id<>''` 的只有 9 条。

**结论：** 设备码要从 baseapp 的 `getClientDatas()` 解析，覆盖所有登录账号；防盗号绑定逻辑保持原样，两者互不影响。

### 2.2 GPS 上报

- 上报方式：客户端调用实体暴露方法 `reqSetProperty("gps", value)`，服务端在 `scripts/base/Account.py:2026` 处理。
- 测试服日志可见 `[Account][<guuid>]reqSetProperty: name=gps value=<lat>,<lon>`，同一账号约每分钟一次；说明客户端已有稳定的上报入口。
- 当前处理会把非法值替换成 `1,1`（`Account.py:2030`），并可能被 `red_gps` / `yellow_gps` 配置改成假坐标；`tbl_Account.sm_gps` 还会在每次上报时 `writeToDB()`（`Account.py:2085`）。
- 测试服 `sm_gps` 中存在空值、`0,0` 和多个账号聚集在同一坐标簇的情况。

**结论：** 复用现有 GPS 上报，不新增客户端协议；但新表**不能每次上报都新增一行**，否则会把现有“每次上报写一次 `tbl_Account`”的写放大再翻一倍。

### 2.3 IP 记录

- 登录/重连时 `Account.onClientEnabled()` 从 `clientAddr` 计算 IP（`scripts/base/Account.py:1036`、`:1057`），写入持久属性 `ip`（`scripts/entity_defs/Account.def:72`），最终落到 `tbl_Account.sm_ip`。
- `reqSetProperty("ip", value)`（`Account.py:2093`）允许客户端写 `ip`，这个值不可信；关联表只在登录时读取刚由 `clientAddr` 计算出的 `self.ip`（保留现有 red_ip 伪装），不读取客户端后续写入的 `ip` 属性。
- `tbl_Account.sm_ip` 只有最新值，没有时间、没有历史，也没有索引；无法做“某段时间内谁和谁同 IP”的查询。
- 测试服 59 个账号中 28 个 `sm_ip=127.0.0.1`（测试客户端经本机转发），另有 6 个账号共用一个公网 IP；正式服也可能出现家庭/公司/运营商 NAT 共用。

**结论：** 新增 IP 事实表，记录登录时由 `clientAddr` 计算出的 IP（红/黄名单账号保留现有伪装）；回环/内网/保留地址入库但标记为非公网，不参与关联。

### 2.4 后台玩家列表

- 线上新后台是独立的 `xuanmanager` Go 服务（不在本仓库），玩家列表接口为 `GET /api/game/players`，直接查 `kbedm`；现有敏感信息接口为 `GET /api/game/players/{playerId}/sensitive`，权限 `game.player.sensitive.view`。
- `doc/新后台管理系统接口文档.md` §4.1 也明确新后台玩家列表直接查 MySQL（`tbl_Account` + `kbedm.third_marketing_info`），不经过游戏服 HTTP 命令。
- 现有玩家列表没有“关联玩家”字段，也没有按设备/IP/GPS 关联的查询。

**结论：** 关联字段应在 `xuanmanager` 的玩家列表查询里做，**不要把重查询放到游戏服**；本仓库只负责把数据写进两张表。

### 2.5 接口选择结论

| 数据 | 复用的现有入口 | 是否需要新客户端接口 |
| --- | --- | --- |
| 设备码 | 登录 `datas`（`onRequestAccountLogin` / `getClientDatas()`） | 不需要 |
| GPS | `reqSetProperty("gps", ...)` | 不需要 |
| IP | `Account.clientAddr`（服务端观测） | 不需要 |

---

## 3. 关联口径设计

### 3.1 信号与默认阈值

| 信号 | 来源 | 置信度 | 建议时间窗 | 参与关联的条件 |
| --- | --- | --- | --- | --- |
| 同设备 | `usr_player_device_info.device_id` | 高（100 分） | 90 天 | 设备码有效、非空；双方 `last_seen` 在窗口内 |
| 同 GPS 网格 | `usr_player_device_info.gps_lat_e3/lon_e3` | 中（60 分） | 7 天 | GPS 有效；按 3 位小数（约 110 米）取整；双方 `last_gps_at` 在窗口内 |
| 同公网 IP | `usr_login_ip_info.login_ip` | 低（30 分） | 7 天 | `ip_public=1`；同 IP；双方 `last_login_time` 在窗口内；该 IP 关联人数不超过阈值（默认 20） |

- 多条信号命中同一相关玩家时，分数相加，最高 100；按分数、最近时间排序。
- 只有 IP 命中的玩家建议标为“弱关联”，后台可用不同颜色/图标区分；是否展示由后台产品决定。
- 设备 + GPS / 设备 + IP 同时命中时，基本可以认为是同一人/同一设备环境，但仍不能自动封号。

### 3.2 共享阈值

- **单 IP 阈值**：同一时间窗内，一个公网 IP 关联的不同玩家超过 20 个时，视为共享出口（NAT/代理/网吧），该 IP 不参与列表关联，或只显示“同 IP 人数”而不展开名单。
- **单 GPS 网格阈值**：同一网格内不同玩家超过 50 个时，视为公共场所，不展开名单。
- **单设备阈值**：同一设备被超过 50 个账号使用时不隐藏（这正是需要排查的场景），但展示最多 10 人，并返回总数。
- 阈值都放在后台查询配置里，不写死在数据库；后续可按运营反馈调整。

### 3.3 不参与关联的数据

- 回环/内网/保留 IP：`127.0.0.0/8`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`、`100.64.0.0/10`（CGNAT）、`0.0.0.0/8`、组播/保留段等。
- 无效 GPS：空值、`0,0`、`1,1`（现有代码的非法值占位）、超出经纬度范围的值。
- 无效设备码：不符合 `^[A-Za-z0-9._:-]{8,255}$` 的值；空设备码不入设备表。
- 红/黄名单被 `red_ip` / `red_gps` / `yellow_gps` 改写过的账号：默认写生效值（即现有伪装值），不额外绕过去拿真实值；如果运营希望这些账号完全不参与关联，可在写入时直接排除。此项需确认，见 §9。

### 3.4 展示口径

- 字段名：`related_players`，字符串；格式 `玩家名(玩家ID)`，多个用中文顿号 `、` 分隔。
- 每个玩家最多展示 10 个相关玩家；超过时字符串末尾加 `等N人`，同时返回 `related_count` 表示真实总数。
- 另返回 `related_types`（本行关联到的信号类型并集，如 `device,gps,ip`）和 `related_visible`（是否有权限查看）。
- **列表里不返回原始 IP、GPS 坐标、设备码**；这些只在玩家详情的敏感信息接口里按权限展示。
- 无关联时返回空字符串、`related_count=0`，不要返回 `"无"` 之类的占位。

示例：

```json
{
  "guuid": "100001",
  "name": "张三",
  "related_players": "李四(100002)、王五(100003)",
  "related_count": 2,
  "related_types": "device,gps",
  "related_visible": true
}
```

---

## 4. 数据表设计

### 4.1 `usr_login_ip_info`（登录 IP 事实表）

设计目标：只回答“谁在什么时间用过哪个 IP”，不承担设备/GPS 维度；表尽量窄，索引尽量小。

```sql
CREATE TABLE `usr_login_ip_info` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_guuid` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '玩家ID',
  `user_name` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '登录时昵称快照',
  `login_day` DATE NOT NULL COMMENT '登录日期，用于按天聚合和清理',
  `login_ip` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'IPv4 整数（INET_ATON）',
  `ip_public` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1=公网，0=回环/内网/保留',
  `first_login_time` DATETIME NOT NULL COMMENT '当天该 IP 首次登录',
  `last_login_time` DATETIME NOT NULL COMMENT '当天该 IP 最近登录',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_day_ip` (`user_guuid`,`login_day`,`login_ip`),
  KEY `idx_ip_day` (`login_ip`,`login_day`),
  KEY `idx_user_day` (`user_guuid`,`login_day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='玩家登录IP记录';
```

写入口径：

- 同一个玩家、同一天、同一个 IP 只保留一行；`first_login_time` 首次写入后不变，`last_login_time` 每次登录/重连更新。
- 一天内换了多个 IP 就多行；这是关联查询需要的，不会无限增长。
- 不在这里存 `device_id`：设备码最长 255 字节，放进 IP 表的唯一索引会把索引撑大；设备维度由设备表负责。
- `user_guuid` 用 `ascii_bin`，玩家 ID 实际是数字串；比 `utf8` 索引小很多。
- `user_name` 用 64 字符快照（注册规则限制昵称最大 32 显示宽度，64 字符足够），避免关联查询再回表 `tbl_Account`。
- 当前项目 `guuid` 是数字串，所以用 `ascii_bin`；如果后续出现非 ASCII 的玩家 ID，需要改回 `utf8_bin`。

索引说明：

- `uk_user_day_ip`：支撑登录 upsert。
- `idx_ip_day`：支撑“本页玩家的 IP 集合 → 找同 IP 的其它玩家”。
- `idx_user_day`：支撑“取本页玩家最近 7 天的 IP”。

### 4.2 `usr_player_device_info`（玩家设备 + 最近位置表）

设计目标：一个玩家在一台设备上只保留一行，记录最近登录、最近 IP、最近有效 GPS，供设备关联和 GPS 关联使用。

```sql
CREATE TABLE `usr_player_device_info` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_guuid` VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '玩家ID',
  `user_name` VARCHAR(64) NOT NULL DEFAULT '' COMMENT '最近登录昵称',
  `device_id` VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '客户端设备ID',
  `device_platform` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT 'android/ios/web',
  `first_seen` DATETIME NOT NULL COMMENT '首次见到该设备',
  `last_seen` DATETIME NOT NULL COMMENT '最近一次登录/定位更新',
  `last_ip` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '最近登录IP',
  `last_ip_public` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '最近IP是否公网',
  `last_gps` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '最近有效GPS原文 lat,lon',
  `gps_lat_e3` INT DEFAULT NULL COMMENT '纬度 x1000 四舍五入，约110米网格',
  `gps_lon_e3` INT DEFAULT NULL COMMENT '经度 x1000 四舍五入',
  `last_gps_at` DATETIME DEFAULT NULL COMMENT '最近有效GPS时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_user` (`device_id`,`user_guuid`),
  KEY `idx_user_seen` (`user_guuid`,`last_seen`),
  KEY `idx_gps_cell` (`gps_lat_e3`,`gps_lon_e3`,`last_gps_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COMMENT='玩家设备与最近位置';
```

写入口径：

- 登录时按 `(device_id, user_guuid)` upsert；`first_seen` 不变，`last_seen`、`last_ip`、`user_name` 更新。
- GPS 上报时只更新当前设备的 `last_gps/gps_lat_e3/gps_lon_e3/last_gps_at/last_seen`；不新增行。
- GPS 无效（空、`0,0`、`1,1`、超范围）时保持上一次有效值，不清空。
- 同一玩家换设备会产生多行；同一设备被多个账号使用也会有多行，这是设备关联的基础。
- `last_gps` 存原文便于后台展示；`gps_lat_e3/gps_lon_e3` 用于索引匹配。

### 4.3 为什么是这两张表

| 维度 | 基数 | 查询方式 | 放在哪 |
| --- | --- | --- | --- |
| 玩家 + 天 + IP | 每个玩家每天 1~N 行 | 按 IP 找玩家、按玩家找 IP | `usr_login_ip_info` |
| 玩家 + 设备 | 每个玩家每台设备 1 行 | 按设备找玩家、按玩家找设备、按 GPS 网格找玩家 | `usr_player_device_info` |

- 没有合并成一张宽表：IP 是按天增长的事实，设备是低频更新的维度；混在一起会让索引和更新都不必要地变大。
- 没有把 GPS 单独建第三张表：只需要“最近有效位置”做关联，不需要 GPS 历史轨迹；设备表一行就够。
- 没有直接把字段加到 `tbl_Account`：`tbl_Account` 是 KBEngine 管理的实体表，只有单值、没有历史；频繁加索引/改结构风险更高。

### 4.4 容量与保留

按测试/正式服规模估算：

| 规模 | IP 表日增 | 180 天行数 | 约占用 | 设备表 |
| --- | --- | --- | --- | --- |
| 1 万日活、每人每天 2 个 IP | 2 万行 | 360 万行 | 约 1~2 GB | 约 1~2 万行 |
| 10 万日活、每人每天 2 个 IP | 20 万行 | 3600 万行 | 约 13~20 GB | 约 10~15 万行 |

建议：

- IP 表默认保留 **180 天**，按 `login_day` 分批删除；如果超过 1000 万行且删除压力大，再评估按 `login_day` 分区（注意 MySQL 5.7 分区要求所有唯一键包含分区列，本期不做）。
- 设备表只保留“玩家 × 设备”维度，增长有限；默认不清理，账号删除/注销时按 `user_guuid` 删除即可。
- 两张表都用 **InnoDB**：登录/GPS 写入是并发的，MyISAM 的表锁不适合；InnoDB 也便于崩溃恢复和行级清理。

### 4.5 回填

- 测试服可选回填：从 `third_marketing_info.device_id` 回填 9 条已绑定设备；从 `tbl_Account.sm_ip/sm_gps` 回填最近值。回填时间统一用当前时间，仅用于联调，不代表真实登录时间。
- 正式服建议**不回填**，上线后自然积累；避免把未知时间的历史 IP/GPS 当成近期关联。

---

## 5. 服务端写入链路

### 5.1 登录/重连：`Account.onClientEnabled()`

落点：`scripts/base/Account.py:1036`，在现有红/黄名单改写之后取生效值 `self.ip`。

伪代码（实施时按项目风格写成小 helper，不新增模块）：

```python
# self.ip 已在 onClientEnabled 里由 clientAddr 计算，并保留现有 red_ip 伪装；
# 不要读取客户端后续 reqSetProperty("ip") 写入的值。
relation_ip_int = _ipv4_text_to_int(self.ip)
relation_ip_public = _is_public_ipv4(relation_ip_int)
device = _parse_login_device(self.getClientDatas())  # 解析登录 datas 中的 device_id/platform

if d_halls.datas[1].get("player_relation_record_on", True):
    self._recordPlayerRelation(relation_ip_int, relation_ip_public, device)
```

要求：

- 解析 `getClientDatas()` 时兼容 `((b'json', b''))`、`(b'json', b'')`、字符串/字节两种情况；JSON 长度限制 1024 字节。
- 设备码用现有 `ANTI_THEFT_DEVICE_RE` 和 `ANTI_THEFT_PLATFORMS` 校验（`scripts/base/Account.py:29`）；不合法则只记 IP，不写设备表。
- 使用登录时刚计算出的 `self.ip`（正常账号就是 `clientAddr`，红/黄名单账号保留现有伪装）；不要在后来的流程里读 `self.ip`，因为客户端可以调用 `reqSetProperty("ip", ...)` 改写它。
- 红/黄名单账号默认写生效值；是否改为原始值或直接排除见 §9。
- 重连会再次触发 `onClientEnabled()`，IP 表按 `(玩家, 日期, IP)` upsert，设备表按 `(设备, 玩家)` upsert，不会重复新增。
- 不需要在 `interfaces` 登录进程写库：那里拿不到客户端 IP，且密码错误/未真正进入游戏的登录不应记录。

### 5.2 GPS：`reqSetProperty("gps")`

落点：`scripts/base/Account.py:2026` 的 `elif name == "gps":` 分支，在现有过滤和 `writeToDB()` 之后调用。

处理流程：

1. 取过滤后的 `self.gps`（此时已处理非法值和红/黄名单）。
2. 跳过空值、`0,0`、`1,1`、经纬度越界。
3. 计算 `gps_lat_e3 = int(round(lat * 1000))`、`gps_lon_e3 = int(round(lon * 1000))`。
4. 节流：与上次写入相比，网格变化，或距上次写入超过 **10 分钟**，才更新数据库；否则只更新内存。
5. 更新 `usr_player_device_info` 中当前 `(user_guuid, device_id)` 行的 GPS 和 `last_seen`；没有设备行时跳过。

节流状态放在账号实体内存里，例如：

```python
self._relation_device_id = ''      # onClientEnabled 时设置
self._relation_gps_cell = None     # 上次写库的网格
self._relation_gps_write_time = 0  # 上次写库时间
```

这样做的原因：

- 测试服日志显示 GPS 约每分钟上报一次；如果每次都写新表，等于在现有 `tbl_Account` 写之外再加一份写放大。
- 10 分钟节流后，在线玩家最多每人 6 次/小时，10 万在线约 167 次/秒的单行 UPDATE，InnoDB 可以承受；1 万在线约 17 次/秒。
- 同一网格也定期刷新 `last_gps_at`，避免玩家一直待在原地却因为时间窗过期而不再参与关联。

### 5.3 SQL 草案

登录 IP upsert：

```sql
INSERT INTO usr_login_ip_info
  (user_guuid, user_name, login_day, login_ip, ip_public, first_login_time, last_login_time)
VALUES
  ('<guuid>', '<name>', CURDATE(), <ip_int>, <ip_public>, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  user_name = VALUES(user_name),
  ip_public = VALUES(ip_public),
  last_login_time = NOW();
```

设备 upsert（仅设备码有效时）：

```sql
INSERT INTO usr_player_device_info
  (user_guuid, user_name, device_id, device_platform,
   first_seen, last_seen, last_ip, last_ip_public)
VALUES
  ('<guuid>', '<name>', '<device_id>', '<platform>',
   NOW(), NOW(), <ip_int>, <ip_public>)
ON DUPLICATE KEY UPDATE
  user_name = VALUES(user_name),
  device_platform = VALUES(device_platform),
  last_seen = NOW(),
  last_ip = VALUES(last_ip),
  last_ip_public = VALUES(last_ip_public);
```

GPS 更新（节流后）：

```sql
UPDATE usr_player_device_info
SET last_gps = '<lat>,<lon>',
    gps_lat_e3 = <lat_e3>,
    gps_lon_e3 = <lon_e3>,
    last_gps_at = NOW(),
    last_seen = NOW()
WHERE user_guuid = '<guuid>' AND device_id = '<device_id>'
LIMIT 1;
```

注意：

- 游戏服这边用 `_sql_escape()`（`scripts/base/Account.py:49`）处理昵称、设备码；IP 用整数；GPS 只写重新格式化后的数字串。
- `ON DUPLICATE KEY UPDATE` 在 MySQL 5.7 可用；后续升级 MySQL 8 时再处理 `VALUES()` 弃用问题。
- GPS 更新不覆盖 `last_ip`，避免定位上报把登录 IP 改掉。

### 5.4 失败隔离

- 所有解析、字符串拼接、SQL 执行都包在 `try/except` 中；异常只记一条简短的 `ERROR_MSG`，**绝不能影响登录和 GPS 原有流程**。
- 使用 `KBEngine.executeRawDatabaseCommand()` 异步执行，不等待结果；如需定位失败，加一个只记录错误标记的回调，不要把原始 GPS/设备码打进日志。
- 部署顺序必须是：**先建表 → 再上代码**。表不存在时登录仍应成功，但会持续报数据库错误。
- 总开关读取 `d_halls.datas[1].get("player_relation_record_on", True)`；默认开启，需要关闭时在测试服 `d_halls.py` 中原地加一行（不要整文件覆盖），或改 `Account.py` 常量后重启。
- 本项目约定 AI 不主动提交/重启；实施时由用户执行重启。

### 5.5 兼容与边界

| 场景 | 处理 |
| --- | --- |
| 老客户端没有 `device_id` | 只写 IP 表；不写设备表；GPS 关联不可用，不报错 |
| 创世 boss / 不在 `third_marketing_info` 的账号 | 照常从 `getClientDatas()` 取设备、从 `clientAddr` 取 IP |
| 同一账号快速重连 | upsert，不新增重复行；可再加 60 秒同 IP/同设备去重，减少写库 |
| 客户端伪造 `reqSetProperty("ip")` | 关联表只在登录时读取刚计算的 `self.ip`，不读取客户端后续写入的值 |
| 客户端伪造 GPS | 只能作为中置信线索，不能单独作为结论 |
| `red_ip` / `red_gps` 账号 | 按现有伪装值记录或直接排除，见 §9；不要静默绕过现有伪装 |
| IPv6 / 代理 | 当前 `clientAddr` 是 IPv4 四元组；遇到非四元组跳过并记日志。若正式服前面有代理，`clientAddr` 会是代理 IP，需要另配 PROXY protocol 或直连 |

### 5.6 代码落点汇总

| 文件 | 改动 |
| --- | --- |
| `scripts/base/Account.py` | 顶部加解析/校验/IP 网格小 helper；`onClientEnabled()` 调 `_recordPlayerRelation()`；`reqSetProperty("gps")` 调 `_recordRelationGps()` |
| `res/server/database.sql` | 追加两张表的建表语句（初始化库用） |
| `scripts/interface/kbemain.py` | **不改**；登录设备码已由 baseapp 的 `getClientDatas()` 获取 |
| `scripts/entity_defs/Account.def` | **不改**；不新增客户端可见属性 |
| `scripts/base/Hall.py` | **不改**；后台直接查 MySQL，不走大厅命令 |

---

## 6. 后台查询与展示（xuanmanager）

### 6.1 接口与权限

- 接口：现有 `GET /api/game/players` 增加返回字段，不新增列表接口。
- 基础权限：沿用玩家列表现有权限（`game.player.view`）。
- 关联字段属于敏感信息：建议只在拥有 `game.player.sensitive.view` 时返回；没有权限时返回 `related_visible=false`，空字符串/0，不泄露关联人数。
- 详情页可复用现有 `GET /api/game/players/{playerId}/sensitive` 做原始 IP/GPS/设备展示；列表只展示“关联玩家名+ID”。

### 6.2 批量查询，避免 N+1

对当前页的 50 个玩家，先拿 `guuid` 集合，再按信号各做一次批量查询，最后在 Go 代码里合并；**不要对每一行玩家各查一次**。

1）本页玩家的设备/GPS 信号：

```sql
SELECT user_guuid, device_id, gps_lat_e3, gps_lon_e3, last_seen, last_gps_at, user_name
FROM usr_player_device_info
WHERE user_guuid IN (?, ?, ...)
  AND last_seen >= DATE_SUB(NOW(), INTERVAL 90 DAY);
```

2）同设备匹配：

```sql
SELECT p.user_guuid AS src_guuid,
       o.user_guuid AS rel_guuid,
       o.user_name,
       o.last_seen
FROM usr_player_device_info p
JOIN usr_player_device_info o
  ON o.device_id = p.device_id
 AND o.user_guuid <> p.user_guuid
WHERE p.user_guuid IN (?, ?, ...)
  AND p.device_id <> ''
  AND p.last_seen >= DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND o.last_seen >= DATE_SUB(NOW(), INTERVAL 90 DAY);
```

3）同 GPS 网格匹配：

```sql
SELECT p.user_guuid AS src_guuid,
       o.user_guuid AS rel_guuid,
       o.user_name,
       o.last_gps_at
FROM usr_player_device_info p
JOIN usr_player_device_info o
  ON o.gps_lat_e3 = p.gps_lat_e3
 AND o.gps_lon_e3 = p.gps_lon_e3
 AND o.user_guuid <> p.user_guuid
WHERE p.user_guuid IN (?, ?, ...)
  AND p.gps_lat_e3 IS NOT NULL
  AND p.last_gps_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
  AND o.last_gps_at >= DATE_SUB(NOW(), INTERVAL 7 DAY);
```

4）本页玩家的 IP 信号 + 同 IP 匹配：

先取本页玩家最近 7 天的 IP，再统计这些 IP 在窗口内关联了多少不同玩家，过滤掉超过 20 人的共享 IP：

```sql
-- 本页玩家的 IP
SELECT user_guuid, login_ip
FROM usr_login_ip_info
WHERE user_guuid IN (?, ?, ...)
  AND ip_public = 1
  AND login_day >= DATE_SUB(CURDATE(), INTERVAL 7 DAY);

-- 这些 IP 的共享人数（在 Go 里过滤 user_count <= 20）
SELECT login_ip, COUNT(DISTINCT user_guuid) AS user_count
FROM usr_login_ip_info
WHERE login_ip IN (?, ?, ...)
  AND ip_public = 1
  AND login_day >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
GROUP BY login_ip;

-- 同 IP 匹配（只查允许的 IP；不在这里 GROUP BY，去重/取名放 Go 里做）
SELECT p.user_guuid AS src_guuid,
       o.user_guuid AS rel_guuid,
       o.user_name,
       o.last_login_time AS last_seen
FROM usr_login_ip_info p
JOIN usr_login_ip_info o
  ON o.login_ip = p.login_ip
 AND o.user_guuid <> p.user_guuid
WHERE p.user_guuid IN (?, ?, ...)
  AND p.login_ip IN (?, ?, ...)
  AND p.ip_public = 1
  AND o.ip_public = 1
  AND p.login_day >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
  AND o.login_day >= DATE_SUB(CURDATE(), INTERVAL 7 DAY);
```

说明：

- 同一对玩家可能因为多天/多个 IP 返回多行，在 Go 里按 `(src_guuid, rel_guuid)` 去重，取 `last_seen` 最大的一行和对应的 `user_name`；不要把 `user_name` 直接塞进 `GROUP BY`，避免 MySQL `ONLY_FULL_GROUP_BY` 模式报错或取到旧昵称。
- 设备/GPS 匹配同理：SQL 只取原始匹配行，去重和合并放在 Go 里。
- 如果本页玩家很多、IP 集合很大，可以把“本页 IP + 共享人数”合并成一条查询；核心原则是**先过滤共享 IP，再做自连接**，避免在大 NAT IP 上爆炸。
- `IN (?, ?, ...)` 按实际元素数量展开占位符，保持参数化查询。

### 6.3 合并、评分、截断

在后台代码里维护 `src_guuid -> map[rel_guuid]relation`：

- 命中设备：`score += 100`，类型加 `device`。
- 命中 GPS：`score += 60`，类型加 `gps`。
- 命中 IP：`score += 30`，类型加 `ip`。
- `score` 最高 100；`last_seen` 取各信号最大值。
- 过滤 `rel_guuid == src_guuid`；按 `score` 降序、`last_seen` 降序排序。
- 每人最多取 10 个；`related_count` 是去重后的真实总数（截断前）。
- 名称优先用设备表的 `user_name`（最近登录快照）；没有设备记录时用 IP 表的 `user_name` 快照。

### 6.4 性能与缓存

- 每页额外 3~4 条批量查询，全部走索引；不要用 `LIKE '%...%'`，不要在 SQL 里做 `GROUP_CONCAT` 大字符串。
- 目标：50 条/页、IP 表 1000 万行时，关联部分 p95 < 200ms；上线前用 `EXPLAIN` 和测试数据验证。
- 关联结果变化慢，可按玩家维度缓存 60 秒；权限变化时按权限隔离缓存，或直接不缓存无敏感权限的响应。
- 如果某一页某个设备/IP/GPS 网格的匹配行数异常大（例如 > 5000），后台应记录一条告警并只取前 N 条，避免拖垮接口。

### 6.5 可选：玩家详情关联页

如果运营需要进一步排查，可加：

```http
GET /api/game/players/{playerId}/relations?page=1&page_size=20
```

返回完整相关玩家列表、每条的关联类型、最近时间、置信度；原始 IP/GPS/设备码只在 `game.player.sensitive.view` 下返回，并写入 `mgr_audit_log`（动作如 `game.player.relation.view`）。列表页只做摘要，不展开原始数据。

---

## 7. 风险、误报与隐私

### 7.1 误报来源

| 来源 | 例子 | 缓解 |
| --- | --- | --- |
| 运营商 NAT / 代理 / 网吧 | 几十个玩家同一个公网 IP | 单 IP 超过 20 人不参与展开；IP 只给低分 |
| 家庭/共用设备 | 夫妻、家人共用一台手机/浏览器 | 设备高分但仍只作为线索；展示时标注“同设备” |
| GPS 漂移/伪造 | 同一地点不同楼层、改包伪造坐标 | 3 位小数网格 + 时间窗；GPS 只给中分；不单独定性 |
| 动态 IP | 同一玩家每天换 IP；IP 被回收给他人 | 7 天时间窗；结合设备/GPS |
| 设备码重置 | 重装、清缓存、换浏览器 | 设备码会变；靠 IP/GPS 兜底，或接受漏报 |
| 多设备同一人 | 手机 + 平板 + 电脑 | 设备关联会漏；GPS/IP 可桥接 |

### 7.2 降低误报的产品建议

- 列表上把“关联”做成可展开的线索，不要直接显示“作弊/小号”结论。
- 强关联（设备命中）和弱关联（仅 IP）用不同颜色/图标。
- 支持按“关联类型”筛选；默认只展开强关联，弱关联需要管理员主动查看。
- 后台保留“为什么关联”的类型字段，方便复核。

### 7.3 隐私与合规

- IP、GPS、设备码都属于敏感数据；只对具备 `game.player.sensitive.view` 的后台角色展示关联明细。
- 列表页不展示原始 IP/GPS/设备码，只展示玩家名 + ID；原始值在详情页按权限展示并审计。
- 建议 IP 表保留 180 天、设备表随账号生命周期保留；账号注销/删除时按 `user_guuid` 清理。
- 不要把关联数据导出给第三方或用于与反作弊无关的用途；导出需单独审批。
- 现有日志有敏感信息：`onRequestAccountLogin` 在 DEBUG 日志里打印明文密码（`scripts/interface/kbemain.py:328`、`:258`、`:309`），GPS 每次上报也会打印坐标，`onEntitiesEnabled` 会打印 `device_id`。本方案不新增这类日志；建议另开任务整改（明文密码属于高风险，优先级应高于本需求）。

### 7.4 数据质量注意

- 现有 GPS 清洗用 `re.findall(r"\d+\.?\d*", value)`，会丢掉负号；如果游戏只在北半球/东经区域运营，问题不大；若以后有南纬/西经，需要先修这个解析。
- `red_gps` / `yellow_gps` 会把特定账号的坐标改成配置值；`red_ip` 会改 IP。默认写入生效值（即现有伪装值）；是否改为原始值或直接排除见 §9。
- 测试服的 `sm_ip` 大量是 `127.0.0.1`，IP 关联在测试服基本不可用；验收重点放在设备/GPS，正式服再验证公网 IP。

---

## 8. 实施步骤与验收

### 8.1 实施顺序

1. 确认 §9 的口径（时间窗、阈值、权限、是否回填）。
2. 在测试服执行两张表的 DDL，并追加到 `res/server/database.sql`；游戏服数据库账号补两张表的 `INSERT/UPDATE`，后台只读账号补 `SELECT`。
3. 修改 `scripts/base/Account.py`：加解析/校验 helper、`onClientEnabled()` 写入、GPS 节流更新。
4. `py_compile` + 桩环境单测：用假的 `KBEngine.executeRawDatabaseCommand` 验证 SQL 拼接、非法设备/GPS 跳过、重连 upsert、开关关闭不发 SQL。
5. 上传 `Account.py`，清 `__pycache__`，由用户手动重启 baseapp。
6. 修改 `xuanmanager` 玩家列表查询与返回字段（独立项目）；先加权限判断和空实现，再打开关联查询。
7. 用测试账号造同设备/同 GPS/同 IP 场景，按 §8.2 验收。
8. 测试服可选回填；正式服不回填。

### 8.2 验收用例

| 用例 | 预期 |
| --- | --- |
| A、B 两个账号同一设备，不同 IP/GPS | 双方列表都出现对方，`related_types` 含 `device` |
| C、D 两个账号不同设备，同一 GPS 网格 | 双方出现对方，`related_types` 含 `gps` |
| E、F 两个账号不同设备/GPS，同公网 IP（该 IP 总人数 ≤ 20） | 出现对方，`related_types` 含 `ip` |
| 某公网 IP 有 30 个账号 | 该 IP 不展开名单，只显示弱关联/人数或不显示 |
| 同一账号 3 次快速重连 | IP 表当天同 IP 仍 1 行；设备表仍 1 行；无重复 |
| 同一账号换 2 台设备 | 设备表 2 行；IP 表按 IP 正常记录 |
| 老客户端无 `device_id` | 只写 IP 表；不写设备表；登录正常 |
| GPS 上报 `0,0` / `1,1` / 空 | 不更新 GPS 字段；保留上一次有效值；不报错 |
| `clientAddr` 为 `127.0.0.1` | IP 入库但 `ip_public=0`，不参与关联 |
| 表被临时改名/数据库报错 | 登录和 GPS 原流程不受影响，只多一条错误日志 |
| 无 `game.player.sensitive.view` 的后台账号 | `related_visible=false`，无关联名单 |
| 有权限的后台账号打开玩家详情关联 | 能看到关联明细，`mgr_audit_log` 有记录 |
| 50 条/页、IP 表 1000 万行 | 关联查询 p95 < 200ms（测试环境压测） |

### 8.3 回滚

- 服务端：把 `player_relation_record_on` 设为 `False`（或回退 `Account.py`）并重启；新表保留不影响登录。
- 后台：关闭关联字段开关/收回敏感权限；回退 `xuanmanager` 版本。
- 数据：如需彻底清理，先备份再 `DROP TABLE`；正式服不建议在未备份时直接删。

### 8.4 监控

- 两张表的行数、日增、索引大小；IP 表超过保留期是否清理成功。
- 游戏服数据库错误日志中与两张表相关的 INSERT/UPDATE 失败。
- 后台列表接口 p95、慢查询；共享 IP/GPS 网格的异常大结果告警。
- 设备表 `last_seen` 长时间不更新的账号比例（判断客户端设备码是否稳定）。

---

## 9. 待确认问题

1. **IP 表粒度**：接受“玩家 + 天 + IP”聚合（推荐），还是必须每次登录一行（需要额外考虑容量和清理）？
2. **时间窗**：设备 90 天、GPS 7 天、IP 7 天是否合适？是否需要按运营反馈调整？
3. **GPS 精度**：3 位小数（约 110 米）是否够用？还是要 4 位小数（约 11 米，误报更少但漏报更多）？
4. **共享阈值**：单 IP 超过 20 人、单 GPS 网格超过 50 人不展开，是否接受？
5. **红/黄名单账号**：关联表记录它们的真实 IP/GPS，还是沿用现有伪装值/直接排除？（推荐默认沿用现有伪装值；如果这些账号也要排查，再改为原始值或排除）
6. **展示权限**：列表里的关联字段是否只给 `game.player.sensitive.view`？还是所有能看玩家列表的管理员都能看摘要？
7. **保留期**：IP 表 180 天、设备表随账号生命周期，是否合适？
8. **测试服回填**：是否需要先把现有 9 条设备绑定和 59 个账号的最近 IP/GPS 回填，便于马上联调？（正式服建议不回填）
9. **详情页**：本期是否只做列表摘要，还是同时做 `GET /api/game/players/{playerId}/relations` 完整明细？

---

## 10. 附：不采用的方案

| 方案 | 为什么不采用 |
| --- | --- |
| 直接给 `tbl_Account.sm_ip/sm_gps` 加索引 | 只有最新值，没有历史和时间窗；`sm_gps` 没有设备维度；KBEngine 实体表不宜频繁改结构 |
| 直接用 `third_marketing_info.device_id` | 只有开启防盗号的账号才有值（测试服 9/61），覆盖不了全量玩家 |
| 默认不按每次登录写一行 IP、每次 GPS 写一行位置 | 写放大；GPS 每分钟一次，表会快速增长；聚合到“玩家+天+IP”和设备维度已够用；如果审计要求每次登录留痕，再单独加原始登录日志表 |
| 预计算一张“玩家-相关玩家”关系表 | 写入时要维护笛卡尔积，NAT/共享设备会产生大量关系；当前规模用批量实时查询更简单，后续慢了再加 |
| 新增客户端“上报设备/位置”协议 | 登录数据已有 device_id，GPS 已有上报入口；改客户端没有必要 |
| 在游戏服 `Hall` 里做关联查询 | 关联查询是后台读需求，放游戏服会占用 baseapp/dbmgr；后台直连 MySQL 更合适 |
| 用 IP 单独判定“同一人” | NAT/CGNAT/代理会大量误报；IP 只能作为低置信辅助信号 |

## 11. 实施状态（2026-11-14）

- 正式库 `kbedm` 已创建 `usr_login_ip_info` / `usr_player_device_info`（2026-11-14 00:27），baseapp 已于 00:29 重启；00:36:56 起已有登录写入（718968，web/127.0.0.1），随登录/GPS 上报继续积累。
- 后台 `xuanmanager` 已实现列表 `relatedCount` / `relatedVisible` 与 `GET /api/game/players/{playerId}/relations`，按 §6 口径批量聚合；不返回原始 IP/GPS/设备码。已部署 8891。
- 实现注意：关联查询必须走游戏库连接（`s.gameDB` / `kbedm`），管理库 `webcm` 没有这两张表。
- 正式 `usr_player_device_info` 实际没有 `last_ip` / `last_ip_public` 两列，§4.2 建表和 §5.3 设备 upsert 不能原样套用；当前游戏服写入已避开这两列。
- 权限：本期沿用 `game.player.view`（所有能看玩家列表的账号可见摘要与明细），未按 `game.player.sensitive.view` 收口。
