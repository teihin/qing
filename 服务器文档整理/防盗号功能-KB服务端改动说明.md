# 防盗号功能——KB 服务端改动说明

状态：待 KB 服务端确认并实施
版本：1.0
日期：2026-08-10
适用范围：KBEngine 登录认证、Account 实体、账号命令、数据库与内部管理命令

> 本文只描述 KB 服务端需要完成的改动和接口输入约定。

## 1. KB 改动目标

KB 服务端需要实现：

1. 登录时读取客户端提交的设备信息。
2. 在密码验证成功后，根据账号防盗号开关决定是否校验设备。
3. 使用明文 `device_id` 和 `device_platform` 精确比较，不做加密、Hash或HMAC。
4. 为设备缺失、格式非法、设备不匹配和服务端数据异常提供专用登录错误。
5. 登录成功后向客户端同步 `Account.anti_theft_on`。
6. 处理玩家开启、关闭防盗号的 Account 命令。
7. 保证开启、关闭和并发请求不会覆盖已绑定设备。
8. 提供内部解绑命令，供管理系统调用。
9. 解绑或安全状态变化后同步在线 Account，并按策略使旧会话失效。
10. 防盗号关闭时兼容当前旧客户端固定登录字符串。

## 2. 数据库改动

### 2.1 权威数据表

本期继续使用：

```text
kbedm.third_marketing_info
```

登录账号仍使用 `player_wxid`。

### 2.2 新增字段

| 字段 | 类型 | 默认值 | KB用途 |
| --- | --- | --- | --- |
| `anti_theft_on` | `TINYINT(1)` | `0` | 防盗号开关 |
| `device_id` | `VARCHAR(255) ASCII BIN` | 空字符串 | 明文设备 ID |
| `device_platform` | `VARCHAR(16) ASCII BIN` | `NULL` | `android`、`ios` 或 `web` |
| `device_version` | `INT` | `1` | 设备协议版本 |
| `device_bound_at` | `DATETIME` | `NULL` | 最近绑定时间 |
| `binding_revision` | `BIGINT` | `0` | 绑定状态修订号 |

生产迁移示例：

```sql
ALTER TABLE kbedm.third_marketing_info
  ADD COLUMN anti_theft_on TINYINT(1) NOT NULL DEFAULT 0 COMMENT '防盗号开关',
  ADD COLUMN device_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '客户端设备ID，明文保存',
  ADD COLUMN device_platform VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '绑定平台android、ios或web',
  ADD COLUMN device_version INT NOT NULL DEFAULT 1 COMMENT '设备协议版本',
  ADD COLUMN device_bound_at DATETIME NULL COMMENT '设备绑定时间',
  ADD COLUMN binding_revision BIGINT NOT NULL DEFAULT 0 COMMENT '绑定修订号';
```

实施要求：

- 先执行 `SHOW COLUMNS`，确认是否已经存在同名字段。
- 使用 KB 项目的正式版本化迁移方式，不能盲目重复执行示例 SQL。
- 同步修改 KB 初始化建库脚本中的 `third_marketing_info` 定义。
- 如果 `device_id` 已存在，确认长度至少255位。
- `device_id` 和 `device_platform` 使用 `ascii_bin`，或条件更新显式使用 `BINARY`，保证区分大小写。
- 不得在未确认数据和代码引用前删除现有生产字段。

### 2.3 合法数据状态

关闭状态：

```text
anti_theft_on = 0
device_id = ''
device_platform = NULL
device_bound_at = NULL
```

开启状态：

```text
anti_theft_on = 1
device_id 非空且格式合法
device_platform 为 android、ios 或 web
device_version = 1
device_bound_at 非空
```

如果数据库出现“开关开启但设备 ID 为空、平台非法”等状态，KB 必须拒绝该账号登录并记录数据异常，不能自动降级放行。

## 3. 登录 `datas` 输入协议

### 3.1 新版输入

KBEngine 登录第三参数为 JSON 字符串。

原生示例：

```json
{
  "version": 1,
  "platform": "android",
  "device_id": "native-device-id",
  "scene": "login"
}
```

网页版示例：

```json
{
  "version": 1,
  "platform": "web",
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "scene": "login"
}
```

字段规则：

