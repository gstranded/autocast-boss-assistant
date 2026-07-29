# ADR 索引（Architecture Decision Records）

本目录记录 Boss 海投助手的关键产品与技术决策。

## 格式说明

每条 ADR 包含：

- 状态：Proposed / Accepted / Deprecated / Superseded
- 背景、决策、备选方案、后果
- 关联需求（FR / NFR）

## 决策列表

| 编号 | 标题 | 状态 |
|------|------|------|
| [ADR-0001](./0001-record-architecture-decisions.md) | 采用 ADR 记录架构决策 | Accepted |
| [ADR-0002](./0002-local-first-data-and-privacy.md) | 本地优先存储与隐私默认 | Accepted |
| [ADR-0003](./0003-message-send-modes-and-state-machine.md) | 多段消息发送模式与状态机 | Accepted |
| [ADR-0004](./0004-filter-rule-engine-and-or-not.md) | 筛选规则引擎采用 AND/OR/NOT 分字段语义 | Accepted |
| [ADR-0005](./0005-preview-before-delivery.md) | 投递前预览优先于直接自动投递 | Accepted |
| [ADR-0006](./0006-idempotent-dedup-control.md) | 三级防重复与幂等控制 | Accepted |
| [ADR-0007](./0007-resume-delivery-strategy.md) | 图片/附件简历独立开关与绑定策略 | Accepted |
| [ADR-0008](./0008-rate-limit-and-account-safety.md) | 频率限制与账号安全边界 | Accepted |
| [ADR-0009](./0009-v1-no-complex-ai.md) | V1 不引入复杂 AI，优先确定性能力 | Accepted |
| [ADR-0010](./0010-task-control-and-recovery.md) | 任务控制与异常恢复机制 | Accepted |

## 新增 ADR 流程

1. 复制模板 `0000-template.md`
2. 顺序编号，文件名使用英文短横线
3. 在本索引表中登记
4. 相关 PRD/FRS 章节回链到该 ADR
