# CSDN 技术文章规划 · AutoCast-Boss海投助手

> 状态：规划（小红书笔记 01 发布后执行）
> 平台：CSDN（技术博客，长文）
> 定位：小红书引流承接站 + 项目技术沉淀
> 风格：和小红书"玩梗+口语"不同，CSDN 面向开发者，用专业但带点个人色彩的语气；开头保留故事钩子，正文扎实

## 文章方向（候选，发布小红书后与用户确认选哪个）

### A. 产品实战型（推荐第一篇）
**标题候选：**
1. BOSS直聘一键海投助手开源：先筛选再批量打招呼，秋招人狂喜
2. 我写了个 BOSS直聘 海投浏览器扩展（开源）：筛选引擎 + 幂等投递 + 账号安全

**结构：**
1. 背景与痛点：手动海投的体力活与误投风险
2. 设计目标：先筛后投、可预览、可恢复、不封号
3. 核心机制
   - 筛选规则引擎：OR / AND / NOT 三段式（`docs/adr/0004-filter-rule-engine-and-or-not.md`）
   - 消息发送状态机与回执判定（`docs/adr/0003-message-send-modes-and-state-machine.md`）
   - 幂等去重与任务恢复（`docs/adr/0006-idempotent-dedup-control.md`、`0010-task-control-and-recovery.md`）
   - 限速与账号安全（`docs/adr/0008-rate-limit-and-account-safety.md`）
   - 简历投递策略（`docs/adr/0007-resume-delivery-strategy.md`）
   - 本地优先数据与隐私（`docs/adr/0002-local-first-data-and-privacy.md`）
4. 使用边界与合规提醒
5. 开源地址 + 安装方式 + 项目结构

### B. 技术深挖型（第二篇）
- MV3 扩展架构：background 队列 / content 页面识别 / sidepanel UI
- 与 BOSS 页面改版对抗的"页面诊断"设计
- 无服务器本地存储方案（indexedDB/extension storage）

## 写作要点

- 开头复用小红书的故事钩子，但展开技术细节
- 每个机制引用仓库里的 ADR 文档，保证准确
- 配图：架构图 + 功能截图（`docs/assets/screenshots/` 已有素材）
- 文末放 GitHub 链接 + Edge 商店链接 + 小红书账号引导（跨平台互引）
- 遵守 CSDN 原创声明，代码片段用真实实现

## 发布信息

- 平台：CSDN 博客（个人账号）
- 建议工作日晚上发布，标题带关键词利于搜索流量（"BOSS直聘 海投 浏览器扩展 开源"）
