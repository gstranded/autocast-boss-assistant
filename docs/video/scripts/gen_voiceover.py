#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为 20260816_175124.mp4 生成配音（macOS TTS）"""
import subprocess, os, json, sys

# 台词：{start(秒), text} —— 基于 OCR 画面时间线设计
LINES = [
    {"start": 0.5,  "text": "兄弟们，又到求职季了。"},
    {"start": 4.5,  "text": "每天打开 BOSS 直聘，刷岗位、点打招呼、等回复，点得手指头都麻了。"},
    {"start": 12.5, "text": "有没有一种可能，找工作，也能一键海投？"},
    {"start": 20.5, "text": "今天给大家介绍一个已经上架 Chrome 应用商店的免费扩展：AutoCast-Boss 海投助手。"},
    {"start": 30.0, "text": "打开应用商店，搜索 AutoCast，就出来了。"},
    {"start": 36.0, "text": "点进详情页，评分、功能介绍，一目了然，直接安装。"},
    {"start": 48.5, "text": "装好之后，打开 BOSS 直聘职位列表。"},
    {"start": 56.0, "text": "先扫码登录账号。"},
    {"start": 66.0, "text": "登录成功，推荐岗位就都出来了。"},
    {"start": 74.0, "text": "岗位很多，但一个个翻太累了。"},
    {"start": 100.0,"text": "想找什么方向，直接搜，比如后端开发。"},
    {"start": 110.0,"text": "相关岗位都出来了，Java 后端、Node.js、C#，应有尽有。"},
    {"start": 124.0,"text": "薪资、经验、地点，一眼看清。"},
    {"start": 169.0,"text": "简历也可以提前准备好，选好图片简历文件。"},
    {"start": 176.0,"text": "投之前，先看看岗位合不合适，别浪费打招呼的机会。"},
    {"start": 216.5,"text": "最关键的一步，点开页面右边的悬浮按钮。"},
    {"start": 223.5,"text": "这就是完整的控制面板，预览、可解释、不重复、可控。先筛后投，让海投真正省心。"},
]

VOICE = "Tingting"   # 大陆男声；备选：Eddy / Rocko / Tingting / Flo
RATE = 180       # 语速（字/分钟）

os.makedirs("/tmp/tts", exist_ok=True)
meta = []
for i, line in enumerate(LINES):
    out = f"/tmp/tts/seg_{i:02d}.aiff"
    subprocess.run(["say", "-v", VOICE, "-r", str(RATE), "-o", out, line["text"]], check=True)
    # 读时长
    info = subprocess.run(["afinfo", out], capture_output=True, text=True).stdout
    dur = 0.0
    for ln in info.splitlines():
        if "estimated duration" in ln:
            dur = float(ln.split(":")[1].strip().split()[0])
    meta.append({"i": i, "start": line["start"], "text": line["text"], "dur": round(dur, 2)})
    print(f"seg {i:02d} dur={dur:.2f}s start={line['start']}s: {line['text'][:30]}")

# 检查重叠
overlap = []
for i in range(len(meta) - 1):
    end = meta[i]["start"] + meta[i]["dur"]
    if end > meta[i + 1]["start"]:
        overlap.append((meta[i]["i"], meta[i + 1]["i"], round(end - meta[i + 1]["start"], 2)))
if overlap:
    print("WARN overlaps:", overlap)
with open("/tmp/tts/meta.json", "w") as f:
    json.dump(meta, f, ensure_ascii=False, indent=1)
print("done", len(meta), "segments")
