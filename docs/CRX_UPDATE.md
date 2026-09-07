# CRX 自动更新（自托管）

扩展以 CRX 形式安装后，Chrome 会自动轮询 `updates.xml` 并**静默升级**，用户无需重新加载、无需手动下载——这就是「无感更新」。

## 原理（30 秒版）

1. `manifest.json` 写死 `update_url`（本仓库固定地址：`https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/updates.xml`）。
2. Chrome 每隔 3~6 小时（或点「更新」按钮）请求该 XML。
3. XML 返回当前最新版本号 + CRX 下载地址（`release/download/vX.Y.Z/…crx`）。
4. Chrome 下载 CRX、校验**签名密钥**、替换安装——**扩展 ID 永远不变**（由密钥派生），设置/历史/简历全部保留。
5. 旧版 CRX 若未带 `update_url`（如首个迁移基线 v1.7.25），升级需手动装一次 v1.7.26 之后的 CRX，之后全自动。

## 扩展 ID 与密钥（重要）

- **ID = 签名公钥的 SHA256 前 32 位映射**。私钥不变 → ID 永远不变。
- 当前密钥与 ID：
  - 私钥：`~/.config/autocast-boss/crx-key.pem`（生成/查看：`node scripts/generate-crx-key.mjs`）
  - 扩展 ID：`gmplhopiejadfccbpofjoljdnejmnedn`
- **私钥绝不能提交仓库**；请自行备份（密码管理器/加密盘），CI 可放到 GitHub Actions Secret（`CRX_KEY`，内容为 PEM 文本）。
- **丢失私钥 = ID 变化 = 所有已装用户变成「全新安装」**（设置还在他们自己的机器上，但扩展不认了，需要导出/导入）。

## 安装一次（用户侧）

### 普通 Chromium 系浏览器（Edge / Brave / 其他 Chromium）
1. 打开 `chrome://extensions`，开启「开发人员模式」；
2. 把 `.crx` 文件拖入该页面 → 允许 → 完成（之后的更新全自动）。

### 个人 Chrome（macOS/Windows）
Chrome 114+ 禁止非商店 CRX 直接安装，需要一次性企业策略。macOS 示例（管理员权限）：
```bash
sudo defaults write /Library/Managed\ Preferences/com.google.Chrome ExtensionInstallSources -array "https://github.com/gstranded/*"
sudo defaults write /Library/Managed\ Preferences/com.google.Chrome ExtensionInstallForcelist -array "gmplhopiejadfccbpofjoljdnejmnedn;https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/updates.xml"
```
（Windows 对应注册表 `HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist`。）
> 或直接选择「加载已解压的扩展程序」指向解压目录：不会自动更新，但保留所有数据（推荐自用）。

### 从「文件夹安装」迁移到 CRX（一次性，约 1 分钟）
ID 不同会清空数据视图，所以按顺序：
1. 旧扩展面板「设置 → 导出 JSON」；
2. `chrome://extensions` 卸载旧扩展（旧 ID）；
3. 按上面方式安装 CRX（新 ID）；
4. 打开面板「设置 → 导入 JSON」→ 恢复设置/筛选/模板/简历/历史/统计；
5. 确认后把本机的 `.crx` 与 `updates.xml` 交给新安装即可。

## 发版时（开发者）
按 `docs/RELEASE_PROCESS.md` 第 4~6 步：`node scripts/build-crx.mjs` 生成 CRX 并刷新 `updates.xml`（与版本一起提交），Release 附上 CRX 文件。

## FAQ
- **多久能收到更新？** Chrome 每 3~6 小时随机检查；点 `chrome://extensions` 右上角「更新」可立即触发。
- **设置会丢吗？** 不会。ID 由密钥决定，升级只是替换文件，`chrome.storage.local` 保留。
- **ego 里的开发版？** ego 仍是「加载未打包」目录开发流程，与 CRX 自动更新互不影响；两边 ID 一致时（同一密钥/同一 `key` 字段）数据可共享。
- **多页签里的 BOSS 页？** 升级后老页面内容脚本会被替换，F5 一次或等下一批自动同步。
