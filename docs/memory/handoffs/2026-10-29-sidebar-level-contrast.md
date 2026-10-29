# 侧边栏一级/二级底色区分（已部署）

目录 `/Volumes/SSD/qing`，分支 `codex/club-ui`。**只改前端样式，逻辑未动；前端已发布，git 未提交。**

## 需求

后台一级菜单（分组表头）和二级菜单（组内页面）看起来太接近、不好分辨，要拉开底色层次。

## 改动

`web/src/styles.css` 在 `.nav-group.is-collapsed > .nav-link` 之后新增一段 `@media (min-width: 821px)`：

- 一级（`.navigation > .nav-link` 与 `.nav-group__toggle`）：青色渐变底块 + 内描边，44px 高、加粗；
  无子页的一级链接与分组表头样式一致。
- 二级（`.nav-group > .nav-link`）：缩进 14px、深青底（`rgba(7,32,39,.82)`）、42px 高、14px 字号，
  悬停加深；激活态仍是青色渐变并保留右侧指示条。
- 只在完整侧边栏宽度下生效：≤820px 的图标栏与 ≤620px 底部导航保持原样（否则会顶掉媒体查询里的宽高）。

## 验证

- 用静态页（同一份构建 CSS + 侧边栏真实类名）截图核对：一级为亮青表头，二级为缩进的深色项，
  折叠组（只有表头）与一级无子页链接显示正常。
- `eslint`、`tsc -b`、`vite build` 通过；产物 `index-BbJhB5-_.js` + `index-DzXYeO4c.css`。
- **未在真实后台登录态下看过**（无管理员凭据），层级效果用静态页截图核对。

## 部署（2026-10-29 21:39）

- 解包到 `web.staging-navlevels-20261029`，本地/暂存/线上 sha256 一致（CSS `57c7b7c3…`）→
  `mv web web.previous-navlevels-20261029` → 暂存目录上位 → 清 `._*`。
- 线上 `index.html` 指向 `index-BbJhB5-_.js` + `index-DzXYeO4c.css`；CSS 下载 200（200,854 B），
  压缩后规则含 `@media (width>=821px)`、`.nav-group>.nav-link{…background:#072027d1…}`；
  `api/health` 200。回滚点 `web.previous-navlevels-20261029`。
