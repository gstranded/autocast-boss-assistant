# 标准原因码（reasonCode）

> 供预览、日志、统计共用。V1 实现应稳定使用 code，文案可迭代。

## 筛选类

| code | 默认文案 |
|------|----------|
| FILTER_TITLE_OR_MISS | 职位名称未命中包含词 |
| FILTER_TITLE_AND_MISS | 职位名称未同时包含必需词 |
| FILTER_TITLE_NOT_HIT | 职位名称命中排除词 |
| FILTER_COMPANY_OR_MISS | 公司名称未命中包含词 |
| FILTER_COMPANY_NOT_HIT | 公司名称命中排除词 |
| FILTER_JD_OR_MISS | 职位描述未命中包含词 |
| FILTER_JD_AND_MISS | 职位描述未同时包含必需词 |
| FILTER_JD_NOT_HIT | 职位描述命中排除词 |
| FILTER_LOCATION_MISS | 工作地点不匹配 |
| FILTER_LOCATION_EXCLUDED | 工作地点命中排除 |
| FILTER_SALARY_LOW | 薪资低于最低要求 |
| FILTER_SALARY_HIGH | 薪资高于最高要求 |
| FILTER_EXPERIENCE | 工作经验不匹配 |
| FILTER_DEGREE | 学历要求不匹配 |
| FILTER_SCALE | 公司规模不匹配 |
| FILTER_ACTIVE | HR 活跃时间不满足 |
| FILTER_HUNTER | 识别为猎头岗位并已排除 |
| FILTER_OUTSOURCE | 识别为外包/驻场并已排除 |
| FILTER_AGE_POST | 职位发布时间过旧 |
| FILTER_BLACKLIST_COMPANY | 命中公司黑名单 |
| FILTER_WHITELIST_COMPANY | 未命中公司白名单 |
| FILTER_MISSING_FIELD | 关键字段缺失，无法判定 |

## 防重复 / 限流类

| code | 默认文案 |
|------|----------|
| DEDUP_JOB | 相同职位已处理，跳过 |
| DEDUP_BOSS | 相同 HR 在限制天数内已沟通 |
| DEDUP_COMPANY_DAILY | 达到同一公司当日投递上限 |
| DEDUP_SESSION_EXISTS | 已存在聊天会话 |
| DEDUP_TASK_ITEM | 本任务已处理该岗位 |
| DEDUP_SEGMENT | 消息段已发送（幂等） |
| DEDUP_RESUME | 简历已发送（幂等） |
| LIMIT_TASK_MAX | 达到本次沟通上限 |
| LIMIT_DAILY_MAX | 达到每日沟通上限 |
| LIMIT_INTERVAL_WAIT | 等待发送间隔 |
| LIMIT_PLATFORM | 检测到平台限制，已暂停 |

## 执行类

| code | 默认文案 |
|------|----------|
| EXEC_CHAT_TIMEOUT | 聊天窗口加载超时 |
| EXEC_CLICK_FAIL | 点击立即沟通失败 |
| EXEC_SEND_TEXT_FAIL | 文本消息发送失败 |
| EXEC_SEND_IMAGE_FAIL | 图片简历发送失败 |
| EXEC_SEND_FILE_FAIL | 附件简历发送失败 |
| EXEC_VAR_RENDER_FAIL | 模板变量渲染失败，已阻止发送 |
| EXEC_RESUME_MISSING | 绑定简历缺失文件 |
| EXEC_USER_SKIP | 用户跳过当前岗位 |
| EXEC_USER_PAUSE | 用户暂停任务 |
| EXEC_USER_STOP | 用户停止任务 |
| EXEC_CONSECUTIVE_FAIL | 连续失败达到阈值，自动暂停 |
| EXEC_UNKNOWN | 未知异常 |

## 成功类

| code | 默认文案 |
|------|----------|
| OK_PREVIEW_PASS | 预览通过，待投递 |
| OK_COMMUNICATED | 已发起沟通 |
| OK_TEXT_SENT | 文本段发送成功 |
| OK_IMAGE_SENT | 图片简历发送成功 |
| OK_FILE_SENT | 附件简历发送成功 |
| OK_ITEM_COMPLETED | 岗位处理完成 |