| 字段 | 必填 | KB校验 |
| --- | --- | --- |
| `version` | 是 | 整数且本期等于1 |
| `platform` | 是 | 只允许小写 `android`、`ios`、`web` |
| `device_id` | 是 | 8～255位，符合指定ASCII正则 |
| `scene` | 否 | 可忽略，不参与设备比较 |

设备 ID 正则：

```text
^[A-Za-z0-9._:-]{8,255}$
```

其他要求：

- 整个 `datas` 建议限制为不超过1024字节。
- 不允许重复JSON键绕过字段校验。
- 设备 ID 不自动去空格、不改变大小写、不截断。
- 首尾空格、换行、控制字符、超长或正则不匹配均判定为非法。
- 平台只接受约定的小写值。
- KB 日志不得记录完整 `datas` 或完整 `device_id`。

### 3.2 旧版输入兼容

当前旧客户端第三参数为：

```text
登陆
```

兼容规则：

- 防盗号关闭：账号密码正确时允许登录。
- 防盗号开启：视为没有设备数据，返回专用设备缺失错误。
- JSON解析失败不能在密码校验前暴露账号防盗号状态。
- 可增加 `ANTI_THEFT_ALLOW_LEGACY_CLIENT=true`；它只能允许关闭状态账号使用旧客户端。

## 4. Loginapp 登录校验

### 4.1 校验顺序

必须按以下顺序处理：

```text
1. 获取登录账号
2. 查询 third_marketing_info
3. 校验账号状态
4. 校验密码
5. 密码正确后读取 anti_theft_on
6. anti_theft_on = 0：不校验设备，允许登录
7. anti_theft_on = 1：解析并校验 datas
8. 精确比较 device_platform
9. 精确比较 device_id
10. 一致则允许登录；缺失、非法或不一致则返回专用错误
```

必须先验证密码，再返回设备类错误。密码错误时继续返回现有账号/密码错误，不能让攻击者通过设备错误探测账号状态。

### 4.2 登录查询

查询至少读取：

```sql
SELECT upper_guuid,
       player_guuid,
       player_wxid,
       player_wxname,
       player_wxpwd,
       anti_theft_on,
       device_id,
       device_platform,
       device_version,
       binding_revision
FROM kbedm.third_marketing_info
WHERE player_wxid = ?
LIMIT 1;
```

建议在 KB 应用代码中使用区分大小写的字符串比较，不只依赖数据库默认排序规则。

### 4.3 判断规则

| 账号密码 | 防盗号 | 设备输入 | KB结果 |
| --- | --- | --- | --- |
| 错误 | 任意 | 任意 | 返回现有账号/密码错误 |
| 正确 | 关闭 | 未传、旧字符串或新版JSON | 允许登录 |
| 正确 | 开启 | 未传或旧字符串 | 返回设备缺失错误 |
| 正确 | 开启 | JSON或字段非法 | 返回设备非法错误 |
| 正确 | 开启 | 平台和设备 ID完全一致 | 允许登录 |
| 正确 | 开启 | 平台或设备 ID不一致 | 返回设备不匹配错误 |
| 正确 | 开启 | 数据库绑定状态非法 | 返回服务端校验不可用错误 |

### 4.4 重新登录和断线重连

- 重新经过账号密码认证的登录必须重新执行设备校验。
- 只恢复同一已认证短期会话的底层连接，可以沿用已认证会话。
- 开启、关闭或后台解绑后，应使旧恢复令牌或旧会话失效。
- `boss_loginname` 等特殊登录入口也应校验，除非命中服务端明确配置的技术账号白名单。

## 5. 专用登录错误码

KB 需要在现有登录错误表中分配不冲突的实际数字。本文只规定符号名，不指定数字。

| 符号名 | 触发条件 | 用户语义 |
| --- | --- | --- |
| `ANTI_THEFT_DEVICE_REQUIRED` | 开启状态但没有新版设备输入 | 需要支持设备验证的客户端 |
| `ANTI_THEFT_DEVICE_INVALID` | JSON、版本、平台或设备 ID格式非法 | 当前设备信息异常 |
| `ANTI_THEFT_DEVICE_MISMATCH` | 平台或设备 ID与数据库不一致 | 当前设备不是绑定设备 |
| `ANTI_THEFT_VERIFY_UNAVAILABLE` | 数据库绑定字段或校验服务异常 | 防盗号暂时无法校验 |

要求：

