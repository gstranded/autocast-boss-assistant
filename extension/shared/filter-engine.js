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

function looksHunter(job) {
  const blob = `${job.title || ''} ${job.company || ''} ${job.hrName || ''} ${job.jd || ''}`;
  return /猎头|招聘顾问|人才中介|人力资源公司|RPO/i.test(blob);
}

function looksOutsource(job) {
  const blob = `${job.title || ''} ${job.company || ''} ${job.jd || ''}`;
  return /外包|驻场|外派|人力外包|IT外包/.test(blob);
}

function matchActive(activeText, activeWithin) {
  if (!activeWithin) return true;
  const t = activeText || '';
  if (activeWithin === 'today') return /今日活跃|刚刚活跃|在线/.test(t);
  if (activeWithin === '3d') return /今日活跃|刚刚活跃|在线|3日内|两日内|昨日/.test(t);
  if (activeWithin === 'week') return /今日活跃|刚刚活跃|在线|3日内|两日内|昨日|本周|一周内|7日内/.test(t);
  return true;
}

/**
 * @param {object} job
 * @param {object} filters
 * @param {object} lists
 * @param {object} settings
 */
export function evaluateJob(job, filters, lists = {}, settings = {}) {
  const passReasons = [];

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

  if (filters.activeWithin && !matchActive(job.activeText, filters.activeWithin)) {
    return {
      decision: 'reject',
      reasonCodes: [REASON.FILTER_ACTIVE],
      reasonTexts: [reasonText(REASON.FILTER_ACTIVE, job.activeText || '未知')],
      passReasons
    };
  }
  if (filters.activeWithin) passReasons.push(`HR 活跃：${job.activeText || '符合'}`);

  return {
    decision: 'pass',
    reasonCodes: [REASON.OK_PREVIEW_PASS],
    reasonTexts: [reasonText(REASON.OK_PREVIEW_PASS)],
    passReasons
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
