import { REASON, reasonText } from './reason-codes.js';
import { normalizeText, todayKey } from './text-utils.js';

function daysBetween(ts, now = Date.now()) {
  return (now - ts) / (24 * 3600 * 1000);
}

/**
 * 职位 / HR / 公司 三级防重复
 */
export function checkDedup(job, ctx) {
  const {
    settings,
    history = [],
    todayStats = { byCompany: {} },
    taskItemKeys = new Set(),
    idempotency = {}
  } = ctx;

  const jobId = job.jobId || '';
  const bossId = job.bossId || '';
  const company = job.company || '';
  const companyKey = normalizeText(company);

  if (taskItemKeys.has(jobId || `${companyKey}|${normalizeText(job.title || '')}`)) {
    return {
      ok: false,
      reasonCodes: [REASON.DEDUP_TASK_ITEM],
      reasonTexts: [reasonText(REASON.DEDUP_TASK_ITEM)]
    };
  }

  if (settings.neverRepeatJob && jobId) {
    const hit = history.find((h) => h.jobId === jobId && h.status === 'success');
    if (hit) {
      if (!(settings.allowRepublishedJob && job.securityId && hit.securityId && job.securityId !== hit.securityId)) {
        return {
          ok: false,
          reasonCodes: [REASON.DEDUP_JOB],
          reasonTexts: [reasonText(REASON.DEDUP_JOB)]
        };
      }
    }
    if (idempotency[`job:${jobId}`]) {
      return {
        ok: false,
        reasonCodes: [REASON.DEDUP_JOB],
        reasonTexts: [reasonText(REASON.DEDUP_JOB)]
      };
    }
  }

  if (bossId && settings.bossCooldownDays > 0) {
    const hit = history.find(
      (h) => h.bossId === bossId && h.status === 'success' && daysBetween(h.ts) < settings.bossCooldownDays
    );
    if (hit) {
      return {
        ok: false,
        reasonCodes: [REASON.DEDUP_BOSS],
        reasonTexts: [reasonText(REASON.DEDUP_BOSS, `${settings.bossCooldownDays}天`)]
      };
    }
  }

  if (companyKey && settings.companyDailyMax > 0) {
    const used = todayStats.byCompany?.[companyKey] || 0;
    if (used >= settings.companyDailyMax) {
      return {
        ok: false,
        reasonCodes: [REASON.DEDUP_COMPANY_DAILY],
        reasonTexts: [reasonText(REASON.DEDUP_COMPANY_DAILY, `${used}/${settings.companyDailyMax}`)]
      };
    }
  }

  if (job.communicated || job.hasChat) {
    return {
      ok: false,
      reasonCodes: [REASON.DEDUP_SESSION_EXISTS],
      reasonTexts: [reasonText(REASON.DEDUP_SESSION_EXISTS)]
    };
  }

  return { ok: true, reasonCodes: [], reasonTexts: [] };
}

export function checkLimits({ settings, taskSuccessCount, todayStats }) {
  if (taskSuccessCount >= settings.taskMaxCommunicate) {
    return {
      ok: false,
      reasonCodes: [REASON.LIMIT_TASK_MAX],
      reasonTexts: [reasonText(REASON.LIMIT_TASK_MAX, `${taskSuccessCount}/${settings.taskMaxCommunicate}`)]
    };
  }
  if ((todayStats.communicate || 0) >= settings.dailyMaxCommunicate) {
    return {
      ok: false,
      reasonCodes: [REASON.LIMIT_DAILY_MAX],
      reasonTexts: [reasonText(REASON.LIMIT_DAILY_MAX, `${todayStats.communicate}/${settings.dailyMaxCommunicate}`)]
    };
  }
  return { ok: true, reasonCodes: [], reasonTexts: [] };
}

export function segmentIdempotencyKey(job, templateVersion, segmentIndex) {
  return `seg:${job.jobId || ''}:${job.bossId || ''}:${templateVersion}:${segmentIndex}`;
}

export function resumeIdempotencyKey(job, kind, profileId) {
  return `resume:${kind}:${job.jobId || ''}:${job.bossId || ''}:${profileId || 'default'}`;
}

export function jobIdempotencyKey(job) {
  return `job:${job.jobId || normalizeText(job.company || '') + '|' + normalizeText(job.title || '')}`;
}

export { todayKey };
