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
  ONBOARDING: 'bht_onboarding'
};

export const MESSAGE_MODES = {
  NATIVE_PLUS: 'native_plus',
  PLUGIN_ONLY: 'plugin_only',
  AUTO_DETECT: 'auto_detect'
};

export const TASK_STATUS = {
  IDLE: 'idle',
  PREVIEWING: 'previewing',
  AWAITING_CONFIRM: 'awaiting_confirm',
  RUNNING: 'running',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

export const ITEM_STATE = {
  NOT_STARTED: 'NOT_STARTED',
  COMMUNICATION_CREATED: 'COMMUNICATION_CREATED',
  NATIVE_GREETING_DETECTED: 'NATIVE_GREETING_DETECTED',
  TEXT_SEGMENT_SENT_PREFIX: 'TEXT_SEGMENT_',
  IMAGE_RESUME_SENT: 'IMAGE_RESUME_SENT',
  ATTACHMENT_RESUME_SENT: 'ATTACHMENT_RESUME_SENT',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  PAUSED: 'PAUSED'
};

export const DEFAULT_SETTINGS = {
  theme: 'dark',
  messageMode: MESSAGE_MODES.AUTO_DETECT,
  similarityThreshold: 0.85,
  segmentIntervalMs: [1800, 3200],
  jobIntervalMs: [3500, 6000],
  taskMaxCommunicate: 30,
  dailyMaxCommunicate: 80,
  companyDailyMax: 3,
  bossCooldownDays: 30,
  neverRepeatJob: true,
  allowRepublishedJob: false,
  consecutiveFailPause: 3,
  autoSendImageResume: true,
  autoSendAttachmentResume: false, // 兼容旧字段名：现在表示点击 BOSS「发简历」
  resumeSendTiming: 'after_text', // on_request | after_text | manual
  previewRequired: true,
  splitViewEnabled: true,
  whitelistOnly: false
};

export const DEFAULT_FILTERS = {
  title: {
    or: [],
    and: [],
    not: ['外包', '驻场', '代招'],
    enabled: { or: true, and: true, not: true }
  },
  company: {
    or: [],
    and: [],
    not: [],
    enabled: { or: true, and: true, not: true }
  },
  jd: {
    or: [],
    and: [],
    not: ['外包', '驻场', '培训'],
    enabled: { or: true, and: true, not: true }
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
  activeWithin: '', // today | 3d | week | ''
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
      text: '您好，我对{职位名称}很感兴趣，希望能进一步沟通。'
    },
    {
      id: 'seg_2',
      enabled: true,
      text: '我具备相关项目经验，方便的话可以看看我的背景，期待您的回复。'
    }
  ]
};

export const DEFAULT_LISTS = {
  companyBlacklist: [],
  companyWhitelist: []
};

export const BOSS_ORIGIN_PATTERNS = [
  /^https?:\/\/([\w-]+\.)?zhipin\.com/i,
  /^https?:\/\/([\w-]+\.)?bosszhipin\.com/i
];