- 错误作为终止型登录失败返回，不能按临时网络错误持续重试。
- 错误响应不返回数据库设备 ID、绑定平台、绑定时间或修订号。
- 同一账号或来源短时间大量失败可以触发监控，但日志只记录错误码和掩码信息。
- 服务端数据异常时拒绝登录，不能静默关闭防盗号后放行。

KB 交付时必须明确每个符号的实际数字、错误配置文件和 Loginapp 返回位置。

## 6. Account 实体改动

### 6.1 新增属性

```xml
<anti_theft_on>
    <Type>INT8</Type>
    <Flags>BASE_AND_CLIENT</Flags>
    <Persistent>false</Persistent>
    <Default>0</Default>
</anti_theft_on>
```

### 6.2 赋值规则

- 登录成功创建 Account 后，从数据库加载。
- 开启成功后设置为1。
- 关闭成功后设置为0。
- 后台解绑成功后，在线 Account设置为0。
- 数据库更新失败或回读不一致时，不能提前改变内存属性。

### 6.3 下发范围

- 只下发 `anti_theft_on`。
- 不下发数据库 `device_id`、平台、绑定时间或修订号。
- 设备 ID 不能增加为客户端透明属性。

## 7. 防盗号开关命令

### 7.1 命令入口

在现有 `reqAccountCommand(param, content)` 分发体系中支持：

```text
content = P@设置_防盗号_开关
```

`param` 示例：

```json
{
  "header": "设置_防盗号_开关",
  "anti_theft_on": 1,
  "device_id": "native-device-id",
  "device_platform": "android",
  "device_version": 1,
  "request_id": "client-request-uuid"
}
```

字段校验：

| 字段 | 规则 |
| --- | --- |
| `anti_theft_on` | 只允许整数0或1 |
| `device_id` | 开启、关闭都必须提交并符合正则 |
| `device_platform` | 只允许 `android`、`ios`、`web` |
| `device_version` | 本期固定为1 |
| `request_id` | 1～64位，用于幂等和结果关联 |

### 7.2 状态机

| 数据库状态 | 请求设备 | 操作 | KB处理 |
| --- | --- | --- | --- |
| 关闭 | 任意合法设备 | 开启 | 原子绑定当前设备并开启 |
| 开启 | 与绑定一致 | 开启 | 幂等成功，不重复绑定 |
| 开启 | 与绑定不一致 | 开启 | 拒绝，不能覆盖原绑定 |
| 开启 | 与绑定一致 | 关闭 | 原子关闭并清空绑定字段 |
| 开启 | 与绑定不一致 | 关闭 | 拒绝 |
| 关闭 | 任意合法设备 | 关闭 | 幂等成功 |

### 7.3 原子开启

```sql
UPDATE kbedm.third_marketing_info
SET anti_theft_on = 1,
    device_id = ?,
    device_platform = ?,
    device_version = ?,
    device_bound_at = NOW(),
    binding_revision = binding_revision + 1
WHERE player_wxid = ?
  AND anti_theft_on = 0
LIMIT 1;
```

影响行数为0时回读：

- 已开启且平台、设备 ID一致：幂等成功。
- 已开启但设备不一致：拒绝覆盖。
- 记录不存在或字段异常：失败。

### 7.4 原子关闭

```sql
UPDATE kbedm.third_marketing_info
SET anti_theft_on = 0,
    device_id = '',
    device_platform = NULL,
    device_version = 1,
    device_bound_at = NULL,
    binding_revision = binding_revision + 1
WHERE player_wxid = ?
  AND anti_theft_on = 1
  AND BINARY device_platform = BINARY ?
  AND BINARY device_id = BINARY ?
LIMIT 1;
```

影响行数为0时回读：

- 已关闭：幂等成功。
- 仍开启且设备不一致：返回设备不匹配。
- 数据异常：返回操作失败。

不能只依赖 `RowsAffected` 判断账号是否存在，必须回读确认。

### 7.5 结果回包

建议至少返回：

```json
{
  "header": "设置_防盗号_开关_结果",
  "request_id": "client-request-uuid",
  "success": true,
  "anti_theft_on": 1,
  "binding_revision": 3,
  "error_code": "",
  "message": "防盗号已开启"
}
```

要求：

- 不返回数据库设备 ID。
- 数据库更新并回读成功后，才能更新 Account 内存属性和返回成功。
- 回包 `request_id` 与请求一致。
- 重复 `request_id` 返回第一次结果，或至少保证不会产生第二次状态覆盖。

