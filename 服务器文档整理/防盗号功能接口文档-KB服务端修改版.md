# 防盗号功能接口文档（KB 服务端修改版）

状态：待 KB 服务端、客户端、XuanManager 共同确认后实施
版本：1.2（简化为明文设备 ID 方案，保留网页版兼容）
日期：2026-08-10
适用项目：Cocos Creator 2.4.13 客户端、KBEngine 游戏服务、XuanManager 注册与管理后台

> 本文是对原《防盗号功能接口文档》的修订建议。结合当前系统规模和后续维护成本，本期不做设备 ID 加密或 HMAC，数据库直接保存明文 `device_id` 并精确比较；仍需修正“原生端每次安装生成随机 ID、不增加专用错误码、后台直接覆盖设备 ID”等问题。

## 1. 目标与范围

### 1.1 功能目标

防盗号开启后，账号只能在当前绑定手机或浏览器资料中登录。主要防护场景是：

- 玩家账号和密码泄漏后，其他手机不能直接登录。
- 同一手机普通卸载、重新安装 App 后，仍识别为原设备。
- 网页版首次访问时生成浏览器 ID，在同一浏览器资料和同一站点来源内持续使用。
- 玩家主动关闭防盗号后，可以换手机登录，并在新手机重新开启防盗号。
- 原手机丢失或损坏时，后台可以经过授权和审计解除绑定。

### 1.2 本期明确不保证

- 不保证恢复出厂设置后仍识别为原设备。
- 不保证刷机、更换系统用户、更换应用签名后仍识别为原设备。
- 不保证 iOS Keychain 被系统或用户清除后仍识别为原设备。
- 不防御已经控制玩家手机、Root/Jailbreak、修改客户端或窃取运行时数据的攻击者。
- 当前项目如果继续使用 HTTP/WS，不能防止网络抓包、设备标识重放；只有升级 HTTPS/WSS 后才能把它作为较完整的安全功能宣传。
- 网页版绑定的是“当前浏览器资料”，不是物理手机：清除网站数据/Cookie、无痕模式结束、更换浏览器、切换域名/端口/HTTP与HTTPS或更换设备后，浏览器 ID 可能丢失或变化，需要原浏览器关闭防盗号或联系客服解绑。
- 网页字符串 ID 只能防止最简单的账号密码盗用，不能阻止会复制浏览器存储、执行脚本或抓取明文传输数据的攻击者；更严格的网页方案仍需 HTTPS WebAuthn。

## 2. 关键设计结论

1. 客户端向服务端提交设备标识，数据库直接保存明文 `device_id`。
2. XuanManager 和 KB 服务端不配置共享加密密钥，统一使用字段校验和字符串精确比较。
3. 明文存储只为降低小系统的实现和维护成本；接口、日志和普通后台页面仍不应无必要地暴露设备 ID。
4. 防盗号校验必须在账号密码验证成功后执行，避免泄露账号状态。
5. 防盗号错误必须使用专用登录错误码，客户端收到后停止自动重试。
6. 防盗号关闭时不绑定设备；开启时绑定当前设备；关闭时清空绑定。
7. 已开启状态下，非当前绑定设备不能覆盖绑定，也不能关闭防盗号。
8. 后台只提供“解除绑定并关闭”，不允许客服手工录入或替换设备 ID。
9. 开关最终状态由服务端 `Account.anti_theft_on` 属性决定，客户端不能只做本地乐观修改。
10. 新旧客户端采用分阶段兼容：防盗号关闭时兼容旧客户端，开启时必须使用支持设备数据的新版客户端。
11. 网页版允许使用首次访问时生成的随机浏览器 ID，服务端平台值为 `web`；必须在开启前明确告知清除网站数据后的客服解绑风险。

## 3. 参与方职责

| 参与方 | 必须负责的功能 |
| --- | --- |
| 原生客户端 | 获取稳定设备标识；注册和登录时提交；设置页发起开关操作；处理专用登录错误；不在日志中输出设备标识 |
| 网页客户端 | 首次访问生成高强度随机浏览器 ID；保存到 IndexedDB 并镜像到 localStorage；同一来源下复用；开启前显示清理数据风险；丢失后不自动恢复旧绑定 |
| XuanManager | 扩展注册接口；校验设备字段；明文写入 `device_id`；提供带权限、确认、原因和审计的后台解绑功能 |
| KB 登录服务 | 解析登录 `datas`；密码成功后查询防盗号状态；精确比较 `device_id`；返回专用登录错误；兼容关闭状态下的旧客户端 |
| KB Account | 声明并同步 `anti_theft_on`；处理开关命令；执行原子更新和回读；同步在线状态 |
| KB 内部管理服务 | 接收 XuanManager 的解绑命令；清除绑定；更新在线 Account；按策略使旧会话失效 |
| 运维 | 执行数据库迁移；规划 HTTPS/WSS；限制数据库和管理接口访问；监控异常但不在普通日志中记录设备 ID |

