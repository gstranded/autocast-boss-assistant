// ===== Onboarding tour: first-run guided walkthrough =====
// Auto-shows a small spotlight popover the first time the side panel opens.
// Steps highlight real parts of the panel (tabs / cards / buttons).
import { STORAGE_KEYS } from '../shared/constants.js';

const KEY = STORAGE_KEYS.ONBOARDING;

const STEPS = [
  {
    sel: null,
    title: '欢迎使用 Boss 海投助手',
    body: '接下来 30 秒带你认识这个面板。每一步会高亮对应区域，随时可点「跳过」。'
  },
  {
    sel: '#tabs',
    title: '① 顶部标签页',
    body: '任务 / 筛选 / 消息 / 简历 / 记录 / 设置，六个分区在这里切换。'
  },
  {
    tab: 'filter',
    sel: '#tab-filter .card',
    title: '② 先填筛选条件',
    body: '职位名称、地点、薪资、排除词。只有命中规则的岗位才会进入预览，被排除的会显示原因。'
  },
  {
    tab: 'message',
    sel: '#tab-message .card',
    title: '③ 编辑打招呼消息',
    body: '写 1–2 段话，选择发送模式。推荐「自动识别」，避免对同一 HR 重复发首句。'
  },
  {
    tab: 'resume',
    sel: '#tab-resume .card',
    title: '④ 准备简历',
    body: '上传图片简历，或勾选「自动点击 BOSS 发简历」。发送时机建议选文本完成后立即发送。'
  },
  {
    tab: 'settings',
    sel: '#tab-settings .card',
    title: '⑤ 设个保守上限',
    body: '第一次用，把「本次最多沟通」设成 1，先跑通一份再放量。其余保持默认即可。'
  },
  {
    tab: 'task',
    sel: '#btnPreview',
    title: '⑥ 扫描 → 预览 → 投递',
    body: '先「扫描预览」核对岗位与跳过原因；可反复点「投递一份」逐个投；要一次投多个就用「批量投递」。',
    last: true
  }
];

let root = null;
let idx = 0;
let active = false;
let rafPos = 0;

function q(sel, el) {
  return (el || document).querySelector(sel);
}

async function isDone() {
  try {
    const r = await chrome.storage.local.get(KEY);
    return !!(r && r[KEY] && r[KEY].done);
  } catch (e) {
    return false;
  }
}

async function markDone(completed) {
  try {
    await chrome.storage.local.set({ [KEY]: { done: true, completed: !!completed, ts: Date.now() } });
  } catch (e) {}
}

function buildDom() {
  if (root) return root;
  const catcher = document.createElement('div');
  catcher.className = 'bht-tour-catcher';
  const spot = document.createElement('div');
  spot.className = 'bht-tour-spot';
  spot.hidden = true;
  const pop = document.createElement('div');
  pop.className = 'bht-tour-pop';
  pop.hidden = true;
  pop.innerHTML =
    '<div class="bht-tour-head">' +
      '<span class="bht-tour-kicker">新手引导</span>' +
      '<button type="button" class="bht-tour-x" aria-label="跳过引导">&times;</button>' +
    '</div>' +
    '<div class="bht-tour-title"></div>' +
    '<div class="bht-tour-body"></div>' +
    '<div class="bht-tour-foot">' +
      '<div class="bht-tour-left">' +
        '<div class="bht-tour-dots"></div>' +
        '<button type="button" class="bht-tour-skip">跳过</button>' +
      '</div>' +
      '<div class="bht-tour-right">' +
        '<button type="button" class="btn bht-tour-prev">上一步</button>' +
        '<button type="button" class="btn primary bht-tour-next">下一步</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(catcher);
  document.body.appendChild(spot);
  document.body.appendChild(pop);

  q('.bht-tour-x', pop).addEventListener('click', function () { finish(false); });
  q('.bht-tour-skip', pop).addEventListener('click', function () { finish(false); });
  q('.bht-tour-prev', pop).addEventListener('click', function () { go(-1); });
  q('.bht-tour-next', pop).addEventListener('click', function () {
    if (idx >= STEPS.length - 1) finish(true);
    else go(1);
  });

  root = {
    catcher: catcher,
    spot: spot,
    pop: pop,
    title: q('.bht-tour-title', pop),
    body: q('.bht-tour-body', pop),
    dots: q('.bht-tour-dots', pop),
    prev: q('.bht-tour-prev', pop),
    next: q('.bht-tour-next', pop)
  };
  root.dots.innerHTML = STEPS.map(function () { return '<i></i>'; }).join('');
  return root;
}

