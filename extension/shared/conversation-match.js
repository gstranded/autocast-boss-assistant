(function installConversationMatch(root) {
  "use strict";

  function normalize(input = "") {
    return String(input)
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[，。！？、,.!?;；:：'"“”‘’（）()[\]【】<>《》\-—_]/g, "");
  }

  function classTokens(className = "") {
    return String(className)
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  function hasActiveState(className = "", ariaSelected = "") {
    if (String(ariaSelected).toLowerCase() === "true") return true;
    const tokens = classTokens(className);
    return tokens.some((token) =>
      token === "active" ||
      token === "selected" ||
      token === "current" ||
      token === "on" ||
      token === "is-active" ||
      token === "is-selected"
    );
  }

  function stableConversationKey({
    dataId = "",
    href = "",
    identityText = "",
    text = "",
    index = 0
  } = {}) {
    const id = String(dataId || "").trim();
    if (id) return "id:" + id;

    const link = String(href || "").trim().replace(/#.*$/, "");
    if (link) return "href:" + link;

    const identity = normalize(identityText);
    if (identity) return "identity:" + identity.slice(0, 120);

    const stableLines = String(text || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(今天|昨天|前天|\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日|\d{4}[./-]\d{1,2}[./-]\d{1,2})$/.test(line))
      .filter((line) => !/^\d+$/.test(line))
      .slice(0, 3)
      .join("|");
    const fallback = normalize(stableLines || text);
    return fallback ? "text:" + fallback.slice(0, 120) : "index:" + Number(index || 0);
  }

  function containsPrefix(haystack, needle, length) {
    if (!haystack || !needle) return false;
    return haystack.includes(needle.slice(0, Math.min(length, needle.length)));
  }

  function scoreConversation(item = {}, job = {}, isNew = false) {
    const text = normalize(item.text || "");
    const company = normalize(job.company || "");
    const title = normalize(job.title || "");
    const hr = normalize(job.hrName || job.bossName || "");
    let score = 0;

    if (company && text.includes(company)) score += 70;
    else if (containsPrefix(text, company, 4)) score += 45;

    if (title && text.includes(title)) score += 65;
    else if (containsPrefix(text, title, 6)) score += 35;

    if (hr && text.includes(hr)) score += 30;
    if (isNew) {
      score += 45;
      score += Math.max(0, 15 - Number(item.index || 0));
    }
    return score;
  }

  function selectConversationCandidate(items = [], job = {}, beforeKeys = []) {
    const before = beforeKeys instanceof Set ? beforeKeys : new Set(beforeKeys || []);
    const newItems = items.filter((item) => item?.key && !before.has(item.key));
    const hasTargetIdentity = Boolean(normalize(job.company || job.title || job.hrName || job.bossName || ""));
    if (!hasTargetIdentity && newItems.length === 1) {
      return { ok: true, item: newItems[0], via: "new-single", score: 60, top: [] };
    }
    const scored = items
      .map((item) => ({
        item,
        score: scoreConversation(item, job, Boolean(item?.key && !before.has(item.key)))
      }))
      .filter((entry) => entry.score >= 45)
      .sort((a, b) => (b.score - a.score) || (Number(a.item.index || 0) - Number(b.item.index || 0)));

    if (scored[0] && scored[0].score >= 60) {
      const second = scored[1];
      if (second && second.score >= scored[0].score - 5) {
        return {
          ok: false,
          error: "CONVERSATION_AMBIGUOUS",
          top: scored.slice(0, 3)
        };
      }
      return {
        ok: true,
        item: scored[0].item,
        via: "score:" + scored[0].score,
        score: scored[0].score,
        top: scored.slice(0, 3)
      };
    }

    if (newItems.length === 1) {
      return { ok: true, item: newItems[0], via: "new-single", score: scored[0]?.score || 0, top: scored };
    }

    const company = normalize(job.company || "");
    if (newItems.length > 1 && company) {
      const companyMatches = newItems.filter((item) => containsPrefix(normalize(item.text || ""), company, 4));
      if (companyMatches.length === 1) {
        return { ok: true, item: companyMatches[0], via: "new+company", score: 45, top: scored };
      }
    }

    return { ok: false, error: "CONVERSATION_NOT_FOUND", top: scored };
  }

  function confirmRenderedOwnMessage(beforeMessages = [], afterMessages = [], expectedText = "") {
    const compact = (value) => String(value || "").replace(/\s+/g, "");
    const expected = compact(expectedText);
    if (!expected) return false;
    const beforeSignature = (beforeMessages || []).map(compact).join("\n");
    const afterSignature = (afterMessages || []).map(compact).join("\n");
    if (beforeSignature === afterSignature) return false;
    return (afterMessages || []).slice(-5).some((message) => {
      const rendered = compact(message);
      return rendered === expected ||
        rendered.includes(expected) ||
        (expected.length > 12 && rendered.includes(expected.slice(0, 24)));
    });
  }

  root.BHTConversationMatch = Object.freeze({
    normalize,
    hasActiveState,
    stableConversationKey,
    scoreConversation,
    selectConversationCandidate,
    confirmRenderedOwnMessage
  });
})(globalThis);