## 4. 设备标识约定

### 4.1 Android

客户端通过原生桥读取 `Settings.Secure.ANDROID_ID`。

约束：

- 不使用每次安装随机生成并保存在普通本地存储的 UUID。
- 同一设备、系统用户和应用签名下，普通卸载重装应取得相同值。
- 恢复出厂、切换系统用户或更换应用签名后允许变化，并按新设备处理。
- 必须使用正式发行签名完成卸载重装验收，不能只用会变化的临时调试签名判断。

### 4.2 iOS

客户端首次运行生成随机 UUID，保存到 Keychain：

- 使用 `ThisDeviceOnly` 可访问级别。
- 关闭 iCloud Keychain 同步属性。
- 不保存到 `NSUserDefaults` 作为唯一来源。
- 卸载重装后重新读取 Keychain；如果读取不到，则生成新 UUID，并按新设备处理。
- 必须使用真实 iPhone 完成卸载重装验收。

### 4.3 Web 浏览器

网页版采用“浏览器资料 ID”，这是本期可以接受的简化方案，但必须明确它不是硬件唯一 ID。

生成规则：

- 首次访问时生成128位随机 UUID v4。
- 使用 `crypto.getRandomValues()` 获取随机字节，不能使用 `Math.random()`。
- 建议存储键名：`qing.antiTheft.browserId.v1`。
- IndexedDB 作为主存储，localStorage 作为镜像备份。
- 启动时先读取 IndexedDB；主值存在时以主值为准并修复镜像；主值缺失但镜像有效时恢复主值；两处都不存在时生成新 ID。
- 不把浏览器 User-Agent、Canvas 指纹、IP、分辨率等不稳定或隐私敏感信息拼入设备 ID。
- 如果浏览器无法完成持久写入和立即回读校验，禁止开启防盗号。
- HTTPS 环境下可调用 `navigator.storage.persist()` 申请持久存储，但浏览器可能拒绝；它只能降低浏览器自动清理概率，不能防止用户主动清除网站数据。

生成示意：

```ts
function createBrowserDeviceId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0"));
    return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join("")
    ].join("-");
}
```

网页版开启防盗号前必须二次确认：

> 网页版防盗号将绑定当前浏览器。清除网站数据或Cookie、使用无痕模式、更换浏览器、网址或设备后，可能无法登录，需要联系客服解除绑定。是否继续开启？

补充规则：

- “清除缓存图片和文件”不一定删除浏览器 ID，但“清除Cookie和网站数据”通常会同时删除 localStorage、IndexedDB 等站点数据，界面文案必须写“网站数据/Cookie”，不能只写“缓存”。
- 同一手机的 Chrome、Safari、Edge、微信内置浏览器分别视为不同设备。
- 无痕/隐私模式不保证长期保存，界面应提示不要在无痕模式开启；客户端不应声称能可靠识别所有无痕模式。
- 浏览器存储按来源隔离，协议、域名或端口变化都可能形成新来源。正式开放网页版防盗号前必须固定生产访问地址。
- 当前若先在 HTTP 地址绑定、以后切换 HTTPS，浏览器存储不会自动跨来源迁移。建议在最终 HTTPS 地址确定后再开放网页版开关，或事先设计迁移窗口，避免批量锁号。
- PWA/添加到主屏幕是否与浏览器共享同一存储必须按目标系统实测，未经测试不得承诺。
- 浏览器 ID 丢失后生成的新 ID只能作为新浏览器身份；服务端不能因为账号密码正确就自动覆盖旧绑定。

官方能力边界参考：

- [`crypto.getRandomValues()`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues) 可生成高强度随机值，也是 `Crypto` 中可在非安全上下文使用的成员。
- [`navigator.storage.persist()`](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist) 需要安全上下文且不保证请求一定获批。
- [`Clear-Site-Data`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Clear-Site-Data) 的 `storage` 范围包括 localStorage 和 IndexedDB，说明浏览器站点数据可以被统一清除。

### 4.4 设备字段格式

客户端提交字段：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `version` / `deviceVersion` | 整数 | 本期固定为 `1` |
| `platform` / `devicePlatform` | 字符串 | 本期允许 `android`、`ios`、`web` |
| `device_id` / `deviceId` | 字符串 | 8～255 位，只允许 ASCII 字母、数字、点、下划线、冒号和连字符 |

推荐正则：

```text
^[A-Za-z0-9._:-]{8,255}$
```

