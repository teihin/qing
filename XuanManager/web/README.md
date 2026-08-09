# XuanManager Web

React 管理界面。开发模式把 `/api` 代理到 `127.0.0.1:8891`；生产构建输出到 `dist/`，由 XuanManager Go 后端同源提供。

```bash
npm install
npm run lint
npm run build
npm run dev
```

浏览器端不保存数据库账号、后台用户密码或服务端权限状态。菜单隐藏只改善使用体验，最终权限由 Go 后端逐个接口校验。
