import { DEFAULT_SETTINGS, validateCommunicationLimits } from './constants.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function requireType(value, path, predicate, description) {
  if (!predicate(value)) throw new Error(`配置字段 ${path} 必须是${description}`);
}

function object(value, path) {
  requireType(value, path, isObject, '对象');
}

function array(value, path, validateItem) {
  requireType(value, path, Array.isArray, '数组');
  value.forEach((item, index) => validateItem(item, `${path}[${index}]`));
}

function string(value, path) {
  requireType(value, path, (item) => typeof item === 'string', '字符串');
}

function number(value, path) {
  requireType(value, path, (item) => typeof item === 'number' && Number.isFinite(item), '有限数字');
}

function boolean(value, path) {
  requireType(value, path, (item) => typeof item === 'boolean', '布尔值');
}

function optional(source, key, path, validate) {
  if (source[key] != null) validate(source[key], `${path}.${key}`);
}

function flags(value, path) {
  object(value, path);
  for (const [key, flag] of Object.entries(value)) boolean(flag, `${path}.${key}`);
}

function textRules(value, path, keys) {
  object(value, path);
  for (const key of keys) optional(value, key, path, (items, itemPath) => array(items, itemPath, string));
  // 旧版 AND 会在 normalizeFilters 中移除，仍允许导入该旧字段。
  optional(value, 'enabled', path, flags);
}

function settings(value, path) {
  object(value, path);
  validateCommunicationLimits(value);
  for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
    if (key === 'taskMaxCommunicate' || key === 'dailyMaxCommunicate') continue;
    if (typeof defaultValue === 'boolean') optional(value, key, path, boolean);
    if (typeof defaultValue === 'number') optional(value, key, path, number);
    if (typeof defaultValue === 'string') optional(value, key, path, string);
  }
  for (const key of ['jobIntervalMs', 'segmentIntervalMs', 'scheduledDeliveryDays']) {
    optional(value, key, path, (items, itemPath) => array(items, itemPath, number));
  }
  optional(value, 'scheduledDeliveryWindows', path, (items, itemPath) => array(items, itemPath, (window, windowPath) => {
    object(window, windowPath);
    string(window.start, `${windowPath}.start`);
    string(window.end, `${windowPath}.end`);
  }));
}

function filters(value, path) {
  object(value, path);
  for (const key of ['title', 'company', 'jd']) {
    optional(value, key, path, (rules, rulesPath) => textRules(rules, rulesPath, ['or', 'not']));
  }
  optional(value, 'location', path, (rules, rulesPath) => {
    textRules(rules, rulesPath, ['include', 'exclude']);
    optional(rules, 'mode', rulesPath, string);
  });
  for (const key of ['experience', 'degree']) optional(value, key, path, (items, itemPath) => array(items, itemPath, string));
  // 旧版本 HR 活跃筛选保存为单个字符串。
  optional(value, 'activeWithin', path, (items, itemPath) => {
    if (typeof items === 'string') return;
    array(items, itemPath, string);
  });
  for (const key of ['salaryMin', 'salaryMax', 'maxPostAgeDays']) optional(value, key, path, number);
  for (const key of ['excludeHunter', 'excludeOutsource']) optional(value, key, path, boolean);
}

function messageTemplate(value, path) {
  object(value, path);
  optional(value, 'version', path, number);
  optional(value, 'segments', path, (items, itemPath) => array(items, itemPath, (segment, segmentPath) => {
    object(segment, segmentPath);
    for (const key of ['id', 'text', 'kind']) optional(segment, key, segmentPath, string);
    optional(segment, 'enabled', segmentPath, boolean);
  }));
}

function resumes(value, path) {
  object(value, path);
  optional(value, 'defaultProfileId', path, string);
  optional(value, 'profiles', path, (items, itemPath) => array(items, itemPath, (profile, profilePath) => {
    object(profile, profilePath);
    for (const key of ['id', 'name']) optional(profile, key, profilePath, string);
    optional(profile, 'images', profilePath, (images, imagesPath) => array(images, imagesPath, (image, imagePath) => {
      object(image, imagePath);
      for (const key of ['name', 'type', 'dataUrl']) optional(image, key, imagePath, string);
      optional(image, 'size', imagePath, number);
    }));
    optional(profile, 'attachment', profilePath, object);
  }));
}

function bindings(value, path) {
  object(value, path);
  optional(value, 'rules', path, (items, itemPath) => array(items, itemPath, (rule, rulePath) => {
    object(rule, rulePath);
    optional(rule, 'keywords', rulePath, (words, wordsPath) => array(words, wordsPath, string));
    optional(rule, 'profileId', rulePath, string);
    optional(rule, 'priority', rulePath, number);
  }));
}

function lists(value, path) {
  object(value, path);
  for (const key of ['companyBlacklist', 'companyWhitelist']) {
    optional(value, key, path, (items, itemPath) => array(items, itemPath, string));
  }
}

function records(value, path) {
  array(value, path, object);
}

function dailyStats(value, path) {
  object(value, path);
  for (const [day, stats] of Object.entries(value)) {
    object(stats, `${path}.${day}`);
    for (const key of ['communicate', 'success', 'skip', 'fail']) optional(stats, key, `${path}.${day}`, number);
    optional(stats, 'byCompany', `${path}.${day}`, (counts, countsPath) => {
      object(counts, countsPath);
      for (const [company, count] of Object.entries(counts)) number(count, `${countsPath}.${company}`);
    });
  }
}

function idempotency(value, path) {
  object(value, path);
  for (const [key, entry] of Object.entries(value)) {
    object(entry, `${path}.${key}`);
    optional(entry, 'ts', `${path}.${key}`, number);
  }
}

function task(value, path) {
  object(value, path);
  for (const key of ['results', 'queue', 'items']) optional(value, key, path, records);
  for (const [index, result] of (value.results || []).entries()) {
    object(result.job, `${path}.results[${index}].job`);
  }
}

const validators = { settings, filters, messageTemplate, resumes, bindings, lists, history: records, dailyStats, idempotency, task };

export function validateImportedConfig(payload) {
  object(payload, '根节点');
  for (const [key, validate] of Object.entries(validators)) optional(payload, key, 'config', validate);
}
