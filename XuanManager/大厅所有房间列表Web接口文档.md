# 大厅所有房间列表 Web 接口文档

本文档提供给新后台前端和新后台后端使用，用于实现“大厅所有活跃房间列表”页面。

前端不要直接调用旧游戏服务 `127.0.0.1:8890`。前端只调用新后台自己的 HTTP API，由新后台后端再去调用旧游戏服务内部接口。

## 一、功能说明

该接口用于展示游戏大厅当前所有活跃房间的概览信息。

当前版本只查询大厅业务房间，即旧服务返回的 `room_type = Custom` 的活跃房间。已结束、已关闭、无有效游戏对象的房间不会返回。

支持：

- 查看当前大厅所有活跃房间列表。
- 分页查询。
- 展示房间状态、玩法、规则、人数统计、创建人、创建时间。
- 展示观战人数、等待带入/占位人数等统计值。

不支持：

- 查看房间内玩家明细列表。
- 查看玩家手牌。
- 查看下张牌。
- 查看 GPS、IP。
- 查看发牌优化概率。
- 按俱乐部、联盟、玩法、状态筛选。
- 执行房间命令。
- 解散房间。
- 踢人。

## 二、前端调用接口

新后台前端调用：

```http
GET /api/admin/hall/rooms
```

该接口由新后台后端提供。新后台后端再转发调用旧游戏服务内部接口。

## 三、请求参数

Query 参数：

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | int | 否 | `1` | 前端页码，从 `1` 开始；非法、空值、小于 `1` 时按 `1` 处理 |
| `page_size` | int | 否 | `50` | 每页数量；非法、空值、小于等于 `0` 时按 `50` 处理；最大 `200` |

请求示例：

```http
GET /api/admin/hall/rooms?page=1&page_size=50
```

## 四、前端响应格式

