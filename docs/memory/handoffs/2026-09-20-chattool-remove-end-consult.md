# 客服玩家端移除「结束咨询」按钮

日期：2026-09-20
目录/分支：`/Volumes/SSD/qing`，`main`（源码未提交）
状态：**前端已部署线上**（`http://154.37.155.17/chattool/`）；源码未提交

## 需求

玩家端客服界面上的「结束咨询」按钮无用，去掉；关闭客服由外层 APP（Cocos 侧）负责。

## 定位

按钮不在 Cocos 工程里，而在 H5 客服页的头部：

- `ChatTool/web/src/PlayerApp.tsx` header 右侧的 `<button className="header-action" onClick={endConversation}>结束咨询</button>`。
- Cocos 侧 `assets/resources/UI/panelKefu.prefab` 只有「关闭」和已被 `panelKefu.ts::ConfigureTitle()`
  置灰的「弹出」，均未改动。

## 改动文件

- `ChatTool/web/src/PlayerApp.tsx`
  - 删除 header 中的「结束咨询」按钮。
  - 删除 `endConversation()` 函数：`tsconfig.app.json` 开启了 `noUnusedLocals`，保留会编译失败。
- `ChatTool/web/src/styles.css`
  - 删除 4 条 `.header-action` 规则（1 条基础 + 3 条媒体查询内），均为已无引用的死样式。
- 未改：服务端 `POST /api/player/end` 及其 handler。客服端结束会话、玩家端
  `conversation.status === 'closed'` 的「本次咨询已结束」提示与「评价本次服务」入口行为不变。

`player-header` 使用 `justify-content: space-between`，去掉右侧按钮后品牌自然靠左，无需补样式。

## 验证

- `tsc -b` 0 报错；`vite build` 通过，产物 `dist/assets/index-CRicsnay.js`（240,742 B）
  + `index-Bq9oCEHx.css`（44,346 B）；产物内「结束咨询」0 命中。
- 部署：`scp` 打包产物到 `/www/html/.chattool/incoming/` → 解包到暂存目录 → 校验
  （新 hash 命中、无「结束咨询」）→ `mv web web.previous-remove-end-consult-20260920-183002`
  → `mv` 新目录 → `chmod 2755`。**只替换静态目录，未重启 Go 服务**（`CHAT_STATIC_DIR` 路径未变）。
- 线上回读：`127.0.0.1:8893` 与经 Caddy 的 `http://154.37.155.17/chattool/` 首页均 200；
  `index-CRicsnay.js` / `index-Bq9oCEHx.css` 均 200 且字节数与本地一致；JS 内「结束咨询」0 命中、
  「评价本次服务」1 命中；CSS 内 `header-action` 0 命中；`/chattool/player` 200；
  `/chattool/api/health` 200。
- **未做**：登录态下在真实 WebView（iOS/Android 原生包）中打开客服页的目视复核。

## 回滚

```
rm -rf /www/html/.chattool/web \
  && mv /www/html/.chattool/web.previous-remove-end-consult-20260920-183002 /www/html/.chattool/web
```

仅动前端静态目录，未换二进制、未重启后端，回滚不需要停机。

## 未完成项

- 源码未提交（本任务未获提交授权）。
- 真实设备 WebView 内的目视复核待做；建议同时确认「关闭客服」只由外层 Cocos 面板承接。
