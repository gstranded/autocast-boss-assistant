const FILTER_SIGNATURE_KEYS = Object.freeze([
  'jobType',
  'salary',
  'experience',
  'degree',
  'industry',
  'scale'
]);

export const JOB_SOURCE_TYPES = Object.freeze({
  RECOMMEND: 'recommend',
  EXPECTATION: 'expectation',
  UNKNOWN: 'unknown'
});

export function normalizeExpectText(value) {
  return String(value || '')
    .replace(/[\s\u00a0]+/g, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .trim();
}

export function expectationDisplayLabel(item = {}) {
  const position = String(item.positionName || item.position || '').trim();
  const location = String(item.locationName || item.location || '').trim();
  if (!position) return location;
  if (!location || normalizeExpectText(position).includes(normalizeExpectText(location))) return position;
  return `${position}(${location})`;
}

export function normalizeExpectationItems(payload = {}) {
  const data = payload?.zpData || payload || {};
  const lists = [
    ...(Array.isArray(data.expectList) ? data.expectList : []),
    ...(Array.isArray(data.partTimeExpectList) ? data.partTimeExpectList : [])
  ];
  return lists
    .map((item) => ({
      id: String(item?.id || '').trim(),
      encryptId: String(item?.encryptId || item?.encryptExpectId || '').trim(),
      positionName: String(item?.positionName || item?.position || '').trim(),
      locationName: String(item?.locationName || item?.location || '').trim(),
      label: expectationDisplayLabel(item)
    }))
    .filter((item) => item.id || item.encryptId || item.label);
}

export function expectationKey(item = {}) {
  return String(item.encryptId || item.id || '').trim();
}

export function findExpectationMatches(items = [], { key = '', label = '' } = {}) {
  const wantedKey = String(key || '').trim();
  const wantedLabel = normalizeExpectText(label);
  return (items || []).filter((item) => {
    if (wantedKey) return expectationKey(item) === wantedKey;
    if (!wantedLabel) return false;
    const itemLabel = normalizeExpectText(item.label || expectationDisplayLabel(item));
    return itemLabel === wantedLabel ||
      normalizeExpectText(item.positionName) === wantedLabel;
  });
}

export function normalizeFilterSignature(signature = {}) {
  const request = {};
  const sourceRequest = signature?.request && typeof signature.request === 'object'
    ? signature.request
    : {};
  for (const key of FILTER_SIGNATURE_KEYS) {
    request[key] = String(sourceRequest[key] || '').trim();
  }
  const hints = Array.from(new Set(
    (Array.isArray(signature?.hints) ? signature.hints : [])
      .map((hint) => String(hint || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  )).sort();
  return { request, hints };
}

export function hasFilterRequestEvidence(signature = {}) {
  const normalized = normalizeFilterSignature(signature);
  return FILTER_SIGNATURE_KEYS.some((key) => normalized.request[key]);
}

export function sameFilterSignature(left = {}, right = {}) {
  const a = normalizeFilterSignature(left);
  const b = normalizeFilterSignature(right);
  const aHasRequest = hasFilterRequestEvidence(a);
  const bHasRequest = hasFilterRequestEvidence(b);
  if (aHasRequest && bHasRequest) {
    return JSON.stringify(a.request) === JSON.stringify(b.request);
  }
  if (aHasRequest !== bHasRequest) {
    const requestSide = aHasRequest ? a : b;
    const hintSide = aHasRequest ? b : a;
    return hintSide.hints.length > 0 &&
      JSON.stringify(requestSide.hints) === JSON.stringify(hintSide.hints);
  }
  return JSON.stringify(a.hints) === JSON.stringify(b.hints);
}

export function sameJobSourceContext(left = {}, right = {}) {
  const aType = String(left?.sourceType || JOB_SOURCE_TYPES.UNKNOWN);
  const bType = String(right?.sourceType || JOB_SOURCE_TYPES.UNKNOWN);
  if (aType !== bType) return false;
  if (aType === JOB_SOURCE_TYPES.EXPECTATION) {
    const aKey = String(left?.expectationKey || '').trim();
    const bKey = String(right?.expectationKey || '').trim();
    return Boolean(aKey && bKey && aKey === bKey);
  }
  return aType === JOB_SOURCE_TYPES.RECOMMEND;
}

export function filterRequestFromUrl(url = '') {
  try {
    const parsed = new URL(String(url || ''), 'https://www.zhipin.com');
    const result = {};
    for (const key of FILTER_SIGNATURE_KEYS) {
      result[key] = String(parsed.searchParams.get(key) || '').trim();
    }
    return result;
  } catch (_) {
    return Object.fromEntries(FILTER_SIGNATURE_KEYS.map((key) => [key, '']));
  }
}

export function jobMergeKey(job = {}) {
  const id = String(job?.jobId || '').trim();
  if (id && !id.startsWith('name_') && !id.startsWith('dom_')) return `id:${id}`;
  const company = String(job?.company || '').toLowerCase().replace(/\s+/g, '');
  const title = String(job?.title || '').toLowerCase().replace(/\s+/g, '');
  return `tc:${company}|${title}`;
}
