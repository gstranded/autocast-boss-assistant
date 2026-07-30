import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const CATALOG_PATH = path.join(ROOT_DIR, 'docs', 'releases', 'release-notes.json');
const DEFAULT_REPO = 'gstranded/boss-haitou-assistant';
const DEFAULT_UPGRADE =
  '从旧版本升级后，请在扩展管理页重新加载扩展，再刷新已经打开的 BOSS 页面。原有本地配置会继续保留。';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const tagIndex = args.indexOf('--tag');
const selectedTag = tagIndex >= 0 ? args[tagIndex + 1] : '';
const repoIndex = args.indexOf('--repo');
const repo = repoIndex >= 0 ? args[repoIndex + 1] : DEFAULT_REPO;

if ((tagIndex >= 0 && !selectedTag) || (repoIndex >= 0 && !repo)) {
  console.error('用法：node scripts/sync-release-notes.mjs [--apply] [--tag v1.5.4] [--repo owner/repo]');
  process.exit(2);
}

function runGh(commandArgs, input) {
  const result = spawnSync('gh', commandArgs, {
    cwd: ROOT_DIR,
    input,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || `gh 退出码 ${result.status}`).trim());
  }
  return String(result.stdout || '');
}

function bodyFor(note) {
  const lines = [
    '## 本次更新',
    ...note.updates.map((item) => `- ${item}`),
    '',
    '## 修复的问题',
    ...note.fixes.map((item) => `- ${item}`),
    '',
    '## 升级说明',
    `- ${note.upgrade || DEFAULT_UPGRADE}`,
    ''
  ];
  return lines.join('\n');
}

function normalize(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
if (!Array.isArray(catalog.releases) || catalog.releases.length === 0) {
  throw new Error('Release 文案目录为空');
}

const notes = new Map();
for (const note of catalog.releases) {
  if (!note.tag || !note.title || !Array.isArray(note.updates) || !Array.isArray(note.fixes)) {
    throw new Error(`Release 文案格式不完整：${JSON.stringify(note)}`);
  }
  if (notes.has(note.tag)) throw new Error(`Release 文案标签重复：${note.tag}`);
  notes.set(note.tag, note);
}

if (selectedTag && !notes.has(selectedTag)) {
  throw new Error(`文案目录中没有 ${selectedTag}`);
}

const remoteReleases = JSON.parse(
  runGh(['api', `repos/${repo}/releases?per_page=100`, '-H', 'Accept: application/vnd.github+json'])
);
const remoteByTag = new Map(remoteReleases.map((release) => [release.tag_name, release]));
const targets = selectedTag ? [notes.get(selectedTag)] : catalog.releases;

if (!selectedTag) {
  const missingNotes = remoteReleases
    .map((release) => release.tag_name)
    .filter((tag) => !notes.has(tag));
  if (missingNotes.length) {
    throw new Error(`以下线上 Release 缺少中文文案：${missingNotes.join(', ')}`);
  }
}

let changed = 0;
let unchanged = 0;
let unpublished = 0;

for (const note of targets) {
  const remote = remoteByTag.get(note.tag);
  if (!remote) {
    console.log(`[未发布] ${note.tag}`);
    unpublished += 1;
    continue;
  }

  const desiredBody = bodyFor(note);
  const needsUpdate =
    normalize(remote.name) !== normalize(note.title) ||
    normalize(remote.body) !== normalize(desiredBody);

  if (!needsUpdate) {
    console.log(`[已一致] ${note.tag}`);
    unchanged += 1;
    continue;
  }

  changed += 1;
  if (!apply) {
    console.log(`[待更新] ${note.tag} -> ${note.title}`);
    continue;
  }

  const payload = JSON.stringify({
    name: note.title,
    body: desiredBody
  });
  runGh(
    [
      'api',
      '--method',
      'PATCH',
      `repos/${repo}/releases/${remote.id}`,
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'X-GitHub-Api-Version: 2022-11-28',
      '--input',
      '-'
    ],
    payload
  );
  console.log(`[已更新] ${note.tag} -> ${note.title}`);
}

console.log(
  `${apply ? '写入完成' : '检查完成'}：待更新/已更新 ${changed}，已一致 ${unchanged}，尚未发布 ${unpublished}`
);

if (!apply && changed > 0) {
  console.log('确认文案后运行：node scripts/sync-release-notes.mjs --apply');
}
