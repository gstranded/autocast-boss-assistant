<p align="center">
  <img src="https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/logo.svg" alt="Boss HaiTou Assistant Logo" width="128" />
</p>

<h1 align="center">Boss HaiTou Assistant</h1>

<p align="center">
  <b>Preview before apply · Explainable filters · No duplicate messages · Correct resume · Controllable tasks</b>
</p>

<p align="center">
  A Chrome / Edge MV3 extension for job seekers on <a href="https://www.zhipin.com/">BOSS Zhipin</a>
</p>

<p align="center">
  <a href="#-quick-start"><img src="https://img.shields.io/badge/Quick%20Start-5%20min-blue?style=for-the-badge" alt="Quick Start" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License" /></a>
  <a href="https://github.com/gstranded/boss-haitou-assistant/releases"><img src="https://img.shields.io/github/v/release/gstranded/boss-haitou-assistant?style=for-the-badge" alt="Release" /></a>
  <a href="#-compatibility"><img src="https://img.shields.io/badge/Chrome%20%2F%20Edge-MV3-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Browser" /></a>
</p>

<p align="center">
  <a href="README.md">简体中文</a> ·
  <a href="README_EN.md"><b>English</b></a>
</p>

---

## ✨ Why this extension?

Many BOSS automation tools already exist. The painful problems are usually not “click speed”, but:

- Misconfigured rules causing **mass wrong applications**
- Native greeting + plugin greeting **duplication**
- **Wrong resume** for multi-track job hunting
- Interrupted tasks that **cannot recover**, with opaque skip reasons

Boss HaiTou Assistant optimizes for reliability and control—not reckless auto-clicking.

---

## 🖼️ UI Walkthrough

### 1) Task: preview gate + controllable delivery

Scan first, confirm second, deliver last. Every job shows pass/skip reasons. Starting a task arranges the job list and message center into left/right browser windows, with a normal-tab fallback when the display is too small.

![Task panel](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/01-task.png)

### 2) Filters: explainable AND / OR / NOT rules

Separate fields for title, company, JD, and location. Each keyword rule has its own enable switch, so a rule can be paused without deleting its contents. Combined text rules run in `NOT → OR → AND` order.

![Filter panel](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/02-filter.png)

### 3) Messages: multi-segment send + greeting dedup

Default auto-detect mode avoids repeating BOSS native greetings.

![Message panel](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/03-message.png)

### 4) Resumes: multi-profile switch + binding rules

Different tracks use different resumes.

![Resume panel](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/04-resume.png)

### 5) Settings: rate limits + local config

Safety limits are first-class features. The panel supports persistent light and dark themes, and the `i` controls beside features open contextual explanations on hover or click.

![Settings panel](https://raw.githubusercontent.com/gstranded/boss-haitou-assistant/main/docs/assets/screenshots/05-settings.png)

---

## 🚀 Quick Start

### Option A: Install from Release (recommended)

1. Open [Releases](https://github.com/gstranded/boss-haitou-assistant/releases)
2. Download `boss-haitou-assistant-vX.Y.Z.zip`
3. Unzip it
4. Open extension page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
5. Enable **Developer mode**
6. Click **Load unpacked**
7. Select the **`extension`** folder
8. Open the side panel from the toolbar icon
9. Open BOSS job list page and sign in

### Option B: Install from source

```bash
git clone https://github.com/gstranded/boss-haitou-assistant.git
cd boss-haitou-assistant
```

Then load the `extension/` folder as unpacked extension.

### 30-second workflow

1. Configure filters / messages / resumes / limits
2. Open BOSS job list
3. Click **Scan Preview**
4. Review pass/skip reasons
5. Click **Confirm & Start**
6. Pause / skip / stop anytime

---

## 📦 Project Structure

```text
boss-haitou-assistant/
├── extension/                 # Load this folder in Chrome/Edge
├── docs/                      # Screenshots, PRD, ADR
├── scripts/                   # Smoke tests
├── README.md                  # Chinese docs (default)
└── README_EN.md               # English docs
```

---

## ⚠️ Boundaries

1. This is a **user-controlled assistant**, not a bypass tool.
2. Keep conservative rate limits and follow platform rules.
3. Data is local-first; protect exported JSON carefully.
4. Site DOM changes may break selectors; use **Diagnose Page**.
5. Auto image/file upload depends on page file inputs.

---

## 📄 License

[MIT](LICENSE) © 2026 gstranded

---

<p align="center">
  If this project helps you, please leave a ⭐ Star
</p>
