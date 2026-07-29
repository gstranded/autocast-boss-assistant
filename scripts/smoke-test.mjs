import { evaluateJob, summarizePreview } from '../extension/shared/filter-engine.js';
import { isSimilar, parseSalaryRange } from '../extension/shared/text-utils.js';
import { planMessageSegments } from '../extension/shared/message-planner.js';
import { MESSAGE_MODES } from '../extension/shared/constants.js';
import { checkDedup, checkLimits } from '../extension/shared/dedup.js';
import { renderTemplate } from '../extension/shared/template.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(isSimilar('您好，我对这个岗位很感兴趣', '你好，我对该职位很感兴趣！', 0.85), 'greeting similar');
const s = parseSalaryRange('15-25K·14薪');
assert(s.min === 15000 && s.max === 25000, 'salary parse');

const filters = {
  title: { or: ['Java', '后端'], and: ['Agent'], not: ['外包'] },
  company: { or: [], and: [], not: [] },
  jd: { or: [], and: [], not: ['驻场'] },
  location: { include: ['广州'], exclude: [], mode: 'contains' },
  salaryMin: 10000,
  salaryMax: null,
  excludeHunter: true,
  excludeOutsource: true,
  activeWithin: ''
};

const passJob = {
  jobId: '1',
  title: 'Java Agent 开发',
  company: '某某科技',
  jd: '负责 Agent 与后端',
  location: '广州·天河',
  salary: '15-25K'
};
assert(evaluateJob(passJob, filters, {}, {}).decision === 'pass', 'should pass');
assert(evaluateJob({ ...passJob, title: 'Java 外包开发' }, filters, {}, {}).decision === 'reject', 'not keyword');
assert(evaluateJob({ ...passJob, location: '佛山' }, filters, {}, {}).decision === 'reject', 'location');

const summary = summarizePreview([
  { decision: 'pass' },
  { decision: 'reject', reasonCodes: ['X'] },
  { decision: 'reject', reasonCodes: ['X'] }
]);
assert(summary.pass === 1 && summary.reject === 2, 'summary');

const rt = renderTemplate('你好{职位名称}', { title: '后端' });
assert(rt.ok && rt.text === '你好后端', 'template ok');
assert(!renderTemplate('你好{职位名称}', {}).ok, 'template missing should fail');

const plan = planMessageSegments({
  mode: MESSAGE_MODES.AUTO_DETECT,
  template: {
    version: 1,
    segments: [
      { id: '1', enabled: true, text: '我对{职位名称}感兴趣' },
      { id: '2', enabled: true, text: '补充经历' }
    ]
  },
  job: { jobId: '1', bossId: 'b', title: 'Java' },
  recentSelfMessages: ['我对Java感兴趣'],
  threshold: 0.85,
  idempotency: {}
});
assert(plan.startIndex === 1, 'skip first segment');
assert(plan.plan.length === 1, 'only second');

assert(!checkLimits({
  settings: { taskMaxCommunicate: 2, dailyMaxCommunicate: 10 },
  taskSuccessCount: 2,
  todayStats: { communicate: 1 }
}).ok, 'task limit');

assert(!checkDedup(
  { jobId: 'x', bossId: 'b', company: 'C', title: 'T', communicated: true },
  {
    settings: { neverRepeatJob: true, bossCooldownDays: 30, companyDailyMax: 3 },
    history: [],
    todayStats: { byCompany: {} },
    taskItemKeys: new Set(),
    idempotency: {}
  }
).ok, 'session exists');

console.log('All unit tests passed.');