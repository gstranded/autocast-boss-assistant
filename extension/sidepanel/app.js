import { MSG } from '../shared/messaging.js';
import { parseKeywords, uid } from '../shared/text-utils.js';
import { reasonText } from '../shared/reason-codes.js';

const $ = (id) => document.getElementById(id);
const FLOAT_MODE = new URLSearchParams(location.search).get("mode") === "float";
const BHT_UI_VERSION = "1.3.5";
// FLOAT_MODE_FORCE_BOSS: floating host only injects on BOSS pages
const state = {
  modalDismissed: false,
  modalClosedForKey: '',
  config: null,
  selected: new Set(),
  activeProfileId: null,
  draftBindings: []
};

async function api(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${name}`);
  });
}

function setConn(ok, text) {
  const el = $('connBadge');
  el.textContent = text;
  el.className = `badge ${ok ? 'ok' : 'bad'}`;
}

function setBossMode(isBoss, reason = '') {
  // 浮窗只在 BOSS 注入；避免 activeTab 误判导致按钮全灰
  const effectiveBoss = FLOAT_MODE ? true : Boolean(isBoss);
  state.isBoss = effectiveBoss;
  state.bossBlockReason = effectiveBoss ? '' : (reason || '');
  ['btnPreview', 'btnDiagnose', 'btnStart', 'btnTestOne', 'btnPause', 'btnResume', 'btnSkip', 'btnStop'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    // 控制按钮在 BOSS/浮窗下始终可点
    if (['btnPause', 'btnResume', 'btnSkip', 'btnStop'].includes(id)) {
      el.disabled = false;
      el.removeAttribute('disabled');
      el.title = '';
      el.style.pointerEvents = 'auto';
      el.style.opacity = '1';
      return;
    }
    el.disabled = !effectiveBoss;
    el.title = effectiveBoss ? '' : (reason || '仅在 BOSS 直聘页面可用');
    el.style.opacity = effectiveBoss ? '1' : '0.45';
  });
  if (!effectiveBoss) {
    if ($('taskStatus')) $('taskStatus').textContent = '状态：未在 BOSS 页面（功能已锁定）';
    if (reason && $('taskWarnings')) $('taskWarnings').textContent = reason;
  } else {
    updateTaskUI(state.config?.task, state.config?.runner);
  }
}

function kwJoin(arr) {
  return (arr || []).join(', ');
}

function fillFilters(filters, lists, settings) {
  $('titleOr').value = kwJoin(filters.title?.or);
  $('titleAnd').value = kwJoin(filters.title?.and);
  $('titleNot').value = kwJoin(filters.title?.not);
  $('companyOr').value = kwJoin(filters.company?.or);
  $('companyNot').value = kwJoin(filters.company?.not);
  $('jdOr').value = kwJoin(filters.jd?.or);
  $('jdAnd').value = kwJoin(filters.jd?.and);
  $('jdNot').value = kwJoin(filters.jd?.not);
  $('locInclude').value = kwJoin(filters.location?.include);
  $('locExclude').value = kwJoin(filters.location?.exclude);
  $('locMode').value = filters.location?.mode || 'contains';
  $('salaryMin').value = filters.salaryMin ?? '';
  $('salaryMax').value = filters.salaryMax ?? '';
  $('activeWithin').value = filters.activeWithin || '';
  $('excludeHunter').checked = filters.excludeHunter !== false;
  $('excludeOutsource').checked = filters.excludeOutsource !== false;
  $('blacklist').value = (lists.companyBlacklist || []).join('\n');
  $('whitelist').value = (lists.companyWhitelist || []).join('\n');
  $('whitelistOnly').checked = Boolean(settings.whitelistOnly);
}

function readFilters() {
  return {
    title: {
      or: parseKeywords($('titleOr').value),
      and: parseKeywords($('titleAnd').value),
      not: parseKeywords($('titleNot').value)
    },
    company: {
      or: parseKeywords($('companyOr').value),
      and: [],
      not: parseKeywords($('companyNot').value)
    },
    jd: {
      or: parseKeywords($('jdOr').value),
      and: parseKeywords($('jdAnd').value),
      not: parseKeywords($('jdNot').value)
    },
    location: {
      include: parseKeywords($('locInclude').value),
      exclude: parseKeywords($('locExclude').value),
      mode: $('locMode').value
    },
    salaryMin: $('salaryMin').value === '' ? null : Number($('salaryMin').value),
    salaryMax: $('salaryMax').value === '' ? null : Number($('salaryMax').value),
    experience: [],
    degree: [],
    activeWithin: $('activeWithin').value,
    excludeHunter: $('excludeHunter').checked,
    excludeOutsource: $('excludeOutsource').checked,
    maxPostAgeDays: null
  };
}

function fillSettings(settings) {
  $('messageMode').value = settings.messageMode;
  $('similarityThreshold').value = settings.similarityThreshold;
  $('autoSendImageResume').checked = Boolean(settings.autoSendImageResume);
  $('autoSendAttachmentResume').checked = Boolean(settings.autoSendAttachmentResume);
  $('resumeSendTiming').value = settings.resumeSendTiming || 'on_request';
  $('taskMaxCommunicate').value = settings.taskMaxCommunicate;
  $('dailyMaxCommunicate').value = settings.dailyMaxCommunicate;
  $('companyDailyMax').value = settings.companyDailyMax;
  $('bossCooldownDays').value = settings.bossCooldownDays;
  $('consecutiveFailPause').value = settings.consecutiveFailPause;
  $('neverRepeatJob').checked = settings.neverRepeatJob !== false;
}

function readSettingsPatch(base) {
  return {
    ...base,
    messageMode: $('messageMode').value,
    similarityThreshold: Number($('similarityThreshold').value || 0.85),
    autoSendImageResume: $('autoSendImageResume').checked,
    autoSendAttachmentResume: $('autoSendAttachmentResume').checked,
    resumeSendTiming: $('resumeSendTiming').value,
    taskMaxCommunicate: Number($('taskMaxCommunicate').value || 30),
    dailyMaxCommunicate: Number($('dailyMaxCommunicate').value || 80),
    companyDailyMax: Number($('companyDailyMax').value || 3),
    bossCooldownDays: Number($('bossCooldownDays').value || 30),
    consecutiveFailPause: Number($('consecutiveFailPause').value || 3),
    neverRepeatJob: $('neverRepeatJob').checked,
    whitelistOnly: $('whitelistOnly').checked
  };
}

function renderSegments(template) {
  const box = $('segments');
  box.innerHTML = '';
  (template.segments || []).forEach((seg, idx) => {
    const div = document.createElement('div');
    div.className = 'seg';
    div.innerHTML = `
      <div class="top">
        <label class="check"><input type="checkbox" data-en="${seg.id}" ${seg.enabled !== false ? 'checked' : ''}/>启用第 ${idx + 1} 段</label>
        <button class="btn tiny" data-del="${seg.id}">删除</button>
      </div>
      <textarea rows="3" data-text="${seg.id}"></textarea>
    `;
    box.appendChild(div);
    div.querySelector(`[data-text="${seg.id}"]`).value = seg.text || '';
  });

  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del');
      state.config.messageTemplate.segments = state.config.messageTemplate.segments.filter((s) => s.id !== id);
      renderSegments(state.config.messageTemplate);
    });
  });
}

function readTemplate(base) {
  const segments = (base.segments || []).map((seg) => {
    const en = document.querySelector(`[data-en="${seg.id}"]`);
    const tx = document.querySelector(`[data-text="${seg.id}"]`);
    if (!tx) return seg;
    return {
      ...seg,
      enabled: en ? en.checked : seg.enabled,
      text: tx.value
    };
  });
  return { ...base, version: (base.version || 1) + 1, segments };
}

function getActiveProfile() {
  const resumes = state.config?.resumes;
  if (!resumes?.profiles?.length) return null;
  const id = state.activeProfileId || resumes.defaultProfileId || resumes.profiles[0].id;
  return resumes.profiles.find((p) => p.id === id) || resumes.profiles[0];
}

function renderProfileList() {
  const resumes = state.config?.resumes || { profiles: [], defaultProfileId: '' };
  const box = $('profileList');
  if (!box) return;
  box.innerHTML = '';
  const activeId = state.activeProfileId || resumes.defaultProfileId;

  (resumes.profiles || []).forEach((p) => {
    const div = document.createElement('div');
    const isActive = p.id === activeId;
    const isDefault = p.id === resumes.defaultProfileId;
    div.className = `profile-item${isActive ? ' active' : ''}`;
    div.innerHTML = `
      <div class="name">
        ${escapeHtml(p.name || '未命名方案')}
        ${isDefault ? '<span class="pill default">默认</span>' : ''}
        ${isActive ? '<span class="pill">编辑中</span>' : ''}
      </div>
      <div class="meta">图片 ${(p.images || []).length} 张 · 附件 ${p.attachment ? '已配置' : '无'}</div>
      <div class="actions">
        <button class="btn tiny" data-switch="${p.id}">切换编辑</button>
        <button class="btn tiny" data-default="${p.id}">设默认</button>
      </div>
    `;
    box.appendChild(div);
  });

  box.querySelectorAll('[data-switch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      // flush current form into memory first
      flushActiveProfileForm();
      state.activeProfileId = btn.getAttribute('data-switch');
      renderResumeEditor();
      renderProfileList();
    });
  });
  box.querySelectorAll('[data-default]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      flushActiveProfileForm();
      state.config.resumes.defaultProfileId = btn.getAttribute('data-default');
      await api(MSG.SAVE_RESUMES, state.config.resumes);
      state.formDirty = false;
  await refresh({ soft: false });
      toast('已更新默认方案', 'success');
    });
  });
}

function renderResumeEditor() {
  const profile = getActiveProfile();
  if (!profile) return;
  state.activeProfileId = profile.id;
  $('profileName').value = profile.name || '';
  const thumbs = $('imagePreview');
  thumbs.innerHTML = '';
  (profile.images || []).forEach((img, idx) => {
    const el = document.createElement('img');
    el.src = img.dataUrl;
    el.title = `${idx + 1}. ${img.name || ''}`;
    thumbs.appendChild(el);
  });
  $('attachInfo').textContent = profile.attachment
    ? `已保存附件：${profile.attachment.name} (${Math.round((profile.attachment.size || 0) / 1024)} KB)`
    : '尚未选择附件';
}

function flushActiveProfileForm() {
  const profile = getActiveProfile();
  if (!profile) return;
  profile.name = $('profileName').value || profile.name || '未命名方案';
}

function renderBindings() {
  const box = $('bindingList');
  if (!box) return;
  const profiles = state.config?.resumes?.profiles || [];
  box.innerHTML = '';
  (state.draftBindings || []).forEach((rule, index) => {
    const div = document.createElement('div');
    div.className = 'binding-item';
    const options = profiles
      .map(
        (p) =>
          `<option value="${p.id}" ${p.id === rule.profileId ? 'selected' : ''}>${escapeHtml(
            p.name || p.id
          )}</option>`
      )
      .join('');
    div.innerHTML = `
      <div class="row">
        <strong>规则 ${index + 1}</strong>
        <button class="btn tiny" data-del-bind="${rule.id}">删除</button>
      </div>
      <label>关键词（逗号分隔，匹配职位名/JD）</label>
      <input data-bind-kw="${rule.id}" value="${escapeAttr((rule.keywords || []).join(','))}" placeholder="算法,LLM,Agent" />
      <label>绑定方案</label>
      <select data-bind-profile="${rule.id}">${options}</select>
      <label>优先级（数字越小越先匹配）</label>
      <input type="number" data-bind-priority="${rule.id}" value="${rule.priority ?? index}" />
    `;
    box.appendChild(div);
  });

  box.querySelectorAll('[data-del-bind]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-del-bind');
      state.draftBindings = state.draftBindings.filter((r) => r.id !== id);
      renderBindings();
    });
  });
}

function readBindingsFromDom() {
  return (state.draftBindings || []).map((rule) => {
    const kw = document.querySelector(`[data-bind-kw="${rule.id}"]`)?.value || '';
    const profileId = document.querySelector(`[data-bind-profile="${rule.id}"]`)?.value || rule.profileId;
    const priority = Number(document.querySelector(`[data-bind-priority="${rule.id}"]`)?.value ?? rule.priority ?? 0);
    return {
      id: rule.id,
      keywords: parseKeywords(kw),
      profileId,
      priority
    };
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function statusLabel(status) {
  const map = {
    idle: '空闲',
    previewing: '扫描中',
    awaiting_confirm: '待确认投递',
    running: '运行中',
    paused: '已暂停',
    stopped: '已停止',
    completed: '已完成',
    failed: '失败'
  };
  return map[status] || status || '空闲';
}

function updateTaskUI(task, runner = {}) {
  const status = task?.status || 'idle';
  if ($('taskStatus')) {
    $('taskStatus').textContent = `状态：${statusLabel(status)}${task?.pauseReason ? `（${task.pauseReason}）` : ''}`;
  }
  const c = task?.counters || { success: 0, skipped: 0, failed: 0, processed: 0 };
  if ($('taskCounters')) {
    $('taskCounters').textContent = `成功 ${c.success || 0} · 跳过 ${c.skipped || 0} · 失败 ${c.failed || 0} · 已处理 ${c.processed || 0}`;
  }

  const onBoss = FLOAT_MODE || state.isBoss !== false;
  // 暂停/继续/跳过/停止：始终可点（浮窗/BOSS）
  ['btnPause', 'btnResume', 'btnSkip', 'btnStop'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = false;
    el.removeAttribute('disabled');
    el.style.pointerEvents = 'auto';
    el.style.opacity = '1';
    el.title = '';
  });
  if ($('btnStart')) $('btnStart').disabled = !(onBoss && status === 'awaiting_confirm');
  if ($('btnTestOne')) {
    const hasPassSelected = Array.from(state.selected || []).length > 0
      || (state.config?.task?.results || []).some((r) => r.decision === 'pass');
    const idleLike = !status || status === 'idle' || status === 'awaiting_confirm' || status === 'completed' || status === 'stopped' || status === 'failed' || status === 'paused';
    $('btnTestOne').disabled = !(onBoss && hasPassSelected && idleLike && !['running'].includes(status));
  }
  if ($('btnPreview')) $('btnPreview').disabled = !(onBoss && status !== 'running');
  if ($('btnDiagnose')) $('btnDiagnose').disabled = !onBoss;
}

function renderPreview(task) {
  if (!task?.summary) {
    $('summaryBox').textContent = '尚未扫描';
    $('previewList').innerHTML = '';
    return;
  }
  const s = task.summary;
  const lines = [`扫描岗位：${s.scanned}`, `符合规则：${s.pass}`, `将被排除：${s.reject}`];
  if (s.byReason) {
    Object.entries(s.byReason)
      .slice(0, 8)
      .forEach(([code, n]) => lines.push(`- ${reasonText(code)}：${n}`));
  }
  $('summaryBox').textContent = lines.join('\n');

  const list = $('previewList');
  list.innerHTML = '';
  state.selected = new Set(
    (task.results || []).filter((r) => r.selected && r.decision === 'pass').map((r) => r.job.jobId)
  );

  (task.results || []).forEach((r) => {
    const div = document.createElement('div');
    div.className = `item ${r.decision}`;
    const canSelect = r.decision === 'pass';
    div.innerHTML = `
      <div class="row">
        <div class="t">${escapeHtml(r.job.title || '未命名职位')}</div>
        ${
          canSelect
            ? `<label class="check"><input type="checkbox" data-job="${r.job.jobId}" ${
                state.selected.has(r.job.jobId) ? 'checked' : ''
              }/></label>`
            : ''
        }
      </div>
      <div class="m">${escapeHtml(r.job.company || '')} · ${escapeHtml(r.job.location || '')} · ${escapeHtml(
      r.job.salary || ''
    )}</div>
      <div class="r">${escapeHtml((r.decision === 'pass' ? r.passReasons : r.reasonTexts)?.join('；') || '')}</div>
    `;
    list.appendChild(div);
  });

  list.querySelectorAll('input[data-job]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.getAttribute('data-job');
      if (input.checked) state.selected.add(id);
      else state.selected.delete(id);
    });
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll("'", '&#39;');
}

function renderLogs(logs = []) {
  const box = $('logList');
  box.innerHTML = '';
  logs.slice(0, 100).forEach((l) => {
    const div = document.createElement('div');
    div.className = `log ${l.level || 'info'}`;
    const time = new Date(l.ts || Date.now()).toLocaleTimeString();
    div.textContent = `[${time}] ${l.message}`;
    box.appendChild(div);
  });
}


function isFormField(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function isEditingForm() {
  return isFormField(document.activeElement);
}

/** soft: 仅刷新任务/连接/日志，不覆盖正在编辑的表单 */
async function refresh(options = {}) {
  const soft = options.soft === true;
  const res = await api(MSG.GET_STATE);
  if (!res?.ok) return;
  state.config = res;
  if (!state.activeProfileId) {
    state.activeProfileId = res.resumes?.defaultProfileId || res.resumes?.profiles?.[0]?.id || null;
  }

  const editing = isEditingForm();
  const keepForm = soft || editing || state.formDirty;
  // 软刷新 / 正在输入 / 有未保存修改：绝不回填表单
  if (!keepForm) {
    state.draftBindings = (res.bindings?.rules || []).map((r, i) => ({
      id: r.id || `rule_${i}`,
      keywords: r.keywords || [],
      profileId: r.profileId,
      priority: r.priority ?? i
    }));
    fillFilters(res.filters, res.lists, res.settings);
    fillSettings(res.settings);
    renderSegments(res.messageTemplate);
    renderProfileList();
    renderResumeEditor();
    renderBindings();
  }

  if (!editing && !state.formDirty) {
    renderPreview(res.task);
  } else if (!editing) {
    // 仅更新计数文案，不重绘列表打断
    updateTaskUI(res.task, res.runner);
  }
  updateTaskUI(res.task, res.runner);
  renderLogs(res.logs || []);

  const isBoss = Boolean(res.activeIsBoss || res.activeTab);
  if (isBoss) {
    setConn(true, '已连接 BOSS · v' + BHT_UI_VERSION);
    setBossMode(true);
  } else {
    const reason = '当前不是 BOSS 直聘页面，助手仅在 zhipin.com 生效';
    setConn(false, '未连接 BOSS');
    setBossMode(false, reason);
  }
  if (isBoss) updateTaskUI(res.task, res.runner);
}

async function saveFilters() {
  const filters = readFilters();
  const lists = {
    companyBlacklist: parseKeywords($('blacklist').value.replace(/\n/g, ',')),
    companyWhitelist: parseKeywords($('whitelist').value.replace(/\n/g, ','))
  };
  const settings = readSettingsPatch(state.config.settings);
  await api(MSG.SAVE_FILTERS, filters);
  await api(MSG.SAVE_LISTS, lists);
  await api(MSG.SAVE_SETTINGS, settings);
  state.formDirty = false;
  await refresh({ soft: false });
  }

async function saveMessage() {
  const template = readTemplate(state.config.messageTemplate);
  const settings = readSettingsPatch(state.config.settings);
  await api(MSG.SAVE_TEMPLATE, template);
  await api(MSG.SAVE_SETTINGS, settings);
  state.formDirty = false;
  await refresh({ soft: false });
  }

async function saveSettings() {
  const settings = readSettingsPatch(state.config.settings);
  await api(MSG.SAVE_SETTINGS, settings);
  state.formDirty = false;
  await refresh({ soft: false });
  }

async function saveResume() {
  const resumes = structuredClone(state.config.resumes);
  if (!resumes.profiles?.length) {
    resumes.profiles = [{ id: 'default', name: '默认方案', images: [], attachment: null }];
    resumes.defaultProfileId = 'default';
  }
  let profile = resumes.profiles.find((p) => p.id === state.activeProfileId);
  if (!profile) {
    profile = resumes.profiles[0];
    state.activeProfileId = profile.id;
  }
  profile.name = $('profileName').value || profile.name || '未命名方案';

  const imageFiles = $('imageFiles').files;
  if (imageFiles?.length) {
    const images = [];
    for (const f of Array.from(imageFiles)) {
      if (f.size > 2.5 * 1024 * 1024) {
        toast(`图片过大已跳过：${f.name}`);
        continue;
      }
      images.push({
        name: f.name,
        size: f.size,
        dataUrl: await fileToDataUrl(f),
        type: f.type
      });
    }
    if (images.length) profile.images = images;
  }

  const attach = $('attachFile').files?.[0];
  if (attach) {
    if (attach.size > 4.5 * 1024 * 1024) {
      toast('附件过大（建议 < 4.5MB）', 'success');
    } else {
      profile.attachment = {
        name: attach.name,
        size: attach.size,
        type: attach.type,
        dataUrl: await fileToDataUrl(attach)
      };
    }
  }

  // write back
  const idx = resumes.profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) resumes.profiles[idx] = profile;

  const settings = readSettingsPatch(state.config.settings);
  await api(MSG.SAVE_RESUMES, resumes);
  await api(MSG.SAVE_SETTINGS, settings);
  $('imageFiles').value = '';
  $('attachFile').value = '';
  state.formDirty = false;
  await refresh({ soft: false });
  }

async function saveBindings() {
  const rules = readBindingsFromDom()
    .filter((r) => (r.keywords || []).length && r.profileId)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));
  await api(MSG.SAVE_BINDINGS, { rules });
  state.formDirty = false;
  await refresh({ soft: false });
  }

function toast(msg, type = 'success', ms = 2200) {
  const el = $('bht-toast') || $('taskWarnings');
  if (!el) return;
  if (el.id === 'bht-toast') {
    el.hidden = false;
    el.textContent = msg;
    el.className = 'bht-toast ' + (type || 'success');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      el.hidden = true;
    }, ms);
  } else {
    el.textContent = msg;
    setTimeout(() => {
      if (el.textContent === msg) {
        const t = state.config?.task;
        el.textContent = (t?.warnings || []).join('；');
      }
    }, ms);
  }
}

function showErrorModal(title, body, { showRetry = true, force = false } = {}) {
  if (!force && state.modalDismissed) return;
  const modal = $('bht-modal');
  if (!modal) {
    toast(body || title, 'error', 4000);
    return;
  }
  const key = String(title || '') + '|' + String(body || '');
  if (!force && state.modalClosedForKey === key) return;
  if (!force && !modal.hidden && state.lastModalKey === key) return;
  state.lastModalKey = key;
  $('bht-modal-title').textContent = title || '投递失败';
  $('bht-modal-body').textContent = body || '发生未知错误';
  const retryBtn = $('bht-modal-retry');
  if (retryBtn) retryBtn.hidden = !showRetry;
  modal.hidden = false;
}

function hideErrorModal() {
  const modal = $('bht-modal');
  if (modal) modal.hidden = true;
  state.modalDismissed = true;
  state.modalClosedForKey = state.lastModalKey || state.modalClosedForKey || '';
}

function bindEvents() {
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  $('btnSaveFilter').addEventListener('click', async () => {
    try {
      await saveFilters();
      toast('筛选已保存', 'success');
    } catch (e) {
      toast(String(e.message || e), 'error');
    }
  });
  $('btnSaveMessage').addEventListener('click', async () => {
    try {
      await saveMessage();
      toast('消息模板已保存', 'success');
    } catch (e) {
      toast(String(e.message || e), 'error');
    }
  });
  $('btnSaveSettings').addEventListener('click', async () => {
    try {
      await saveSettings();
      toast('设置已保存', 'success');
    } catch (e) {
      toast(String(e.message || e), 'error');
    }
  });
  $('btnSaveResume').addEventListener('click', async () => {
    try {
      await saveResume();
      toast('当前方案已保存', 'success');
    } catch (e) {
      toast(String(e.message || e), 'error');
    }
  });
  $('btnSaveBindings').addEventListener('click', async () => {
    try {
      await saveBindings();
      toast('绑定规则已保存', 'success');
    } catch (e) {
      toast(String(e.message || e), 'error');
    }
  });

  $('btnAddSeg').addEventListener('click', () => {
    const template = readTemplate(state.config.messageTemplate);
    template.segments.push({
      id: `seg_${Date.now().toString(36)}`,
      enabled: true,
      text: ''
    });
    state.config.messageTemplate = template;
    state.formDirty = true;
    renderSegments(template);
    toast('已新增消息段', 'success');
  });

  $('btnAddProfile')?.addEventListener('click', async () => {
    flushActiveProfileForm();
    const resumes = structuredClone(state.config.resumes);
    const id = uid('profile');
    resumes.profiles.push({ id, name: `方案 ${resumes.profiles.length + 1}`, images: [], attachment: null });
    if (!resumes.defaultProfileId) resumes.defaultProfileId = id;
    state.activeProfileId = id;
    await api(MSG.SAVE_RESUMES, resumes);
    state.formDirty = false;
    await refresh({ soft: false });
    toast('已新建方案', 'success');
  });

  $('btnSetDefaultProfile')?.addEventListener('click', async () => {
    flushActiveProfileForm();
    const resumes = structuredClone(state.config.resumes);
    resumes.defaultProfileId = state.activeProfileId || resumes.defaultProfileId;
    await api(MSG.SAVE_RESUMES, resumes);
    state.formDirty = false;
    await refresh({ soft: false });
    toast('已设为默认方案', 'success');
  });

  $('btnDeleteProfile')?.addEventListener('click', async () => {
    const resumes = structuredClone(state.config.resumes);
    if ((resumes.profiles || []).length <= 1) {
      toast('至少保留一个方案', 'error');
      return;
    }
    const delId = state.activeProfileId;
    resumes.profiles = resumes.profiles.filter((p) => p.id !== delId);
    if (resumes.defaultProfileId === delId) resumes.defaultProfileId = resumes.profiles[0].id;
    state.activeProfileId = resumes.defaultProfileId;
    const bindings = { rules: (state.config.bindings?.rules || []).filter((r) => r.profileId !== delId) };
    await api(MSG.SAVE_RESUMES, resumes);
    await api(MSG.SAVE_BINDINGS, bindings);
    state.formDirty = false;
    await refresh({ soft: false });
    toast('方案已删除', 'success');
  });

  $('btnClearImages')?.addEventListener('click', async () => {
    const resumes = structuredClone(state.config.resumes);
    const profile = resumes.profiles.find((p) => p.id === state.activeProfileId);
    if (profile) profile.images = [];
    await api(MSG.SAVE_RESUMES, resumes);
    state.formDirty = false;
    await refresh({ soft: false });
    toast('已清空图片', 'success');
  });

  $('btnClearAttach')?.addEventListener('click', async () => {
    const resumes = structuredClone(state.config.resumes);
    const profile = resumes.profiles.find((p) => p.id === state.activeProfileId);
    if (profile) profile.attachment = null;
    await api(MSG.SAVE_RESUMES, resumes);
    state.formDirty = false;
    await refresh({ soft: false });
    toast('已清除附件', 'success');
  });

  $('btnAddBinding')?.addEventListener('click', () => {
    const profileId = state.activeProfileId || state.config.resumes.defaultProfileId || state.config.resumes.profiles[0]?.id;
    state.draftBindings = readBindingsFromDom();
    state.draftBindings.push({ id: uid('rule'), keywords: [], profileId, priority: state.draftBindings.length });
    state.formDirty = true;
    renderBindings();
    toast('已新增绑定规则', 'success');
  });

  $('btnPreview').addEventListener('click', async () => {
    if (state.isBoss === false) return toast(state.bossBlockReason || '仅在 BOSS 直聘页面可用', 'error');
    toast('开始扫描预览…', 'warn', 1500);
    await saveFilters();
    $('btnPreview').disabled = true;
    $('taskStatus').textContent = '状态：扫描中…';
    const res = await api(MSG.RUN_PREVIEW, { scroll: true });
    if (!res?.ok) {
      toast(res?.message || res?.error || '扫描失败，请打开职位列表页', 'error', 3500);
      setConn(false, '页面未就绪');
      showErrorModal('扫描失败', res?.message || res?.error || '请打开 BOSS 职位列表页后重试', { showRetry: false });
    } else if (res.summary) {
      toast(`扫描完成：通过 ${res.summary.pass} / 共 ${res.summary.scanned}`, 'success');
    } else {
      toast('预览完成', 'success');
    }
    await refresh({ soft: false });
    $('btnPreview').disabled = false;
  });

  $('btnDiagnose')?.addEventListener('click', async () => {
    if (state.isBoss === false) return toast(state.bossBlockReason || '仅在 BOSS 直聘页面可用', 'error');
    toast('正在诊断页面…', 'warn', 1200);
    const res = await api(MSG.DIAGNOSE);
    if (!res?.ok) {
      toast(res?.message || res?.error || '诊断失败', 'error');
      return;
    }
    const c = res.counts || {};
    const sample = (res.samples || [])[0];
    const lines = [
      `URL: ${res.url || ''}`,
      `卡片: ${c.cardsTotal ?? c.card ?? 0}`,
      `标题节点: ${c.title ?? 0}`,
      `公司节点: ${c.company ?? 0}`,
      sample ? `样例: ${sample.title || ''} @ ${sample.company || ''}` : '样例: 无'
    ];
    $('summaryBox').textContent = lines.join('\n');
    toast((c.cardsTotal || 0) > 0 ? '诊断完成：已识别岗位卡片' : '诊断完成：未识别到岗位卡片', (c.cardsTotal || 0) > 0 ? 'success' : 'warn');
  });

  $('btnStart').addEventListener('click', async () => {
    if (state.isBoss === false) return toast(state.bossBlockReason || '仅在 BOSS 直聘页面可用', 'error');
    const selectedJobIds = Array.from(state.selected);
    if (!selectedJobIds.length) {
      toast('请至少选择一个通过岗位', 'error');
      return;
    }
    toast('正在启动投递…', 'warn', 1500);
    const res = await api(MSG.CONFIRM_AND_START, { selectedJobIds });
    if (!res?.ok) {
      toast(res?.message || res?.error || '启动失败', 'error', 3500);
      showErrorModal('启动失败', res?.message || res?.error || '无法开始任务', { showRetry: false });
    } else {
      toast('已开始投递', 'success');
    }
    await refresh({ soft: true });
  });

  
  $('btnTestOne')?.addEventListener('click', async () => {
    if (state.isBoss === false) return toast(state.bossBlockReason || '仅在 BOSS 直聘页面可用', 'error');
    // save settings first so resume flags apply
    try { await saveSettings(); await saveResume(); await saveMessage(); } catch (_) {}
    let selectedJobIds = Array.from(state.selected || []);
    if (!selectedJobIds.length) {
      const pass = (state.config?.task?.results || []).filter((r) => r.decision === 'pass');
      if (pass[0]?.job?.jobId) selectedJobIds = [pass[0].job.jobId];
    }
    if (!selectedJobIds.length) {
      toast('请先扫描预览并至少有一个通过岗位', 'error');
      return;
    }
    // only first for test
    selectedJobIds = selectedJobIds.slice(0, 1);
    const settings = {
      ...(state.config?.settings || {}),
      autoSendImageResume: !!$('autoSendImageResume')?.checked,
      autoSendAttachmentResume: !!$('autoSendAttachmentResume')?.checked,
      resumeSendTiming: $('resumeSendTiming')?.value || 'on_request'
    };
    if (settings.autoSendImageResume && settings.resumeSendTiming !== 'after_text') {
      toast('提示：已勾选自动发图，但时机不是「文本发送完成后」。测试将按当前设置执行', 'warn', 3500);
    } else if (!settings.autoSendImageResume) {
      toast('提示：未勾选自动发图片简历，本次测试通常只发文字', 'warn', 2800);
    }
    toast('正在启动测试投递（仅 1 岗）…', 'warn', 1500);
    const res = await api(MSG.RUN_TEST_DELIVERY || 'BHT_RUN_TEST_DELIVERY', {
      jobId: selectedJobIds[0],
      selectedJobIds
    });
    if (!res?.ok) {
      toast(res?.message || res?.error || '测试投递启动失败', 'error', 3500);
      showErrorModal('测试投递失败', res?.message || res?.error || '无法启动', { showRetry: false });
    } else {
      toast('测试投递已开始：' + (res.job?.title || selectedJobIds[0]), 'success');
    }
    await refresh({ soft: true });
  });

// controls wired in wireControlButtons()

  $('btnCopyLogs')?.addEventListener('click', async () => {
    const logs = state.config?.logs || [];
    const text = logs
      .slice()
      .reverse()
      .map((l) => {
        const time = new Date(l.ts || Date.now()).toLocaleTimeString();
        return `[${time}] ${l.message || ''}`;
      })
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || '暂无日志');
      toast('日志已复制', 'success');
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text || '暂无日志';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      toast('日志已复制', 'success');
    }
  });

  $('btnClearLogs').addEventListener('click', async () => {
    await api(MSG.CLEAR_LOGS);
    toast('日志已清空', 'success');
    await refresh({ soft: true });
  });

  $('selectAllPass').addEventListener('change', () => {
    const on = $('selectAllPass').checked;
    document.querySelectorAll('#previewList input[data-job]').forEach((input) => {
      input.checked = on;
      const id = input.getAttribute('data-job');
      if (on) state.selected.add(id);
      else state.selected.delete(id);
    });
    toast(on ? '已全选通过项' : '已取消全选', 'success', 1200);
  });

  $('btnExport').addEventListener('click', async () => {
    const res = await api(MSG.EXPORT_CONFIG);
    if (!res?.ok) return toast('导出失败', 'error');
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `boss-haitou-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('配置已导出', 'success');
  });

  $('importFile').addEventListener('change', async () => {
    const file = $('importFile').files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await api(MSG.IMPORT_CONFIG, { data });
      if (!res?.ok) throw new Error(res?.error || '导入失败');
      state.formDirty = false;
      await refresh({ soft: false });
      toast('导入成功', 'success');
    } catch (e) {
      toast(String(e.message || e), 'error');
    } finally {
      $('importFile').value = '';
    }
  });
}


chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === MSG.TASK_EVENT) {
    if (state.config) state.config.task = msg.payload;
    updateTaskUI(msg.payload, state.config?.runner || {});
    if (
      msg.payload?.status === 'paused' &&
      msg.payload?.awaitingUserRetry &&
      msg.payload?.pauseReason &&
      !msg.payload?.uiErrorDismissed &&
      !state.modalDismissed
    ) {
      const reason = msg.payload.pauseReason;
      const detail = msg.payload?.lastErrorDetail || '';
      const body = reason + (detail ? ('\n\n' + detail) : '');
      const key = msg.payload?.errorKey || ('投递已暂停|' + body);
      if (state.modalClosedForKey && state.modalClosedForKey === key) return;
      showErrorModal('投递已暂停', body, { showRetry: true, force: false });
    }
  }
  if (msg?.type === MSG.LOG_EVENT) {
    const logs = [msg.payload, ...(state.config?.logs || [])].slice(0, 100);
    if (state.config) state.config.logs = logs;
    renderLogs(logs);
  }
});

$('bht-modal-close')?.addEventListener('click', async () => {
  state.modalDismissed = true;
  const bodyText = $('bht-modal-body')?.textContent || '';
  state.modalClosedForKey = state.lastModalKey || ('投递已暂停|' + bodyText);
  state.lastModalKey = state.modalClosedForKey;
  const modal = $('bht-modal');
  if (modal) modal.hidden = true;
  try {
    await api(MSG.DISMISS_ERROR_MODAL, {});
  } catch (_) {
    try { await api('BHT_DISMISS_ERROR_MODAL', {}); } catch (__) {}
  }
  if (state.config?.task) {
    state.config.task.awaitingUserRetry = false;
    state.config.task.uiErrorDismissed = true;
  }
  toast('已关闭，任务保持暂停，不会自动重试', 'warn', 2800);
  forceEnableControls();
});

