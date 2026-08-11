/** BOSS 直聘 URL 判定：扩展仅在这些域名生效 */

const BOSS_HOST_SUFFIXES = ['zhipin.com', 'bosszhipin.com'];

export const BOSS_MATCH_PATTERNS = [
  '*://*.zhipin.com/*',
  '*://zhipin.com/*',
  '*://*.bosszhipin.com/*',
  '*://bosszhipin.com/*'
];

export function isBossHostname(hostname = '') {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return BOSS_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

export function isBossUrl(url = '') {
  if (!url || typeof url !== 'string') return false;
  // chrome://, about:, edge://, 扩展页等一律否
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    return isBossHostname(u.hostname);
  } catch {
    return BOSS_HOST_SUFFIXES.some((s) => url.toLowerCase().includes(s));
  }
}

export function isBossTab(tab) {
  return Boolean(tab?.id != null && isBossUrl(tab.url || ''));
}

export function bossUrlGuardMessage(url = '') {
  if (!url) return '请先打开 BOSS 直聘页面（zhipin.com）';
  if (!/^https?:\/\//i.test(url)) return '当前不是网页标签，助手仅在 BOSS 直聘网站生效';
  return '当前页面不是 BOSS 直聘，助手仅在 zhipin.com / bosszhipin.com 生效';
}