服务端不得对设备 ID 静默执行大小写转换或去除内部字符。首尾存在空格、包含换行或不符合正则时直接判定为非法。

## 5. 明文设备 ID 比较规则

### 5.1 统一规则

为降低当前小系统的实现和维护成本，本期不做设备 ID 加密、Hash或HMAC。XuanManager注册写入、KB登录校验和开关命令统一使用明文 `device_id`。

比较规则：

```text
客户端 platform 通过白名单和小写格式校验
客户端 device_id 通过长度与正则校验
数据库 device_platform == 客户端 platform
数据库 device_id == 客户端 device_id
```

要求：

- 平台值只接受规范小写值 `android`、`ios`、`web`。
- 设备 ID 不做大小写转换、不自动去空格、不截断，校验通过后按字符串精确比较。
- XuanManager和KB必须使用相同正则与长度限制，避免注册成功但KB登录不认可。
- 不需要配置共享密钥，不存在密钥轮换和两端加密算法不一致的问题。
- 即使采用明文存储，也不应把设备 ID 写入普通业务日志、登录错误、审计详情或公开接口响应。

### 5.2 安全边界

明文方案的代价是：拥有数据库读取权限的人可以看到设备 ID，HTTP/WS 传输也可能被抓包复制。结合当前系统规模，本期接受该风险，以换取简单实现和维护；它只能称为“本机登录限制”或“基础防盗号”。数据库账号仍应最小权限，管理页面默认不展示完整设备 ID，正式部署条件允许时仍建议升级 HTTPS/WSS。

## 6. 数据库字段

### 6.1 推荐字段

继续使用 `kbedm.third_marketing_info` 作为本期权威数据源，新增：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `anti_theft_on` | `TINYINT(1)` | `0` | `0`关闭，`1`开启 |
| `device_id` | `VARCHAR(255) ASCII BIN` | 空字符串 | 客户端设备标识，明文保存并区分大小写 |
| `device_platform` | `VARCHAR(16) ASCII BIN` | `NULL` | `android`、`ios` 或 `web` |
| `device_version` | `INT` | `1` | 设备协议版本 |
| `device_bound_at` | `DATETIME` | `NULL` | 最近一次绑定时间 |
| `binding_revision` | `BIGINT` | `0` | 每次绑定、关闭或后台解绑后递增 |

新库迁移示例：

```sql
ALTER TABLE kbedm.third_marketing_info
  ADD COLUMN anti_theft_on TINYINT(1) NOT NULL DEFAULT 0 COMMENT '防盗号开关',
  ADD COLUMN device_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' COMMENT '客户端设备ID，明文保存',
  ADD COLUMN device_platform VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '绑定平台android、ios或web',
  ADD COLUMN device_version INT NOT NULL DEFAULT 1 COMMENT '设备协议版本',
  ADD COLUMN device_bound_at DATETIME NULL COMMENT '设备绑定时间',
  ADD COLUMN binding_revision BIGINT NOT NULL DEFAULT 0 COMMENT '绑定修订号';
```

> 正式迁移前必须先执行 `SHOW COLUMNS` 检查现有字段，使用项目的版本化迁移机制，不能在生产环境盲目重复执行示例 SQL。

### 6.2 数据一致性约束

- `anti_theft_on = 0` 时，`device_id` 应为空字符串，`device_platform`、`device_bound_at` 应为 `NULL`。
- `anti_theft_on = 1` 时，`device_id` 必须非空且符合统一格式，平台必须有效。
- `device_id` 和 `device_platform` 使用 ASCII 二进制排序规则，避免 MySQL 默认不区分大小写的排序规则破坏精确比较。
- `binding_revision` 每次真实状态变化后递增。
- 不能把 `device_id` 作为 `Account` 客户端透明属性下发。
- 普通后台页面默认只显示掩码，例如前4位和后4位；有排查需要时由独立高权限查看完整值，但不能编辑，并应记录查看审计。

### 6.3 旧字段兼容

- 如果原文的 `anti_theft_on`、`device_id` 尚未创建，直接按本节迁移一次。
- 如果生产库已经存在同名明文 `device_id`，保留该字段，不重复创建；检查类型是否至少能保存255位字符串，并确认使用 `ascii_bin` 或在所有SQL比较中显式使用 `BINARY`。
- 如果实验版本曾创建其他未使用的设备字段，可以在确认无真实数据和代码引用后单独清理；未经核对不能直接删除生产字段。
- 已有真实明文绑定数据时，先校验格式和平台；无法确认平台的开启账号应先关闭并让玩家重新绑定。

## 7. XuanManager 注册接口约定

本节用于 KB 对接，不要求 KB 实现注册 HTTP 接口。

现有注册字段保持不变，增加：

