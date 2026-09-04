# Agent 必读：分支、目录、测试与发版

任何在本仓库里改代码、修 bug、发版的 Agent **开始动手前必须先读本文**。不要在 `main` 上直接开发，也不要用 Chrome 已加载的稳定目录当草稿本。

详细步骤见 [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md)。发版文案与 ZIP 规则见 [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md)。

## 两套目录，不要混

| 用途 | 目录 | Git 分支 | 谁加载 `extension/` |
|------|------|----------|---------------------|
| 稳定日常使用 | `/Users/gaohaizhen/Desktop/boss` | `main` | **Chrome** |
| 开发与回归 | `/Users/gaohaizhen/Desktop/boss-dev` | `dev` | **ego-browser** |

- Chrome 加载：`/Users/gaohaizhen/Desktop/boss/extension`
- ego 加载：`/Users/gaohaizhen/Desktop/boss-dev/extension`
- 开发任务的工作目录必须是 **`boss-dev`**。不要在 `boss` 里改业务代码，以免 Chrome 半成品扩展和稳定版搅在一起。
- 两个目录是同一仓库的 git worktree，提交会共享；只是检出的分支不同。

## 分支怎么走

```text
日常改代码、跑测试  →  只在 dev
开发完成、ego 验过  →  把 dev 合并进 main
合并进 main 之后    →  再 bump 版本、打 tag、发 GitHub Release
```

- 禁止：在 `main` 上直接改功能、修 bug、升版本。
- 禁止：在 Chrome 用的 `boss` 目录里开发完不经 `dev` 就发版。
- 大功能可以用 `dev` 上的短命分支（例如 `fix/image-send`），合回 `dev` 后再进 `main`。不要再开一堆长期平行的 `codex/...` 当默认开发线。

## 版本号必须一起改

发版时下列位置必须是同一个 `x.y.z`（例如 `1.7.24`）：

| 位置 | 字段 |
|------|------|
| `package.json` | `version` |
| `extension/manifest.json` | `version` |
| `extension/sidepanel/app.js` | `BHT_UI_VERSION` |
| `extension/content/content-main.js` | `BHT_CONTENT_VERSION` |
| `extension/content/floating-host.js` | `BHT_FLOAT_HOST_VERSION` |
| `tests/browser/chrome-stub.js` | `runtimeVersion`（两处） |
| `docs/releases/release-notes.json` | 新增 `vX.Y.Z` 条目 |
| `dist/RELEASE_vX.Y.Z.md` | 与 JSON 正文一致 |
| Git tag / GitHub Release | `vX.Y.Z` |
| ZIP 文件名 | `dist/autocast-boss-haitou-vX.Y.Z.zip` |

开发过程中 **不要提前改版本号**。版本号只在 `dev` 已合并进 `main`、准备发 Release 时一次性改齐。

漏改任一处会导致面板提示「扩展代码版本不一致」或「海投助手需刷新」。扩展重载后，已打开的 BOSS 页必须 **F5**，浮窗 iframe 才会带上新的 `v=`。

## Agent 默认动作

1. 确认当前工作目录是 `/Users/gaohaizhen/Desktop/boss-dev`，当前分支是 `dev`（或从 `dev` 拉出的短命分支）。
2. 若目录不存在：按 `docs/DEV_WORKFLOW.md` 建 worktree，不要改 Chrome 那份 `boss`。
3. 改代码、写测试、在 **ego** 里加载 `boss-dev/extension` 验证。
4. 不要对用户的 Chrome 扩展点「重新加载」，除非用户明确要求更新稳定版。
5. 准备发版时：先把 `dev` 合进 `main`，再在 `main` 上按 `docs/RELEASE_PROCESS.md` 升版本、打包、打 tag。
6. 发版后让 `dev` 跟上 `main`，避免两条线再次分叉。
