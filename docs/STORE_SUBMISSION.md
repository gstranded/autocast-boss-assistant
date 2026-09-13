# Chrome Web Store 上架指引

## 你需要做的（一次性，约 10 分钟）
1. 打开 https://chrome.google.com/webstore/devconsole 用你的 Google 账号登录；
2. 按提示注册开发者（**$5 一次性**，需支付验证；会要求填一个寄送地址，任意可收信的即可）；
3. 注册完成后 → 新建项目 → 上传 **`dist/autocast-store-vX.Y.Z.zip`**（商店专用包：已去除 key/update_url，含 256px 图标）；
4. 填写列表信息（下方素材已备好，可复制）。

## 列表信息素材
- **名称**：AutoCast-Boss海投助手
- **摘要**：BOSS 直聘一键海投：筛选岗位、批量打招呼、自动发简历。
- **详细说明**（中文）：
  > AutoCast-Boss海投助手是一款面向求职者的效率工具。功能：\n· 职位扫描与预览：按关键词/薪资/公司黑白名单等规则筛选；\n· 批量沟通：自动进入岗位详情发起沟通并发送配置好的消息与图片简历；\n· 定时投递：按工作日与时间窗自动暂停/恢复，避免超出预期时段；\n· 频率控制：单次/每日/公司/HR 维度上限，记录与统计可导出。\n所有数据仅保存在浏览器本地，详见隐私政策。
- **隐私政策 URL**：https://gstranded.github.io/autocast-boss-assistant/privacy/index.html（项目仓库托管）
- **截图**：1280×800 或 640×400 PNG ×（3 张，见 /tmp/store-screenshots/）
- **图标**：已包含在包内（128×128）
- **类别**：生产力（Productivity）；语言：简体中文
- **链接**：网站/支持 = GitHub 仓库 https://github.com/gstranded/autocast-boss-assistant

## 审核注意
- 权限说明已写入隐私政策；审核通常会要求说明 scripting/tabs 用途——按隐私政策「三、权限说明」作答即可；
- 首次审核一般 24 小时内（权限敏感时可能 2~3 天）；驳回按 feedback 修改重提即可；
- 通过后用户在 Chrome 商店页「添加至 Chrome」→ 即与牛客同款：无警告、开关正常、Google 自动更新。

## 上架后
- 商店版由 Google 更新；自托管 CRX/updates.xml 保留给 Edge/Brave/ego/Linux 用户；
- 商店版与签名版 ID 不同，老用户迁移：旧版「导出 JSON」→ 商店版「导入 JSON」。
