<p align="center">
  <img src="https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/logo.png" alt="AutoCast-Boss海投助手" width="96" />
  <h1 align="center">AutoCast-Boss海投助手</h1>
</p>

<p align="center">BOSS 直聘网页端「筛选 + 一键海投」助手：先按规则筛岗位，再自动批量打招呼、发简历，不用逐个手动点。</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/autocast-boss%E6%B5%B7%E6%8A%95%E5%8A%A9%E6%89%8B/dhkfdlpjdpbckibdfabbhccffecilhdb"><b>Chrome 商店安装</b></a> ·
  <a href="https://microsoftedge.microsoft.com/addons/detail/autocastboss%E6%B5%B7%E6%8A%95%E5%8A%A9%E6%89%8B/dgmfdkboghlfdcbgoapehjhjgmldnmod"><b>Edge 商店安装</b></a> ·
  <a href="https://github.com/gstranded/autocast-boss-assistant/releases">GitHub 下载</a> ·
  <a href="README_EN.md">English</a> ·
  <a href="PRIVACY.md">隐私政策</a> ·
  <a href="LICENSE">MIT License</a>
</p>

> 已上架 Chrome Web Store 与 Microsoft Edge Add-ons，可直接从商店安装。安装前请先阅读[「使用边界」](#使用边界)。

<br/>

## 效果预览

[<img src="https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/readme/hero.jpg" alt="效果预览" />](https://github.com/gstranded/autocast-boss-assistant)

*投递一份：右侧面板多段打招呼 + 图片简历，左侧职位列表保持不动（v1.7.10 起沟通动作在临时执行页完成，筛选状态零跳转）。*

<br/>

## 安装

### 从 Chrome 商店安装（推荐）

1. 打开 [AutoCast-Boss海投助手 - Chrome Web Store](https://chromewebstore.google.com/detail/autocast-boss%E6%B5%B7%E6%8A%95%E5%8A%A9%E6%89%8B/dhkfdlpjdpbckibdfabbhccffecilhdb)。
2. 点击「添加到 Chrome」。
3. 打开 [BOSS 直聘职位列表](https://www.zhipin.com/web/geek/jobs)，登录后刷新一次页面。
4. 点击页面右侧悬浮按钮打开面板。

### 从 Edge 商店安装

1. 打开 [AutoCast-Boss海投助手 - Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/autocastboss%E6%B5%B7%E6%8A%95%E5%8A%A9%E6%89%8B/dgmfdkboghlfdcbgoapehjhjgmldnmod)。
2. 点击「获取」。
3. 打开 [BOSS 直聘职位列表](https://www.zhipin.com/web/geek/jobs)，登录后刷新一次页面。
4. 点击页面右侧悬浮按钮打开面板。

### 从 GitHub Release 安装

1. 打开 [Releases](https://github.com/gstranded/autocast-boss-assistant/releases)，下载最新的 `autocast-boss-haitou-vX.Y.Z.zip`。
2. 解压 ZIP。
3. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
4. 开启“开发者模式”，点击“加载已解压的扩展程序”，选择解压后直接包含 `manifest.json` 的根目录。
5. 打开 [BOSS 直聘职位列表](https://www.zhipin.com/web/geek/jobs)，登录后刷新一次页面，点右侧悬浮按钮打开面板。

从源码安装时，克隆仓库后直接加载仓库里的 `extension/` 目录：

```bash
git clone https://github.com/gstranded/autocast-boss-assistant.git
cd autocast-boss-assistant
```

<br/>

## 界面总览

面板右上角可在白色 / 黑色主题间切换；字段或功能标题旁的 `i` 是说明入口；任务按钮按“扫描与确认 / 测试与诊断 / 运行控制”分组。

![任务页](https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/readme/panel-task.png)

## 任务页

| 按钮 | 作用 |
|---|---|
| 扫描预览 | 读取当前职位列表，运行全部筛选和防重复规则，不发送消息 |
| 页面诊断 | 检查当前页面类型、关键选择器和内容脚本状态 |
| 批量投递 | 对预览中已勾选的岗位建立队列，开始处理 |
| 投递一份 | 只取当前勾选的第一个通过岗位，验证完整流程 |
| 暂停 / 继续 | 安全步骤间暂停；从保存的游标恢复 |
| 跳过当前 | 标记当前岗位为跳过并继续下一个 |
| 停止 | 停止任务并汇报成功、跳过、失败、已处理数量 |

- 扫描预览会先保留当前可见岗位，再回到当前职位列表顶部，快速触达列表当前底部并约每 300 毫秒确认下一批岗位；连续稳定到底或达到 60 秒后，再对全部累计岗位统一筛选一次。扫描不再复制一个丢失 SPA 求职期望的临时页（v1.7.15）。
- 扫描批次只传输本批新增岗位；扫描期间使用轻量状态同步，不重复读取完整任务、历史、简历和日志。隐藏面板会暂停轮询，面板打开状态也不再跨 BOSS 标签共享（v1.7.14）。
- 扫描的 60 秒上限是采集硬截止，到时会立即筛选已收集岗位；“已到底”与“已超时”互斥记录，调试包会保留滚动元素、初始/最终高度和增长次数（v1.7.15）。
- 扫描只读取和筛选岗位，不会发起沟通。
- BOSS 列表卡不提供完整 HR 活跃度；启用活跃筛选时，预览不会把空值误报为“不满足”，投递前会在临时岗位详情页只读校验，符合后才点击沟通（v1.7.15）。
- 沟通动作在**不激活的临时执行标签页**完成，左侧职位列表保持只读——筛选、滚动位置、当前详情和页面实例都不会被跳转改写（v1.7.10）。
- 关闭 BOSS 自动招呼后平台没有「留在此页」按钮时，沟通成功后会自动恢复原职位列表并继续投递（v1.7.9）。

<br/>

## 筛选页

![筛选页](https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/readme/panel-filter.png)

### HR 活跃（多选）

可按 HR 最近活跃时间**多选**筛选，命中任意一项即通过：

| 选项 | 匹配 BOSS 标签 |
|---|---|
| 刚刚活跃 | 刚刚活跃 / 当前在线 / 在线 |
| 今日活跃 | 今日活跃 |
| 3 日内活跃 | 3 日内 / 两日内 / 昨日 |
| 本周活跃 | 本周 / 一周内 / 7 日内 |
| 本月活跃 | 本月 / 近 30 日 / 30 日内 |

选「不限」会清空其它选择；选了具体项则「不限」自动取消。旧版单选配置自动迁移。

### 职位与 JD

| 参数 | 作用 | 示例 |
|---|---|---|
| 职位名称：包含任意 OR | 命中任意一个词即可通过这一项；留空表示不限 | `Java, Go, 后端` |
| 职位名称：必须同时包含 AND | 必须命中全部词；留空表示不限 | `Agent, 大模型` |
| 职位名称：排除任意 NOT | 命中任意一个词就排除 | `外包, 驻场, 代招` |
| 公司包含 OR | 公司名命中任意一个词才通过；留空表示不限 | `字节, 腾讯` |
| 公司排除 NOT | 公司名命中任意一个词就排除 | `人力, 咨询` |
| JD 包含 OR | 职位描述命中任意一个词才通过；留空表示不限 | `LLM, RAG` |
| JD 必须 AND | 职位描述必须命中全部词 | `Python, Agent` |
| JD 排除 NOT | 职位描述命中任意一个词就排除 | `培训, 驻场` |

三类文本规则同时启用时，检查顺序为 `NOT → OR → AND`。关键词可用英文逗号、中文逗号、顿号、正斜杠、反斜杠或换行分隔；英文大小写不影响匹配。

**统一标准化**：职位、公司、JD、黑白名单按同一规则匹配——忽略英文大小写、全角/半角、空格、换行、连字符、下划线和常见中英文标点。因此 `AI Agent`、`aiagent`、`AI-Agent` 按同一词匹配；`C++`、`C#` 中有意义的符号仍保留（v1.7.13）。

### 地点、薪资与名单

| 参数 | 作用 | 留空时 |
|---|---|---|
| 地点包含 | 岗位地点至少命中一个目标词 | 不限制地点 |
| 地点排除 | 命中任意排除地点就跳过 | 不排除地点 |
| 地点匹配：包含 / 精确 | `广州` 可匹配 `广州·天河区`；精确要求规范化后完全相同 | — |
| 最低月薪（元） | 岗位薪资上限低于该值时排除 | 不设下限 |
| 最高月薪（元） | 岗位薪资下限高于该值时排除 | 不设上限 |
| 排除猎头 | 识别为猎头岗位时跳过 | 默认开启 |
| 排除外包/驻场 | 识别为外包或驻场时跳过 | 默认开启 |
| 公司黑名单 / 白名单 | 命中黑名单词排除；白名单记录优先公司 | — |
| 仅投白名单公司 | 开启后未命中白名单的公司全部跳过 | 关闭 |

薪资统一填写月薪金额，例如 `15000`，不要填写 `15K`。

<br/>

## 消息页

<table>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/readme/panel-message-1.png" alt="消息页（上）：BOSS 自动招呼联动" width="372" /></td>
    <td align="center"><img src="https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/readme/panel-message-2.png" alt="消息页（下）：消息段编辑器" width="372" /></td>
  </tr>
  <tr>
    <td align="center"><sub>消息页（上）：BOSS 自动招呼联动</sub></td>
    <td align="center"><sub>消息页（下）：消息段编辑器</sub></td>
  </tr>
</table>

### BOSS 自动招呼与插件消息

- 消息页会同步 BOSS 账号真实的自动招呼开关和当前话术；**建议关闭 BOSS 自动招呼**，由插件统一控制发送顺序。
- 面板开关修改的是 BOSS 账号全局设置，必须二次确认；修改后会立即回读，只有状态一致才提示成功。
- BOSS 当前话术可以直接在插件中编辑；保存后会创建或更新自定义模板、设为当前话术，并再次回读确认。
- 每个消息段可标记为「招呼」或「补充」，并可用总开关关闭插件的全部文字消息。
- BOSS 自动招呼开启且平台确认已发送时，插件跳过所有「招呼」段，仅发送「补充」段；关闭时按顺序发送两类消息（v1.7.7+）。
- 平台回执和账号状态都无法确认时，插件会等待新的本人消息气泡；仍无法确认就安全暂停，不会冒险重复发送。

面板中的「预计发送顺序」会实时展示最终由 BOSS 和插件分别发送什么。

### 消息段与变量

| 变量 | 替换内容 |
|---|---|
| `{HR称呼}` | HR 名称；无法识别时使用 `HR` |
| `{职位名称}` | 当前岗位名称 |
| `{公司名称}` | 当前公司名称 |
| `{匹配技能}` | 扫描阶段识别到的匹配技能 |
| `{工作城市}` | 当前岗位城市或地点 |

- 每一段可单独启用、删除、选角色（「招呼」/「补充」）；发送顺序就是页面中的段落顺序。
- 同一岗位的同一段发送成功后会记录幂等键，刷新或恢复任务不会重复发送。
- 变量无法解析时该消息段不会盲目发送，日志会显示失败原因。
- 消息输入采用 **1.8 秒空闲防抖**并识别中文输入法组合态：拼音尚未上屏时不保存、不刷新、不重建输入框，也不会弹保存提示（v1.7.12）。

<br/>

## 简历页

![简历页](https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/readme/panel-resume.png)

| 参数 | 作用 |
|---|---|
| 自动发送图片简历 | 依次发送当前方案中的图片（源文件单张 ≤ 8 MB，导入后自动压缩） |
| 发送时机 | 文本发送完成后立即发送（推荐）/ 仅手动 |
| 方案名称 | 区分不同方向，例如“广州 AI 岗” |
| 图片简历 | 可多选；按页面显示顺序发送；**点击缩略图全屏预览**（多图可 ← → 切换，Esc 关闭） |
| 设为默认 | 没有绑定规则命中时使用该方案 |
| 删除方案 | 删除当前方案；至少保留一个可用方案 |
| 绑定规则 | 关键词命中职位名/JD → 用绑定方案；优先级数字越小越先判断 |

> 插件**不会自动点击 BOSS 聊天页的「发简历」按钮**——该按钮通常需要招聘者先回复、形成双向沟通后才可用（v1.7.11 起移除该自动化，避免把平台门禁误判成失败）。需要自动随消息发送简历时，请配置图片简历。

<br/>

## 设置页

![设置页](https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/readme/panel-settings.png)

| 参数 | 默认值 | 作用 |
|---|---|---:|---|
| 投递间隔（秒） | `5` | 每投完一份后的基准等待；实际等待在设定值 **±1 秒**内随机（设 5 → 实际 4~6 秒），降低机械节奏 |
| 本次最多沟通 | `30` | 当前任务允许成功创建沟通的最大岗位数 |
| 每日最多沟通 | `80` | 当天累计沟通上限 |
| 同公司每天最多 | `3` | 同一公司当天的沟通上限 |
| 同 HR 冷却天数 | `30` | 冷却期内不再联系同一 HR；填 `0` 表示不冷却 |
| 连续失败暂停 | `3` | 连续失败达到该次数后自动暂停，等待人工检查 |
| 同一职位永不重复 | 开启 | 已投递职位以后不再进入队列 |
| 开始投递时自动左右分屏 | 开启 | 职位列表窗口在左侧，消息中心在右侧；屏幕空间不足时回退为普通标签页 |
| 详细调试日志 | 关闭 | 记录页面事件级日志，排障时开启 |

“导出 JSON”会导出筛选、消息、设置和简历方案；“导入 JSON”恢复这些配置。导出文件可能包含图片简历数据，不要公开上传。

<br/>

## 记录页

![记录页](https://raw.githubusercontent.com/gstranded/autocast-boss-assistant/main/docs/assets/readme/panel-history.png)

投递记录支持筛选、导出、清空；任务停止或完成时，面板会汇报 `成功 / 跳过 / 失败 / 已处理`。

<br/>

## 第一次使用

1. 在“筛选”页填写目标职位、地点、薪资和排除条件（HR 活跃可多选）。
2. 在“消息”页选择发送模式，检查每一段文字（建议关闭 BOSS 自动招呼）。
3. 在“简历”页建立图片简历方案，并检查发送时机。
4. 在“设置”页把本次上限先改为 `1`。
5. 回到“任务”页，点击“扫描预览”。
6. 检查通过岗位、排除原因和勾选范围。
7. 点击“投递一份”，确认打开了正确的聊天、消息确实发出、简历状态正确。
8. 测试通过后再提高上限，重新扫描并点击“批量投递”。

<br/>

## 常见问题

### 面板显示“未连接页面”

确认当前网址属于 `zhipin.com` 或 `bosszhipin.com`，然后按 `F5` 刷新。只关闭再打开面板不能恢复已经失效的内容脚本。

### 打开了职位，但没有切换到正确聊天

先点“页面诊断”，再复制日志。当前版本会按职位、公司和 HR 综合匹配会话；无法确认目标会话时会暂停，不会把消息发到未知会话。

### 日志显示消息已填入，但没有发送成功

插件只把“聊天页出现本人新消息”视为成功回执。超时会记为失败或暂停，不会把“点击过按钮”伪装成发送成功。

### 为什么没有自动点击 BOSS“发简历”

BOSS 通常要求招聘者先回复、形成双向沟通后才开放“发简历”。从 v1.7.11 起插件不再自动点击该按钮；如需自动随消息发送简历，请配置图片简历。

### 页面改版后全部扫描失败

运行“页面诊断”，把浏览器版本、扩展版本、当前页面 URL 和日志一起提交到 [Issues](https://github.com/gstranded/autocast-boss-assistant/issues)。

<br/>

## 数据与权限

- 配置、历史、任务状态和图片简历保存在浏览器本地扩展存储中。
- 扩展不提供自建服务器，不会把简历或聊天内容上传给作者。
- 扩展只声明 BOSS 相关域名访问权限。
- `tabs`、`scripting` 用于定位并恢复 BOSS 列表页和聊天页；`storage`、`unlimitedStorage` 用于本地配置、任务恢复和图片简历。
- 卸载扩展会删除浏览器管理的本地扩展数据。也可以先导出配置，再从扩展管理页移除扩展。

完整说明见 [隐私政策](PRIVACY.md)。

## 使用边界

1. 本项目与 BOSS 直聘无隶属或合作关系。
2. 用户必须在预览页确认岗位范围和消息内容，并对发送行为负责。
3. 请遵守目标网站条款、账号限制和当地法律，不要发送骚扰、欺诈或无关消息。
4. 自动化会带来误投、限流或封禁风险。建议先投递一份，并使用保守上限。
5. 已上架 [Chrome Web Store](https://chromewebstore.google.com/detail/autocast-boss%E6%B5%B7%E6%8A%95%E5%8A%A9%E6%89%8B/dhkfdlpjdpbckibdfabbhccffecilhdb) 与 [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/autocastboss%E6%B5%B7%E6%8A%95%E5%8A%A9%E6%89%8B/dgmfdkboghlfdcbgoapehjhjgmldnmod)。

## 开发与测试

```bash
npm test
npm run smoke
```

项目入口：

```text
extension/                 可直接加载的 MV3 扩展
├─ background/             队列、状态机、发送回执
├─ content/                BOSS 页面识别与交互
├─ sidepanel/              面板 UI
├─ shared/                 筛选、模板、去重、会话匹配
└─ manifest.json
```

发布流程见 [Release 说明维护](docs/RELEASE_PROCESS.md)。每个 GitHub Release 必须使用中文写明“本次更新”和“修复的问题”。

## License

[MIT](LICENSE) © 2026 gstranded