```json
{
  "invitationCode": "648425",
  "nickname": "PlayerName",
  "loginName": "abc123",
  "password": "******",
  "avatarIndex": "1",
  "antiTheftEnabled": true,
  "deviceId": "native-device-id",
  "devicePlatform": "android",
  "deviceVersion": 1
}
```

处理规则：

| 注册开关 | 设备字段 | XuanManager行为 |
| --- | --- | --- |
| `false` | 可不传 | 写入关闭状态，`device_id` 保存为空字符串 |
| `false` | 已传 | 校验格式后忽略绑定，`device_id` 保存为空字符串 |
| `true` | 缺失或非法 | 返回400，不创建账号 |
| `true` | 合法 | 在同一注册写入中明文保存 `device_id`、平台和开启状态 |

建议初次上线时注册默认关闭，等新版客户端覆盖和联调稳定后，再决定是否默认开启。

网页版注册使用同一请求结构，把 `devicePlatform` 设置为 `web`，`deviceId` 设置为当前浏览器资料 ID。网页刷新时必须复用已有 ID，不能每次注册或登录重新生成。

注册响应、普通日志和审计不得返回或记录完整 `deviceId`、明文密码或密码摘要。

## 8. KB 登录 `datas` 协议

### 8.1 新版客户端请求

KBEngine 登录第三参数传 JSON 字符串：

```json
{
  "version": 1,
  "platform": "android",
  "device_id": "native-device-id",
  "scene": "login"
}
```

网页版使用同一协议：

```json
{
  "version": 1,
  "platform": "web",
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "scene": "login"
}
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` | 是 | 本期固定为1 |
| `platform` | 是 | `android`、`ios` 或 `web` |
| `device_id` | 是 | 当前原生设备或浏览器资料标识 |
| `scene` | 否 | `login`、`reconnect` 等诊断场景，不参与设备比较 |

整个 `datas` 建议限制为不超过1024字节。未知字段忽略，但已知字段必须严格校验。

### 8.2 旧客户端兼容

当前旧客户端第三参数为固定字符串：

```text
登陆
```

兼容规则：

- 账号防盗号关闭：密码正确后允许旧客户端登录。
- 账号防盗号开启：旧客户端缺少设备数据，返回设备标识缺失错误，不允许登录。
- 不能因为 JSON 解析失败直接在密码校验前暴露防盗号状态。
- 兼容开关建议配置为 `ANTI_THEFT_ALLOW_LEGACY_CLIENT=true`，只控制关闭状态账号是否允许旧客户端登录。

### 8.3 登录验证顺序

KB 必须按以下顺序执行：

```text
1. 读取登录账号
2. 查询账号记录
3. 验证账号状态和密码
4. 密码正确后读取 anti_theft_on
5. anti_theft_on = 0：允许登录，不要求设备数据
6. anti_theft_on = 1：严格解析和校验 datas
7. 精确比较数据库与客户端的 device_platform
8. 精确比较数据库与客户端的 device_id
9. 一致则允许登录；缺失、非法或不一致则返回专用错误
```

查询示意：

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

### 8.4 登录判断表

| 账号密码 | 防盗号 | 设备数据 | 结果 |
| --- | --- | --- | --- |
| 错误 | 任意 | 任意 | 返回原账号或密码错误，不执行可见的设备判断 |
| 正确 | 关闭 | 未传、旧字符串或新版JSON | 允许登录 |
| 正确 | 开启 | 未传或旧字符串 | 返回 `ANTI_THEFT_DEVICE_REQUIRED` |
| 正确 | 开启 | JSON非法、字段非法 | 返回 `ANTI_THEFT_DEVICE_INVALID` |
| 正确 | 开启 | 平台和设备 ID一致 | 允许登录 |
| 正确 | 开启 | 平台或设备 ID不一致 | 返回 `ANTI_THEFT_DEVICE_MISMATCH` |
| 正确 | 开启 | 数据库绑定字段异常 | 返回 `ANTI_THEFT_VERIFY_UNAVAILABLE`，禁止降级放行 |

## 9. 专用登录错误码

KB 需要在现有登录错误码表中分配不冲突的实际数字，并同步客户端错误描述映射。本文只规定符号名称和语义，不擅自指定数字。

| 符号名 | 语义 | 客户端行为 | 建议用户提示 |
| --- | --- | --- | --- |
| `ANTI_THEFT_DEVICE_REQUIRED` | 已开启但没有有效设备数据 | 停止自动重试 | 防盗号已开启，请升级或重新打开最新版客户端 |
| `ANTI_THEFT_DEVICE_INVALID` | 设备协议或字段非法 | 停止自动重试 | 当前设备信息获取失败，请重启游戏后再试 |
| `ANTI_THEFT_DEVICE_MISMATCH` | 当前设备不是绑定设备 | 停止自动重试 | 当前设备不是绑定设备，请在原设备关闭防盗号或联系客服解绑 |
| `ANTI_THEFT_VERIFY_UNAVAILABLE` | 服务端绑定数据或校验配置异常 | 停止自动重试，可提示稍后重试 | 防盗号校验暂不可用，请稍后再试或联系客服 |