$('bht-modal-retry')?.addEventListener('click', async () => {
  state.modalDismissed = false;
  state.modalClosedForKey = '';
  state.lastModalKey = '';
  const modal = $('bht-modal');
  if (modal) modal.hidden = true;
  toast('正在重试当前失败岗位…', 'warn', 1500);
  const res = await api(MSG.RESUME_TASK, { retry: true });
  if (!res?.ok) {
    state.modalDismissed = false;
    showErrorModal('重试失败', res?.message || res?.error || '请重新扫描预览后再试', { showRetry: true, force: true });
  } else {
    toast('已开始重试', 'success');
  }
  await refresh({ soft: true });
});

// 控制按钮强制可点 + 独立绑定（防止 disabled/重复状态导致失灵）
function forceEnableControls() {
  ['btnPause', 'btnResume', 'btnSkip', 'btnStop'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = false;
    el.removeAttribute('disabled');
    el.style.pointerEvents = 'auto';
    el.style.opacity = '1';
    el.style.cursor = 'pointer';
    el.tabIndex = 0;
  });
}

function wireControlButtons() {
  const once = (id, handler) => {
    const el = $(id);
    if (!el) return;
    if (el.dataset.bhtWired === '1') return;
    el.dataset.bhtWired = '1';
    el.addEventListener('click', async (ev) => {
      forceEnableControls();
      try {
        await handler(ev);
      } catch (err) {
        toast(String(err?.message || err), 'error');
      }
    });
  };

  once('btnPause', async () => {
    const res = await api(MSG.PAUSE_TASK);
    toast(res?.ok === false ? (res.message || '暂停失败') : '任务已暂停', res?.ok === false ? 'error' : 'warn');
    await refresh({ soft: true });
  });

  once('btnResume', async () => {
    state.modalDismissed = false;
    state.modalClosedForKey = '';
    state.lastModalKey = '';
    const modal = $('bht-modal');
    if (modal) modal.hidden = true;
    toast('继续任务…', 'warn', 1200);
    const res = await api(MSG.RESUME_TASK);
    toast(res?.ok === false ? (res.message || res.error || '继续失败') : '已继续投递', res?.ok === false ? 'error' : 'success');
    await refresh({ soft: true });
  });

  once('btnSkip', async () => {
    const res = await api(MSG.SKIP_CURRENT);
    // 暂停等待中也允许跳过：清 pause 继续循环
    if (state.config?.runner?.pause || state.config?.task?.status === 'paused') {
      await api(MSG.RESUME_TASK);
    }
    toast(res?.ok === false ? (res.message || '跳过失败') : '已请求跳过当前岗位', res?.ok === false ? 'error' : 'warn');
    await refresh({ soft: true });
  });

  once('btnStop', async () => {
    state.modalDismissed = true;
    state.modalClosedForKey = state.lastModalKey || 'stop';
    const modal = $('bht-modal');
    if (modal) modal.hidden = true;
    const res = await api(MSG.STOP_TASK);
    toast(res?.ok === false ? (res.message || '停止失败') : '任务已停止', res?.ok === false ? 'error' : 'warn');
    await refresh({ soft: true });
  });
}

