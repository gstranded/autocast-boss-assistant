import { REASON, reasonText } from './reason-codes.js';
import { includesKeyword } from './text-utils.js';

const VAR_RE = /\{([^}]+)\}/g;

const VAR_MAP = {
  HR称呼: (ctx) => ctx.hrName || ctx.bossName || 'HR',
  职位名称: (ctx) => ctx.title || '',
  公司名称: (ctx) => ctx.company || '',
  匹配技能: (ctx) => ctx.matchedSkills || ctx.skills || '',
  工作城市: (ctx) => ctx.city || ctx.location || ''
};

const TEMPLATE_VARIABLES = Object.freeze(Object.keys(VAR_MAP));

function describeMissingVariable(key) {
  if (!VAR_MAP[key]) {
    if (key === '职位信息') {
      return '消息模板中的变量「{职位信息}」不受支持，请到「消息」页改为「{职位名称}」';
    }
    return `消息模板中的变量「{${key}}」不受支持，请到「消息」页修改；可用变量：${TEMPLATE_VARIABLES.map((name) => `{${name}}`).join('、')}`;
  }
  return `消息模板中的变量「{${key}}」当前没有可替换内容，请到「消息」页检查`;
}

export function renderTemplate(text, ctx = {}, { failOnMissing = true } = {}) {
  let missing = [];
  const rendered = String(text || '').replace(VAR_RE, (_, rawKey) => {
    const key = String(rawKey).trim();
    const getter = VAR_MAP[key];
    if (!getter) {
      missing.push(key);
      return failOnMissing ? `{${key}}` : '';
    }
    const val = getter(ctx);
    if (val == null || val === '') {
      missing.push(key);
      return failOnMissing ? `{${key}}` : '';
    }
    return String(val);
  });

  if (failOnMissing && (missing.length || /\{[^}]+\}/.test(rendered))) {
    const details = Array.from(new Set(missing.map(describeMissingVariable)));
    return {
      ok: false,
      text: rendered,
      missing,
      reasonCodes: [REASON.EXEC_VAR_RENDER_FAIL],
      reasonTexts: [reasonText(REASON.EXEC_VAR_RENDER_FAIL, details.join('；'))]
    };
  }
  return { ok: true, text: rendered, missing: [], reasonCodes: [], reasonTexts: [] };
}

export function pickResumeProfile(job, resumes, bindings) {
  const profiles = resumes?.profiles || [];
  const defaultId = resumes?.defaultProfileId || profiles[0]?.id;
  const rules = (bindings?.rules || []).slice().sort((a, b) => (a.priority || 0) - (b.priority || 0));
  const blob = `${job.title || ''} ${job.jd || ''}`;
  for (const rule of rules) {
    const kws = rule.keywords || [];
    if (kws.some((k) => includesKeyword(blob, k))) {
      const profile = profiles.find((p) => p.id === rule.profileId);
      if (profile) return profile;
    }
  }
  return profiles.find((p) => p.id === defaultId) || profiles[0] || null;
}