要求：

- 错误响应不能包含数据库设备 ID、绑定平台细节或绑定时间。
- 这些错误必须被客户端识别为终止型错误，不能进入现有延迟自动登录循环。
- 短时间连续失败应进入账号/IP异常监控，但监控日志不得输出设备原值。

## 10. Account 属性同步

KB Account 实体增加：

```xml
<anti_theft_on>
    <Type>INT8</Type>
    <Flags>BASE_AND_CLIENT</Flags>
    <Persistent>false</Persistent>
    <Default>0</Default>
</anti_theft_on>
```

要求：

- 登录成功创建 Account 后，从 `third_marketing_info.anti_theft_on` 加载。
- 开启、关闭和后台解绑成功后立即更新在线 `Account.anti_theft_on`。
- 客户端设置页以该属性的服务端同步值作为最终状态。
- 数据库保存的 `device_id` 不得作为 Account 属性下发给客户端。
- 客户端需要为透明属性增加 setter/事件通知，但这是客户端改动，不属于 KB 服务端实现。

## 11. 设置页开关命令

### 11.1 调用方式

客户端继续使用现有双参数命令：

```ts
account.reqAccountCommand(param, content);
```

`content`：

```text
P@设置_防盗号_开关
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

字段规则：

| 字段 | 规则 |
| --- | --- |
| `anti_theft_on` | 只允许整数0或1 |
| `device_id` | 开启和关闭时都必须提交，用于证明当前设备 |
| `device_platform` | `android`、`ios` 或 `web` |
| `device_version` | 本期固定为1 |
| `request_id` | 1～64位，用于幂等、关联请求与防连续点击 |

### 11.2 状态机

| 当前状态 | 当前请求设备 | 请求 | KB结果 |
| --- | --- | --- | --- |
| 关闭 | 任意合法设备 | 开启 | 原子写入当前明文设备 ID并开启 |
| 开启 | 与绑定一致 | 开启 | 幂等成功，不重复绑定 |
| 开启 | 与绑定不一致 | 开启 | 拒绝，禁止覆盖绑定 |
| 开启 | 与绑定一致 | 关闭 | 原子关闭并清空绑定字段 |
| 开启 | 与绑定不一致 | 关闭 | 拒绝 |
| 关闭 | 任意合法设备 | 关闭 | 幂等成功，保持关闭和空绑定 |

### 11.3 原子开启

示意 SQL：

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

如果影响行数为0，必须重新读取：

- 已开启且平台、设备 ID一致：按幂等成功处理。
- 已开启且平台或设备 ID不一致：拒绝，不能覆盖绑定。
- 记录不存在或字段异常：返回失败。

### 11.4 原子关闭

只有当前绑定设备可以关闭：

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

如果影响行数为0，必须回读实际状态：

- 已关闭：按幂等成功处理。
- 仍开启但平台或设备 ID不一致：返回设备不匹配。
- 数据异常：返回操作失败。

> 不能只依赖 `RowsAffected` 判断记录是否存在；相同值更新或并发请求都可能返回0，必须回读确认。

### 11.5 操作结果

沿用现有 Account 命令回包体系，建议至少包含：

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

- 回包不包含数据库保存的设备 ID。
- 成功写库后必须回读，再更新 `Account.anti_theft_on`。
- 客户端在回包或属性同步前禁用开关，避免重复点击。
- 最终状态以 `Account.anti_theft_on` 为准，不能仅根据本地点击结果显示。

## 12. 后台解除绑定

### 12.1 管理原则

后台只允许：

- 查看开启/关闭状态。
- 查看掩码后的设备 ID（可选）。
- 独立高权限、带审计地查看完整设备 ID（仅排查需要）。
- 解除绑定并关闭防盗号。

后台禁止：

- 输入或替换原始设备 ID。
- 把一个账号直接绑定到客服输入的新设备 ID。
- 无权限、无原因、无确认地关闭防盗号。

### 12.2 KB 内部命令建议

XuanManager 应通过服务器本机受控内部接口调用 KB，不建议只改数据库而不处理在线 Account。

命令名建议：

```text
异步_解除_玩家_防盗号绑定
```

请求示意：

```json
{
  "player_guuid": "玩家ID",
  "login_name": "登录账号",
  "request_id": "admin-request-uuid",
  "reason_code": "DEVICE_LOST"
}
```

KB 操作：

1. 按玩家ID和登录账号核对唯一账号。
2. 原子设置 `anti_theft_on = 0`。
3. 清空设备 ID、平台和绑定时间。
4. `binding_revision` 递增。
5. 回读数据库确认。
6. 如果玩家在线，更新 `Account.anti_theft_on = 0`。
7. 建议使该账号现有登录会话失效，要求重新登录。
8. 返回最终状态和修订号，不返回设备数据。

XuanManager 负责：独立权限、二次确认、操作原因、操作者身份、修改前后状态和审计记录。

网页版丢失浏览器 ID 后只能走本节解绑流程。客服解绑前必须按业务制定的身份核验流程确认账号归属；否则攻击者可能绕过设备绑定，直接通过客服社会工程申请解绑。解绑成功后，玩家在新浏览器登录并主动重新开启，才能绑定新的浏览器 ID。

## 13. 会话、一致性与并发

### 13.1 多设备并发开启

两个设备同时在关闭状态下请求开启时，只允许第一个条件更新成功。第二个请求回读后发现已绑定其他设备 ID，必须拒绝，不能后写覆盖前写。

### 13.2 已登录旧会话

如果账号在设备A已登录，随后通过管理后台解绑或发生安全状态变化：

- 建议使账号现有会话失效并要求重新登录。
- 至少必须同步在线 Account 属性，避免客户端继续显示旧状态。
- 不能只更新数据库而长期保留不一致的在线内存状态。

### 13.3 断线重连

- 重新经过完整账号认证的登录必须重新提交并校验设备数据。
- 只恢复同一短期会话的底层网络重连，可以沿用已认证会话。
- 开启、关闭或后台解绑后，应使旧恢复令牌/旧会话失效，避免绕过新状态。

### 13.4 请求幂等

- 开关命令携带 `request_id`。
- KB 应在短时间窗口内识别同账号重复 `request_id`，返回第一次处理结果。
- 即使未实现请求缓存，条件更新和回读逻辑也必须保证重复请求不会覆盖绑定。

## 14. 特殊登录与老板账号

原方案提出 `boss_loginname` 不参与防盗号校验，这会形成永久绕过入口，不建议按角色直接豁免。

推荐规则：

- 普通老板、代理、盟主等游戏角色与普通玩家使用相同防盗号规则。
- 如果确有技术服务账号必须绕过，只允许通过服务器配置的精确账号白名单。
- 白名单默认关闭，例如 `ANTI_THEFT_BYPASS_ACCOUNTS` 为空。
- 每次白名单绕过都记录安全审计和告警。
- 白名单不能由客户端字段、玩家角色或数据库可自行修改字段决定。

## 15. 日志、监控与隐私

严禁记录：

- 完整 `device_id`。
- 明文密码或密码摘要。
- 登录 `datas` 原文。

允许记录：

- 玩家内部ID或按现有规范脱敏的登录账号。
- 操作类型和结果。
- 错误码。
- 平台类型。
- `binding_revision`。
- 掩码后的设备 ID，例如只保留前4位和后4位；如无排查必要，建议不记录。

建议监控：

- 同一账号短时间大量设备不匹配。
- 同一来源IP对大量账号触发设备错误。
- 后台解绑次数异常。
- XuanManager和KB设备字段校验规则不一致。
- 数据库存在“开关开启但设备 ID为空”等非法状态。

发生数据库状态非法或服务端异常时，已开启账号必须拒绝登录，不能静默降级放行。

## 16. 上线兼容策略

### 第一阶段：服务端准备

1. 数据库增加新字段，全部账号默认关闭。
2. XuanManager 与 KB 统一设备字段长度、正则和精确比较规则。
3. 两端完成相同合法/非法设备 ID测试用例。
4. KB 支持新版 JSON 和关闭状态下的旧客户端字符串。
5. 增加专用登录错误码和 Account 属性，但暂不让用户开启。

### 第二阶段：客户端发布

1. 发布 Android/iOS 稳定设备标识获取。
2. 所有正常登录和重新认证都携带新版 JSON。
3. 客户端识别专用错误并停止自动重试。
4. 观察设备数据获取失败率，不立即默认开启。
5. 网页版完成浏览器 ID 生成、IndexedDB/localStorage恢复、开启风险确认和存储读写自检。

### 第三阶段：开放功能

1. 开放注册页防盗号开关。
2. 开放设置页开关。
3. 上线 XuanManager 后台解绑。
4. 保持新注册默认关闭，完成一轮真实账号验证。
5. 网页版只在固定生产来源开放；HTTP转HTTPS、域名或端口仍可能变化时暂不开放。

### 第四阶段：安全增强

1. 升级注册接口为 HTTPS。
2. 升级 KB 登录和游戏连接为 WSS/TLS。
3. 再评估是否新注册默认开启。
4. 现有浏览器 ID 方案继续作为基础模式；如需更严格的网页版保护，单独设计 WebAuthn 协议，不复用字符串 ID 作为强认证凭证。

## 17. 验收用例

### 17.1 登录

| 编号 | 前置条件 | 操作 | 预期 |
| --- | --- | --- | --- |
| L01 | 防盗号关闭 | 旧客户端传“登陆” | 密码正确即可登录 |
| L02 | 防盗号关闭 | 新客户端不传设备数据 | 按兼容策略允许登录 |
| L03 | 防盗号开启 | 旧客户端传“登陆” | 返回设备缺失专用错误，停止重试 |
| L04 | 防盗号开启、绑定A | 设备A登录 | 登录成功 |
| L05 | 防盗号开启、绑定A | 设备B登录 | 返回设备不匹配，停止重试 |
| L06 | 防盗号开启 | JSON非法 | 返回设备数据非法，停止重试 |
| L07 | 密码错误 | 提交任意设备 | 只返回原账号/密码错误，不暴露防盗号状态 |
| L08 | 防盗号开启但设备 ID为空 | 登录 | 拒绝并记录服务端数据异常，不降级放行 |

### 17.2 开关

| 编号 | 前置条件 | 操作 | 预期 |
| --- | --- | --- | --- |
| S01 | 防盗号关闭 | 设备A开启 | 绑定A、开关为1、修订号递增 |
| S02 | 已绑定A | 设备A重复开启 | 幂等成功，不重复覆盖 |
| S03 | 已绑定A | 设备B请求开启 | 拒绝，绑定仍为A |
| S04 | 已绑定A | 设备A关闭 | 开关为0，设备 ID和平台清空 |
| S05 | 已绑定A | 设备B关闭 | 拒绝，状态不变 |
| S06 | 已关闭 | 重复关闭 | 幂等成功 |
| S07 | 已关闭 | A、B并发开启 | 只能一个成功，另一个不得覆盖 |
| S08 | 连续点击 | 同一 `request_id` 重复请求 | 返回一致结果，只产生一次真实状态变化 |

### 17.3 换机与重装

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| D01 | Android同一正式签名卸载重装 | 取得相同设备标识，原账号可登录 |
| D02 | iPhone卸载重装且Keychain仍在 | 取得相同设备标识，原账号可登录 |
| D03 | 换新手机且防盗号仍开启 | 新手机登录失败 |
| D04 | 原手机关闭防盗号后换新手机 | 新手机可登录并重新开启绑定 |
| D05 | 原手机丢失，后台解除绑定 | 新手机可登录并重新开启绑定 |
| D06 | 恢复出厂或标识丢失 | 按新设备处理，需要原设备关闭或后台解绑 |

### 17.4 网页版

| 编号 | 场景 | 预期 |
| --- | --- | --- |
| W01 | 首次打开网页 | 生成一个浏览器 ID，IndexedDB和localStorage值一致 |
| W02 | 同一来源正常刷新和重开浏览器 | 继续使用原浏览器 ID |
| W03 | 主存储缺失但镜像有效 | 从镜像恢复主存储，不生成新 ID |
| W04 | 清除Cookie和网站数据后重开 | 生成新 ID；已绑定账号登录失败并提示客服解绑 |
| W05 | 同一手机更换浏览器 | 视为新设备，已绑定账号登录失败 |
| W06 | 使用无痕模式 | 显示风险提示；不能承诺关闭浏览器后仍可登录 |
| W07 | 切换域名、端口或HTTP/HTTPS | 视为新来源；未迁移时按新设备处理 |
| W08 | 浏览器存储写入或回读失败 | 禁止开启防盗号 |
| W09 | 开启前确认弹窗 | 明确提示清除网站数据后需客服解绑 |
| W10 | 客服解绑后在新浏览器登录并开启 | 绑定新的浏览器 ID |

### 17.5 管理后台与在线状态

| 编号 | 操作 | 预期 |
| --- | --- | --- |
| A01 | 无权限用户请求解绑 | 拒绝且不修改 |
| A02 | 未确认或未填写原因 | XuanManager拒绝提交 |
| A03 | 合法解绑 | KB关闭、清空绑定、回读成功、记录审计 |
| A04 | 玩家在线时解绑 | Account属性同步，旧会话按策略失效 |
| A05 | 普通后台用户查看账号 | 只返回掩码设备 ID，不返回完整值 |
| A06 | 高权限人员查看完整设备 ID | 必须有独立权限并记录查看审计，不能编辑 |

### 17.6 安全与一致性

| 编号 | 检查 | 预期 |
| --- | --- | --- |
| C01 | Go端和KB端使用相同设备输入 | 字段校验和精确比较结果一致 |
| C02 | 检查服务日志和审计 | 无完整设备ID、密码和登录datas原文 |
| C03 | 数据库开启但设备ID为空 | 登录失败并产生数据异常告警，不降级放行 |
| C04 | 修改平台大小写或设备字符串 | 平台按规范校验，设备ID不被静默改写 |
| C05 | XuanManager与KB正则不一致 | 联调测试必须发现并修正规则差异后才能上线 |

## 18. KB 服务端交付清单

KB 团队需要交付并说明涉及文件：

- [ ] 登录 `datas` 新版 JSON 解析。
- [ ] 关闭状态下兼容旧客户端字符串。
- [ ] 登录和开关协议允许并正确校验 `platform = web`。
- [ ] 密码成功后的平台和明文设备 ID精确校验。
- [ ] 与XuanManager一致的长度、正则和合法/非法测试用例。
- [ ] 四个专用登录错误的实际数字及客户端映射。
- [ ] `Account.anti_theft_on` 实体定义和登录赋值。
- [ ] `设置_防盗号_开关` Account 命令。
- [ ] 原子开启、关闭、幂等和并发保护。
- [ ] 操作结果回包和 `request_id` 关联。
- [ ] 后台解除绑定内部命令。
- [ ] 在线 Account 同步和旧会话失效策略。
- [ ] 老板/特殊登录链路不再默认绕过，或提供受控白名单方案。
- [ ] 初始化建库脚本和生产迁移脚本。
- [ ] 日志脱敏和异常监控。
- [ ] 单元测试、数据库测试和联调结果。

## 19. 客户端与 XuanManager 对接清单

为便于 KB 联调，其他参与方需要同步完成：

### 客户端

- [ ] Android 原生桥返回 `ANDROID_ID`。
- [ ] iOS 原生桥返回 Keychain UUID。
- [ ] Web 首次访问使用 `crypto.getRandomValues()` 生成浏览器 UUID。
- [ ] Web 使用 IndexedDB 主存储和 localStorage 镜像，并完成写入回读自检。
- [ ] Web 开启前显示清除网站数据、换浏览器和换网址的风险确认。
- [ ] Web 浏览器 ID 丢失后不自动覆盖服务端旧绑定。
- [ ] 注册接口增加防盗号和设备字段。
- [ ] KB 登录第三参数改为新版 JSON。
- [ ] 登录错误码设置为终止型，不再自动重试。
- [ ] 注册页和设置页使用 Prefab 固定节点。
- [ ] 设置开关使用 `reqAccountCommand(param, "P@设置_防盗号_开关")`。
- [ ] 增加 `Account.anti_theft_on` 客户端 setter/事件。
- [ ] 开关操作期间禁用连续点击，以服务端属性为最终状态。

### XuanManager

- [ ] 注册请求扩展和字段校验。
- [ ] 使用与KB相同的设备字段长度和正则。
- [ ] 注册开启时原子写入明文设备 ID、平台与开关。
- [ ] 注册关闭时把设备 ID保存为空字符串。
- [ ] 后台增加独立查看/解绑权限。
- [ ] 解绑要求原因、二次确认和审计。
- [ ] 通过 KB 内部命令解绑并回读，不直接静默改库。
- [ ] 普通接口、日志和审计不暴露完整设备 ID；高权限查看必须审计且不能编辑。

## 20. 联调前必须由 KB 确认的项目

KB 团队回复本文时，请明确以下结果：

1. 登录认证实际读取 `third_marketing_info` 的代码位置。
2. 登录 `datas` 在 Loginapp 中的实际获取位置和最大长度。
3. 专用登录错误码分配的具体数字及错误表文件。
4. `Account` 实体定义文件和服务端初始化位置。
5. `reqAccountCommand` 的实际分发入口，以及是否接受 `P@设置_防盗号_开关`。
6. 设置命令结果通过哪个现有客户端事件返回。
7. 在线账号是否允许多端同时存在，以及开启/解绑后如何踢出旧会话。
8. `boss_loginname` 特殊登录链路是否确有业务必要；若必要，采用什么受控白名单。
9. `third_marketing_info` 当前表引擎、唯一索引和并发更新行为。
10. XuanManager 调用 KB 内部解绑命令的准确命令名、参数和返回格式。
11. KB 与 XuanManager 是否确认使用相同长度、正则和明文精确比较规则。
12. 是否同意分阶段兼容和默认关闭的上线顺序。

以上12项确认完成后，客户端才能按最终错误码、命令名和返回事件开始完整联调。
