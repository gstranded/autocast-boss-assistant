/** @typedef {'info'|'warn'|'error'|'success'} LogLevel */

export const STORAGE_KEYS = {
  SETTINGS: 'bht_settings',
  FILTERS: 'bht_filters',
  MESSAGE_TEMPLATE: 'bht_message_template',
  RESUMES: 'bht_resumes',
  BINDINGS: 'bht_resume_bindings',
  LISTS: 'bht_black_white_lists',
  HISTORY: 'bht_delivery_history',
  IDEMPOTENCY: 'bht_idempotency',
  TASK: 'bht_current_task',
  LOGS: 'bht_logs',
  DAILY_STATS: 'bht_daily_stats',
  ONBOARDING: 'bht_onboarding',
  USAGE_NOTICE: 'bht_usage_notice',
  UPDATE: 'bht_update_state'
};

export const MESSAGE_MODES = {
  NATIVE_PLUS: 'native_plus',
  PLUGIN_ONLY: 'plugin_only',
  AUTO_DETECT: 'auto_detect'
};

export const MESSAGE_SEGMENT_KINDS = {
  GREETING: 'greeting',
  SUPPLEMENT: 'supplement'
};

export const TASK_STATUS = {
  AWAITING_CONFIRM: 'awaiting_confirm',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

export const DEFAULT_TARGET_NO_NEW_RETRY_LIMIT = 5;
export const MIN_TARGET_NO_NEW_RETRY_LIMIT = 1;
export const MAX_TARGET_NO_NEW_RETRY_LIMIT = 50;

export function normalizeTargetNoNewRetryLimit(value, fallback = DEFAULT_TARGET_NO_NEW_RETRY_LIMIT) {
  const fallbackValue = Number.isFinite(Number(fallback))
    ? Math.max(MIN_TARGET_NO_NEW_RETRY_LIMIT, Math.min(MAX_TARGET_NO_NEW_RETRY_LIMIT, Math.floor(Number(fallback))))
    : DEFAULT_TARGET_NO_NEW_RETRY_LIMIT;
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(MIN_TARGET_NO_NEW_RETRY_LIMIT, Math.min(MAX_TARGET_NO_NEW_RETRY_LIMIT, Math.floor(numeric)))
    : fallbackValue;
}

export const ITEM_STATE = {
  NOT_STARTED: 'NOT_STARTED',
  COMMUNICATION_CREATED: 'COMMUNICATION_CREATED',
  NATIVE_GREETING_DETECTED: 'NATIVE_GREETING_DETECTED',
  TEXT_SEGMENT_SENT_PREFIX: 'TEXT_SEGMENT_',
  IMAGE_RESUME_SENT: 'IMAGE_RESUME_SENT',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  PAUSED: 'PAUSED'
};

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  messageMode: MESSAGE_MODES.AUTO_DETECT,
  pluginTextEnabled: true,
  strictGreetingGuard: true,
  nativeGreetingWaitMs: 2600,
  similarityThreshold: 0.85,
  segmentIntervalMs: [1800, 3200],
  jobIntervalMs: [29000, 31000], // 投递间隔：基准 30 秒 → 29~31 秒随机
  taskMaxCommunicate: 150,
  dailyMaxCommunicate: 150,
  companyDailyMax: 3,
  bossCooldownDays: 30,
  neverRepeatJob: true,
  allowRepublishedJob: false,
  consecutiveFailPause: 3,
  targetNoNewRetryLimit: DEFAULT_TARGET_NO_NEW_RETRY_LIMIT,
  autoSendImageResume: true,
  resumeSendTiming: 'after_text', // after_text | manual
  splitViewEnabled: true,
  backgroundDeliveryEnabled: true,
  debugLoggingEnabled: false,
  scheduledDeliveryEnabled: false,
  scheduledDeliveryDays: [1, 2, 3, 4, 5],
  scheduledDeliveryWindows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '17:00' }],
  whitelistOnly: false
};

export function normalizeCommunicationLimit(value, fallback = 150, { allowZero = false } = {}) {
  if (value == null || String(value).trim() === '' || !['number', 'string'].includes(typeof value)) return fallback;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= (allowZero ? 0 : 1) ? numeric : fallback;
}

export function validateCommunicationLimits(settings = {}) {
  for (const key of ['taskMaxCommunicate', 'dailyMaxCommunicate']) {
    const value = settings[key];
    if (value == null || String(value).trim() === '') continue;
    const min = key === 'dailyMaxCommunicate' ? 0 : 1;
    if (!['number', 'string'].includes(typeof value) || !Number.isSafeInteger(Number(value)) || Number(value) < min) {
      throw new Error(`${key === 'dailyMaxCommunicate' ? '每日最多沟通' : '本次最多沟通'}必须是${min === 0 ? '非负' : '正'}整数`);
    }
  }
}

export const DEFAULT_FILTERS = {
  title: {
    or: [],
    not: ['外包', '驻场', '代招'],
    enabled: { or: true, not: true }
  },
  company: {
    or: [],
    not: [],
    enabled: { or: true, not: true }
  },
  jd: {
    or: [],
    not: ['外包', '驻场', '培训'],
    enabled: { or: true, not: true }
  },
  location: {
    include: [],
    exclude: [],
    mode: 'contains', // exact | contains
    enabled: { include: true, exclude: true }
  },
  salaryMin: null,
  salaryMax: null,
  experience: [], // empty = any
  degree: [],
  activeWithin: ['week'], // 单选 HR 活跃上限：online | just | today | 3d | week | 2w | month | half，默认「本周内」
  excludeHunter: true,
  excludeOutsource: true,
  maxPostAgeDays: null
};

export const DEFAULT_MESSAGE_TEMPLATE = {
  version: 1,
  segments: [
    {
      id: 'seg_1',
      enabled: true,
      kind: MESSAGE_SEGMENT_KINDS.GREETING,
      text: '您好，我对{职位名称}很感兴趣，希望能进一步沟通。'
    },
    {
      id: 'seg_2',
      enabled: true,
      kind: MESSAGE_SEGMENT_KINDS.SUPPLEMENT,
      text: '我具备相关项目经验，方便的话可以看看我的背景，期待您的回复。'
    }
  ]
};

export const DEFAULT_LISTS = {
  companyBlacklist: [],
  companyWhitelist: []
};
