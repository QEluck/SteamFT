# SteamFT · Steam 游戏时间监控工具

一个基于 **Electron** 的 Windows 桌面应用：定期通过 Steam Web API 读取指定 Steam ID 的玩家信息、游戏时长、近期游戏，并自动保存每次拉取的完整快照，方便你对比**相邻两次监控**的增量，也可以**任意选取两个历史时间点**进行深度对比。

> 监控与对比全部在本地程序内完成，不会把你的 Steam ID 或 API Key 上传到任何第三方服务器。

---

## ✨ 功能清单

| 模块 | 说明 |
|---|---|
| 🕑 **定时自动刷新** | 按分钟间隔轮询 Steam Web API（默认 5 分钟，可改），启动时立即拉一次 |
| 🔘 **功能开关** | 玩家信息&在线状态 / 拥有的游戏&总时长 / 近期两周游戏 — 三项分别开关 |
| 🆔 **Steam ID 输入** | 17 位 SteamID64，与 API Key 一起保存到用户数据目录，下次启动自动回填 |
| 📈 **相邻增量对比** | 每次刷新后自动显示总时长净增 + 单游戏增量标签 + 本次增量排行 + "新入库"标记 |
| 🗂️ **完整历史记录** | 每次拉取落地为一条记录（最多 500 条），下拉可直接任选两个时间点对比 |
| 🔍 **两点深度对比** | 总时长变化 / 实际增加 / 有增量的游戏数 / 不再拥有的游戏 / 增量排行 TOP12 |
| 📦 **打包为安装包** | 使用 Electron Builder 生成 NSIS 安装包，自定义图标、可改安装目录、桌面快捷方式 |
| 🤖 **GitHub Actions CI** | 推送到 main 自动构建并上传 Artifact；打 `v*` tag 自动创建 GitHub Release 并挂载安装包 |

## 🔑 准备工作：Steam Web API Key

调用 Steam 接口必须有 API Key：

1. 登录 Steam 账号后访问 👉 [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)
2. 随便填一个域名（不检查真实性） → **同意条款** → 生成 32 位 Key
3. 复制填到软件"配置区 → Steam Web API Key"

## 🖥️ 安装与使用

### 方式 A：下载预构建安装包（推荐）
打开仓库右侧 **Releases**，下载 `SteamFT Setup x.y.z.exe` → 双击安装 → 桌面快捷方式启动。

如暂无 Release，可从 **Actions → 最新成功的 Build → Summary** 底部下载 `SteamFT-Setup` Artifact，解压后即为安装包。

### 方式 B：源码运行

```bash
# Node.js >= 18
npm install
npm start
```

### 方式 C：本地打包为安装包

```bash
npm run build
# 产物：dist/SteamFT Setup x.y.z.exe
```

## ⚙️ 配置项

| 字段 | 说明 |
|---|---|
| API Key | Steam Web API Key（32 位） |
| Steam ID | 17 位 SteamID64，如 [steamid.io](https://steamid.io/) 可查询 |
| 刷新间隔 | 单位分钟，推荐 3-10 分钟（太短会触发 Steam 限流） |
| 玩家信息开关 | 是否拉取昵称 / 等级 / 在线状态 / VAC 封禁 |
| 拥有的游戏开关 | 是否拉取游戏列表、每个游戏总时长；**关闭后历史记录与增量对比也不保存** |
| 最近玩的游戏开关 | 是否拉取近 2 周内有过记录的游戏 |

配置保存于 `%APPDATA%\SteamFT\config.json`（可直接删除回到首次启动状态）。

## 📂 本地文件说明

所有持久化数据都在 **`%APPDATA%\SteamFT\`**（用户数据目录），程序源码与安装包里**绝不会**包含这些文件：

- `config.json` — API Key、Steam ID、刷新间隔、三项功能开关
- `snapshot.json` — 上次快照（用于相邻两次增量对比的基准）
- `history.json` — 历次拉取的完整记录（最多 500 条，用于任意两点对比）

删除任意一个就会重置它对应的数据；全删即完全还原首次启动。

## 🤖 CI / 自动构建

工作流在 `.github/workflows/build.yml`：

- **push to `main`** → `windows-latest` + Node 20 → `npm ci` → `npm run build` → 上传安装包为 Artifact（保留 90 天）
- **push tag `v*`** → 上述全部 + 自动创建 GitHub Release 并挂载 `SteamFT Setup.exe`、`.blockmap`、`builder-debug.yml`
- **手动触发**：仓库 **Actions → Build Windows Installer → Run workflow**

创建一个 Release 只需：

```bash
git tag v1.0.2
git push origin v1.0.2
```

## 🧱 技术栈

- **Electron 31** — 桌面壳，`contextIsolation: true` + preload 安全桥接
- **Steam Web API** — `ISteamUser/GetPlayerSummaries` / `IPlayerService/GetOwnedGames`(+include_appinfo) / `GetRecentlyPlayedGames`
- **electron-builder 24** — 目标 NSIS，自定义图标、可改目录安装、自动快捷方式
- **GitHub Actions** — 自动构建 + Release

## 📝 License

MIT
