# Chrome 与 Edge 商店上架清单

更新时间：2026 年 7 月 30 日

## 结论

当前版本适合继续通过 GitHub Release 测试，不建议直接提交公开商店。

主要阻断项不是 Manifest V3 或打包格式，而是“代用户批量发送消息”：

- Chrome Web Store 不允许扩展在用户无法确认消息内容和目标收件人的情况下代用户发消息。
- Microsoft Edge Add-ons 明确限制自动生成垃圾式或未经请求消息、或代表用户执行平台操纵行为的机器人功能。

当前已有“扫描预览 → 勾选岗位 → 确认投递”，但送审前仍应增加逐条展开的最终确认页，显示每个目标招聘者、岗位、渲染后的完整消息和简历动作。Edge 的政策风险仍然很高，即使增加确认，也不能保证通过。

官方依据：

- [Chrome Web Store：Spam and Abuse](https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse)
- [Chrome Web Store：Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)
- [Chrome Web Store：Publish in the Chrome Web Store](https://developer.chrome.com/docs/webstore/publish)
- [Chrome Web Store：User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq/)
- [Microsoft Edge Add-ons：Developer policies](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)
- [Microsoft Edge Add-ons：Publish an extension](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)

## 送审前代码整改

- [ ] 增加最终确认页，逐条显示目标 HR、公司、岗位、完整消息和简历动作。
- [ ] 确认框默认不勾选；用户确认后才能执行。
- [ ] 为公开商店构建提供“辅助模式”：每个会话发送前再次确认，默认关闭连续自动投递。
- [ ] 清楚披露会读取 BOSS 职位页面、会话标题和近期本人消息。
- [x] 消息发送必须等待聊天页出现本人新消息后才返回成功。
- [x] 无法确认目标会话时暂停，不向未知会话发送。
- [x] 已移除受双向回复门禁限制的 BOSS“发简历”自动化；自动简历仅发送用户明确配置的图片。
- [x] 已删除未使用的 `alarms` 和 `notifications` 权限。
- [ ] 再审计 `tabs`、`scripting` 和 `unlimitedStorage`，准备可复现的权限说明视频。
- [ ] 增加首次运行的数据处理说明与明确同意。
- [ ] 检查 BOSS 直聘服务条款是否允许目标功能；商店通过不等于平台允许。

## 通用材料

- [x] Manifest V3。
- [x] 16、32、48、128、256 像素图标。
- [x] 中文隐私政策：`PRIVACY.md`。
- [x] GitHub 首页使用教程和参数说明。
- [x] 五张功能截图源文件。
- [ ] 商店专用截图，去除真实姓名、公司、聊天和简历内容。
- [ ] 公开支持邮箱。
- [ ] 隐私政策的稳定 HTTPS 地址。
- [ ] 版本说明、审核账号或“为何不能提供测试账号”的审核备注。
- [ ] 录制从安装、登录、扫描、确认到发送回执的审核视频。

## ZIP 包要求

商店包与 GitHub Release 安装包的目录结构不同。商店 ZIP 解压后，根目录必须直接出现：

```text
manifest.json
background/
content/
sidepanel/
shared/
...
```

不要让 ZIP 最外层再套一个 `extension/` 文件夹。不要包含 `.git`、测试脚本、源码地图、真实简历或调试日志。

## Chrome Web Store

1. 注册 Chrome Web Store 开发者账号并启用两步验证。
2. 上传根目录含 `manifest.json` 的 ZIP。
3. 填写 Store Listing：名称、简短说明、详细说明、类别、语言、截图和图标。
4. 在 Privacy 页声明单一用途、所有数据类型、主机权限和每项权限理由。
5. 填写隐私政策链接。
6. 在审核备注中提供完整测试步骤，说明需要用户自己的 BOSS 登录状态。
7. 先提交为非公开测试版本；确认审核反馈后再决定公开。

建议单一用途文案：

> 在用户明确选择并确认后，帮助用户筛选 BOSS 直聘职位、定位对应聊天，并发送用户预先配置的求职消息和简历。

权限说明：

| 权限 | 审核说明 |
|---|---|
| `storage` | 本地保存筛选、消息、队列、历史和简历方案 |
| `unlimitedStorage` | 用户可主动导入多张图片简历，普通配额可能不足 |
| `tabs` | 在 BOSS 职位页和聊天页之间建立并恢复用户确认的任务 |
| `scripting` | 仅在已声明的 BOSS 域名中恢复扩展页面脚本 |
| BOSS 主机权限 | 读取用户当前查看的职位信息、匹配目标会话并执行确认后的操作 |

## Microsoft Edge Add-ons

1. 在 Partner Center 注册开发者账号。
2. 创建新扩展并上传 ZIP。
3. 填写可见性和市场。
4. 在 Privacy 页填写单一用途、权限、远程代码、数据实践和隐私政策。
5. 为简体中文建立商店说明、关键词和截图。
6. 在认证备注中提供测试步骤和账号说明。
7. 提交认证；官方说明认证最长可能需要七个工作日。

Edge 的机器人政策与本项目核心自动模式直接冲突。合理顺序是先完成“每个会话发送前确认”的辅助模式，再向 Microsoft 支持确认这一使用场景是否允许，得到明确答复后才提交。

## 建议发布顺序

1. GitHub Release：继续真实环境验证发送回执和会话匹配。
2. Chrome 非公开测试：验证隐私披露、权限理由和逐条确认模式。
3. Chrome 公开版：根据审核意见决定。
4. Edge：先取得政策层面的明确反馈，再投入素材和认证成本。
