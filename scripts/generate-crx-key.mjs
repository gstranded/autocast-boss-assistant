#!/usr/bin/env node
// 生成 CRX 签名密钥对（一次性）：私钥保存在指定路径（勿提交仓库），
// 公钥（base64 DER SPKI）写入 manifest 的 "key" 字段 → 所有安装/更新共用同一个扩展 ID。
// 用法：node scripts/generate-crx-key.mjs [输出私钥路径]
// 输出： manifest key 字段值 与 该 key 对应的扩展 ID。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const outPath = process.argv[2] || path.join(os.homedir(), '.config', 'autocast-boss', 'crx-key.pem');

function idFromPublicKey(spkiDer) {
  const digest = crypto.createHash('sha256').update(spkiDer).digest('hex').slice(0, 32);
  return digest.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

if (fs.existsSync(outPath)) {
  const pem = fs.readFileSync(outPath, 'utf8');
  const pub = crypto.createPublicKey(pem);
  const spki = pub.export({ type: 'spki', format: 'der' });
  console.log('已存在密钥：' + outPath);
  console.log('manifest "key": ' + spki.toString('base64'));
  console.log('扩展 ID: ' + idFromPublicKey(spki));
  process.exit(0);
}

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const spki = publicKey.export({ type: 'spki', format: 'der' });
fs.chmodSync(outPath, 0o600);

console.log('私钥已保存：' + outPath + '（请务必备份！丢失=旧安装全部失效需要重装）');
console.log('manifest "key": ' + spki.toString('base64'));
console.log('扩展 ID: ' + idFromPublicKey(spki));
