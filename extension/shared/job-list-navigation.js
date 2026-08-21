import { isBossUrl } from './boss-url.js';

const JOB_LIST_URL_PATTERN = /\/web\/geek\/jobs|recommend|search|rec-job|job-recommend|geek\/job(?!_detail)/i;

export function isBossJobListUrl(url = '') {
  if (!isBossUrl(url)) return false;
  try {
    const parsed = new URL(url);
    // 只看 pathname，避免职位详情页的 searchId 查询参数被误判为搜索列表。
    return JOB_LIST_URL_PATTERN.test(parsed.pathname);
  } catch (_) {
    return false;
  }
}

export function resolveBossJobListUrl({ candidate = '', currentUrl = '' } = {}) {
  if (isBossJobListUrl(candidate)) return new URL(candidate).href;

  if (isBossUrl(currentUrl)) {
    try {
      return new URL('/web/geek/jobs', currentUrl).href;
    } catch (_) {}
  }

  return 'https://www.zhipin.com/web/geek/jobs';
}

export function didContentDocumentChange({
  previousInstanceId = '',
  currentInstanceId = '',
  previousUrl = '',
  currentUrl = ''
} = {}) {
  if (!currentInstanceId) return false;
  if (previousInstanceId) return currentInstanceId !== previousInstanceId;
  // 兼容升级前尚未返回实例 ID 的旧 content：只有 URL 也变化时才判定整页跳转。
  return Boolean(previousUrl && currentUrl && previousUrl !== currentUrl);
}
