import { isSimilar } from './text-utils.js';
import { MESSAGE_MODES, MESSAGE_SEGMENT_KINDS, ITEM_STATE } from './constants.js';
import { segmentIdempotencyKey } from './dedup.js';
import { renderTemplate } from './template.js';
import {
  NATIVE_GREETING_STATES,
  normalizeMessageTemplateRoles
} from './greeting-policy.js';

export function planMessageSegments({
  mode,
  template,
  job,
  recentSelfMessages = [],
  threshold = 0.85,
  idempotency = {},
  nativeGreetingState = null,
  strictUnknown = true,
  pluginTextEnabled = true
}) {
  const normalizedTemplate = normalizeMessageTemplateRoles(template);
  const segments = (normalizedTemplate.segments || [])
    .map((segment, sourceIndex) => ({ ...segment, sourceIndex }))
    .filter((segment) => segment.enabled !== false);
  const version = template.version || 1;
  const plan = [];

  let startIndex = 0;
  let nativeDetected = false;
  let blocked = false;
  let blockReason = '';

  if (!pluginTextEnabled) {
    return {
      nativeDetected: nativeGreetingState === NATIVE_GREETING_STATES.SENT,
      startIndex: 0,
      plan: [],
      blocked: false,
      blockReason: '',
      skippedByMode: segments.length,
      totalEnabled: segments.length
    };
  }

  if (nativeGreetingState === NATIVE_GREETING_STATES.SENT) {
    nativeDetected = true;
  } else if (
    nativeGreetingState === NATIVE_GREETING_STATES.UNKNOWN &&
    strictUnknown &&
    segments.some((segment) => segment.kind === MESSAGE_SEGMENT_KINDS.GREETING)
  ) {
    blocked = true;
    blockReason = 'NATIVE_GREETING_UNKNOWN';
  } else if (nativeGreetingState == null && mode === MESSAGE_MODES.NATIVE_PLUS) {
    nativeDetected = true;
    startIndex = 1;
  } else if (nativeGreetingState == null && mode === MESSAGE_MODES.AUTO_DETECT) {
    const first = segments[0];
    if (first) {
      const rendered = renderTemplate(first.text, job, { failOnMissing: false });
      const firstText = rendered.text;
      nativeDetected = recentSelfMessages.some((m) => isSimilar(m, firstText, threshold));
      if (nativeDetected) startIndex = 1;
    }
  }

  if (blocked) {
    return {
      nativeDetected: false,
      startIndex: 0,
      plan: [],
      blocked,
      blockReason,
      skippedByMode: 0,
      totalEnabled: segments.length
    };
  }

  const selectedSegments = nativeGreetingState != null
    ? segments.filter((segment) => !(
        nativeDetected && segment.kind === MESSAGE_SEGMENT_KINDS.GREETING
      ))
    : segments.slice(startIndex);

  for (const seg of selectedSegments) {
    const sourceIndex = seg.sourceIndex;
    const key = segmentIdempotencyKey(job, version, sourceIndex);
    if (idempotency[key]) continue;
    const rendered = renderTemplate(seg.text, job, { failOnMissing: true });
    plan.push({
      index: sourceIndex,
      id: seg.id,
      kind: seg.kind,
      key,
      text: rendered.ok ? rendered.text : '',
      render: rendered,
      stateName: `${ITEM_STATE.TEXT_SEGMENT_SENT_PREFIX}${sourceIndex + 1}_SENT`
    });
  }

  return {
    nativeDetected,
    startIndex,
    plan,
    blocked,
    blockReason,
    skippedByMode: segments.length - selectedSegments.length,
    totalEnabled: segments.length
  };
}
