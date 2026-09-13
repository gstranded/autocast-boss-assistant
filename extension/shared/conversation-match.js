/**
 * Conversation matching: prefer 公司 + HR + 岗位 triple match.
 */
(function installConversationMatch(root) {
  "use strict";

  function normalize(input = "") {
    return String(input)
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[，。！？、,.!?;；:：'"“”‘’（）()[\]【】<>《》\-—_]/g, "");
  }

  function cleanHrIdentity(input = "") {
    return String(input || "")
      .split(/[·|｜]/)[0]
      .replace(/\s*(刚刚活跃|当前在线|在线|今日活跃|3日内活跃|本周活跃|两周内活跃|2周内活跃|本月活跃|2月内活跃|3月内活跃|4月内活跃|半年前活跃|半年内活跃|一年前活跃|1年前活跃|\d+日前活跃|\d+日内活跃|\d+周内活跃|\d+月内活跃)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
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
    return tokens.some(
      (token) =>
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
      .filter(
        (line) =>
          !/^(今天|昨天|前天|\d{1,2}:\d{2}|\d{1,2}月\d{1,2}日|\d{4}[./-]\d{1,2}[./-]\d{1,2})$/.test(
            line
          )
      )
      .filter((line) => !/^\d+$/.test(line))
      .slice(0, 3)
      .join("|");
    const fallback = normalize(stableLines || text);
    return fallback ? "text:" + fallback.slice(0, 120) : "index:" + Number(index || 0);
  }

  function containsPrefix(haystack, needle, length) {
    if (!haystack || !needle) return false;
    const n = Math.min(length, needle.length);
    if (n <= 0) return false;
    return haystack.includes(needle.slice(0, n));
  }

  function titleTokens(title = "") {
    const parts = String(title || "")
      .split(/[\s\-—–_/｜|·•（）()【】\[\]　]+/)
      .map((x) => normalize(x))
      .filter((x) => x && x.length >= 2);
    const out = [];
    for (const p of parts) {
      if (!out.includes(p)) out.push(p);
    }
    return out.slice(0, 16);
  }

  function itemBlob(item = {}) {
    // 结构化字段 + 原始文本
    return normalize(
      [
        item.hrName || item.bossName || "",
        item.company || "",
        item.title || item.position || "",
        item.identityText || "",
        item.text || ""
      ].join("|")
    );
  }

  function scoreCompany(blob, job) {
    const company = normalize(job.company || "");
    if (!company) return { score: 0, hit: false };
    if (blob.includes(company)) return { score: 100, hit: true };
    if (containsPrefix(blob, company, 4)) return { score: 70, hit: true };
    if (containsPrefix(blob, company, 2)) return { score: 30, hit: true };
    return { score: 0, hit: false };
  }

  function scoreHr(blob, job, item) {
    const hr = normalize(cleanHrIdentity(job.hrName || job.bossName || ""));
    if (!hr) return { score: 0, hit: false, hasHr: false };
    const itemHr = normalize(cleanHrIdentity(item.hrName || item.bossName || ""));
    if (itemHr && (itemHr === hr || itemHr.includes(hr) || hr.includes(itemHr))) {
      return { score: 120, hit: true, hasHr: true };
    }
    if (blob.includes(hr)) return { score: 110, hit: true, hasHr: true };
    // 姓氏 + 先生/女士 宽松
    const family = hr.slice(0, 1);
    if (family && /(先生|女士|老师|经理|总)$/.test(hr) && blob.includes(family) && /(先生|女士|老师|经理|总)/.test(blob)) {
      return { score: 55, hit: true, hasHr: true };
    }
    if (containsPrefix(blob, hr, 2)) return { score: 40, hit: true, hasHr: true };
    return { score: 0, hit: false, hasHr: true };
  }

  function scoreTitle(blob, job, item) {
    const title = normalize(job.title || "");
    if (!title) return { score: 0, hit: false };
    const itemTitle = normalize(item.title || item.position || "");
    if (itemTitle && (itemTitle === title || itemTitle.includes(title) || title.includes(itemTitle))) {
      return { score: 100, hit: true };
    }
    if (blob.includes(title)) return { score: 95, hit: true };
    if (containsPrefix(blob, title, 8)) return { score: 70, hit: true };
    if (containsPrefix(blob, title, 6)) return { score: 50, hit: true };
    if (containsPrefix(blob, title, 4)) return { score: 28, hit: true };

    const tokens = titleTokens(job.title || "");
    let hit = 0;
    for (const tok of tokens) {
      if (tok.length >= 2 && blob.includes(tok)) hit += 1;
    }
    if (hit <= 0) return { score: 0, hit: false };
    return { score: Math.min(55, 12 + hit * 10), hit: hit >= 2 };
  }

  function scoreConversation(item = {}, job = {}, isNew = false) {
    const blob = itemBlob(item);
    const c = scoreCompany(blob, job);
    const h = scoreHr(blob, job, item);
    const t = scoreTitle(blob, job, item);

    let score = 0;
    score += c.score;
    score += h.score;
    score += t.score;

    // 三维命中强加成（用户期望的主路径）
    if (c.hit && h.hit && t.hit) score += 80;
    else if (c.hit && h.hit) score += 45;
    else if (c.hit && t.hit) score += 30;
    else if (h.hit && t.hit) score += 35;

    // 只有公司名、没有 HR/岗位时压分，避免大厂多会话同分
    if (c.hit && !h.hit && !t.hit) score -= 25;

    if (isNew) {
      score += 50;
      score += Math.max(0, 15 - Number(item.index || 0) * 3);
    } else {
      const idx = Number(item.index || 0);
      if (idx === 0) score += 18;
      else if (idx === 1) score += 8;
      else if (idx === 2) score += 3;
    }
    if (item.active) score += 10;

    return {
      score,
      companyHit: c.hit,
      hrHit: h.hit,
      titleHit: t.hit,
      companyScore: c.score,
      hrScore: h.score,
      titleScore: t.score,
      triple: Boolean(c.hit && h.hit && t.hit),
      duoCH: Boolean(c.hit && h.hit),
      duoCT: Boolean(c.hit && t.hit)
    };
  }

  function isNewItem(item, before) {
    return Boolean(item?.key && !before.has(item.key));
  }

  function selectConversationCandidate(items = [], job = {}, beforeKeys = [], opts = {}) {
    const before = beforeKeys instanceof Set ? beforeKeys : new Set(beforeKeys || []);
    const preferNewest = opts.preferNewest !== false;
    const newItems = items.filter((item) => isNewItem(item, before));
    const hasTargetIdentity = Boolean(
      normalize(job.company || job.title || job.hrName || job.bossName || "")
    );

    if (!hasTargetIdentity && newItems.length === 1) {
      return { ok: true, item: newItems[0], via: "new-single", score: 60, top: [] };
    }

    const scored = items
      .map((item) => {
        const detail = scoreConversation(item, job, isNewItem(item, before));
        return {
          item,
          ...detail,
          isNew: isNewItem(item, before)
        };
      })
      .filter((entry) => entry.score >= 50)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.triple) - Number(a.triple) ||
          Number(b.duoCH) - Number(a.duoCH) ||
          b.titleScore - a.titleScore ||
          b.hrScore - a.hrScore ||
          Number(a.item.index || 0) - Number(b.item.index || 0)
      );

    // A. 唯一「公司+HR+岗位」三重命中
    const triples = scored.filter((e) => e.triple);
    if (triples.length === 1) {
      return {
        ok: true,
        item: triples[0].item,
        via: "triple:" + triples[0].score,
        score: triples[0].score,
        top: scored.slice(0, 3)
      };
    }
    if (triples.length > 1) {
      // 多个三重：优先新会话 / 置顶
      const ranked = [...triples].sort(
        (a, b) =>
          Number(b.isNew) - Number(a.isNew) ||
          Number(a.item.index || 0) - Number(b.item.index || 0) ||
          b.score - a.score
      );
      if (ranked[0].isNew && !ranked[1].isNew) {
        return {
          ok: true,
          item: ranked[0].item,
          via: "triple-new:" + ranked[0].score,
          score: ranked[0].score,
          top: scored.slice(0, 3)
        };
      }
      if (ranked[0].score - ranked[1].score >= 15) {
        return {
          ok: true,
          item: ranked[0].item,
          via: "triple-gap:" + ranked[0].score,
          score: ranked[0].score,
          top: scored.slice(0, 3)
        };
      }
    }

    // B. 唯一「公司+HR」
    const duoCH = scored.filter((e) => e.duoCH);
    if (duoCH.length === 1) {
      return {
        ok: true,
        item: duoCH[0].item,
        via: "company+hr:" + duoCH[0].score,
        score: duoCH[0].score,
        top: scored.slice(0, 3)
      };
    }
    if (duoCH.length > 1) {
      // 同 HR 多岗位：用岗位名拆
      const withTitle = duoCH.filter((e) => e.titleHit);
      if (withTitle.length === 1) {
        return {
          ok: true,
          item: withTitle[0].item,
          via: "company+hr+titleHit:" + withTitle[0].score,
          score: withTitle[0].score,
          top: scored.slice(0, 3)
        };
      }
      const ranked = [...duoCH].sort(
        (a, b) =>
          b.titleScore - a.titleScore ||
          Number(b.isNew) - Number(a.isNew) ||
          Number(a.item.index || 0) - Number(b.item.index || 0) ||
          b.score - a.score
      );
      if (ranked[0].titleScore - (ranked[1]?.titleScore || 0) >= 20 || ranked[0].score - (ranked[1]?.score || 0) >= 18) {
        return {
          ok: true,
          item: ranked[0].item,
          via: "company+hr-gap:" + ranked[0].score,
          score: ranked[0].score,
          top: scored.slice(0, 3)
        };
      }
    }

    // C. 唯一新会话 + 公司命中
    const newCompany = scored.filter((e) => e.isNew && e.companyHit);
    if (newCompany.length === 1) {
      return {
        ok: true,
        item: newCompany[0].item,
        via: "new+company:" + newCompany[0].score,
        score: newCompany[0].score,
        top: scored.slice(0, 3)
      };
    }
    if (newCompany.length > 1) {
      const ranked = [...newCompany].sort(
        (a, b) =>
          Number(b.hrHit) - Number(a.hrHit) ||
          b.titleScore - a.titleScore ||
          b.score - a.score ||
          Number(a.item.index || 0) - Number(b.item.index || 0)
      );
      if (ranked[0].hrHit && !ranked[1].hrHit) {
        return {
          ok: true,
          item: ranked[0].item,
          via: "new+company+hr:" + ranked[0].score,
          score: ranked[0].score,
          top: scored.slice(0, 3)
        };
      }
      if (ranked[0].titleScore - (ranked[1]?.titleScore || 0) >= 18 || ranked[0].score - (ranked[1]?.score || 0) >= 15) {
        return {
          ok: true,
          item: ranked[0].item,
          via: "new+company-gap:" + ranked[0].score,
          score: ranked[0].score,
          top: scored.slice(0, 3)
        };
      }

      // 会话列表按新到旧排列。只有置顶行确实是本次新增，且有 HR/岗位身份优势时才自顶向下选；
      // 仅凭“排第一”不足以安全发消息，因为未读/活跃会话也可能被平台置顶。
      const topRow = ranked.find((entry) => Number(entry.item?.index || 0) === 0);
      const runnerUp = ranked.find((entry) => entry !== topRow);
      if (
        topRow && topRow.isNew &&
        (topRow.hrHit || topRow.titleHit) &&
        (!runnerUp ||
          (topRow.hrHit && !runnerUp.hrHit) ||
          (topRow.titleScore - runnerUp.titleScore >= 12))
      ) {
        return {
          ok: true,
          item: topRow.item,
          via: "top-down-new-identity:" + topRow.score,
          score: topRow.score,
          top: scored.slice(0, 3)
        };
      }
    }

    // D. 常规最高分，要求拉开差距
    if (scored[0] && scored[0].score >= 80) {
      const top = scored[0];
      const second = scored[1];
      if (!second || second.score < top.score - 12) {
        return {
          ok: true,
          item: top.item,
          via: "score:" + top.score,
          score: top.score,
          top: scored.slice(0, 3)
        };
      }
      // 贴分但 top 有 HR 命中、second 没有
      if (top.hrHit && !second.hrHit && top.companyHit) {
        return {
          ok: true,
          item: top.item,
          via: "hr-break-tie:" + top.score,
          score: top.score,
          top: scored.slice(0, 3)
        };
      }
      if (top.titleHit && !second.titleHit && top.companyHit) {
        return {
          ok: true,
          item: top.item,
          via: "title-break-tie:" + top.score,
          score: top.score,
          top: scored.slice(0, 3)
        };
      }
      if (preferNewest && top.isNew && !second.isNew && top.companyHit) {
        return {
          ok: true,
          item: top.item,
          via: "new-break-tie:" + top.score,
          score: top.score,
          top: scored.slice(0, 3)
        };
      }
      return {
        ok: false,
        error: "CONVERSATION_AMBIGUOUS",
        top: scored.slice(0, 3),
        message: "多个相似会话分数接近（公司/HR/岗位未能唯一确定）"
      };
    }

    if (newItems.length === 1) {
      return {
        ok: true,
        item: newItems[0],
        via: "new-single",
        score: scored[0]?.score || 0,
        top: scored
      };
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
      return (
        rendered === expected ||
        rendered.includes(expected) ||
        (expected.length > 12 && rendered.includes(expected.slice(0, 24)))
      );
    });
  }

  const api = Object.freeze({
    normalize,
    cleanHrIdentity,
    classTokens,
    hasActiveState,
    stableConversationKey,
    scoreConversation,
    selectConversationCandidate,
    confirmRenderedOwnMessage
  });

  root.ConversationMatch = api;
  root.BHTConversationMatch = api;
  try {
    if (typeof module !== "undefined" && module.exports) module.exports = api;
  } catch (_) {}
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof window !== "undefined"
      ? window
      : this
);
