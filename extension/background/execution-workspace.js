import { isBossTab } from '../shared/boss-url.js';
import { isBossJobListUrl, sameJobListUrl } from '../shared/job-list-navigation.js';
import { computeSideBySideBounds, snapshotWindowBounds, windowBoundsMatch } from '../shared/window-layout.js';

const failure = (error, message) => ({ ok: false, error, message });
const CHAT_URL = 'https://www.zhipin.com/web/geek/chat';

function listUrl(tab) {
  return String(tab?.url || tab?.pendingUrl || '');
}

async function getDisplayMetrics(tabId, browser) {
  try {
    if (!browser?.scripting?.executeScript || tabId == null) return null;
    const rows = await browser.scripting.executeScript({
      target: { tabId },
      func: () => ({
        left: window.screen.availLeft,
        top: window.screen.availTop,
        width: window.screen.availWidth,
        height: window.screen.availHeight
      })
    });
    return rows?.[0]?.result || null;
  } catch (_) {
    return null;
  }
}

async function getFirstTab(windowId, browser) {
  try {
    const tabs = await browser.tabs.query({ windowId });
    return tabs?.[0] || null;
  } catch (_) {
    return null;
  }
}

async function removeWindow(windowId, browser) {
  if (windowId == null || !browser?.windows?.remove) return;
  await browser.windows.remove(windowId).catch(() => {});
}

async function applyPopupBounds(windowId, bounds, browser) {
  if (windowId == null || !bounds) return null;
  const current = await browser.windows.get(windowId).catch(() => null);
  if (!current) throw new Error('后台工作窗口已关闭');
  // A minimized workspace belongs to the user; leave its state alone. Bounds
  // are restored when the user brings it back, and background delivery keeps
  // running against the minimized tab.
  if (current.state === 'minimized') return current;
  await browser.windows.update(windowId, {
    state: 'normal',
    left: bounds.left,
    top: bounds.top,
    width: bounds.width,
    height: bounds.height
  });
  const live = await browser.windows.get(windowId).catch(() => null);
  if (!live || !windowBoundsMatch(live, bounds, { positionTolerancePx: 2, sizeTolerancePx: 2 })) {
    throw new Error('浏览器未应用左右分屏窗口尺寸');
  }
  return live;
}

function listCandidates(task, tabs = []) {
  const candidates = (tabs || []).filter((tab) => isBossJobListUrl(listUrl(tab)));
  if (candidates.length <= 1) return candidates;

  const savedHref = String(task?.sourceContext?.listHref || task?.listHref || '').trim();
  if (!savedHref) return candidates;
  const exact = candidates.filter((tab) => listUrl(tab) === savedHref);
  if (exact.length === 1) return exact;
  const same = candidates.filter((tab) => sameJobListUrl(savedHref, listUrl(tab)) === true);
  return same.length === 1 ? same : candidates;
}

function chooseWorkspaceList(task, tabs = []) {
  const candidates = listCandidates(task, tabs);
  if (candidates.length === 1) return candidates[0];
  const savedId = Number(task?.execution?.listTabId);
  if (Number.isFinite(savedId)) {
    const saved = candidates.find((tab) => Number(tab.id) === savedId);
    if (saved) return saved;
  }
  // Several equally plausible list pages are unsafe to guess between: using
  // the wrong source can send a valid job to the wrong task snapshot.
  return null;
}

