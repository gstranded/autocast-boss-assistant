(() => {
  const clone = (value) => structuredClone(value);
  const persistenceKey = "bht_panel_harness_storage";
  let persistedStorage = {};
  try {
    persistedStorage = JSON.parse(localStorage.getItem(persistenceKey) || "{}");
  } catch (_) {}
  const storage = {
    bht_settings: { theme: "dark" },
    bht_onboarding: { done: true, completed: true },
    ...persistedStorage
  };
  const listeners = [];
  const calls = [];
  const duplicateResumeFixture = new URLSearchParams(location.search).get("duplicateResume") === "1";
  const resumeFixtureImage = {
    name: "resume.png",
    size: 68,
    type: "image/png",
    dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl6sAAAAASUVORK5CYII="
  };

  const state = {
    activeIsBoss: true,
    activeTab: { id: 101, url: "https://www.zhipin.com/web/geek/jobs" },
    settings: {
      theme: "dark",
      messageMode: "auto_detect",
      similarityThreshold: 0.85,
      pluginTextEnabled: true,
      strictGreetingGuard: true,
      nativeGreetingWaitMs: 2600,
      taskMaxCommunicate: 1,
      dailyMaxCommunicate: 80,
      companyDailyMax: 3,
      bossCooldownDays: 30,
      consecutiveFailPause: 3,
      neverRepeatJob: true,
      splitViewEnabled: true,
      whitelistOnly: false,
      autoSendImageResume: false,
      autoSendAttachmentResume: false,
      resumeSendTiming: "manual"
    },
    filters: {
      title: {
        or: ["Agent", "大模型"],
        and: [],
        not: ["外包"],
        enabled: { or: true, and: true, not: true }
      },
      company: { or: [], and: [], not: [], enabled: { or: true, and: true, not: true } },
      jd: { or: [], and: [], not: ["培训"], enabled: { or: true, and: true, not: true } },
      location: {
        include: ["广州"],
        exclude: [],
        mode: "contains",
        enabled: { include: true, exclude: true }
      },
      salaryMin: null,
      salaryMax: null,
      experience: [],
      degree: [],
      activeWithin: "",
      excludeHunter: true,
      excludeOutsource: true,
      maxPostAgeDays: null
    },
    lists: { companyBlacklist: [], companyWhitelist: [] },
    messageTemplate: {
      version: 1,
      segments: [
        { id: "seg_1", kind: "greeting", enabled: true, text: "您好，我对{职位名称}很感兴趣。" },
        { id: "seg_2", kind: "supplement", enabled: true, text: "我有相关项目经验，期待进一步沟通。" }
      ]
    },
    bossGreeting: {
      ok: true,
      enabled: true,
      status: "on",
      templateId: "harness-template-1",
      text: "Boss您好，我对贵司这个岗位很感兴趣，方便聊聊吗？",
      templates: [{ templateId: "harness-template-1", text: "Boss您好，我对贵司这个岗位很感兴趣，方便聊聊吗？" }],
      syncedAt: Date.now(),
      source: "harness"
    },
    resumes: {
      profiles: [{
        id: "default",
        name: "默认简历",
        images: duplicateResumeFixture
          ? [{ ...resumeFixtureImage }, { ...resumeFixtureImage }]
          : [],
        attachment: null
      }],
      defaultProfileId: "default"
    },
    bindings: { rules: [] },
    history: [],
    idempotency: {},
    task: null,
    logs: [{ id: "log_1", ts: Date.now(), level: "info", message: "测试容器已连接" }],
    dailyStats: {},
    runner: {}
  };
  state.settings = { ...state.settings, ...(storage.bht_settings || {}) };

  function stateResponse() {
    return { ok: true, runtimeVersion: "1.7.14", ...clone(state) };
  }

  function persistStorage() {
    try {
      localStorage.setItem(persistenceKey, JSON.stringify(storage));
    } catch (_) {}
  }

  function previewTask() {
    return {
      id: "task_harness",
      status: "awaiting_confirm",
      summary: { scanned: 2, pass: 1, reject: 1, byReason: { FILTER_TITLE_NOT: 1 } },
      counters: { success: 0, skipped: 0, failed: 0, processed: 0 },
      results: [
        {
          job: {
            jobId: "job_pass",
            title: "AI Agent 实习生",
            company: "示例科技",
            location: "广州·天河区",
            salary: "20-30K"
          },
          decision: "pass",
          selected: true,
          passReasons: ["符合筛选条件"],
          reasonTexts: []
        },
        {
          job: {
            jobId: "job_reject",
            title: "大模型外包开发",
            company: "示例人力",
            location: "广州",
            salary: "15-20K"
          },
          decision: "reject",
          selected: false,
          passReasons: [],
          reasonTexts: ["职位名称命中排除词：外包"]
        }
      ]
    };
  }

  async function recordCall(type, payload) {
    try {
      await fetch("/__harness/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload })
      });
    } catch (_) {}
  }

  async function sendMessage(message = {}) {
    const type = message.type || "";
    const payload = clone(message.payload);
    calls.push({ type, payload });
    document.documentElement.dataset.harnessLastCall = type;
    document.documentElement.dataset.harnessCallCount = String(calls.length);
    document.documentElement.dataset.harnessCalls = calls.map((call) => call.type).join(",");
    await recordCall(type, payload);

    if (type === "BHT_GET_STATE") return stateResponse();
    if (type === "BHT_GET_RUNNER_STATE") {
      return { ok: true, runtimeVersion: "1.7.14", now: Date.now(), runner: clone(state.runner) };
    }
    if (type === "BHT_GET_BOSS_GREETING") return clone(state.bossGreeting);
    if (type === "BHT_SET_BOSS_GREETING") {
      state.bossGreeting = {
        ...state.bossGreeting,
        ok: true,
        enabled: payload?.enabled === true,
        status: payload?.enabled === true ? "on" : "off",
        syncedAt: Date.now(),
        previousEnabled: state.bossGreeting.enabled,
        changed: state.bossGreeting.enabled !== (payload?.enabled === true)
      };
      document.documentElement.dataset.harnessBossGreeting = state.bossGreeting.status;
      return clone(state.bossGreeting);
    }
    if (type === "BHT_SAVE_BOSS_GREETING_TEXT") {
      const text = String(payload?.text || "").trim();
      const templateId = state.bossGreeting.templateId || "harness-template-1";
      state.bossGreeting = {
        ...state.bossGreeting,
        ok: true,
        templateId,
        text,
        templates: [{ templateId, text, greetingType: 2, editable: true }],
        syncedAt: Date.now(),
        textSaved: true,
        savedTemplateId: templateId
      };
      document.documentElement.dataset.harnessBossGreetingText = text;
      return clone(state.bossGreeting);
    }
    if (type === "BHT_OPEN_BOSS_GREETING_SETTINGS") {
      document.documentElement.dataset.harnessOpenedBossGreetingSettings = "true";
      return { ok: true, tabId: 202 };
    }
    if (type === "BHT_SAVE_SETTINGS") {
      state.settings = { ...state.settings, ...(payload || {}) };
      storage.bht_settings = clone(state.settings);
      persistStorage();
      document.documentElement.dataset.harnessSavedTheme = state.settings.theme || "";
      document.documentElement.dataset.harnessSavedTaskMax = String(state.settings.taskMaxCommunicate ?? "");
      return { ok: true };
    }
    if (type === "BHT_SAVE_FILTERS") {
      state.filters = clone(payload);
      return { ok: true };
    }
    if (type === "BHT_SAVE_LISTS") {
      state.lists = clone(payload);
      return { ok: true };
    }
    if (type === "BHT_SAVE_TEMPLATE") {
      state.messageTemplate = clone(payload);
      return { ok: true };
    }
    if (type === "BHT_SAVE_RESUMES") {
      state.resumes = clone(payload);
      return { ok: true };
    }
    if (type === "BHT_SAVE_BINDINGS") {
      state.bindings = clone(payload);
      return { ok: true };
    }
    if (type === "BHT_RUN_PREVIEW") {
      state.task = previewTask();
      document.documentElement.dataset.harnessPreviewPass = String(state.task.summary.pass);
      return { ok: true, summary: clone(state.task.summary) };
    }
    if (type === "BHT_RUN_TEST_DELIVERY") {
      const jobId = payload?.selectedJobIds?.[0] || payload?.jobId;
      document.documentElement.dataset.harnessTestJobId = jobId || "";
      document.documentElement.dataset.harnessTestJobCount = String(payload?.selectedJobIds?.length || 0);
      state.task = {
        ...previewTask(),
        status: "running",
        testDelivery: true,
        testJobId: jobId
      };
      return {
        ok: true,
        job: clone(state.task.results.find((row) => row.job.jobId === jobId)?.job),
        splitView: { ok: true, simulated: true }
      };
    }
    if (type === "BHT_DIAGNOSE") {
      return {
        ok: true,
        url: state.activeTab.url,
        counts: { cardsTotal: 2, title: 2, company: 2 },
        samples: [{ title: "AI Agent 实习生", company: "示例科技" }]
      };
    }
    if (type === "BHT_CLEAR_LOGS") {
      state.logs = [];
      return { ok: true };
    }
    if (type === "BHT_CLEAR_HISTORY") {
      state.history = [];
      return { ok: true };
    }
    if (type === "BHT_EXPORT_CONFIG") return { ok: true, data: clone(state) };
    if (type === "BHT_IMPORT_CONFIG") return { ok: true };
    if (type === "BHT_PAUSE_TASK") state.task = { ...(state.task || {}), status: "paused" };
    if (type === "BHT_RESUME_TASK") state.task = { ...(state.task || {}), status: "running" };
    if (type === "BHT_STOP_TASK") state.task = { ...(state.task || {}), status: "stopped" };
    return { ok: true };
  }

  globalThis.chrome = {
    runtime: {
      id: "boss-panel-harness",
      lastError: null,
      sendMessage,
      onMessage: { addListener(listener) { listeners.push(listener); } }
    },
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return clone(storage);
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((key) => key in storage).map((key) => [key, clone(storage[key])]));
        },
        async set(values) {
          Object.assign(storage, clone(values));
          persistStorage();
        }
      }
    }
  };

  globalThis.__BHT_HARNESS__ = { calls, listeners, state, storage };
})();
