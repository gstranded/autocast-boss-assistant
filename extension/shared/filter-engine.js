import { REASON, reasonText } from './reason-codes.js';
import { includesKeyword, normalizeText, parseSalaryRange } from './text-utils.js';

function evalTextRules(text, rules = {}, codes) {
  const value = text || '';
  const enabled = rules.enabled || {};
  const or = enabled.or === false ? [] : (rules.or || []);
  const and = enabled.and === false ? [] : (rules.and || []);
  const not = enabled.not === false ? [] : (rules.not || []);

  for (const k of not) {
    if (includesKeyword(value, k)) {
      return {
        pass: false,
        reasonCodes: [codes.not],
        reasonTexts: [reasonText(codes.not, k)],
        hits: { not: k }
      };
    }
  }

  if (or.length) {
    const hit = or.some((k) => includesKeyword(value, k));
    if (!hit) {
      return {
        pass: false,
        reasonCodes: [codes.or],
        reasonTexts: [reasonText(codes.or, or.join('/'))],
        hits: {}
      };
    }
  }

  if (and.length) {
    const miss = and.find((k) => !includesKeyword(value, k));
    if (miss) {
      return {
        pass: false,
        reasonCodes: [codes.and],
        reasonTexts: [reasonText(codes.and, miss)],
        hits: {}
      };
    }
  }

  return { pass: true, reasonCodes: [], reasonTexts: [], hits: {} };
}

function evalLocation(location, locationRules = {}) {
  const enabled = locationRules.enabled || {};
  const include = enabled.include === false ? [] : (locationRules.include || []);
  const exclude = enabled.exclude === false ? [] : (locationRules.exclude || []);
  const mode = locationRules.mode || 'contains';
  const loc = location || '';

  for (const k of exclude) {
    if (!k) continue;
    if (mode === 'exact' ? normalizeText(loc) === normalizeText(k) : includesKeyword(loc, k)) {
      return {
        pass: false,
        reasonCodes: [REASON.FILTER_LOCATION_EXCLUDED],
        reasonTexts: [reasonText(REASON.FILTER_LOCATION_EXCLUDED, k)]
      };
    }
  }

  if (include.length) {
    const ok = include.some((k) =>
      mode === 'exact' ? normalizeText(loc) === normalizeText(k) : includesKeyword(loc, k)
    );
    if (!ok) {
      return {
        pass: false,
        reasonCodes: [REASON.FILTER_LOCATION_MISS],
        reasonTexts: [reasonText(REASON.FILTER_LOCATION_MISS, loc || '空')]
      };
    }
  }
  return { pass: true, reasonCodes: [], reasonTexts: [] };
}

export function looksHunter(job) {
  if (job?.goldHunter === true || job?.goldHunter === 1) return true;
  const blob = `${job.hrName || ''} ${job.hrTitle || ''} ${job.company || ''}`;
  return /猎头/.test(blob);
}

function looksOutsource(job) {
  const blob = `${job.title || ''} ${job.company || ''} ${job.jd || ''}`;
  return /外包|驻场|外派|人力外包|IT外包/.test(blob);
}

// 数字越大越久。筛选项是单选上限：选「本周内」收下在线到本周。
const ACTIVE_RANK = {
  online: 0,
  just: 1,
  today: 2,
  '3d': 3,
  week: 4,
  '2w': 5,
  month: 6,
  '2m': 7,
  '3m': 8,
  '4m': 9,
  half: 10,
  year: 11
};

export const ACTIVE_CEILING_KEYS = ['online', 'just', 'today', '3d', 'week', '2w', 'month', 'half'];