## 8. 并发、幂等和一致性

### 8.1 两台设备并发开启

- 只允许第一个条件更新成功。
- 第二个请求回读后发现已绑定其他设备，必须拒绝。
- 后到请求不能覆盖先到请求。

### 8.2 重复请求

- 重复开启同一设备按幂等成功处理。
- 重复关闭已关闭账号按幂等成功处理。
- 相同 `request_id` 应返回一致结果。
- 同一账号状态更新应串行化或依靠数据库条件更新保证互斥。

### 8.3 状态更新顺序

```text
校验请求
→ 条件更新数据库
→ 回读数据库
→ 更新在线Account属性
→ 返回结果
```

不能先修改 Account 内存，再异步尝试写数据库。

## 9. 内部解绑命令

### 9.1 命令能力

建议通过现有服务器本机内部命令体系提供：

```text
异步_解除_玩家_防盗号绑定
```

最终名称可按 KB 命名规则调整，但必须在联调前确认。

输入示意：

```json
{
  "player_guuid": "玩家ID",
  "login_name": "登录账号",
  "request_id": "admin-request-uuid",
  "reason_code": "DEVICE_LOST"
}
```

KB 处理：

1. 按玩家ID和登录账号核对唯一记录。
2. 原子设置 `anti_theft_on = 0`。
3. 清空设备 ID、平台和绑定时间。
4. `binding_revision` 递增。
5. 回读最终状态。
6. 在线 Account属性同步为0。
7. 建议使现有会话和恢复令牌失效。
8. 返回最终开关、修订号和请求ID，不返回设备 ID。

解绑 SQL 示意：

```sql
UPDATE kbedm.third_marketing_info
SET anti_theft_on = 0,
    device_id = '',
    device_platform = NULL,
    device_version = 1,
    device_bound_at = NULL,
    binding_revision = binding_revision + 1
WHERE player_guuid = ?
  AND player_wxid = ?
LIMIT 1;
```

影响行数为0时回读，区分已解绑、记录不存在和数据异常。

## 10. 特殊登录和白名单

不建议让 `boss_loginname` 按游戏角色永久绕过。

- 老板、代理、盟主等普通游戏账号执行相同设备校验。
- 技术服务账号如必须绕过，使用服务端精确账号白名单。
- 建议配置名：`ANTI_THEFT_BYPASS_ACCOUNTS`，默认空。
- 白名单不能由客户端参数或玩家角色字段决定。
- 每次白名单绕过都记录安全审计和告警。

## 11. 日志和监控

### 11.1 禁止记录

- 完整 `device_id`。
- 登录 `datas` 原文。
- 明文密码或密码摘要。
- 数据库查询结果整行。

### 11.2 允许记录

- 玩家内部ID或脱敏登录账号。
- 平台类型、操作类型、错误码和 `binding_revision`。
- 必要时记录设备 ID掩码，例如前4位和后4位。

### 11.3 建议监控

- 同一账号短时间大量设备不匹配。
- 同一来源IP对大量账号触发设备错误。
- 数据库存在开启但设备 ID为空的记录。
- 内部解绑命令异常增加。
- 条件更新后回读状态不一致。

## 12. KB 上线顺序

1. 检查表结构和现有字段。
2. 执行版本化数据库迁移并同步初始化建库脚本。
3. 增加登录 `datas` 解析和关闭状态下的旧客户端兼容。
4. 增加密码成功后的设备校验。
5. 分配专用登录错误码。
6. 增加 `Account.anti_theft_on` 定义和赋值。
7. 实现开关命令、条件更新和回读。
8. 实现内部解绑命令和在线 Account同步。
9. 实现旧会话失效策略。
10. 完成单元测试、并发测试和联调。
11. 在外部系统开放开关前先部署兼容版本。

全部账号默认 `anti_theft_on = 0`，因此 KB 兼容版本可以先上线，不影响未开启账号。

## 13. KB 验收用例

### 13.1 登录