export async function backgroundWorkspaceProblem(task, browser = chrome) {
  if (!task?.execution?.backgroundDeliveryActive) return null;
  const execution = task.execution;
  const windowId = execution.backgroundWindowId;
  if (windowId == null) return failure('BACKGROUND_WINDOW_CLOSED', '后台工作窗口已关闭，请重新扫描职位列表后继续');
  const win = await browser.windows.get(windowId).catch(() => null);
  if (!win) return failure('BACKGROUND_WINDOW_CLOSED', '后台工作窗口已关闭，请重新扫描职位列表后继续');

  let list = await browser.tabs.get(execution.listTabId).catch(() => null);
  if (list?.windowId !== windowId) {
    // The saved tab id can point to a duplicate BOSS list page opened by a
    // floating panel. Prefer the live list tab in the delivery-owned window;
    // otherwise a valid background workspace is incorrectly reported as
    // BACKGROUND_LIST_MOVED on the next start/resume.
    const workspaceTabs = await browser.tabs.query({ windowId }).catch(() => []);
    const workspaceList = chooseWorkspaceList(task, workspaceTabs);
    if (workspaceList) {
      list = workspaceList;
      execution.listTabId = workspaceList.id;
      execution.listWindowId = workspaceList.windowId;
    }
  }
  if (!list || list.windowId !== windowId || !isBossJobListUrl(listUrl(list))) {
    return failure('BACKGROUND_LIST_MOVED', '后台职位列表已离开工作窗口或被导航，已暂停以保护原页面');
  }
  if (win.type && win.type !== 'popup') {
    return failure('BACKGROUND_WORKSPACE_INVALID', '旧版投递窗口无法精确左右分屏，将重建工作区');
  }

  // New workspaces always have two distinct popup windows. A legacy task can
  // have stored the chat tab in the same window as the list; treat that as an
  // invalid legacy workspace so recovery rebuilds it without deleting the
  // list window first.
  if (execution.splitViewActive && (
    execution.messageWindowId == null ||
    execution.messageWindowId === windowId ||
    execution.messageTabId == null
  )) {
    return failure('BACKGROUND_WORKSPACE_INVALID', '旧版投递工作区缺少独立消息窗口，将重建工作区');
  }

  if (execution.messageWindowId != null) {
    const messageWindow = await browser.windows.get(execution.messageWindowId).catch(() => null);
    if (!messageWindow) return failure('BACKGROUND_WINDOW_CLOSED', '后台消息窗口已关闭，请重新扫描职位列表后继续');
    // Older builds created normal windows. On macOS those windows cannot be
    // narrowed to a half-screen width, so they overlap even when their saved
    // bounds look like a split. Rebuild that legacy workspace as two popups.
    if (messageWindow.type && messageWindow.type !== 'popup') {
      return failure('BACKGROUND_WORKSPACE_INVALID', '旧版投递窗口无法精确左右分屏，将重建工作区');
    }
    if (execution.messageTabId != null) {
      const messageTab = await browser.tabs.get(execution.messageTabId).catch(() => null);
      if (!messageTab || messageTab.windowId !== messageWindow.id || !/\/chat(?:\/|$)/i.test(listUrl(messageTab))) {
        return failure('BACKGROUND_MESSAGE_MOVED', '后台消息页已关闭或离开消息窗口，已暂停以保护投递状态');
      }
    }
  }
  return null;
}

export async function activateBackgroundTab(windowId, tabId, browser = chrome, allowedWindowIds = [windowId]) {
  if (windowId == null || tabId == null) return failure('BACKGROUND_WINDOW_CLOSED', '后台工作窗口或执行标签已关闭');
  const win = await browser.windows.get(windowId).catch(() => null);
  if (!win) return failure('BACKGROUND_WINDOW_CLOSED', '后台工作窗口已关闭');
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab || !allowedWindowIds.includes(tab.windowId)) return failure('BACKGROUND_TAB_MOVED', '执行标签已离开后台工作窗口，已停止本次操作');
  // Activating a tab in a minimized window is unnecessary and can cause some
  // Chromium builds to restore or raise that window. Keep the tab alive and
  // let page operations run without changing the user's desktop.
  if (win.state === 'minimized' || win.focused === false) {
    await browser.tabs.update(tabId, { autoDiscardable: false });
    return { ok: true, minimized: win.state === 'minimized', unfocused: win.focused === false };
  }
  await browser.tabs.update(tabId, { active: true, autoDiscardable: false });
  return { ok: true };
}

/**
 * Navigate a delivery-owned tab without restoring a minimized window. Chrome
 * can otherwise raise a minimized window when a navigation is paired with
 * `active: true`; the tab only needs to remain live for background DOM work.
 */
