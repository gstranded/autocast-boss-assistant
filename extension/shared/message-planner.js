import { isSimilar } from './text-utils.js';
import { MESSAGE_MODES, ITEM_STATE } from './constants.js';
import { segmentIdempotencyKey } from './dedup.js';
import { renderTemplate } from './template.js';

export function planMessageSegments({
  mode,
  template,
  job,
  recentSelfMessages = [],
  threshold = 0.85,
  idempotency = {}
}) {
  const segments = (template.segments || []).filter((s) => s.enabled !== false);
  const version = template.version || 1;
  const plan = [];

  let startIndex = 0;
  let nativeDetected = false;

  if (mode === MESSAGE_MODES.NATIVE_PLUS) {
    startIndex = 1;
  } else if (mode === MESSAGE_MODES.AUTO_DETECT) {
    const first = segments[0];
    if (first) {
      const rendered = renderTemplate(first.text, job, { failOnMissing: false });
      const firstText = rendered.text;
      nativeDetected = recentSelfMessages.some((m) => isSimilar(m, firstText, threshold));
      if (nativeDetected) startIndex = 1;
    }
  }

  for (let i = startIndex; i < segments.length; i++) {
    const seg = segments[i];
    const key = segmentIdempotencyKey(job, version, i);
    if (idempotency[key]) continue;
    const rendered = renderTemplate(seg.text, job, { failOnMissing: true });
    plan.push({
      index: i,
      id: seg.id,
      key,
      text: rendered.ok ? rendered.text : '',
      render: rendered,
      stateName: `${ITEM_STATE.TEXT_SEGMENT_SENT_PREFIX}${i + 1}_SENT`
    });
  }

  return {
    nativeDetected,
    startIndex,
    plan,
    skippedByMode: startIndex,
    totalEnabled: segments.length
  };
}