成功返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "page": 1,
    "page_size": 50,
    "total": 12,
    "items": [
      {
        "room_id": 851724,
        "room_type": "Custom",
        "room_name": "1-851724",
        "room_status": "游戏中",
        "game_status": "playing",
        "play_mode": "传销扯旋",
        "special_rule": ["特牌", "圈芒", "底皮1/3"],
        "round_count": 3,
        "game_round": 99999,
        "player_count": 4,
        "watcher_count": 1,
        "player_and_watcher_count": 5,
        "inhold_count": 0,
        "max_number": 8,
        "club_id": "0",
        "club_name": "",
        "creator_guuid": "648425",
        "creator_name": "boss",
        "create_datetime": "2026-08-11 10:00:00",
        "remark": "26分钟"
      }
    ]
  }
}
```

失败返回：

```json
{
  "code": 1,
  "message": "获取大厅房间列表失败",
  "data": null
}
```

如果旧服务返回了明确错误，新后台后端可以把安全的错误信息透传给前端，例如：

```json
{
  "code": 1,
  "message": "BOSS未初始化",
  "data": null
}
```

可透传的旧服务错误包括：

- `BOSS未初始化`
- `权限不足`
- `参数错误`

其它未知错误统一返回 `获取大厅房间列表失败`。

## 五、字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `room_id` | int | 房间号 |
| `room_type` | string | 房间类型；当前固定为 `Custom` |
| `room_name` | string | 房间名 |
| `room_status` | string | 后台展示状态，前端状态标签优先使用该字段 |
| `game_status` | string | 游戏内部原始状态，仅用于后台排查，不建议直接作为页面状态展示 |
| `play_mode` | string | 玩法 |
| `special_rule` | array | 房间规则；服务端保证返回数组，前端也应按数组处理 |
| `round_count` | int | 当前局数 |
| `game_round` | int | 总局数或配置局数 |
| `player_count` | int | 坐下/游戏玩家数量 |
| `watcher_count` | int | 观战人数 |
| `player_and_watcher_count` | int | 玩家加观战总人数；旧服务方法不可用时可能等于 `player_count + watcher_count` |
| `inhold_count` | int | 等待带入/占位人数 |
| `max_number` | int | 最大人数 |
| `club_id` | string | 俱乐部 ID，普通大厅房可为 `0` 或空字符串 |
| `club_name` | string | 俱乐部名称 |
| `creator_guuid` | string | 创建人游戏 ID |
| `creator_name` | string | 创建人昵称 |
| `create_datetime` | string | 创建时间 |
| `remark` | string | 简要备注，当前可用于展示剩余时间 |

不会返回的字段：

- 房间内玩家明细列表。
- 玩家手牌。
- 牌堆。
- 下张牌。
- GPS。
- IP。
- 发牌优化概率。
- 发牌优化次数。
- 玩家实时下注细节。
- 房间操作命令。

## 六、房间状态说明

`room_status` 给前端直接展示。

可能值：

| 值 | 说明 |
| --- | --- |
| `准备` | 房间未开局，暂无实际游戏进程 |
| `等待中` | 房间未开局，但已有玩家或等待带入玩家 |
| `游戏中` | 房间已进入游戏流程 |
| `要求解散` | 房间处于申请解散流程 |

前端建议颜色：

| 状态 | 建议展示 |
| --- | --- |
| `游戏中` | 主要状态 |
| `等待中` | 普通状态 |
| `准备` | 次要状态 |
| `要求解散` | 警示状态 |

说明：

- 前端展示状态以 `room_status` 为准。
- `game_status` 是旧游戏服务的内部原始状态，只用于排查。
- 已结束、已关闭的房间不会出现在列表中。

## 七、页面展示建议

列表建议列：

| 列名 | 对应字段 |
| --- | --- |
| 房间号 | `room_id` |
| 房间名 | `room_name` |
| 状态 | `room_status` |
| 玩法 | `play_mode` |
| 规则 | `special_rule` |
| 局数 | `round_count / game_round` |
| 人数 | `player_count / max_number` |
| 观战 | `watcher_count` |
| 占位 | `inhold_count` |
| 俱乐部 | `club_name` 或 `club_id` |
| 创建人 | `creator_name` 和 `creator_guuid` |
| 创建时间 | `create_datetime` |
| 备注 | `remark` |

规则展示建议：

- `special_rule` 是数组。
- 前端可用空格或标签方式展示。
- 不建议把所有规则挤在很窄的表格列里，可使用 tooltip 或展开详情。

## 八、新后台后端转发逻辑

新后台后端调用旧游戏服务：

```bash
curl --get 'http://127.0.0.1:8890/hall/command' \
  --data-urlencode 'header=查询_大厅_所有房间' \
  --data-urlencode 'param={"page":0,"count":50,"context":"admin-room-list"}'
