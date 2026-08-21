(() => {
  if (window.__BHT_NETWORK_HOOK_V1__) return;
  window.__BHT_NETWORK_HOOK_V1__ = true;

  const TARGET = /\/wapi\/zpgeek\/friend\/add\.json/i;
  const SOURCE = 'bht-page-network-hook';

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

  function emit(url, payload) {
    if (!TARGET.test(String(url || '')) || !payload || typeof payload !== 'object') return;
    try { window.postMessage(receiptFrom(url, payload), location.origin); } catch (_) {}
  }

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
    this.__bhtFriendAddUrl = String(url || '');
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    if (TARGET.test(this.__bhtFriendAddUrl || '')) {
      this.addEventListener('loadend', () => {
        try {
          const payload = typeof this.response === 'object' && this.response
            ? this.response
            : JSON.parse(this.responseText || '{}');
          emit(this.responseURL || this.__bhtFriendAddUrl, payload);
        } catch (_) {}
      }, { once: true });
    }
    return originalSend.apply(this, args);
  };
})();
