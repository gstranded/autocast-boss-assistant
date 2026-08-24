# GitHub Release 说明维护

## 功能版本与 Commit 约定

- 版本以完整、可验证的功能为单位：一个功能修好即可发一版；多个强关联改动形成同一闭环时可以合并为一版。
- 不把尚未完成或未验证的功能塞进 Release，也不把无关本地修改带入版本提交。
- Commit 标题使用 `type(scope): outcome`，正文至少包含 `Root cause / Implementation / Verification / Compatibility`。
- 删除或迁移功能时，正文必须说明旧配置如何处理、保留了哪些相邻能力，以及用户可见变化。
- 发布前必须确认源码版本、Manifest、面板版本、ZIP 文件名、标签和 Release 标题一致。

所有 Release 使用 UTF-8 中文，正文固定包含：

```markdown
## 本次更新
- 本版本新增或调整了什么

## 修复的问题
- 修复了什么问题，之前会造成什么结果

## 升级说明
- 用户升级后是否需要重新加载扩展或迁移配置
```

## 修改已有 Release

Release 文案统一维护在 `docs/releases/release-notes.json`。先检查差异：

```bash
node scripts/sync-release-notes.mjs
```

确认后写入 GitHub：

```bash
node scripts/sync-release-notes.mjs --apply
```

只处理一个版本：

```bash
node scripts/sync-release-notes.mjs --tag v1.5.4 --apply
```

脚本通过 Node.js 把 UTF-8 JSON 从标准输入交给 GitHub CLI，避免 Windows PowerShell、CMD 或旧脚本把中文按系统代码页传递后变成乱码。

## 发布新版本

1. 更新 `extension/manifest.json` 和 `package.json` 的版本号。
2. 在 `docs/releases/release-notes.json` 增加对应版本。
3. 运行 `npm test` 和 `npm run smoke`。
4. 打包扩展，ZIP 根目录必须直接包含 `manifest.json`。
5. 提交并推送代码。
6. 创建 Release 并上传 ZIP。
7. 运行同步脚本写入中文说明。
8. 打开 GitHub Release 页面复核标题、正文、附件和中文显示。

不要在 PowerShell 命令行参数中直接拼接长段中文 Release 文案，也不要继续使用仓库中旧的临时上传脚本。
