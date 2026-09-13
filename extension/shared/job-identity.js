/**
 * 克隆列表页点沟通前的岗位身份：有真实 jobId 就必须对上，标题不能覆盖 id 冲突。
 */
export function isSyntheticJobId(jobId = '') {
  const id = String(jobId || '').trim();
  return !id || id.startsWith('name_') || id.startsWith('dom_');
}

function foldTitle(input = '') {
  return String(input || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function listJobIdentityMismatch({
  wantId = '',
  cardId = '',
  hrefId = '',
  wantTitle = '',
  gotTitle = ''
} = {}) {
  const target = String(wantId || '').trim();
  if (isSyntheticJobId(target)) return '';

  const realCardId = isSyntheticJobId(cardId) ? '' : String(cardId || '').trim();
  const realHrefId = isSyntheticJobId(hrefId) ? '' : String(hrefId || '').trim();
  if (realCardId && realCardId === target) return '';
  if (realHrefId && realHrefId === target) return '';
  if ((realCardId && realCardId !== target) || (realHrefId && realHrefId !== target)) {
    const pageId = realCardId || realHrefId;
    return '列表岗位与目标不一致（目标 ' + target.slice(0, 18) + ' / 页面 ' + pageId.slice(0, 18) + '）';
  }

  const want = foldTitle(wantTitle);
  const got = foldTitle(gotTitle);
  if (want && got && want === got) return '';
  return '列表岗位与目标不一致（目标 ' + target.slice(0, 18) + ' / 页面 ' + (got || '未知').slice(0, 18) + '）';
}

if (typeof globalThis !== 'undefined') {
  globalThis.BHTJobIdentity = Object.freeze({
    isSyntheticJobId,
    listJobIdentityMismatch
  });
}
