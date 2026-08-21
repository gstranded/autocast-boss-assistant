import { MESSAGE_SEGMENT_KINDS } from './constants.js';

export const NATIVE_GREETING_STATES = Object.freeze({
  SENT: 'sent',
  NOT_SENT: 'not_sent',
  UNKNOWN: 'unknown'
});

export function normalizeMessageTemplateRoles(template = {}) {
  const segments = (template.segments || []).map((segment, index) => ({
    ...segment,
    kind: Object.values(MESSAGE_SEGMENT_KINDS).includes(segment?.kind)
      ? segment.kind
      : index === 0
        ? MESSAGE_SEGMENT_KINDS.GREETING
        : MESSAGE_SEGMENT_KINDS.SUPPLEMENT
  }));
  return { ...template, segments };
}

export function resolveNativeGreetingEvidence({
  platformReceipt = null,
  settingSnapshot = null,
  alreadyContacted = false,
  freshSelfMessages = []
} = {}) {
  const receiptText = String(
    platformReceipt?.text || platformReceipt?.greeting || ''
  ).trim();
  if (platformReceipt && typeof platformReceipt.showGreeting === 'boolean') {
    return {
      state: platformReceipt.showGreeting
        ? NATIVE_GREETING_STATES.SENT
        : NATIVE_GREETING_STATES.NOT_SENT,
      source: 'friend_add_receipt',
      text: receiptText,
      confidence: 'platform'
    };
  }
  if (receiptText) {
    return {
      state: NATIVE_GREETING_STATES.SENT,
      source: 'friend_add_greeting_text',
      text: receiptText,
      confidence: 'platform'
    };
  }
  const freshText = (freshSelfMessages || []).map(String).find((text) => text.trim());
  if (freshText) {
    return {
      state: NATIVE_GREETING_STATES.SENT,
      source: 'fresh_self_message',
      text: freshText.trim(),
      confidence: 'dom'
    };
  }
  if (alreadyContacted) {
    return {
      state: NATIVE_GREETING_STATES.SENT,
      source: 'already_contacted',
      text: '',
      confidence: 'safe_skip'
    };
  }
  if (settingSnapshot && typeof settingSnapshot.enabled === 'boolean') {
    return {
      state: settingSnapshot.enabled
        ? NATIVE_GREETING_STATES.SENT
        : NATIVE_GREETING_STATES.NOT_SENT,
      source: 'boss_setting',
      text: String(settingSnapshot.text || '').trim(),
      confidence: 'account_setting'
    };
  }
  return {
    state: NATIVE_GREETING_STATES.UNKNOWN,
    source: 'no_evidence',
    text: '',
    confidence: 'unknown'
  };
}
