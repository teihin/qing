# 历史原文摘录：启动与业务链路

状态：历史证据，不是当前指令。原记录可能已经被后续决策替代。
来源：[完整原文](AGENTS.original.md)，原第 290–316 行；以 [当前状态](../../CURRENT.md) 和 [决策记录](../../DECISIONS.md) 确认适用性。

---

## 启动与业务链路

```text
login.fire
  -> StartGameManager
  -> GameDataManager（持久化单例、KBE、心跳、重连、移动 SDK）
  -> panelUpdate（Web 跳过热更，Native 使用 AssetsManager）
  -> panelLogin
  -> panelMain（大厅）
  -> drh8.fire（牌桌）
```

- `assets/scripts/StartGameManager.ts`：启动入口。
- `assets/scripts/GameDataManager.ts`：全局会话、网络、登录状态、重连和场景跳转中心。
- `assets/scripts/common/UIManager.ts`：把 `assets/resources/UI/<面板名>.prefab` 动态加载到 `Canvas/Normal` 或 `Canvas/Top`。
- `assets/scripts/common/GameDef.ts`：服务器、状态、数据结构及公共常量。
- `assets/scripts/UI/panelMain.ts`：大厅、房间列表、钱包、个人中心和管理入口。
- `assets/scripts/UI/panelGameView.ts`：牌桌 UI 与玩家交互。
- `assets/scripts/logic/DrhLogicMgr.ts`：房间和牌局总状态。
- `assets/scripts/logic/DrhPlayerLogic.ts`：单座位状态、发牌、操作和结算表现。
- `assets/scripts/logic/DrhNameManager.ts`：牌型名称与点数。
- `assets/scripts/kbe_scripts/kbengine.js`：定制 KBEngine WebSocket 客户端。
- `assets/scripts/kbe_scripts/Account.js`：业务 RPC 包装及服务端事件转发。
- `assets/scripts/mobile/MobileManager.ts`：微信、语音、统计、GPS、图片和原生桥接。
- `assets/scripts/UI/panelUpdate.ts`：当前实际使用的热更新逻辑；`logic/UpdateManager.ts` 基本未使用。
- 2026-08-11 已静态确认 Native 启动强更流程：`StartGameManager` 打开 `panelUpdate`，其 `UpdateWebConfig()` 会延迟0.5秒调用 `checkUpdate()`；远端版本相对本地只增加补丁位（如1.0.28→1.0.29）时执行热更新，主版本或次版本提高（如1.0.28→2.0.1或1.1.0）时打开 `panelVertion`，不会进入 `panelLogin`。当前项目内及远端清单均为1.0.28，`.hot-update-config.json` 下一版本为1.0.29。发布原生不兼容版本时，新Android/iOS安装包必须内置与远端一致的2.0.1清单，否则新包也会被强更弹窗拦住；远端清单应在新版安装包就绪后最后切换。历史下载配置原本来自已停用的9000端点，当前不再依赖下载地址：`panelVertion.ts` 的“确定”和“取消”均直接调用 `cc.game.end()` 关闭客户端，不跳转网页；该脚本修改必须进入新版原生包或在切换大版本前先以普通补丁热更新到全部旧客户端，否则仍运行旧缓存脚本的客户端可能继续执行历史下载逻辑。网页版直接跳过Native热更检查，不受该强更版本影响。

