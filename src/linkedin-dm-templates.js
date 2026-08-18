// LinkedIn DM templates utility.
// A configured shortcut fills only the currently open LinkedIn message composer.
// It never opens recipients, iterates conversations, or sends a message.

(() => {
  const COMPOSER_SELECTORS = [
    '.msg-form__contenteditable[contenteditable="true"]',
    'form.msg-form [contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][role="textbox"][aria-label*="message" i]',
    '[contenteditable="true"][role="textbox"][data-placeholder*="message" i]',
  ];
  const CONVERSATION_ROOT_SELECTORS = [
    ".msg-overlay-conversation-bubble",
    ".msg-conversations-container__convo-contents",
    ".msg-thread",
    '[data-view-name*="message-thread" i]',
  ];
  const HEADER_SELECTORS = [
    ".msg-overlay-bubble-header",
    ".msg-thread__topcard",
    ".msg-thread__header",
    '[data-view-name*="message-thread" i] header',
    ".msg-conversations-container__convo-contents > header",
  ];
  const NAME_SELECTORS = [
    '[data-anonymize="person-name"]',
    ".msg-overlay-bubble-header__title",
    ".msg-thread__participant-name",
    ".msg-thread__link-to-profile",
    ".msg-entity-lockup__entity-title",
    ".artdeco-entity-lockup__title",
    "h1",
    "h2",
  ];
  const HEADLINE_SELECTORS = [
    '[data-anonymize="headline"]',
    ".msg-thread__participant-headline",
    ".msg-entity-lockup__entity-subtitle",
    ".artdeco-entity-lockup__subtitle",
  ];

  let templates = [];
  let templateRunInFlight = false;
  let lastResolution = null;

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
    return el.getClientRects().length > 0 &&
      !el.disabled &&
      el.getAttribute("aria-disabled") !== "true";
  }

  function isMessagingComposer(el) {
    if (el.classList.contains("msg-form__contenteditable")) return true;
    if (el.closest("form.msg-form")) return true;
    if (CONVERSATION_ROOT_SELECTORS.some((selector) => el.closest(selector))) {
      const description = [
        el.getAttribute("aria-label"),
        el.getAttribute("data-placeholder"),
        el.getAttribute("placeholder"),
      ].filter(Boolean).join(" ");
      return /message/i.test(description);
    }
    return false;
  }

  function composerCandidates() {
    const candidates = new Set();
    for (const selector of COMPOSER_SELECTORS) {
      for (const el of document.querySelectorAll(selector)) candidates.add(el);
    }
    return [...candidates].filter(isVisible).filter(isMessagingComposer);
  }

  function activeComposer() {
    const visible = composerCandidates();
    const focused = visible.find(
      (candidate) => candidate === document.activeElement || candidate.contains(document.activeElement)
    );
    // Overlay conversations are appended after the main page, so the last visible
    // composer is the best fallback when none currently has focus.
    return focused ?? visible[visible.length - 1] ?? null;
  }

  function conversationScope(composer) {
    for (const selector of CONVERSATION_ROOT_SELECTORS) {
      const root = composer.closest(selector);
      if (root) return root;
    }
    return composer.closest("section") ?? document.querySelector("main") ?? document;
  }

  function addIfMatches(set, root, selector) {
    if (root.matches?.(selector)) set.add(root);
    for (const element of root.querySelectorAll(selector)) set.add(element);
  }

  function headerBlocks(scope) {
    const blocks = new Set();
    for (const selector of HEADER_SELECTORS) addIfMatches(blocks, scope, selector);

    // LinkedIn has used the profile link itself as the full-page top card in
    // some variants. Keep this narrow so message-row profile links never win.
    const profileLink = scope.querySelector('a.msg-thread__link-to-profile[href*="/in/"]');
    if (profileLink) {
      blocks.add(profileLink.closest(".msg-thread__topcard, header") ?? profileLink);
    }
    return [...blocks].filter(isVisible);
  }

  function textCandidates(block, selectors) {
    const values = [];
    for (const selector of selectors) {
      if (block.matches?.(selector) && isVisible(block)) {
        values.push(block.innerText || block.textContent || "");
      }
      for (const element of block.querySelectorAll(selector)) {
        if (!isVisible(element)) continue;
        values.push(element.innerText || element.textContent || "");
      }
    }
    return values;
  }

  function profileHrefs(block) {
    const hrefs = [];
    if (block.matches?.('a[href*="/in/"]') && isVisible(block)) {
      hrefs.push(block.getAttribute("href"));
    }
    for (const link of block.querySelectorAll('a[href*="/in/"]')) {
      if (!isVisible(link)) continue;
      hrefs.push(link.getAttribute("href"));
    }
    return hrefs.filter(Boolean);
  }

  function resolveRecipient(composer) {
    const scope = conversationScope(composer);
    for (const block of headerBlocks(scope)) {
      const recipient = UfxLinkedIn.recipientFromHeader({
        nameCandidates: textCandidates(block, NAME_SELECTORS),
        profileHrefs: profileHrefs(block),
        headerText: block.innerText || block.textContent || "",
      });
      if (recipient.fullName || recipient.handle || /group conversation/.test(recipient.reason)) {
        return recipient;
      }
    }
    return {
      fullName: "",
      firstName: "",
      handle: "",
      reason: "no conversation header found",
    };
  }

  function visibleCompanySuggestion(composer) {
    const scope = conversationScope(composer);
    const headlines = [];
    for (const block of headerBlocks(scope)) {
      headlines.push(...textCandidates(block, HEADLINE_SELECTORS));
    }
    const suggestion = UfxLinkedIn.companyFromHeadlines(headlines);
    return {
      status: suggestion ? "suggested" : "none",
      company: suggestion?.company ?? "",
      confidence: suggestion?.confidence ?? "",
      source: suggestion ? "visible LinkedIn headline" : "no clear visible LinkedIn headline",
      headlinesFound: headlines.filter((value) => value.trim()).length,
    };
  }

  function templateUsesCompany(body) {
    return /\{\{\s*company\s*\}\}|\{\s*company\s*\}/.test(body || "");
  }

  // ---------- insertion (LinkedIn contenteditable composer) ----------

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  function isTextControl(element) {
    return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
  }

  function composerText(composer) {
    const value = isTextControl(composer)
      ? composer.value
      : (composer.innerText || composer.textContent || "");
    return value.replace(/\u200B/g, "");
  }

  async function composerChanged(composer, before, timeoutMs = 300) {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      await nextFrame();
      if (composerText(composer) !== before) return true;
    }
    return false;
  }

  function placeCaretAtEnd(element) {
    if (isTextControl(element)) {
      element.setSelectionRange(element.value.length, element.value.length);
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
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

    // LinkedIn's current editor accepts the browser's native editing command and
    // observes its input event. This preserves any draft already in the composer.
    try {
      document.execCommand("insertText", false, text);
      if (await composerChanged(composer, before)) return true;
    } catch {
      // Fall through to the paste-compatible editor path.
    }

    // Fallback for editor variants that own paste instead of beforeinput/input.
    try {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      composer.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }));
      if (await composerChanged(composer, before)) return true;
    } catch {
      // Some hardened page contexts do not expose a constructible DataTransfer.
    }
    return false;
  }

  async function selectReviewToken(composer, token, preferLast = false) {
    if (isTextControl(composer)) {
      const index = preferLast ? composer.value.lastIndexOf(token) : composer.value.indexOf(token);
      if (index < 0) return false;
      composer.focus();
      composer.setSelectionRange(index, index + token.length);
      await nextFrame();
      return composer.selectionStart === index && composer.selectionEnd === index + token.length;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const walker = document.createTreeWalker(composer, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      if (preferLast) nodes.reverse();
      for (const node of nodes) {
        const index = preferLast ? node.data.lastIndexOf(token) : node.data.indexOf(token);
        if (index < 0) continue;
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + token.length);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        await nextFrame();
        if (window.getSelection().toString() === token) return true;
      }
      await nextFrame();
    }
    return false;
  }

  // ---------- feedback + shortcut handling ----------

  let toastTimer = null;
  function toast(message, kind = "ok") {
    document.querySelector(".ufx-toast")?.remove();
    clearTimeout(toastTimer);
    const element = document.createElement("div");
    element.className = "ufx-toast";
    element.dataset.kind = kind;
    element.textContent = message;
    document.body.appendChild(element);
    toastTimer = setTimeout(() => {
      element.classList.add("ufx-toast-out");
      setTimeout(() => element.remove(), 300);
    }, 2600);
  }

  async function runTemplate(template) {
    const composer = activeComposer();
    if (!composer) {
      toast("Open a LinkedIn conversation first", "error");
      return;
    }

    const recipient = resolveRecipient(composer);
    const companyLookup = templateUsesCompany(template.body)
      ? visibleCompanySuggestion(composer)
      : null;
    if (companyLookup?.company) recipient.company = companyLookup.company;
    lastResolution = { recipient, companyLookup };

    const { text, missing, placeholders } = UfxTemplates.substitute(template.body, recipient);
    if (missing.length) {
      const why = recipient.reason ? ` (${recipient.reason})` : "";
      toast(`Can't fill {{${missing[0]}}}${why} — nothing inserted`, "error");
      return;
    }

    const inserted = await insertIntoComposer(composer, text);
    if (!inserted) {
      try {
        await navigator.clipboard.writeText(text);
        toast("Couldn't type into LinkedIn — copied instead, press ⌘V", "error");
      } catch {
        toast("Couldn't insert the template", "error");
      }
      return;
    }

    const who = recipient.firstName || recipient.fullName || recipient.handle;
    const suggestedCompany = companyLookup?.company || "";
    const reviewToken = suggestedCompany || placeholders[0] || "";
    const selectedForReview = reviewToken && (
      await selectReviewToken(composer, reviewToken, !!suggestedCompany)
    );
    if (suggestedCompany && selectedForReview) {
      toast(`Suggested “${suggestedCompany}” from ${recipient.firstName || "the recipient"}'s visible headline — review & send`);
    } else if (placeholders.length && selectedForReview) {
      const what = placeholders[0].replace(/^\[|\]$/g, "");
      toast(`No clear company visible for ${who || "this recipient"} — type the ${what}, then send`);
    } else {
      const name = template.name || "Template";
      toast(who ? `“${name}” ready for ${who} — review & send` : `“${name}” inserted — review & send`);
    }
  }

  function onKeydown(event) {
    if (event.repeat) return;
    const template = templates.find(
      (candidate) => candidate.shortcut && UfxTemplates.eventMatchesShortcut(event, candidate.shortcut)
    );
    if (!template) return;
    event.preventDefault();
    event.stopPropagation();
    if (templateRunInFlight) {
      toast("Still preparing the previous template…");
      return;
    }
    templateRunInFlight = true;
    runTemplate(template)
      .catch(() => toast("Couldn't insert the template", "error"))
      .finally(() => { templateRunInFlight = false; });
  }

  // Console helper for diagnosing LinkedIn selector drift.
  window.__ufxLinkedInDmDebug = () => {
    const composer = activeComposer();
    const info = {
      platform: "linkedin",
      composerFound: !!composer,
      composerCandidates: composerCandidates().map((element) => ({
        tag: element.tagName,
        classes: element.className,
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
      })),
      pathname: location.pathname,
      recipient: composer ? resolveRecipient(composer) : null,
      lastResolution,
      templates: templates.map((template) => ({
        name: template.name,
        shortcut: UfxTemplates.formatShortcut(template.shortcut),
      })),
    };
    console.log(info);
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
