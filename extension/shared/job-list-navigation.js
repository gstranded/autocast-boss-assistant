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

// 让两个 BOSS 职位列表 URL 可比较：忽略易变的安全校验参数（_security_check 等），
// 只比较决定「岗位集合」的路径与关键查询参数（city/query/experience/salary 等）。
// 用于检测「预览后列表是否被换成另一批岗位」——若不一致，投递前明确提示用户重新预览，
// 而不是逐岗点卡片后发现活跃度未知、连续 3 岗后才被动暂停。
const VOLATILE_QUERY_KEYS = new Set([
  '_security_check',
  'ka',
  'page',
  'from',
  'timestamp',
  't'
]);

export function sameJobListUrl(a = '', b = '') {
  if (!isBossJobListUrl(a) || !isBossJobListUrl(b)) {
    // 双方都是可用列表 URL 才判等同；否则视为未知（交给后续逐岗核对兜底）
    return null;
  }
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    if (ua.pathname !== ub.pathname) return false;
    // 取所有非易变参数，按 key 排序后拼接比较
    const pick = (u) => {
      const keys = [];
      for (const [k, v] of u.searchParams) {
        if (VOLATILE_QUERY_KEYS.has(k)) continue;
        keys.push(k + '=' + v);
      }
      return keys.sort().join('&');
    };
    return pick(ua) === pick(ub);
  } catch (_) {
    return null;
  }
}
