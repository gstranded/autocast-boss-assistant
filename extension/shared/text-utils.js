const GREETING_PREFIX = /^(您好|你好|hello|hi|hey)(?:[，,。.!！]+|(?=[\u4e00-\u9fff])|$)/i;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

export function normalizeText(input = '') {
  return String(input)
    .replace(EMOJI_RE, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[！]/g, '!')
    .replace(/[？]/g, '?')
    .replace(/[：]/g, ':')
    .replace(/[；]/g, ';')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/\s+/g, '')
    .replace(GREETING_PREFIX, '')
    .replace(/岗位/g, '职位')
    .replace(/该职位/g, '这个职位')
    .replace(/贵司|贵公司/g, '公司')
    .toLowerCase()
    .trim();
}

/**
 * 筛选专用标准化：统一全/半角、大小写、空白和装饰性分隔符。
 * 保留 + 与 #，避免把 C++ / C# 退化成普通的 C。
 */
export function normalizeMatchText(input = '') {
  return String(input || '')
    .normalize('NFKC')
    .replace(EMOJI_RE, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/[^\p{L}\p{N}+#]+/gu, '')
    .toLowerCase()
    .trim();
}

export function bigrams(s) {
  if (!s) return new Set();
  if (s.length < 2) return new Set([s]);
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

export function charSet(s) {
  return new Set(Array.from(s));
}

function lcsRatio(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return (2 * dp[m][n]) / (m + n);
}

function similarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length);
    return Math.max(0.86, ratio);
  }
  const bi = jaccard(bigrams(na), bigrams(nb));
  const ch = jaccard(charSet(na), charSet(nb));
  const lcs = lcsRatio(na, nb);
  return Math.max(bi, ch * 0.95, lcs);
}

export function isSimilar(a, b, threshold = 0.85) {
  return similarity(a, b) >= threshold;
}

export function parseKeywords(text = '') {
  return String(text || '')
    // 支持：换行 / 中英文逗号 / 顿号 / 分号 / 竖线 / 反斜杠 / 斜杠
    .split(/[\n,，、;；|\\/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomBetween(range) {
  if (Array.isArray(range)) {
    const [min, max] = range;
    return Math.floor(min + Math.random() * (max - min + 1));
  }
  return Number(range) || 0;
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function salaryScale(value, raw) {
  const n = Number(value);
  if (!Number.isFinite(n)) return n;
  if (/元?\/(?:小时|时)|时薪/.test(raw)) return Math.round(n * 8 * 22);
  if (/元?\/(?:天|日)|\/天|\/日/.test(raw)) return Math.round(n * 22);
  if (/[kK千]/.test(raw) || n < 1000) return n * 1000;
  return n;
}

/** 解析如 15-25K·14薪 / 8-12K / 400-450元/天 / 面议 */
export function parseSalaryRange(text = '') {
  const s = String(text).replace(/\s/g, '');
  if (!s || /面议|薪资面议/.test(s)) return { min: null, max: null, raw: s };
  const m = s.match(/(\d+(?:\.\d+)?)\s*[-~～—]\s*(\d+(?:\.\d+)?)/);
  if (m) {
    return {
      min: salaryScale(m[1], s),
      max: salaryScale(m[2], s),
      raw: s
    };
  }
  const single = s.match(/(\d+(?:\.\d+)?)(?:\s*[kK千]|元?\/(?:天|日|小时|时))/);
  if (single) {
    const v = salaryScale(single[1], s);
    return { min: v, max: v, raw: s };
  }
  return { min: null, max: null, raw: s };
}

export function includesKeyword(text, keyword) {
  if (!keyword) return false;
  const normalizedText = normalizeMatchText(text);
  const normalizedKeyword = normalizeMatchText(keyword);
  return Boolean(normalizedKeyword) && normalizedText.includes(normalizedKeyword);
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