// CONTROL_CAPTURE_INVOKE: 捕获阶段解除 disabled，避免“点了没反应”
document.addEventListener('click', (e) => {
  const btn = e.target?.closest?.('#btnPause, #btnResume, #btnSkip, #btnStop');
  if (!btn) return;
  if (btn.disabled) {
    btn.disabled = false;
    btn.removeAttribute('disabled');
  }
}, true);

bindEvents();
forceEnableControls();
wireControlButtons();
refresh();
setInterval(() => {
  forceEnableControls();
});

$('bht-modal-retry')?.addEventListener('click', async () => {
  state.modalDismissed = false;
  state.modalClosedForKey = '';
  state.lastModalKey = '';
  const modal = $('bht-modal');
  if (modal) modal.hidden = true;
  toast('正在重试当前失败岗位…', 'warn', 1500);
  const res = await api(MSG.RESUME_TASK, { retry: true });
  if (!res?.ok) {
    state.modalDismissed = false;
    showErrorModal('重试失败', res?.message || res?.error || '请重新扫描预览后再试', { showRetry: true, force: true });
  } else {
    toast('已开始重试', 'success');
  }
  await refresh({ soft: true });
});

// 控制按钮强制可点 + 独立绑定（防止 disabled/重复状态导致失灵）
function forceEnableControls() {
  ['btnPause', 'btnResume', 'btnSkip', 'btnStop'].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.disabled = false;
    el.removeAttribute('disabled');
    el.style.pointerEvents = 'auto';
    el.style.opacity = '1';
    el.style.cursor = 'pointer';
    el.tabIndex = 0;
  });
}

