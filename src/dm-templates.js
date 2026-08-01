// DM templates utility.
// Press a configured shortcut inside a DM conversation to pre-fill the composer
// with a template, substituting {{first_name}} / {{full_name}} / {{handle}} read
// from the conversation header. Never sends — the human always clicks Send.

(() => {
  const CLASSIC_COMPOSER_SELECTOR = '[data-testid="dmComposerTextInput"]';
  const XCHAT_COMPOSER_SELECTORS = [
    'textarea[placeholder="Unencrypted message"]',
    'textarea[aria-label="Unencrypted message"]',
    '[contenteditable="true"][data-placeholder="Unencrypted message"]',
    '[contenteditable="true"][aria-label="Unencrypted message"]',
    '[data-testid*="composer" i] textarea',
    '[data-testid*="composer" i][contenteditable="true"]',
    '[data-testid*="composer" i] [contenteditable="true"]',
  ];
  const AVATAR_SELECTOR = '[data-testid^="UserAvatar-Container-"]';
  // Paths under x.com that are never profile handles.
  const NON_PROFILE_PATHS = new Set([
    "home", "explore", "notifications", "messages", "i", "settings", "search",
    "compose", "jobs", "bookmarks", "premium", "verified-orgs", "communities",
  ]);

  let templates = [];

  async function loadTemplates() {
    const { dmTemplates } = await chrome.storage.sync.get("dmTemplates");
    templates = dmTemplates?.templates ?? [];
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.dmTemplates) {
      templates = changes.dmTemplates.newValue?.templates ?? [];
    }
  });

  // ---------- DOM: composer + recipient ----------

  function isVisible(el) {
    return el.getClientRects().length > 0 && !el.disabled && el.getAttribute("aria-disabled") !== "true";
  }

  function isXChatConversation() {
    return /^\/i\/chat\/(?!requests(?:\/|$)|settings(?:\/|$))[^/]+/.test(location.pathname);
  }

  function composerCandidates() {
    const candidates = new Set(document.querySelectorAll(CLASSIC_COMPOSER_SELECTOR));
    for (const selector of XCHAT_COMPOSER_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) candidates.add(el);
    }

    // XChat has already changed its composer attributes more than once. On an
    // actual conversation route, accept a visible textarea/textbox whose own
    // accessible description says "message" (but never a search field).
    if (isXChatConversation()) {
      for (const el of document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]')) {
        const description = [
          el.getAttribute("placeholder"),
          el.getAttribute("aria-label"),
          el.getAttribute("data-placeholder"),
        ].filter(Boolean).join(" ");
        if (/message/i.test(description) && !/search/i.test(description)) candidates.add(el);
      }
    }

    return [...candidates].filter(isVisible);
  }

  function activeComposer() {
    // getClientRects, not offsetParent — the latter is null for fixed-position
    // containers (like the messages drawer) even when perfectly visible.
    const visible = composerCandidates();
    // Last in DOM order wins: the message drawer renders after the main column.
    return visible[visible.length - 1] ?? null;
  }

  // The subtree that contains this composer's conversation (and not the inbox
  // list, which lives in a sibling column and is full of other people's names).
  function conversationScope(composer) {
    if (isXChatConversation()) {
      const conversation =
        composer.closest('[data-testid*="conversation" i]') ??
        composer.closest('[aria-label*="conversation" i]');
      const hasHeader = conversation?.querySelector('header, [data-testid*="header" i]');
      return (
        (hasHeader ? conversation : null) ??
        document.querySelector("main") ??
        document
      );
    }
    return (
      composer.closest('[data-testid="DMDrawer"]') ??
      composer.closest("section") ??
      document.querySelector("main") ??
      document
    );
  }

  function handleFromHref(href) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, location.origin);
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null;
    const m = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (!m || NON_PROFILE_PATHS.has(m[1].toLowerCase())) return null;
    return m[1];
  }

  // URL shape distinguishes 1:1 from group chats in the full messages view:
  // 1:1 conversation ids are "<userId>-<userId>", group ids a single number.
  function urlSaysGroup() {
    const m = location.pathname.match(/^\/messages\/(\d+)(-\d+)?/);
    if (m) return !m[2];
    // XChat gives group conversation ids a leading "g". Numeric ids (with or
    // without dashes) are 1:1 conversations.
    const xchat = location.pathname.match(/^\/i\/chat\/(g?[0-9-]+)(?:\/|$)/);
    if (xchat) return xchat[1].startsWith("g");
    return null; // drawer or non-conversation page — unknown
  }

  function headerNameFrom(block, handle) {
    const directSelectors = [
      '[data-testid*="conversation-title" i]',
      '[data-testid*="chat-title" i]',
      "h1",
      "h2",
    ];
    const rawCandidates = [];
    for (const selector of directSelectors) {
      for (const el of block.querySelectorAll(selector)) rawCandidates.push(el.textContent || "");
    }
    rawCandidates.push(...(block.innerText || block.textContent || "").split(/\n+/));

    const generic = /^(chat|back|info|details|verified account|user avatar|encrypted|unencrypted)$/i;
    for (let raw of rawCandidates) {
      raw = raw.replace(new RegExp(`@${handle}\\b`, "i"), " ").trim();
      raw = raw.replace(/\bVerified account\b/gi, " ").trim();
      const cleaned = UfxTemplates.cleanDisplayName(raw);
      if (!cleaned || cleaned.length > 80 || generic.test(cleaned)) continue;
      if (cleaned.toLowerCase() === handle.toLowerCase()) continue;
      return cleaned;
    }
    return "";
  }

  function recipientFromConversationHeader(scope) {
    const headerBlocks = [...scope.querySelectorAll('header, [data-testid*="header" i]')]
      .filter(isVisible)
      .filter((el) => !/inbox/i.test(el.getAttribute("data-testid") || ""));

    for (const block of headerBlocks) {
      const links = [...block.querySelectorAll("a[href]")];
      const handles = [...new Set(links.map((link) => handleFromHref(link.getAttribute("href"))).filter(Boolean))];
      if (handles.length !== 1) continue;
      const handle = handles[0];

      for (const link of links) {
        if (handleFromHref(link.getAttribute("href"))?.toLowerCase() !== handle.toLowerCase()) continue;
        const text = UfxTemplates.cleanDisplayName(link.textContent);
        const nameOnly = text.split(/@[A-Za-z0-9_]+/)[0].trim();
        if (nameOnly && nameOnly.toLowerCase() !== handle.toLowerCase()) {
          return { fullName: nameOnly, handle };
        }
      }

      const fullName = headerNameFrom(block, handle);
      if (fullName) return { fullName, handle };
    }
    return null;
  }

  // Returns { fullName, firstName, handle, reason } — empty strings for what
  // couldn't be resolved, reason explaining why when something is missing.
  function resolveRecipient(composer) {
    const scope = conversationScope(composer);

    if (urlSaysGroup() === true) {
      return { fullName: "", firstName: "", handle: "", reason: "group conversation" };
    }

    // XChat links only the avatar in its conversation header; the display name
    // is a sibling. Resolve that compact header before scanning message rows.
    const headerRecipient = recipientFromConversationHeader(scope);
    if (headerRecipient) {
      return {
        fullName: headerRecipient.fullName,
        firstName: UfxTemplates.firstNameFrom(headerRecipient.fullName),
        handle: headerRecipient.handle,
        reason: "",
      };
    }

    // Every avatar inside the conversation scope belongs to the other person
    // (your own DM bubbles render without an avatar). Distinct handles > 1
    // means a group chat or a scope that leaked into the inbox list.
    const handles = new Set();
    for (const el of scope.querySelectorAll(AVATAR_SELECTOR)) {
      const handle = el.getAttribute("data-testid").slice("UserAvatar-Container-".length);
      if (handle) handles.add(handle);
    }
    let handle = handles.size === 1 ? [...handles][0] : null;

    // Display name: a profile link in this scope that carries visible text
    // (the conversation header). Message-row avatar links wrap only an image.
    let fullName = "";
    for (const link of scope.querySelectorAll("a[href]")) {
      const linkHandle = handleFromHref(link.getAttribute("href"));
      if (!linkHandle) continue;
      if (handle && linkHandle.toLowerCase() !== handle.toLowerCase()) continue;
      const text = UfxTemplates.cleanDisplayName(link.textContent);
      // Skip links whose text is just the @handle or empty (avatar wrappers).
      if (!text || text.toLowerCase() === "@" + linkHandle.toLowerCase()) continue;
      const nameOnly = text.split(/@[A-Za-z0-9_]+/)[0].trim();
      if (nameOnly) {
        fullName = nameOnly;
        handle = handle ?? linkHandle;
        break;
      }
    }

    if (handles.size > 1 && !fullName) {
      return { fullName: "", firstName: "", handle: "", reason: "multiple people found — group chat?" };
    }

    return {
      fullName,
      firstName: UfxTemplates.firstNameFrom(fullName),
      handle: handle ?? "",
      reason: fullName ? "" : "no conversation header found",
    };
  }

  // ---------- insertion (Draft.js composer) ----------

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

  function isTextControl(el) {
    return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
  }

  function composerText(composer) {
    return isTextControl(composer) ? composer.value : composer.textContent;
  }

  // X renders with concurrent React — a successful paste may take a few frames to
  // reach the DOM. Poll briefly so we never double-insert via the fallback path.
  async function composerChanged(composer, before, timeoutMs = 250) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      await nextFrame();
      if (composerText(composer) !== before) return true;
    }
    return false;
  }

  function placeCaretAtEnd(el) {
    if (isTextControl(el)) {
      el.setSelectionRange(el.value.length, el.value.length);
      return;
    }
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function insertIntoComposer(composer, text) {
    composer.focus();
    placeCaretAtEnd(composer);
    const before = composerText(composer);

    if (isTextControl(composer)) {
      const start = composer.selectionStart ?? before.length;
      const end = composer.selectionEnd ?? start;
      const next = before.slice(0, start) + text + before.slice(end);
      const prototype = composer instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(composer, next);
      else composer.value = next;
      const caret = start + text.length;
      composer.setSelectionRange(caret, caret);
      composer.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }));
      return composerChanged(composer, before);
    }

    // Preferred: simulated paste — Draft.js handles multi-line pastes correctly.
    const data = new DataTransfer();
    data.setData("text/plain", text);
    composer.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data })
    );
    if (await composerChanged(composer, before)) return true;

    // Fallback: execCommand still works in contenteditable Draft.js editors.
    document.execCommand("insertText", false, text);
    return composerChanged(composer, before);
  }

  // Select a literal token inside the composer so the user's next keystrokes
  // replace it (used for manual variables like [company]). Draft may re-render
  // and restore its own selection right after an insert, so retry briefly.
  async function selectPlaceholder(composer, token) {
    if (isTextControl(composer)) {
      const idx = composer.value.indexOf(token);
      if (idx < 0) return false;
      composer.focus();
      composer.setSelectionRange(idx, idx + token.length);
      await nextFrame();
      return composer.selectionStart === idx && composer.selectionEnd === idx + token.length;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const walker = document.createTreeWalker(composer, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const idx = walker.currentNode.data.indexOf(token);
        if (idx < 0) continue;
        const range = document.createRange();
        range.setStart(walker.currentNode, idx);
        range.setEnd(walker.currentNode, idx + token.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        await nextFrame();
        if (window.getSelection().toString() === token) return true;
      }
      await nextFrame();
    }
    return false;
  }

  // ---------- feedback toast ----------

  let toastTimer = null;
  function toast(message, kind = "ok") {
    document.querySelector(".ufx-toast")?.remove();
    clearTimeout(toastTimer);
    const el = document.createElement("div");
    el.className = "ufx-toast";
    el.dataset.kind = kind;
    el.textContent = message;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => {
      el.classList.add("ufx-toast-out");
      setTimeout(() => el.remove(), 300);
    }, 2600);
  }

  // ---------- shortcut handling ----------

  async function runTemplate(template) {
    const composer = activeComposer();
    if (!composer) {
      toast("Open a DM conversation first", "error");
      return;
    }

    const recipient = resolveRecipient(composer);
    const { text, missing, placeholders } = UfxTemplates.substitute(template.body, recipient);
    if (missing.length) {
      const why = recipient.reason ? ` (${recipient.reason})` : "";
      toast(`Can't fill {{${missing[0]}}}${why} — nothing inserted`, "error");
      return;
    }

    const inserted = await insertIntoComposer(composer, text);
    if (inserted) {
      const who = recipient.firstName || recipient.fullName || recipient.handle;
      if (placeholders.length && (await selectPlaceholder(composer, placeholders[0]))) {
        const what = placeholders[0].replace(/^\[|\]$/g, "");
        toast(who ? `Ready for ${who} — type the ${what}, then send` : `Type the ${what}, then send`);
      } else {
        toast(who ? `“${template.name}” ready for ${who} — review & send` : `“${template.name}” inserted — review & send`);
      }
    } else {
      // Last resort: clipboard, so the keystroke is never a dead end.
      try {
        await navigator.clipboard.writeText(text);
        toast("Couldn't type into the composer — copied instead, press ⌘V", "error");
      } catch {
        toast("Couldn't insert the template", "error");
      }
    }
  }

  function onKeydown(event) {
    if (event.repeat) return;
    const template = templates.find(
      (t) => t.shortcut && UfxTemplates.eventMatchesShortcut(event, t.shortcut)
    );
    if (!template) return;
    event.preventDefault();
    event.stopPropagation();
    runTemplate(template);
  }

  // Console helper for diagnosing selector drift: __ufxDmDebug() in DevTools.
  window.__ufxDmDebug = () => {
    const composer = activeComposer();
    const info = {
      composerFound: !!composer,
      composerCandidates: composerCandidates().map((el) => ({
        tag: el.tagName,
        testid: el.getAttribute("data-testid"),
        placeholder: el.getAttribute("placeholder") || el.getAttribute("data-placeholder"),
        ariaLabel: el.getAttribute("aria-label"),
      })),
      pathname: location.pathname,
      urlSaysGroup: urlSaysGroup(),
      recipient: composer ? resolveRecipient(composer) : null,
      templates: templates.map((t) => ({ name: t.name, shortcut: UfxTemplates.formatShortcut(t.shortcut) })),
    };
    console.table ? console.log(info) : console.log(JSON.stringify(info, null, 2));
    return info;
  };

  (window.__ufxUtilities ??= []).push({
    id: "dm-templates",
    label: "DM templates",
    async run() {
      await loadTemplates();
      window.addEventListener("keydown", onKeydown, true);
    },
  });
})();
