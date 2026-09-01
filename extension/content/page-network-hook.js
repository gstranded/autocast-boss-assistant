(() => {
  if (window.__BHT_NETWORK_HOOK_V2__) return;
  window.__BHT_NETWORK_HOOK_V2__ = true;

  const FRIEND_TARGET = /\/wapi\/zpgeek\/friend\/add\.json/i;
  const LIST_TARGET = /\/wapi\/zpgeek\/(?:search\/joblist|pc\/recommend\/job\/list|pc\/special\/zone\/joblist)\.json/i;
  const DETAIL_TARGET = /\/wapi\/zpgeek\/job\/detail\.json/i;
  const TARGET = new RegExp(
    [FRIEND_TARGET.source, LIST_TARGET.source, DETAIL_TARGET.source].join('|'),
    'i'
  );
  const SOURCE = 'bht-page-network-hook';
  const metadataCache = new Map();
  let cachedHasMore = null;

  function receiptFrom(url, payload) {
    const zpData = payload?.zpData || {};
    const greetingValue = zpData.greeting;
    const text = String(
      typeof greetingValue === 'string'
        ? greetingValue
        : greetingValue?.demo || greetingValue?.content || zpData.greetingText || ''
    ).trim();
    const rawShowGreeting = zpData.showGreeting;
    const hasShowGreeting =
      typeof rawShowGreeting === 'boolean' ||
      rawShowGreeting === 0 ||
      rawShowGreeting === 1;
    let jobId = '';
    try { jobId = new URL(String(url || ''), location.origin).searchParams.get('jobId') || ''; } catch (_) {}
    return {
      source: SOURCE,
      type: 'friend-add-receipt',
      at: Date.now(),
      jobId,
      code: Number(payload?.code),
      ok: Number(payload?.code) === 0,
      hasShowGreeting,
      showGreeting: hasShowGreeting ? Boolean(rawShowGreeting) : null,
      greeting: text
    };
  }

  function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null && value !== '');
  }

  function compactJobMetadata(raw = {}, source = 'list') {
    const jobInfo = raw.jobInfo || {};
    const bossInfo = raw.bossInfo || {};
    const bossOnlineRaw = firstDefined(raw.bossOnline, bossInfo.bossOnline);
    const bossOnline = bossOnlineRaw === true || bossOnlineRaw === 1 || bossOnlineRaw === '1';
    const activeTimeDesc = String(firstDefined(raw.activeTimeDesc, bossInfo.activeTimeDesc, '') || '').trim();
    return {
      jobId: String(firstDefined(raw.encryptJobId, raw.encryptId, raw.jobId, jobInfo.encryptId, '') || ''),
      securityId: String(firstDefined(raw.securityId, '') || ''),
      lid: String(firstDefined(raw.lid, '') || ''),
      bossId: String(firstDefined(raw.encryptBossId, raw.bossId, bossInfo.encryptBossId, '') || ''),
      bossName: String(firstDefined(raw.bossName, bossInfo.name, '') || '').trim(),
      bossTitle: String(firstDefined(raw.bossTitle, bossInfo.title, '') || '').trim(),
      brandName: String(firstDefined(raw.brandName, bossInfo.brandName, '') || '').trim(),
      bossOnline,
      activeText: bossOnline ? '在线' : activeTimeDesc,
      source
    };
  }

  function metadataFrom(url, payload) {
    const href = String(url || '');
    const zpData = payload?.zpData || {};
    if (LIST_TARGET.test(href)) {
      const list = Array.isArray(zpData.jobList)
        ? zpData.jobList
        : Array.isArray(zpData.list)
          ? zpData.list
          : [];
      return {
        source: SOURCE,
        type: 'job-metadata',
        at: Date.now(),
        endpoint: 'list',
        hasMore: typeof zpData.hasMore === 'boolean' ? zpData.hasMore : null,
        jobs: list.map((job) => compactJobMetadata(job, 'list')).filter((job) => job.jobId)
      };
    }
    if (DETAIL_TARGET.test(href)) {
      const job = compactJobMetadata({
        ...zpData,
        securityId: firstDefined(zpData.securityId, new URL(href, location.origin).searchParams.get('securityId')),
        lid: firstDefined(zpData.lid, new URL(href, location.origin).searchParams.get('lid'))
      }, 'detail');
      return {
        source: SOURCE,
        type: 'job-metadata',
        at: Date.now(),
        endpoint: 'detail',
        hasMore: null,
        jobs: job.jobId ? [job] : []
      };
    }
    return null;
  }

  function emit(url, payload) {
    if (!TARGET.test(String(url || '')) || !payload || typeof payload !== 'object') return;
    try {
      if (FRIEND_TARGET.test(String(url || ''))) {
        window.postMessage(receiptFrom(url, payload), location.origin);
      }
      const metadata = metadataFrom(url, payload);
      if (metadata && (metadata.jobs.length || metadata.hasMore !== null)) {
        if (typeof metadata.hasMore === 'boolean') cachedHasMore = metadata.hasMore;
        for (const job of metadata.jobs) {
          metadataCache.set(job.jobId, { ...(metadataCache.get(job.jobId) || {}), ...job });
        }
        window.postMessage(metadata, location.origin);
      }
    } catch (_) {}
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source !== 'bht-content' || event.data?.type !== 'job-metadata-request') return;
    try {
      window.postMessage({
        source: SOURCE,
        type: 'job-metadata',
        at: Date.now(),
        endpoint: 'cache',
        hasMore: cachedHasMore,
        jobs: Array.from(metadataCache.values()).slice(-2000)
      }, location.origin);
    } catch (_) {}
  });

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || response.url || '';
      if (TARGET.test(String(url || ''))) {
        response.clone().json().then((payload) => emit(url, payload)).catch(() => {});
      }
      return response;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__bhtNetworkUrl = String(url || '');
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (TARGET.test(this.__bhtNetworkUrl || '')) {
      this.addEventListener('loadend', () => {
        try {
          const payload = typeof this.response === 'object' && this.response
            ? this.response
            : JSON.parse(this.responseText || '{}');
          emit(this.responseURL || this.__bhtNetworkUrl, payload);
        } catch (_) {}
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };
})();