function switchTab(name) {
  const btn = q('.tabs button[data-tab="' + name + '"]');
  if (btn) btn.click();
}

function position() {
  if (!active || !root) return;
  const step = STEPS[idx];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let rect = null;
  if (step.sel) {
    const el = q(step.sel);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rect = r;
    }
  }
  const pad = 6;
  if (rect) {
    root.spot.hidden = false;
    root.catcher.classList.remove('dim');
    root.spot.style.top = Math.max(4, rect.top - pad) + 'px';
    root.spot.style.left = Math.max(4, rect.left - pad) + 'px';
    root.spot.style.width = Math.min(vw - 8, rect.width + pad * 2) + 'px';
    root.spot.style.height = Math.min(vh - 8, rect.height + pad * 2) + 'px';
  } else {
    root.spot.hidden = true;
    root.catcher.classList.add('dim');
  }

  const pop = root.pop;
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  let top;
  let left;
  if (rect) {
    const gap = 10;
    const below = vh - rect.bottom;
    const above = rect.top;
    if (below >= ph + gap) top = rect.bottom + gap;
    else if (above >= ph + gap) top = rect.top - ph - gap;
    else top = below >= above ? Math.min(vh - ph - 8, rect.bottom + gap) : Math.max(8, rect.top - ph - gap);
    left = rect.left + rect.width / 2 - pw / 2;
  } else {
    top = (vh - ph) / 2;
    left = (vw - pw) / 2;
  }
  top = Math.max(8, Math.min(top, vh - ph - 8));
  left = Math.max(8, Math.min(left, vw - pw - 8));
  pop.style.top = top + 'px';
  pop.style.left = left + 'px';
}

function schedulePosition() {
  cancelAnimationFrame(rafPos);
  rafPos = requestAnimationFrame(position);
}

function render(i) {
  idx = i;
  const r = buildDom();
  const step = STEPS[i];
  if (step.tab) switchTab(step.tab);
  r.title.textContent = step.title;
  r.body.textContent = step.body;
  r.prev.hidden = (i === 0);
  r.next.textContent = (i >= STEPS.length - 1) ? '完成' : '下一步';
  const dots = r.dots.querySelectorAll('i');
  for (let d = 0; d < dots.length; d++) dots[d].classList.toggle('on', d === i);
  r.pop.hidden = false;
  requestAnimationFrame(function () {
    if (step.sel) {
      const el = q(step.sel);
      if (el) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    requestAnimationFrame(position);
  });
}

function go(delta) {
  const ni = idx + delta;
  if (ni < 0 || ni >= STEPS.length) return;
  render(ni);
}

function onKey(e) {
  if (!active) return;
  if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); if (idx >= STEPS.length - 1) finish(true); else go(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
}

function finish(completed) {
  active = false;
  if (root) {
    root.catcher.remove();
    root.spot.remove();
    root.pop.remove();
    root = null;
  }
  window.removeEventListener('resize', schedulePosition);
  window.removeEventListener('scroll', schedulePosition, true);
  document.removeEventListener('keydown', onKey, true);
  markDone(completed);
}

function start() {
  if (active) return;
  active = true;
  window.addEventListener('resize', schedulePosition);
  window.addEventListener('scroll', schedulePosition, true);
  document.addEventListener('keydown', onKey, true);
  render(0);
}

async function init() {
  const replay = document.getElementById('btnReplayTour');
  if (replay) replay.addEventListener('click', function () { start(); });
  window.addEventListener('message', function (event) {
    const data = event.data || {};
    if (data.source !== 'bht-agent') return;
    if (data.cmd === 'skip-onboarding') finish(false);
  });
  if (await isDone()) return;
  setTimeout(start, 250);
}

init();
