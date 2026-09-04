# 开发、测试与发版工作流

Chrome 用稳定代码，ego 用开发代码。Agent 入口规范见仓库根目录 [AGENTS.md](../AGENTS.md)。

## 1. 目录与浏览器

| 角色 | 路径 | 分支 | 加载扩展的浏览器 |
|------|------|------|------------------|
| 稳定副本 | `/Users/gaohaizhen/Desktop/boss` | `main` | Chrome：加载 `.../boss/extension` |
| 开发副本 | `/Users/gaohaizhen/Desktop/boss-dev` | `dev` | ego-browser：加载 `.../boss-dev/extension` |

两份目录是同一个 Git 仓库的 worktree，不是两份互不相干的拷贝。

第一次把开发副本建出来：

```bash
# 在稳定副本里执行
cd /Users/gaohaizhen/Desktop/boss
git fetch origin
git branch --show-current    # 确认自己在干什么

# 若还没有 dev：从当前已发布的稳定提交拉一条
git branch dev
git push -u origin dev

git worktree add /Users/gaohaizhen/Desktop/boss-dev dev
```

ego 里：`chrome://extensions` → 开发者模式 → 加载未打包扩展 → 选 **`/Users/gaohaizhen/Desktop/boss-dev/extension`**（必须能直接看到 `manifest.json`）。

Chrome 里继续加载 **`/Users/gaohaizhen/Desktop/boss/extension`**，不要改成 `boss-dev`。

## 2. 日常开发

```text
在 boss-dev 改代码
    → npm test && npm run smoke
    → ego 重新加载 boss-dev 扩展，F5 刷新 BOSS 页
    → 提交到 dev（或 dev 上的短命分支再合回 dev）
```

- 不要在 `/Users/gaohaizhen/Desktop/boss` 里改 `extension/`。
- 不要在 `main` 上直接 commit 功能。
- 开发中途不要改版本号。
- PR 请打到 `dev`。GitHub Actions（`.github/workflows/ci.yml`）会在每一份 PR 以及 `dev` / `main` 的 push 上自动跑 `npm test` 与 `npm run smoke`，不要求贡献者在 review 里自行跑测试。发版仍按本文第 4 节手动打 tag、上传 ZIP。
- 扩展重载之后，BOSS 列表页和消息页都要 F5。只重载扩展、不刷新页面，浮窗脚本和 content script 会仍是旧版本。

## 3. 合并进 main

开发完成、ego 验证通过后再合：

```bash
cd /Users/gaohaizhen/Desktop/boss
git checkout main
git pull origin main
git merge dev
git push origin main
```

有冲突在 `boss` 这份稳定目录解决，解决完再确认 Chrome 仍加载的是 `boss/extension`。

## 4. 发版（只在 main 上做）

`dev` 已经在 `main` 里之后：

1. 把 [AGENTS.md](../AGENTS.md) 里列出的全部版本号改成同一个新版本。
2. 在 `docs/releases/release-notes.json` 顶部增加 `vX.Y.Z`。
3. `npm test` 与 `npm run smoke`。
4. 打包，ZIP 根目录必须直接含 `manifest.json`：

```bash
rm -f dist/autocast-boss-haitou-vX.Y.Z.zip
(cd extension && zip -r -q ../dist/autocast-boss-haitou-vX.Y.Z.zip . -x '*.DS_Store')
```

5. 提交、推送 `main`。
6. 打 tag `vX.Y.Z`，创建 GitHub Release 并上传 ZIP。
7. `node scripts/sync-release-notes.mjs --tag vX.Y.Z --apply`
8. 把 `dev` 快进到 `main`，避免下次从旧 dev 开发：

```bash
cd /Users/gaohaizhen/Desktop/boss-dev
git fetch origin
git merge --ff-only origin/main
git push origin dev
```

9. Chrome 加载的是 `boss`：在 `chrome://extensions` 点「重新加载」，再 F5 BOSS 页。ego 继续加载 `boss-dev`。

Commit 标题、Release 中文正文格式见 [RELEASE_PROCESS.md](./RELEASE_PROCESS.md)。

## 5. 版本号漏改会怎样

- 面板 `BHT_UI_VERSION` 和后台 `manifest.version` 不一致 → 「扩展代码版本不一致，已停止投递」。
- content script 与后台不一致 → 扫描/投递被拒绝或注入失败。
- 只重载扩展、不 F5 → 浮窗提示「海投助手需刷新」或 iframe 仍带旧的 `v=`。

所以发版检查清单就是：源码、Manifest、面板、content、浮窗宿主、测试桩、release-notes、ZIP 名、tag、Release 标题，全部同一版本。