| 编号 | 前置条件 | 输入 | 预期 |
| --- | --- | --- | --- |
| K-L01 | 关闭 | 旧字符串“登陆” | 密码正确即可登录 |
| K-L02 | 关闭 | 合法新版JSON | 密码正确即可登录 |
| K-L03 | 开启 | 旧字符串“登陆” | 返回设备缺失错误 |
| K-L04 | 开启、绑定A | 平台和设备均为A | 登录成功 |
| K-L05 | 开启、绑定A | 设备B | 返回设备不匹配 |
| K-L06 | 开启 | JSON或平台非法 | 返回设备非法错误 |
| K-L07 | 密码错误 | 任意设备 | 只返回原密码错误 |
| K-L08 | 开启但设备ID为空 | 合法设备 | 返回校验不可用 |
| K-L09 | Web绑定 | `platform=web`且ID一致 | 登录成功 |

### 13.2 开关和并发

| 编号 | 前置条件 | 操作 | 预期 |
| --- | --- | --- | --- |
| K-S01 | 关闭 | A开启 | 绑定A、开关为1、修订号递增 |
| K-S02 | 已绑定A | A重复开启 | 幂等成功 |
| K-S03 | 已绑定A | B请求开启 | 拒绝，不覆盖A |
| K-S04 | 已绑定A | A关闭 | 开关为0并清空绑定 |
| K-S05 | 已绑定A | B关闭 | 拒绝 |
| K-S06 | 已关闭 | 重复关闭 | 幂等成功 |
| K-S07 | 关闭 | A、B并发开启 | 只能一台成功 |
| K-S08 | 任意 | 相同请求ID重发 | 结果一致，不重复改变状态 |

### 13.3 Account和解绑

| 编号 | 操作 | 预期 |
| --- | --- | --- |
| K-A01 | 开启成功 | 在线属性变为1 |
| K-A02 | 关闭成功 | 在线属性变为0 |
| K-A03 | 数据库更新失败 | 在线属性保持旧值 |
| K-A04 | 合法解绑 | 数据库关闭、绑定清空、在线属性为0 |
| K-A05 | 解绑在线账号 | 旧会话按策略失效 |
| K-A06 | 解绑不存在账号 | 明确失败，不创建记录 |

### 13.4 安全和日志

| 编号 | 检查 | 预期 |
| --- | --- | --- |
| K-C01 | 检查日志 | 无完整设备ID、登录datas和密码 |
| K-C02 | 设备ID大小写不同 | 精确比较判定不一致 |
| K-C03 | 超长或含控制字符ID | 拒绝为非法输入 |
| K-C04 | 开启但数据状态非法 | 拒绝登录并产生监控 |
| K-C05 | 非白名单老板账号 | 与普通账号相同校验 |

## 14. KB 交付清单

KB 团队完成后请提供：

- [ ] 数据库迁移文件和初始化建库脚本位置。
- [ ] Loginapp 读取、解析 `datas` 的代码位置。
- [ ] 密码成功后设备校验代码位置。
- [ ] 四个专用错误码的实际数字和配置文件。
- [ ] `Account.anti_theft_on` 定义和登录赋值位置。
- [ ] `reqAccountCommand` 分发和开关处理位置。
- [ ] 开启、关闭条件更新与回读实现。
- [ ] 命令结果回包事件和格式。
- [ ] 内部解绑命令最终名称、参数和返回格式。
- [ ] 在线 Account同步和旧会话失效实现。
- [ ] 技术账号白名单策略。
- [ ] 日志脱敏和异常监控位置。
- [ ] 单元测试、并发测试和联调结果。

## 15. 联调前需要 KB 确认

1. 登录认证实际查询 `third_marketing_info` 的文件和函数。
2. Loginapp 获取 `datas` 的位置和最大长度。
3. 是否能严格拒绝重复JSON键；如不能，采用什么解析约束。
4. 专用登录错误码的具体数字。
5. Account实体定义和服务端初始化位置。
6. `reqAccountCommand` 的真实分发入口。
7. 是否接受 `content = P@设置_防盗号_开关`。
8. 命令结果通过哪个现有事件返回。
9. 同账号是否允许多端在线。
10. 开启、关闭和解绑后如何使旧会话失效。
11. `boss_loginname` 是否确有业务绕过需求。
12. `third_marketing_info` 当前表引擎、唯一索引和字段排序规则。
13. 内部解绑命令的最终名称和返回结构。
14. 是否同意默认关闭、先部署兼容版本的顺序。

以上内容确认后，即可把 KB 的最终错误码、命令名和回包格式作为联调契约。
