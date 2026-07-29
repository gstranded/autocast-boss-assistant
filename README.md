<p align="center">
  <img src="https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/logo.svg" alt="Boss HaiTou Assistant Logo" width="128" />
</p>

<h1 align="center">Boss 海投助手</h1>

<p align="center">
  <b>投递前可预览 · 筛选原因可解释 · 消息不重复 · 简历不发错 · 任务随时可控</b>
</p>

<p align="center">
  面向 <a href="https://www.zhipin.com/">BOSS 直聘</a> 求职者的 Chrome / Edge MV3 浏览器扩展
</p>

<p align="center">
  <a href="#-快速开始"><img src="https://img.shields.io/badge/快速开始-5%20min-blue?style=for-the-badge" alt="Quick Start" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" /></a>
  <a href="https://github.com/gstranded/boss-haitou-assistant/releases"><img src="https://img.shields.io/github/v/release/gstranded/boss-haitou-assistant?style=for-the-badge" alt="Release" /></a>
  <a href="#-兼容性"><img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Browser" /></a>
</p>

<p align="center">
  <a href="README.md"><b>简体中文</b></a> ·
  <a href="README_EN.md">English</a>
</p>

---

## ✨ 为什么做这个扩展？

公开的 BOSS 海投类工具已经很多，但真正让人难受的通常不是“点得不够快”，而是：

- 规则一配错就**批量误投**
- 原生打招呼 + 插件消息**重复**
- 多方向求职时**简历发错**
- 中断后**无法恢复**，跳过原因不透明

Boss 海投助手把差异化放在可靠性与可控性上，而不是极限自动点击。

---

## 🖼️ 界面导览（核心功能）

### 1) 任务页：预览门禁 + 可控投递

先扫描，再确认，最后投递。每条岗位都能看到**通过 / 跳过原因**。

![任务页截图](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/01-task.png)

**核心点**
- 扫描预览汇总（扫描数 / 通过数 / 排除原因）
- 勾选将投递岗位后，才允许「确认投递」
- 暂停 / 继续 / 跳过当前 / 停止
- 实时日志可追踪
- 页面诊断：检查当前 BOSS 页选择器是否可用

### 2) 筛选页：AND / OR / NOT 可解释规则

职位、公司、JD、地点分字段配置，不再只有一个关键词框。

![筛选页截图](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/02-filter.png)

**核心点**
- 职位名 OR / AND / NOT
- 地点包含 / 排除 + 精确或包含匹配
- 薪资区间、HR 活跃、猎头 / 外包识别
- 公司黑白名单

### 3) 消息页：多段发送 + 原生打招呼去重

默认「自动识别」模式，避免和 BOSS 原生打招呼语重复。

![消息页截图](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/03-message.png)

**核心点**
- 三种模式：原生补充 / 全插件发送 / 自动识别（默认）
- 多段消息启停、模板变量
- 相似度去重 + 幂等键，刷新重试不重发

### 4) 简历页：多方案切换 + 规则绑定

不同方向用不同简历，避免“一张简历打天下”。

![简历页截图](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/04-resume.png)

**核心点**
- 多求职方案（图片简历 / 附件简历）
- 设默认、切换编辑、删除
- 关键词绑定规则（如 `LLM/Agent → AI 方案`）
- 图片与附件独立开关

### 5) 设置页：频率限制与本地配置

把账号安全边界做成一等功能。

![设置页截图](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/05-settings.png)

**核心点**
- 本次 / 每日 / 同公司上限
- 同 HR 冷却天数
- 配置导入导出（JSON，默认本地存储）

---

## 🚀 快速开始

> 和大多数开源 Chrome 扩展一样：下载源码或 Release 包后，用开发者模式「加载已解压的扩展程序」。

### 方式 A：从 Release 安装（推荐）

