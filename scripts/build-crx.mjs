#!/usr/bin/env node
// 构建 CRX 安装包（用 Chromium/Chrome 官方打包器，产出 Chrome 100% 认可的 CRX3）并刷新 updates.xml。
// 用法：node scripts/build-crx.mjs [--dir extension] [--key <私钥.pem>] [--out dist]
// 私钥：默认 ~/.config/autocast-boss/crx-key.pem，或环境变量 CRX_KEY 指定。
// 打包器：环境变量 CHROME_BIN 指定，否则按顺序探测 ego lite / Google Chrome / Chromium / Edge / Brave。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const srcDir = path.resolve(ROOT, arg('--dir', 'extension'));
const keyPath = arg('--key', process.env.CRX_KEY || path.join(os.homedir(), '.config', 'autocast-boss', 'crx-key.pem'));
const outDir = path.resolve(ROOT, arg('--out', 'dist'));
const repo = 'gstranded/autocast-boss-assistant';

const CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/ego lite.app/Contents/MacOS/ego lite',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
].filter(Boolean);
const browser = CANDIDATES.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('未找到可用的 Chromium 打包器，请用环境变量 CHROME_BIN 指定');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
const version = manifest.version;
const crxFile = `update-channel-v${version}.crx`; // 自动更新协议专用文件名；用户安装包另装 zip
const crxPath = path.join(outDir, crxFile);
const crxUrl = `https://github.com/${repo}/releases/download/v${version}/${crxFile}`;
const updateUrl = `https://raw.githubusercontent.com/${repo}/main/updates.xml`;

if (!fs.existsSync(keyPath)) {
  console.error('未找到签名私钥：' + keyPath + '。先运行 node scripts/generate-crx-key.mjs');
  process.exit(1);
}

// 打包时确保 CRX 内 manifest 带 update_url（否则该版本永远收不到后续自动更新）。
// 从临时副本打包，不改动源目录。
let packDir = srcDir;
if (manifest.update_url !== updateUrl) {
  const tmpDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'crx-pack-'));
  fs.cpSync(srcDir, tmpDir, { recursive: true });
  const tmpManifest = path.join(tmpDir, 'manifest.json');
  const patched = JSON.parse(fs.readFileSync(tmpManifest, 'utf8'));
  patched.update_url = updateUrl;
  fs.writeFileSync(tmpManifest, JSON.stringify(patched, null, 2));
  packDir = tmpDir;
  console.log('⚠️  manifest 缺少 update_url，已在构建时注入：' + updateUrl);
}
if (!manifest.key) {
  console.log('ℹ️  manifest 未包含 "key"：CRX ID 由签名公钥派生（与密钥固定），建议按 generate-crx-key 输出补上（未打包安装也保持同 ID）。');
}

fs.mkdirSync(outDir, { recursive: true });
// Chrome 官方打包：-pack-extension 产出 <dir>.crx；-pack-extension-key 复用我们的私钥（ID 不变）
execFileSync(browser, ['--pack-extension=' + packDir, '--pack-extension-key=' + keyPath, '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'crx-profile-'))], { stdio: 'inherit' });
const produced = packDir + '.crx';
if (!fs.existsSync(produced)) {
  console.error('打包器未产出 CRX：' + produced);
  process.exit(1);
}
fs.renameSync(produced, crxPath);

// 从私钥派生扩展 ID（与 generate-crx-key.mjs 一致）
const pem = fs.readFileSync(keyPath, 'utf8');
const spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
const digest = crypto.createHash('sha256').update(spki).digest('hex').slice(0, 32);
const appId = digest.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

// 更新仓库根 updates.xml（update_url 固定指向它）
const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">',
  `  <app appid="${appId}">`,
  `    <updatecheck status="ok" codebase="${crxUrl}" version="${version}" />`,
  '  </app>',
  '</gupdate>',
  ''
].join('\n');
fs.writeFileSync(path.join(ROOT, 'updates.xml'), xml);

console.log('CRX 已生成：' + crxPath);
console.log('app id：  ' + appId);
console.log('下载地址：' + crxUrl);
console.log('updates.xml 已刷新（v' + version + '）');
