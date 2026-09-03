import { REASON, reasonText } from './reason-codes.js';
import { normalizeMatchText } from './text-utils.js';

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
  const companyKey = normalizeMatchText(company);

  if (taskItemKeys.has(jobId || `${companyKey}|${normalizeMatchText(job.title || '')}`)) {
    return {
      ok: false,
      reasonCodes: [REASON.DEDUP_TASK_ITEM],
      reasonTexts: [reasonText(REASON.DEDUP_TASK_ITEM)]
    };
  }

  if (settings.neverRepeatJob) {
    const hit = jobId
      ? history.find((h) => h.jobId === jobId && h.status === 'success')
      : null;
    if (hit) {
      if (!(settings.allowRepublishedJob && job.securityId && hit.securityId && job.securityId !== hit.securityId)) {
        return {
          ok: false,
          reasonCodes: [REASON.DEDUP_JOB],
          reasonTexts: [reasonText(REASON.DEDUP_JOB)]
        };
      }
    }
    // 幂等簿命中同样检查：与 history 一致地允许「重新发布」岗（securityId 变化视为重发）
    const idemEntry = idempotency[jobIdempotencyKey(job)];
    if (idemEntry) {
      // 旧版本写入的幂等记录没有 securityId：回退用同岗 history 成功记录中的 securityId 作为证据；
      // 两边都拿不到 securityId 时无法证明是重发，按「绝不重复」保守拦截。
      const knownSecurityId = idemEntry.securityId
        ? String(idemEntry.securityId)
        : hit?.status === 'success' ? String(hit.securityId || '') : '';
      const republished = Boolean(
        settings.allowRepublishedJob &&
        job.securityId &&
        knownSecurityId &&
        String(job.securityId) !== knownSecurityId
      );
      if (!republished) {
        return {
          ok: false,
          reasonCodes: [REASON.DEDUP_JOB],
          reasonTexts: [reasonText(REASON.DEDUP_JOB)]
        };
      }
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
  // 0 = 未设每日上限（与界面显示「未设上限」一致；normalizeSettings 允许导入 0）
  if (settings.dailyMaxCommunicate > 0 && (todayStats.communicate || 0) >= settings.dailyMaxCommunicate) {
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
  return `job:${job.jobId || normalizeMatchText(job.company || '') + '|' + normalizeMatchText(job.title || '')}`;
}
