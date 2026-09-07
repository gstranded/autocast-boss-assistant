#!/usr/bin/env node
// 构建 CRX 安装包并刷新更新清单 update_url 指向的 updates.xml。
// 依赖：devDependency crx3（npm install 后即可）。
// 用法：node scripts/build-crx.mjs [--dir extension] [--key <私钥.pem>] [--out dist]
// 私钥：默认 ~/.config/autocast-boss/crx-key.pem，也可用环境变量 CRX_KEY 指定路径。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const writeCRX3File = require('crx3');

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

const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
const version = manifest.version;
const crxFile = `autocast-boss-haitou-v${version}.crx`;
const crxPath = path.join(outDir, crxFile);
const crxUrl = `https://github.com/${repo}/releases/download/v${version}/${crxFile}`;
const updateUrl = `https://raw.githubusercontent.com/${repo}/main/updates.xml`;

if (!fs.existsSync(keyPath)) {
  console.error('未找到签名私钥：' + keyPath + '。先运行 node scripts/generate-crx-key.mjs');
  process.exit(1);
}

if (manifest.update_url !== updateUrl) {
  console.warn('⚠️  当前 manifest.update_url 与更新清单地址不一致：' + String(manifest.update_url));
}
if (!manifest.key && !arg('--ignore-no-key', '')) {
  console.warn('⚠️  manifest 未包含 "key"：打包出的 CRX 仍会以签名公钥派生 ID，但建议按 generate-crx-key 的输出补上 "key"（未打包安装也保持同一 ID）。');
}

fs.mkdirSync(outDir, { recursive: true });
await writeCRX3File([srcDir], {
  keyPath,
  crxPath,
  appVersion: version,
  crxURL: crxUrl
});

// 从私钥派生扩展 ID（与 generate-crx-key.mjs 一致）
const idFromKeyPath = () => {
  const pem = fs.readFileSync(keyPath, 'utf8');
  const spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
  const digest = crypto.createHash('sha256').update(spki).digest('hex').slice(0, 32);
  return digest.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
};
const appId = idFromKeyPath();

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
console.log('updates.xml 已刷新（引导用户「检查更新」路径不变）');
