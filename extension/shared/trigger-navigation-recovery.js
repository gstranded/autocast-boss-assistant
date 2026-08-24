(function initTriggerNavigationRecovery(root) {
  function resolveTriggerNavigationRecovery({
    opType = '',
    triggerType = 'BHT_TRIGGER_CONVERSATION',
    job = {},
    inflightAt = 0,
    now = Date.now(),
    click = null,
    receipt = null,
    href = '',
    contentVersion = ''
  } = {}) {
    if (opType !== triggerType) return null;
    const ids = [job.jobId, job.encryptJobId].map((value) => String(value || '')).filter(Boolean);
    const clickMatches = click &&
      now - Number(click.at || 0) < 6000 &&
      (!click.jobId || !ids.length || ids.includes(String(click.jobId)));
    const receiptMatches = receipt &&
      receipt.ok !== false &&
      Number(receipt.at || 0) >= Number(inflightAt || 0) &&
      (!receipt.jobId || !ids.length || ids.includes(String(receipt.jobId)));
    // 新建沟通必须有 friend/add 成功回执；“继续沟通”本身已证明会话存在。
    if (!receiptMatches && !(clickMatches && click.already)) return null;
    const nativeGreeting = receiptMatches
      ? {
          available: true,
          showGreeting: receipt.hasShowGreeting ? receipt.showGreeting : null,
          text: receipt.greeting || '',
          source: 'friend-add-response',
          at: receipt.at
        }
      : { available: false, showGreeting: null, text: '', source: 'already-contacted' };
    return {
      ok: true,
      phase: 'CHAT_TRIGGERED',
      navigated: true,
      navigationRecovered: true,
      fromHref: href,
      buttonText: clickMatches ? String(click.buttonText || '') : '立即沟通',
      already: Boolean(clickMatches && click.already),
      stayed: false,
      nativeGreeting,
      detailTitle: String(click?.detailTitle || job.title || ''),
      hrName: String(click?.hrName || job.hrName || job.bossName || ''),
      bossName: String(click?.hrName || job.hrName || job.bossName || ''),
      company: String(click?.company || job.company || ''),
      title: String(click?.title || click?.detailTitle || job.title || ''),
      listHref: href,
      contentVersion
    };
  }

  root.BHTTriggerNavigationRecovery = { resolveTriggerNavigationRecovery };
})(globalThis);