export async function navigateBackgroundTab(tabId, url, browser = chrome, allowedWindowIds = []) {
  if (tabId == null) return failure('BACKGROUND_TAB_CLOSED', '后台执行标签已关闭');
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab || (allowedWindowIds.length && !allowedWindowIds.includes(tab.windowId))) {
    return failure('BACKGROUND_TAB_MOVED', '执行标签已离开后台工作窗口，已停止本次操作');
  }
  const win = await browser.windows.get(tab.windowId).catch(() => null);
  if (!win) return failure('BACKGROUND_WINDOW_CLOSED', '后台工作窗口已关闭');
  const patch = { url, autoDiscardable: false };
  if (win.state !== 'minimized' && win.focused !== false) patch.active = true;
  await browser.tabs.update(tabId, patch);
  return {
    ok: true,
    minimized: win.state === 'minimized',
    unfocused: win.focused === false,
    tab: { ...tab, ...patch }
  };
}

/**
 * Prepare the background delivery workspace with two exact-size popup windows.
 * The existing job-list tab is moved into the left popup so its URL, SPA state,
 * filters and content instance remain intact; the chat popup occupies the right.
 */
export async function prepareBackgroundWorkspace(task, browser = chrome) {
  const execution = task.execution || (task.execution = {});
  if (execution.listTabId == null) return failure('LIST_TAB_NOT_FOUND', '未找到任务的职位列表，请重新扫描预览');

  let list = await browser.tabs.get(execution.listTabId).catch(() => null);

  // A floating panel may send a later start request from a duplicate/old
  // BOSS list tab. Once a background workspace already exists, the delivery
  // window is authoritative: recover the list tab that is actually inside
  // that window before validating the workspace. Without this lookup a stale
  // tab id makes an otherwise healthy workspace look "moved" and pauses the
  // queue before the next job starts.
  if (
    execution.backgroundDeliveryActive &&
    execution.backgroundWindowId != null &&
    list?.windowId !== execution.backgroundWindowId
  ) {
    const workspaceTabs = await browser.tabs.query({ windowId: execution.backgroundWindowId }).catch(() => []);
    const workspaceList = chooseWorkspaceList(task, workspaceTabs);
    if (workspaceList) {
      list = workspaceList;
      execution.listTabId = workspaceList.id;
      execution.listWindowId = workspaceList.windowId;
    }
  }
  if (!isBossTab(list) || !isBossJobListUrl(listUrl(list))) {
    return failure('LIST_TAB_NOT_FOUND', '未找到任务的职位列表，请重新扫描预览');
  }

  if (execution.backgroundDeliveryActive) {
    const problem = await backgroundWorkspaceProblem(task, browser);
    if (!problem) {
      // backgroundWorkspaceProblem may have replaced a stale listTabId with
      // the live tab inside the delivery popup. Use that id consistently for
      // activation and for the result returned to the panel.
      list = await browser.tabs.get(execution.listTabId).catch(() => list);
      try {
        const savedBounds = execution.splitBounds || null;
        if (savedBounds?.left) await applyPopupBounds(execution.backgroundWindowId, savedBounds.left, browser);
        if (savedBounds?.right && execution.messageWindowId != null) {
          await applyPopupBounds(execution.messageWindowId, savedBounds.right, browser);
        }
      } catch (_) {
        // Rebuild below if a popup was resized or the browser rejected its
        // exact bounds. Never report a split workspace that overlaps.
        execution.splitViewActive = false;
      }
      if (execution.splitViewActive) {
        await activateBackgroundTab(execution.backgroundWindowId, list.id, browser, [execution.backgroundWindowId]);
        return {
          ok: true,
          background: true,
          reused: true,
          splitView: true,
          listTabId: list.id,
          messageTabId: execution.messageTabId,
          windowId: execution.backgroundWindowId,
          messageWindowId: execution.messageWindowId,
          bounds: execution.splitBounds || null
        };
      }
    }
    // A minimized or moved workspace needs user attention. If only the chat
    // window disappeared, keep the original list window and rebuild one chat
    // window; never remove the user's job-list window. Legacy normal windows
    // are delivery-owned too, so rebuild them as exact-size popups.
    const rebuildProblem = problem || { error: 'BACKGROUND_WORKSPACE_INVALID' };
    if (!['BACKGROUND_WINDOW_CLOSED', 'BACKGROUND_MESSAGE_MOVED', 'BACKGROUND_WORKSPACE_INVALID'].includes(rebuildProblem.error)) return rebuildProblem;
    const legacyListWindowId = execution.backgroundWindowId;
    const legacyMessageWindowId = execution.messageWindowId;
    const legacyMessageTabId = execution.messageTabId;
    // Older background builds put the message tab in the same normal window
    // as the list. That window is also the source tab's owner, so removing it
    // here would destroy the only recoverable job-list page. Leave it intact;
    // the successful rebuild removes the old delivery window after moving the
    // list tab into the new popup.
    if (execution.messageWindowId != null && execution.messageWindowId !== execution.backgroundWindowId) {
      await removeWindow(execution.messageWindowId, browser);
    }
    execution.backgroundDeliveryActive = false;
    execution.splitViewActive = false;
    execution.messageTabId = null;
    execution.messageWindowId = null;
    execution.backgroundWindowId = list.windowId;
    execution.listWindowId = list.windowId;
    execution.legacyListWindowId = legacyListWindowId;
    execution.legacyMessageWindowId = legacyMessageWindowId;
    execution.legacyMessageTabId = legacyMessageTabId;
  }

  const sourceWindowId = list.windowId;
  const sourceWindow = await browser.windows.get(sourceWindowId).catch(() => null);
  if (!sourceWindow) return failure('BACKGROUND_WINDOW_CLOSED', '职位列表所在窗口已关闭，请重新扫描职位列表后继续');
  const originalBounds = snapshotWindowBounds(sourceWindow);
  const originalIndex = Number.isFinite(Number(list.index)) ? Number(list.index) : 0;
  const display = await getDisplayMetrics(list.id, browser) || sourceWindow;
  const bounds = computeSideBySideBounds(display, { minWidth: 520, minHeight: 600 });
  if (!bounds) return failure('DISPLAY_TOO_SMALL', '当前屏幕空间不足，无法创建左右后台工作窗口；已保留原职位页');

  let listWindow = null;
  let listWindowId = sourceWindowId;
  let listRelocated = false;
  let messageWindow = null;
  try {
    // A normal Chrome window has a platform-enforced minimum width (about
    // 900px on macOS). Two normal windows therefore overlap on a 1470px
    // display even when windows.update reports the requested 735px bounds.
    // Popup windows honor the exact split bounds. Moving the existing list tab
    // into a popup preserves its URL, SPA state, filters and content instance.
    listWindow = await browser.windows.create({
      tabId: list.id,
      type: 'popup',
      focused: false,
      ...bounds.left
    });
    if (listWindow?.id == null) throw new Error('Missing background list window');
    listWindowId = listWindow.id;
    listRelocated = listWindowId !== sourceWindowId;
    await applyPopupBounds(listWindowId, bounds.left, browser);

    messageWindow = await browser.windows.create({
      url: CHAT_URL,
      type: 'popup',
      focused: false,
      ...bounds.right
    });
    if (messageWindow?.id == null) throw new Error('Missing background message window');
    const messageTab = messageWindow.tabs?.[0] || await getFirstTab(messageWindow.id, browser);
    if (!messageTab?.id) throw new Error('Missing background message tab');
    await applyPopupBounds(messageWindow.id, bounds.right, browser);

    execution.backgroundDeliveryActive = true;
    execution.backgroundWindowId = listWindowId;
    execution.listWindowId = listWindowId;
    execution.listTabId = list.id;
    execution.splitViewActive = true;
    execution.splitBounds = bounds;
    execution.messageTabId = messageTab.id;
    execution.messageWindowId = messageWindow.id;
    // A legacy same-window workspace may still contain user tabs alongside
    // the old chat tab. Remove only the delivery-owned chat tab; never close
    // the whole normal window and take unrelated user pages with it.
    if (execution.legacyMessageWindowId === execution.legacyListWindowId &&
        execution.legacyMessageTabId != null &&
        execution.legacyMessageTabId !== list.id) {
      if (browser.tabs?.remove) await browser.tabs.remove(execution.legacyMessageTabId).catch(() => {});
    }
    // A legacy list popup is safe to discard only when it is distinct from
    // the original source window. Even then, leave cleanup to Chrome if it is
    // still hosting an unrelated tab; the new workspace is already valid.
    if (execution.legacyListWindowId != null &&
        execution.legacyListWindowId !== listWindowId &&
        execution.legacyListWindowId !== messageWindow.id) {
      const legacyTabs = await browser.tabs.query({ windowId: execution.legacyListWindowId }).catch(() => []);
      if (!legacyTabs.length) await removeWindow(execution.legacyListWindowId, browser);
    }
    delete execution.legacyListWindowId;
    delete execution.legacyMessageWindowId;
    delete execution.legacyMessageTabId;
    // The tab moved into the new popup is already the popup's active tab.
    // Do not send an explicit active:true update here: on some Chromium/macOS
    // builds that can raise an unfocused popup and steal the user's desktop.
    await browser.tabs.update(list.id, { autoDiscardable: false });
    // The new chat window is intentionally created unfocused. Activating its
    // tab here can steal focus back from the user's current application.
    await browser.tabs.update(messageTab.id, { autoDiscardable: false });
    return {
      ok: true,
      background: true,
      splitView: true,
      listTabId: list.id,
      messageTabId: messageTab.id,
      windowId: listWindowId,
      messageWindowId: messageWindow.id,
      bounds,
      listWindowType: 'popup',
      messageWindowType: 'popup'
    };
  } catch (error) {
    if (messageWindow?.id != null) await removeWindow(messageWindow.id, browser);
    let listRecovered = !listRelocated;
    if (listRelocated && listWindowId !== sourceWindowId) {
      // Moving the only tab out of a normal window may make Chromium close
      // the source window automatically. Only delete the new popup after the
      // tab is confirmed to be back in the source window; otherwise preserve
      // it as the recovery workspace so the filtered SPA page is not lost.
      const sourceStillExists = Boolean(await browser.windows.get(sourceWindowId).catch(() => null));
      if (sourceStillExists) {
        await browser.tabs.move(list.id, { windowId: sourceWindowId, index: Math.min(originalIndex, 1000) }).catch(() => {});
        const movedBack = await browser.tabs.get(list.id).catch(() => null);
        listRecovered = Boolean(movedBack && movedBack.windowId === sourceWindowId);
      }
      if (listRecovered) await removeWindow(listWindowId, browser);
    } else if (originalBounds) {
      await browser.windows.update(sourceWindowId, {
        state: originalBounds.state || 'normal',
        ...(originalBounds.state === 'normal' ? originalBounds : {})
      }).catch(() => {});
    }
    execution.backgroundDeliveryActive = false;
    execution.splitViewActive = false;
    execution.messageTabId = null;
    execution.messageWindowId = null;
    // If Chromium closed the source while relocating its only tab, the new
    // popup still owns the intact list document and must remain retryable.
    const recoveryWindowId = listRecovered ? sourceWindowId : listWindowId;
    execution.backgroundWindowId = recoveryWindowId;
    execution.listWindowId = recoveryWindowId;
    if (!listRecovered && listWindowId != null && listWindowId !== sourceWindowId) {
      execution.listTabId = list.id;
    }
    delete execution.legacyListWindowId;
    return failure('BACKGROUND_WORKSPACE_FAILED', '无法创建后台工作窗口，任务未开始；请检查浏览器窗口后重试');
  }
}