1. 打开 [Releases](https://github.com/gstranded/boss-haitou-assistant/releases)
2. 下载最新的 `boss-haitou-assistant-vX.Y.Z.zip`
3. 解压到任意目录（例如 `D:\boss-haitou-assistant`）
4. 打开 Chrome / Edge 扩展管理页：
   - Chrome：`chrome://extensions`
   - Edge：`edge://extensions`
5. 打开右上角 **开发者模式**
6. 点击 **加载已解压的扩展程序**
7. 选择解压后的 **`extension`** 目录
8. 点击工具栏图标打开侧栏
9. 打开 [BOSS 直聘职位列表页](https://www.zhipin.com/web/geek/jobs) 并登录后使用

### 方式 B：从源码安装

```bash
git clone https://github.com/gstranded/boss-haitou-assistant.git
cd boss-haitou-assistant
```

然后在扩展管理页加载项目中的 `extension/` 目录（同上第 4-9 步）。

### 30 秒上手流程

1. 在侧栏配置 **筛选 / 消息 / 简历 / 频率上限**
2. 打开 BOSS 职位列表页
3. 点击 **扫描预览**
4. 核对将投递岗位与跳过原因
5. 点击 **确认投递**
6. 可随时暂停、跳过或停止

---

## 📦 项目结构

```text
boss-haitou-assistant/
├── extension/                 # 可直接加载的扩展根目录
│   ├── manifest.json          # MV3 清单
│   ├── background/            # 任务调度 / 配置中心
│   ├── content/               # BOSS 页面适配
│   ├── sidepanel/             # 侧栏 UI
│   ├── shared/                # 规则、去重、模板等纯逻辑
│   ├── assets/icons/          # 扩展图标
│   └── _locales/              # 扩展多语言（zh_CN / en）
├── docs/
│   ├── assets/screenshots/    # README 截图
│   ├── requirements/          # PRD / FRS / NFR
│   └── adr/                   # 架构决策记录
├── scripts/                   # 冒烟测试等脚本
├── README.md                  # 中文文档（默认）
└── README_EN.md               # English docs
```

---

## ✅ 功能清单（V1）

| 模块 | 能力 |
|------|------|
| 筛选引擎 | 职位/公司/JD/地点 AND·OR·NOT，薪资、活跃、猎头/外包、黑白名单 |
| 预览门禁 | 扫描汇总 + 逐岗原因，确认后才发送 |
| 多段消息 | 自动识别去重、模板变量、状态机、幂等 |
| 多简历方案 | 多档案切换、关键词绑定、图片/附件独立开关 |
| 防重复 | 职位 / HR / 公司三级 + 历史记录 |
| 任务控制 | 开始确认、暂停、继续、停止、跳过、检查点恢复 |
| 限流安全 | 本次/每日/同公司上限，连续失败自动暂停 |
| 本地优先 | 配置与简历默认本地保存，支持 JSON 导入导出 |

---

## 🧪 本地自检

```bash
npm test
# 或
node scripts/smoke-test.mjs
```

---

## 📚 文档

- [产品需求 PRD](docs/requirements/PRD.md)
- [功能规格 FRS](docs/requirements/FRS.md)
- [非功能需求 NFR](docs/requirements/NFR.md)
- [架构决策 ADR](docs/adr/README.md)
- [原因码表](docs/requirements/reason-codes.md)

---

## 🌐 兼容性

- 浏览器：Chromium 内核（Chrome / Edge）最新两个大版本
- 平台：BOSS 直聘 Web（`*.zhipin.com`）
- Manifest：V3
- 扩展 UI 语言：简体中文（默认） / English（`_locales`）

---

## ⚠️ 使用边界

1. 本工具是**用户可控的辅助扩展**，不是“绕过平台风控”工具。
2. 请合理设置频率上限，遵守 BOSS 直聘平台规则与账号安全要求。
3. 简历与配置默认仅存本地；导出 JSON 请自行妥善保管。
4. BOSS 页面改版可能导致选择器失效，可用「页面诊断」快速确认。
5. 图片 / 附件自动上传依赖页面上传控件，失败时请手动补发。

---

## 🗺️ 路线图

- [x] V1：预览门禁、可解释筛选、多段去重、多简历方案、任务恢复
- [ ] V2：多套完整求职方案一键切换、漏斗统计、规则解释增强
- [ ] V2：AI 回复建议（生成 → 确认 → 发送，非默认全自动）
- [ ] 跟进提醒与一键操作

---

## 🤝 贡献

欢迎 Issue / PR：

1. Fork 本仓库
2. 创建特性分支
3. 提交改动
4. 发起 Pull Request

开发时请优先保证：
- 预览门禁不被破坏
- 跳过 / 失败有可读原因
- 不引入“绕过风控”类能力

---

## 📄 License

[MIT](LICENSE) © 2026 gstranded

---

<p align="center">
  如果这个项目对你有帮助，欢迎点一个 ⭐ Star
</p>