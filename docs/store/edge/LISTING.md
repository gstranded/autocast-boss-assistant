# Edge 商店更新文案（AutoCast-Boss海投助手）

商店页：https://microsoftedge.microsoft.com/addons/detail/boss-%E6%B5%B7%E6%8A%95%E5%8A%A9%E6%89%8B/dgmfdkboghlfdcbgoapehjhjgmldnmod  
产品 ID：`dgmfdkboghlfdcbgoapehjhjgmldnmod`  
包：`dist/autocast-boss-haitou-v1.7.2.zip`  
商店图：`docs/store/edge/assets/`（按 Partner Center 尺寸出好，见下方对照）

不要新建扩展，只更新这一条 listing。

## 商店图上传对照

全部在 `docs/store/edge/assets/`。先删旧图，再传新图。

| Partner Center 栏 | 尺寸 | 上传这个文件 |
|---|---|---|
| Extension logo * | 300×300（1:1，最小 128） | `logo-300.png`（粉色公文包） |
| Small promotional tile | 440×280 | `promo-small-440x280.png` |
| Large promotional tile | 1400×560 | `promo-large-1400x560.png` |
| Screenshot 1 发送效果（最前） | **正好 1280×800** | `screenshot-01-send-1280x800.png` |
| Screenshot 2 任务/扫描预览 | 1280×800 | `screenshot-01-task-1280x800.png` |
| Screenshot 3 筛选 | 1280×800 | `screenshot-02-filter-1280x800.png` |
| Screenshot 4 消息（多段话术） | 1280×800 | `screenshot-03-message-1280x800.png` |
| Screenshot 5 简历设置 | 1280×800 | `screenshot-04-resume-1280x800.png` |

桌面可直接上传（像素已改好）：
- `/Users/gaohaizhen/Desktop/效果截图-1280x800.png`（1280×800）
- `/Users/gaohaizhen/Desktop/效果截图-640x400.png`（640×400）

不要传原图 `效果截图.png`，商店只收 **正好** 1280×800 或 640×400。

备用：`logo-512.png`；同名 `*-640x400.png`。

扩展工具栏图标已经打进 ZIP，不用另选。

## 搜索词

最多 7 个，每个最多 30 字符，全部加起来不超过 21 个英文单词。中文每条算 1 个词。

```text
AutoCast
Boss海投
BOSS直聘
求职助手
职位筛选
简历投递
海投助手
```

如果后台已经有「消息模板」，删掉它，换成 `AutoCast`。

## 名称

```text
AutoCast-Boss海投助手
```

## 简短说明

```text
BOSS 直聘一键海投。先筛选岗位，再自动批量打招呼、发简历，不用逐个手动点。
```

## 详细说明

```text
AutoCast-Boss海投助手帮你在 BOSS 直聘网页端一键海投：先按规则筛岗位，再自动批量沟通，不用一条条点「立即沟通」。

你先设好想投的职位、地点、薪资和排除词，插件会扫描当前列表，标出通过和跳过的原因。确认后点「批量投递」或「投递一份」，它会自动打开对应聊天、发送你写好的打招呼，并按设置发送简历。

适合不想逐个手动投、又希望先过滤一批岗位的求职者。

主要能力：
- 一键海投：扫描后批量打招呼，不用逐个手动点
- 岗位筛选：职位 / 公司 / JD / 地点，支持包含、必须、排除
- 扫描预览：投之前先看通过和排除原因
- 自动发消息：多段话术，自动识别是否已打过招呼
- 自动发简历：可点 BOSS「发简历」，或按方案发图片简历
- 随时可控：暂停、继续、跳过、停止，任务可恢复
- 数据在本地：筛选、话术、简历和记录保存在你的浏览器里

使用方法：
1. 安装后打开 BOSS 直聘职位列表并登录
2. 刷新页面，点右侧悬浮按钮
3. 填筛选条件和打招呼内容
4. 点「扫描预览」核对岗位
5. 点「投递一份」先试 1 个，再「批量投递」

请合理设置本次上限，遵守 BOSS 直聘使用规则，不要发送骚扰或无关消息。本扩展与 BOSS 直聘无官方合作。
```

## 本次更新说明（Notes for certification / What’s new）

```text
更新现有扩展，不是新产品。版本 1.7.2。

变化：
- 名称改为 AutoCast-Boss海投助手
- 更换粉色公文包图标
- 强调一键海投：先筛选，再自动批量投递

测试：
1. 打开 https://www.zhipin.com/web/geek/jobs 并登录
2. 刷新后点右侧悬浮按钮
3. 扫描预览，确认有通过/排除原因
4. 可用「投递一份」验证发送

无法提供公共测试账号，需要审核员自己的 BOSS 登录态。配置只保存在本机。
```