export function classifyActive(activeText) {
  const t = String(activeText || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (/刚刚活跃/.test(t)) return 'just';
  if (/今日活跃/.test(t)) return 'today';
  if (/3日内活跃/.test(t)) return '3d';
  if (/\d+日前活跃/.test(t)) return '3d';
  if (/两周内活跃|(^|[^0-9])2周内活跃/.test(t)) return '2w';
  if (/本周活跃/.test(t)) return 'week';
  if (/本月活跃/.test(t)) return 'month';
  if (/(^|[^0-9])2月内活跃/.test(t)) return '2m';
  if (/(^|[^0-9])3月内活跃/.test(t)) return '3m';
  if (/(^|[^0-9])4月内活跃/.test(t)) return '4m';
  {
    // 其余「N月内活跃」：1月内→本月档；5月及以上→半年前档（此前只能匹配 2-4 月，
    // 5月内/6月内 等会落入「无法归类→恒不满足」，宽松筛选也被误拒）
    const monthMatch = t.match(/(\d+)月内活跃/);
    if (monthMatch) {
      const n = Number(monthMatch[1]);
      if (n === 1) return 'month';
      if (n >= 5) return 'half';
    }
  }
  if (/半年前活跃|半年内活跃/.test(t)) return 'half';
  if (/一年前活跃|1年前活跃/.test(t)) return 'year';
  if (/当前在线/.test(t) || /(^|[^0-9\u4e00-\u9fff])在线([^0-9\u4e00-\u9fff]|$)/.test(t)) return 'online';
  return '';
}

function coerceActiveKey(key) {
  if (ACTIVE_CEILING_KEYS.includes(key)) return key;
  if (key === '2m' || key === '3m' || key === '4m' || key === 'year') return 'half';
  return '';
}

export function normalizeActiveWithin(value) {
  const keys = Array.isArray(value) ? value : (value ? [value] : []);
  const coerced = keys.map(coerceActiveKey).filter(Boolean);
  if (!coerced.length) return [];
  coerced.sort((a, b) => ACTIVE_RANK[a] - ACTIVE_RANK[b]);
  return [coerced[coerced.length - 1]];
}

export function matchActive(activeText, activeWithin) {
  const selected = normalizeActiveWithin(activeWithin);
  if (!selected.length) return true;
  const ceiling = ACTIVE_RANK[selected[0]];
  if (!Number.isFinite(ceiling)) return true;
  const bucket = classifyActive(activeText);
  if (!bucket || !Number.isFinite(ACTIVE_RANK[bucket])) return false;
  return ACTIVE_RANK[bucket] <= ceiling;
}

/**
 * @param {object} job
 * @param {object} filters
 * @param {object} lists
 * @param {object} settings
 * @param {object} options
 */
export function evaluateJob(job, filters, lists = {}, settings = {}, options = {}) {
  const passReasons = [];
  let requiresActiveCheck = false;

  if (!job || !(job.title || job.jobId)) {
    return {
      decision: 'reject',
      reasonCodes: [REASON.FILTER_MISSING_FIELD],
      reasonTexts: [reasonText(REASON.FILTER_MISSING_FIELD)],
      passReasons: []
    };
  }

  const company = job.company || '';
  const black = lists.companyBlacklist || [];
  const white = lists.companyWhitelist || [];

  if (black.some((c) => includesKeyword(company, c) || normalizeText(company) === normalizeText(c))) {
    return {
      decision: 'reject',
      reasonCodes: [REASON.FILTER_BLACKLIST_COMPANY],
      reasonTexts: [reasonText(REASON.FILTER_BLACKLIST_COMPANY, company)],
      passReasons: []
    };
  }

  if (settings.whitelistOnly && white.length) {
    const ok = white.some((c) => includesKeyword(company, c) || normalizeText(company) === normalizeText(c));
    if (!ok) {
      return {
        decision: 'reject',
        reasonCodes: [REASON.FILTER_WHITELIST_COMPANY],
        reasonTexts: [reasonText(REASON.FILTER_WHITELIST_COMPANY, company)],
        passReasons: []
      };
    }
  }

  const checks = [
    evalTextRules(job.title, filters.title, {
      or: REASON.FILTER_TITLE_OR_MISS,
      and: REASON.FILTER_TITLE_AND_MISS,
      not: REASON.FILTER_TITLE_NOT_HIT
    }),
    evalTextRules(company, filters.company, {
      or: REASON.FILTER_COMPANY_OR_MISS,
      and: REASON.FILTER_COMPANY_OR_MISS,
      not: REASON.FILTER_COMPANY_NOT_HIT
    }),
    evalTextRules(job.jd, filters.jd, {
      or: REASON.FILTER_JD_OR_MISS,
      and: REASON.FILTER_JD_AND_MISS,
      not: REASON.FILTER_JD_NOT_HIT
    }),
    evalLocation(job.location, filters.location)
  ];

  for (const c of checks) {
    if (!c.pass) {
      return {
        decision: 'reject',
        reasonCodes: c.reasonCodes,
        reasonTexts: c.reasonTexts,
        passReasons: []
      };
    }
  }

  if (filters.title?.enabled?.or !== false && filters.title?.or?.length) passReasons.push(`职位命中包含词`);
  if (filters.title?.enabled?.and !== false && filters.title?.and?.length) passReasons.push(`职位满足必需词`);
  if (filters.location?.enabled?.include !== false && filters.location?.include?.length) {
    passReasons.push(`地点匹配：${job.location || ''}`);
  }

  const salary = parseSalaryRange(job.salary || '');
  if (filters.salaryMin != null && salary.max != null && salary.max < filters.salaryMin) {
    return {
      decision: 'reject',
      reasonCodes: [REASON.FILTER_SALARY_LOW],
      reasonTexts: [reasonText(REASON.FILTER_SALARY_LOW, job.salary || '')],
      passReasons
    };
  }
  if (filters.salaryMax != null && salary.min != null && salary.min > filters.salaryMax) {
    return {
      decision: 'reject',
      reasonCodes: [REASON.FILTER_SALARY_HIGH],
      reasonTexts: [reasonText(REASON.FILTER_SALARY_HIGH, job.salary || '')],
      passReasons
    };
  }
  if (filters.salaryMin != null || filters.salaryMax != null) {
    passReasons.push(`薪资满足要求`);
  }

  if (filters.excludeHunter && looksHunter(job)) {
    return {
      decision: 'reject',
      reasonCodes: [REASON.FILTER_HUNTER],
      reasonTexts: [reasonText(REASON.FILTER_HUNTER)],
      passReasons
    };
  }
  if (filters.excludeOutsource && looksOutsource(job)) {
    return {
      decision: 'reject',
      reasonCodes: [REASON.FILTER_OUTSOURCE],
      reasonTexts: [reasonText(REASON.FILTER_OUTSOURCE)],
      passReasons
    };
  }

  if (normalizeActiveWithin(filters.activeWithin).length) {
    const activeText = String(job.activeText || '').trim();
    if (!activeText && options.deferUnknownActive === true) {
      // 列表经常没有活跃文案。预览不点卡，投递时在临时详情页再核对。
      requiresActiveCheck = true;
      passReasons.push('HR 活跃：投递时核对');
    } else if (!matchActive(activeText, filters.activeWithin)) {
      return {
        decision: 'reject',
        reasonCodes: [REASON.FILTER_ACTIVE],
        reasonTexts: [reasonText(REASON.FILTER_ACTIVE, activeText || '未知')],
        passReasons,
        requiresActiveCheck: false
      };
    } else {
      passReasons.push(`HR 活跃：${activeText}`);
    }
  }

  return {
    decision: 'pass',
    reasonCodes: [REASON.OK_PREVIEW_PASS],
    reasonTexts: [reasonText(REASON.OK_PREVIEW_PASS)],
    passReasons,
    requiresActiveCheck
  };
}

export function previewReasonLines(row = {}) {
  if (row.decision === 'pass') {
    const extra = Array.isArray(row.passReasons) ? row.passReasons.filter(Boolean) : [];
    if (extra.length) return extra;
  }
  return Array.isArray(row.reasonTexts) ? row.reasonTexts.filter(Boolean) : [];
}

export function summarizePreview(results = []) {
  const summary = {
    scanned: results.length,
    pass: 0,
    reject: 0,
    byReason: {}
  };
  for (const r of results) {
    if (r.decision === 'pass') summary.pass += 1;
    else {
      summary.reject += 1;
      const code = r.reasonCodes?.[0] || 'OTHER';
      summary.byReason[code] = (summary.byReason[code] || 0) + 1;
    }
  }
  return summary;
}
