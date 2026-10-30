export const UPDATE_FEED_URL = 'https://github.com/gstranded/autocast-boss-assistant/releases.atom';
export const UPDATE_RELEASE_PAGE = 'https://github.com/gstranded/autocast-boss-assistant/releases';
export const UPDATE_HOME_PAGE = 'https://github.com/gstranded/autocast-boss-assistant';
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_RETRY_INTERVAL_MS = 30 * 60 * 1000;

export function normalizeUpdateVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+\.\d+\.\d+)$/);
  return match ? match[1] : '';
}

export function isNewerVersion(latest, current) {
  const a = normalizeUpdateVersion(latest);
  const b = normalizeUpdateVersion(current);
  if (!a || !b) return false;
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i];
  }
  return false;
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:#(\d+)|#x([\da-f]+)|amp|lt|gt|quot|apos);/gi, (entity, decimal, hex) => {
      if (decimal || hex) {
        const code = parseInt(decimal || hex, hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
      }
      return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity.toLowerCase()] || entity;
    });
}

export function safeUpdateReleaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin === 'https://github.com' &&
        url.pathname.startsWith('/gstranded/autocast-boss-assistant/releases/tag/')) {
      url.search = '';
      url.hash = '';
      return url.href;
    }
  } catch (_) {}
  return UPDATE_RELEASE_PAGE;
}

// The existing Atom endpoint needs no new host permission. MV3 workers have
// no DOMParser; read only entry fields and accept exact stable release tags.
export function parseUpdateFeed(xml) {
  const entries = String(xml || '').match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) || [];
  let latest = null;
  for (const entry of entries) {
    const links = entry.match(/<link\b[^>]*>/gi) || [];
    const attr = (link, name) => decodeXml(link.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]);
    const link = links.find((item) => attr(item, 'rel') === 'alternate');
    const releaseUrl = safeUpdateReleaseUrl(attr(link || '', 'href'));
    if (releaseUrl === UPDATE_RELEASE_PAGE) continue;
    let tag;
    try { tag = decodeURIComponent(new URL(releaseUrl).pathname.split('/').pop()); }
    catch (_) { continue; }
    const latestVersion = normalizeUpdateVersion(tag);
    if (!latestVersion || (latest && !isNewerVersion(latestVersion, latest.latestVersion))) continue;
    const field = (name) => decodeXml(entry.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]);
    const date = field('published') || field('updated');
    latest = {
      latestVersion,
      releaseUrl,
      publishedAt: Number.isFinite(Date.parse(date)) ? date : '',
      summary: field('content').replace(/<[^>]*>/g, ' ').replace(/[#>*`\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
    };
  }
  if (!latest) throw new Error('响应缺少正式版本信息');
  return latest;
}

export function normalizeUpdateState(value = {}) {
  const timestamp = (key) => Number.isFinite(value?.[key]) && value[key] > 0 ? value[key] : 0;
  const pending = value?.pendingReminder;
  const pendingVersion = normalizeUpdateVersion(pending?.version);
  return {
    latestVersion: normalizeUpdateVersion(value?.latestVersion),
    releaseUrl: safeUpdateReleaseUrl(value?.releaseUrl),
    publishedAt: typeof value?.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt)) ? value.publishedAt : '',
    summary: String(value?.summary || '').slice(0, 160),
    lastCheckedAt: timestamp('lastCheckedAt'),
    lastAttemptAt: timestamp('lastAttemptAt'),
    notifiedVersion: normalizeUpdateVersion(value?.notifiedVersion),
    pendingReminder: pendingVersion && typeof pending?.id === 'string' &&
      pending.id.length <= 100 && Number.isFinite(pending.expiresAt) && pending.expiresAt > 0
      ? { id: pending.id, version: pendingVersion, expiresAt: pending.expiresAt }
      : null
  };
}

export function shouldCheckForUpdate(state, now = Date.now()) {
  const cached = normalizeUpdateState(state);
  const elapsed = (at) => at ? now - at : Infinity;
  // Also recover after the system clock moves backwards.
  const due = (at, interval) => elapsed(at) < 0 || elapsed(at) >= interval;
  return due(cached.lastCheckedAt, UPDATE_CHECK_INTERVAL_MS) &&
    due(cached.lastAttemptAt, UPDATE_RETRY_INTERVAL_MS);
}

export function canRemindUpdate(state, currentVersion) {
  const cached = normalizeUpdateState(state);
  return isNewerVersion(cached.latestVersion, currentVersion) &&
    (!cached.notifiedVersion || isNewerVersion(cached.latestVersion, cached.notifiedVersion));
}
