// 央国企/特定企业岗位详情页没有「立即沟通」，而是「立即网申/立即投递/投递简历」等
// 站外或表单类按钮。检测到这些按钮说明该岗位不支持 BOSS 站内沟通，应跳过而非报错暂停。
export const NON_CHAT_APPLY_LABELS = [
  '立即网申',
  '立即投递',
  '投递简历',
  '立即申请',
  '申请职位',
  '网申'
];

export function isNonChatApplyLabel(label) {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  return NON_CHAT_APPLY_LABELS.includes(text);
}

// 在给定作用域（或 document）中查找「立即网申」类按钮元素。
// 返回第一个匹配的可交互元素；找不到返回 null。
export function findNonChatApplyNode(root) {
  const selector = [
    '.job-detail-op a',
    '.job-detail-op button',
    '.job-detail-box a',
    '.job-detail-box button',
    '.job-detail-header a',
    '.job-detail-header button',
    'a',
    'button',
    "[role='button']"
  ].join(',');
  const seen = new Set();
  const roots = [root, (typeof document !== 'undefined' ? document : null)].filter(Boolean);
  for (const scope of roots) {
    let nodes = [];
    try { nodes = Array.from(scope.querySelectorAll(selector)); } catch (_) {}
    for (const node of nodes) {
      const interactive = node.matches?.("a,button,[role='button']")
        ? node
        : node.closest?.("a,button,[role='button']") || node;
      if (!interactive || seen.has(interactive)) continue;
      seen.add(interactive);
      const label = (interactive.textContent || '').replace(/\s+/g, ' ').trim();
      if (!isNonChatApplyLabel(label)) continue;
      try {
        const style = getComputedStyle(interactive);
        const rect = interactive.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) continue;
        if (rect.width < 18 || rect.height < 10) continue;
      } catch (_) {}
      return interactive;
    }
  }
  return null;
}