```

旧游戏服务成功返回：

```json
{
  "ret_code": 512,
  "ret_result": {
    "number": 0,
    "count": 12,
    "result": [],
    "context": "admin-room-list"
  }
}
```

旧游戏服务失败返回示例：

```json
{
  "ret_code": 769,
  "ret_result": {
    "error": "权限不足"
  }
}
```

后端转换规则：

| 前端参数 | 旧服务参数 |
| --- | --- |
| `page` | `page - 1` |
| `page_size` | `count` |

| 旧服务字段 | 前端字段 |
| --- | --- |
| `ret_result.number + 1` | `data.page` |
| `page_size` | `data.page_size` |
| `ret_result.count` | `data.total` |
| `ret_result.result` | `data.items` |

处理要求：

- 新后台后端必须把前端 `page` 转为旧服务 0 基页码。
- `page_size` 最大限制为 `200`。
- 如果旧服务不可达，前端接口返回失败。
- 如果 `ret_code != 512`，前端接口返回失败。
- 如果 `ret_result` 不是对象，前端接口返回失败。
- 如果 `ret_result.result` 不是数组，前端接口返回失败。
- 如果旧服务返回 `ret_result.error` 且属于安全错误信息，可以透传给前端。
- 新后台后端应记录调用日志，便于排查。

## 九、新后台后端示例伪代码

```js
function safePositiveInt(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

async function listHallRooms(req, res) {
  const page = safePositiveInt(req.query.page, 1);
  const rawPageSize = safePositiveInt(req.query.page_size, 50);
  const pageSize = Math.min(rawPageSize, 200);

  const param = {
    page: page - 1,
    count: pageSize,
    context: `admin-room-list-${Date.now()}`
  };

  let oldResp;
  try {
    oldResp = await callOldHallCommand('查询_大厅_所有房间', param);
  } catch (err) {
    return res.json({
      code: 1,
      message: '获取大厅房间列表失败',
      data: null
    });
  }

  const oldResult = oldResp && oldResp.ret_result;
  const safeErrors = ['BOSS未初始化', '权限不足', '参数错误'];
  const oldError = oldResult && typeof oldResult.error === 'string' ? oldResult.error : '';

  if (!oldResp || oldResp.ret_code !== 512) {
    return res.json({
      code: 1,
      message: safeErrors.includes(oldError) ? oldError : '获取大厅房间列表失败',
      data: null
    });
  }

  if (!oldResult || typeof oldResult !== 'object' || !Array.isArray(oldResult.result)) {
    return res.json({
      code: 1,
      message: '获取大厅房间列表失败',
      data: null
    });
  }

  const returnedPage = Number.isFinite(Number(oldResult.number)) ? Number(oldResult.number) + 1 : page;

  return res.json({
    code: 0,
    message: 'ok',
    data: {
      page: returnedPage,
      page_size: pageSize,
      total: Number.isFinite(Number(oldResult.count)) ? Number(oldResult.count) : 0,
      items: oldResult.result
    }
  });
}
```

## 十、刷新频率建议

房间列表是实时内存数据，不建议前端高频自动刷新。

建议：

- 默认手动刷新。
- 如果需要自动刷新，间隔不低于 5 秒。
- 页面不可见时暂停自动刷新。
- 切换分页、点击刷新按钮时重新请求。

## 十一、安全要求

- 前端不得直接访问 `http://127.0.0.1:8890/hall/command`。
- 旧游戏服务 HTTP 端口不得开放公网。
- 新后台接口必须做登录态校验。
- 只有后台管理员可访问该页面。
- 本接口只读，不提供房间操作能力。
- 页面上不要展示玩家明细、手牌、牌堆、GPS、IP、发牌优化等敏感运行数据。

## 十二、验收标准

前端验收：

- 能展示当前大厅所有活跃房间。
- 当前返回房间的 `room_type` 为 `Custom`。
- 分页正常。
- 无房间时显示空列表。
- 已结束、已关闭房间不显示。
- 旧服务异常时显示错误提示。
- `BOSS未初始化`、`权限不足`、`参数错误` 能显示为明确错误。
- 字段展示清晰，不把规则文本挤压到影响页面可读。
- 页面不展示玩家明细、手牌、牌堆、GPS、IP、发牌优化等敏感数据。

后端验收：

- 能正确调用旧服务 `查询_大厅_所有房间`。
- 能处理 `ret_code != 512` 的情况。
- 能处理旧服务不可达的情况。
- 能校验 `ret_result` 是对象。
- 能校验 `ret_result.result` 是数组。
- 能限制 `page_size <= 200`。
- 能把前端 `page` 从 1 基转换为旧服务 0 基。
- 能把旧服务 `number` 从 0 基转换为前端 1 基。

## 十三、后续扩展

如果后续需要房间详情或房间管理，应新增独立接口，例如：

- `GET /api/admin/hall/rooms/{room_id}`
- `POST /api/admin/hall/rooms/{room_id}/dismiss`
- `POST /api/admin/hall/rooms/{room_id}/command`

不要在当前列表接口中混入房间操作功能。
