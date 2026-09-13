import { isBossUrl } from './boss-url.js';
import { isBossJobListUrl, resolveBossJobListUrl } from './job-list-navigation.js';

export const CONVERSATION_WORKER_MODE = Object.freeze({
  DETAIL: 'detail',
  LIST: 'list'
});

export function buildConversationWorkerAttempts({ job = {}, listHref = '' } = {}) {
  const attempts = [];
  const detailHref = String(job.href || '');
  if (isBossUrl(detailHref) && /\/job_detail\//i.test(new URL(detailHref).pathname)) {
    attempts.push({ mode: CONVERSATION_WORKER_MODE.DETAIL, url: new URL(detailHref).href });
  }

  const fallbackListHref = resolveBossJobListUrl({ candidate: listHref || job.listHref || '' });
  if (isBossJobListUrl(fallbackListHref)) {
    attempts.push({ mode: CONVERSATION_WORKER_MODE.LIST, url: fallbackListHref });
  }

  return attempts.filter((attempt, index, rows) =>
    rows.findIndex((row) => row.mode === attempt.mode && row.url === attempt.url) === index
  );
}

export function isListDocumentPreserved(before = {}, after = {}) {
  if (!before.tabId || !after.tabId || before.tabId !== after.tabId) return false;
  if (!before.url || !after.url || before.url !== after.url) return false;
  if (before.contentInstanceId && after.contentInstanceId) {
    return before.contentInstanceId === after.contentInstanceId;
  }
  return true;
}