function wireControlButtons() {
  const once = (id, handler) => {
    const el = $(id);
    if (!el) return;
    if (el.dataset.bhtWired === '1') return;
    el.dataset.bhtWired = '1';
    el.addEventListener('click', async (ev) => {
      forceEnableControls();
      try {
        await handler(ev);
      } catch (err) {
        toast(String(err?.message || err), 'error');
      }
    });
  };

  once('btnPause', async () => {
    const res = await api(MSG.PAUSE_TASK);
    toast(res?.ok === false ? (res.message || '暂停失败') : '任务已暂停', res?.ok === false ? 'error' : 'warn');
    await refresh({ soft: true });
  });

  once('btnResume', async () => {
    state.modalDismissed = false;
    state.modalClosedForKey = '';
    state.lastModalKey = '';
    const modal = $('bht-modal');
    if (modal) modal.hidden = true;
    toast('继续任务…', 'warn', 1200);
    const res = await api(MSG.RESUME_TASK);
    toast(res?.ok === false ? (res.message || res.error || '继续失败') : '已继续投递', res?.ok === false ? 'error' : 'success');
    await refresh({ soft: true });
  });

  once('btnSkip', async () => {
    const res = await api(MSG.SKIP_CURRENT);
    // 暂停等待中也允许跳过：清 pause 继续循环
    if (state.config?.runner?.pause || state.config?.task?.status === 'paused') {
      await api(MSG.RESUME_TASK);
    }
    toast(res?.ok === false ? (res.message || '跳过失败') : '已请求跳过当前岗位', res?.ok === false ? 'error' : 'warn');
    await refresh({ soft: true });
  });

  once('btnStop', async () => {
    state.modalDismissed = true;
    state.modalClosedForKey = state.lastModalKey || 'stop';
    const modal = $('bht-modal');
    if (modal) modal.hidden = true;
    const res = await api(MSG.STOP_TASK);
    toast(res?.ok === false ? (res.message || '停止失败') : '任务已停止', res?.ok === false ? 'error' : 'warn');
    await refresh({ soft: true });
  });
}

// CONTROL_CAPTURE_INVOKE: 捕获阶段解除 disabled，避免“点了没反应”
document.addEventListener('click', (e) => {
  const btn = e.target?.closest?.('#btnPause, #btnResume, #btnSkip, #btnStop');
  if (!btn) return;
  if (btn.disabled) {
    btn.disabled = false;
    btn.removeAttribute('disabled');
  }
}, true);

bindEvents();
forceEnableControls();
wireControlButtons();
refresh();
setInterval(() => {
  forceEnableControls();
  refresh({ soft: true });
}, 3000);