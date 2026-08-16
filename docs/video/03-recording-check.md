# AutoCast-Boss海投助手 · 录屏演练清单（Recoding Check）

> 用途：正式录屏前，在 ego-browser 中用测试号完整演练一遍，确认分镜每一步可行、节奏正确。
> 演练时同步截图/记录每步的选择器与预期结果；正式录制时照此执行。

## 前置条件

- [ ] ego-browser（Profile: cjy）已加载 `extension/` 目录（开发者模式 → 加载未打包的扩展程序）
- [ ] BOSS 直聘测试号已登录（`https://www.zhipin.com/web/geek/jobs`）
- [ ] 职位列表有真实岗位数据（测试号可正常浏览）
- [ ] 录屏软件就绪（窗口录制 ego lite 窗口，1920 宽）

## 关键选择器速查（来自源码）

| 元素 | 选择器 / 位置 |
|---|---|
| 悬浮按钮 | `#bht-fab`（zhipin 页面右下角） |
| 面板容器 | `#bht-panel`（内含 `#bht-frame` iframe） |
| 面板标签 | `button[data-tab="filter/message/resume/history/settings/task"]` |
| 扫描预览 | `#btnPreview` |
| 批量投递 | `#btnStart` |
| 投递一份 | `#btnTestOne` |
| 页面诊断 | `#btnDiagnose` |
| 暂停/继续/跳过/停止 | `#btnPause` `#btnResume` `#btnSkip` `#btnStop` |
| 复制/清空日志 | `#btnCopyLogs` `#btnClearLogs` |
| 筛选保存 | `#btnSaveFilter` |
| 消息保存 | `#btnSaveMessage`（`#btnAddSeg` 加段） |
| 简历保存 | `#btnSaveResume`（`#btnAddProfile` 加方案） |
| 设置保存 | `#btnSaveSettings` |

### 表单字段 ID（sidepanel/index.html）

| 页 | 字段 | ID |
|---|---|---|
| 筛选 | 职位名称 OR/AND/NOT | `#titleOr` `#titleAnd` `#titleNot`（+`#titleOrEnabled` 等开关） |
| 筛选 | 公司 OR/NOT | `#companyOr` `#companyNot` |
| 筛选 | JD OR/AND/NOT | `#jdOr` `#jdAnd` `#jdNot` |
| 筛选 | 地点包含/排除/模式 | `#locInclude` `#locExclude` `#locMode` |
| 筛选 | 薪资下限/上限 | `#salaryMin` `#salaryMax` |
| 筛选 | HR 活跃 | `#activeWithin` |
| 筛选 | 黑/白名单 | `#blacklist` `#whitelist` `#whitelistOnly` |
| 筛选 | 排除猎头/外包 | `#excludeHunter` `#excludeOutsource` |
| 消息 | 消息段列表 | `#segments`（段内输入框在 JS 中动态生成） |
| 消息 | 发送模式 | `#messageMode` |
| 消息 | 相似度阈值 | `#similarityThreshold` |
| 简历 | 方案名/图片 | `#profileName` `#imageFiles` `#imagePreview` |
| 简历 | 图片简历开关 | `#autoSendImageResume` |
| 简历 | BOSS发简历开关 | `#autoSendAttachmentResume` |
| 简历 | 发送时机 | `#resumeSendTiming` |
| 简历 | 绑定列表 | `#bindingList` |
| 设置 | 本次上限/每日上限 | `#taskMaxCommunicate` `#dailyMaxCommunicate` |
| 设置 | 同公司每天最多 | `#companyDailyMax` |
| 设置 | 同HR冷却天数 | `#bossCooldownDays` |
| 设置 | 连续失败暂停 | `#consecutiveFailPause` |
| 设置 | 同一职位永不重复 | `#neverRepeatJob` |
| 设置 | 自动分屏 | `#splitViewEnabled` |
| 任务 | 预览列表/日志/计数 | `#previewList` `#logList` `#taskCounters` `#summaryBox` |
| 任务 | 全选通过项 | `#selectAllPass` |

> 注意：面板是 iframe（`#bht-frame`），自动化操作需先切入 iframe 上下文。

## 演练步骤（对应分镜 01-script.md）

### A. 安装段（分镜 3）
- [ ] 打开 `chrome://extensions`，确认 AutoCast-Boss海投助手 已加载（版本 1.7.3）
- [ ] 打开 `https://www.zhipin.com/web/geek/jobs`，F5 刷新
- [ ] 页面右下角出现 `#bht-fab` 悬浮按钮
- [ ] 点击悬浮按钮 → 面板展开，显示 6 个标签：任务/筛选/消息/简历/记录/设置

### B. 筛选页（分镜 4）
- [ ] 切到「筛选」tab
- [ ] 职位名称 OR：`大模型, Agent`；AND：`AI`
- [ ] 职位排除 NOT：`外包, 驻场, 代招`
- [ ] 公司排除 NOT：`人力, 咨询`
- [ ] 最低月薪：`15000`
- [ ] 地点包含：`广州`
- [ ] HR 活跃：一周内
- [ ] 悬停 `i` 说明图标确认气泡可用
- [ ] 点「保存筛选」，确认保存成功提示

### C. 消息页（分镜 5）
- [ ] 切到「消息」tab
- [ ] 第 1 段模板含 `{HR称呼}` `{职位名称}`，第 2 段含 `{匹配技能}` `{公司名称}`
- [ ] 发送模式：自动识别（推荐）
- [ ] 点「保存消息」

### D. 简历页（分镜 5）
- [ ] 切到「简历」tab
- [ ] 开启「自动发送图片简历」（如测试号有图片）或「自动点击 BOSS 发简历」
- [ ] 点「保存简历」

### E. 设置页（分镜 7）
- [ ] 切到「设置」tab
- [ ] 本次最多沟通：`3`（演练/录制用低值）
- [ ] 连续失败暂停：`3`
- [ ] 点「保存设置」

### F. 任务页核心演示（分镜 6-7）
- [ ] 切到「任务」tab
- [ ] 点「扫描预览」→ 列表显示 ✓通过 / ✗排除+原因
- [ ] 点「全选通过项」
- [ ] 点「投递一份」→ 自动左右分屏（左：职位列表；右：消息中心）
- [ ] 聊天页出现本人新消息（真实发送成功回执）
- [ ] 任务页显示单条结果（成功/跳过/失败）
- [ ] 点「批量投递」→ 日志滚动，逐岗处理
- [ ] 任务完成/停止后汇报：成功 X / 跳过 X / 失败 X / 已处理 X

### G. 收尾（分镜 8）
- [ ] 切回「设置」页展示安全项（每日上限、同公司上限、冷却）
- [ ] 关面板、清理状态（如需重演：清空记录 `#btnClearHistory`）

## 演练记录

| 步骤 | 结果 | 问题 / 备注 |
|---|---|---|
| A1 扩展已加载 | ☐ | |
| A2 悬浮按钮出现 | ☐ | |
| … | | |

## 录制注意事项

1. 鼠标悬停 0.5–1s 再点击，便于后期配音对齐。
2. 段与段之间静默 1–2s。
3. 「投递一份」真实发送画面停留 2–3s。
4. 聊天页 HR 名字/头像打码（剪辑时）。
5. 测试号发送上限调低（本次 3），避免打扰真实 HR。
