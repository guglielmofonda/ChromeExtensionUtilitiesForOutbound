// LinkedIn message templates utility.
// A configured shortcut fills only the currently open message composer or
// connection-invitation note. It never opens recipients, iterates, or sends.

(() => {
  const COMPOSER_SELECTORS = [
    '.msg-form__contenteditable[contenteditable="true"]',
    'form.msg-form [contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][role="textbox"][aria-label*="message" i]',
    '[contenteditable="true"][role="textbox"][data-placeholder*="message" i]',
  ];
  const CONNECTION_NOTE_COMPOSER_SELECTORS = [
    'textarea#custom-message',
    'dialog textarea',
    '[role="dialog"] textarea',
    '[aria-modal="true"] textarea',
    '[role="dialog"] textarea[name="message"]',
    '.artdeco-modal textarea[name="message"]',
    '.artdeco-modal textarea',
    'textarea[placeholder*="know each other" i]',
    'textarea[aria-label*="note" i]',
    'dialog [contenteditable]',
    '[role="dialog"] [contenteditable]',
    '[aria-modal="true"] [contenteditable]',
    '[role="dialog"] [contenteditable][role="textbox"]',
    '[aria-modal="true"] [contenteditable][role="textbox"]',
    '.artdeco-modal [contenteditable][role="textbox"]',
    '[contenteditable][data-placeholder*="know each other" i]',
    '[contenteditable][aria-placeholder*="know each other" i]',
    '[contenteditable][aria-label*="note" i]',
  ];
  const CONNECTION_NOTE_SCOPE_SELECTOR =
    'dialog, [role="dialog"], [aria-modal="true"], .artdeco-modal';
  const EDITABLE_COMPOSER_SELECTOR =
    'textarea, input:not([type]), input[type="text"], [contenteditable]';
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
  const PROFILE_NAME_SELECTORS = [
    '[data-view-name="profile-card"] [data-anonymize="person-name"]',
    '[data-view-name="profile-card"] .text-heading-xlarge',
    '[data-view-name="profile-card"] [role="heading"][aria-level="1"]',
    ".pv-text-details__left-panel h1",
    ".pv-text-details__left-panel .text-heading-xlarge",
    ".pv-top-card .text-heading-xlarge",
    '.pv-top-card [role="heading"][aria-level="1"]',
    "h1.text-heading-xlarge",
    "h1",
  ];
  const PROFILE_HEADLINE_SELECTORS = [
    '[data-view-name="profile-card"] [data-anonymize="headline"]',
    ".pv-text-details__left-panel .text-body-medium.break-words",
    ".pv-top-card .text-body-medium.break-words",
    '.pv-top-card [data-anonymize="headline"]',
  ];
  const PROFILE_CURRENT_COMPANY_SELECTORS = [
    '[aria-label*="current company" i]',
    'a[href*="/company/"]',
    '.pv-text-details__right-panel > li:first-child:not(:only-child)',
    '.pv-text-details__right-panel > ul > li:first-child:not(:only-child)',
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

  function isEditableComposer(element) {
    if (!element?.matches) return false;
    if (element.matches('textarea, input:not([type]), input[type="text"]')) return true;
    if (element.isContentEditable) return true;
    const contentEditable = element.getAttribute("contenteditable");
    return contentEditable === "" || contentEditable === "true" ||
      contentEditable === "plaintext-only";
  }

  function connectionNoteDialog(element) {
    if (!isEditableComposer(element)) return null;
    const dialog = element.closest(CONNECTION_NOTE_SCOPE_SELECTOR);
    const placeholder = element.getAttribute("placeholder") ||
      element.getAttribute("data-placeholder") ||
      element.getAttribute("aria-placeholder") ||
      element.getAttribute("aria-label") || "";
    const dialogText = dialog?.innerText || dialog?.textContent || "";
    if (UfxLinkedIn.isConnectionNoteContext({ dialogText, placeholder })) {
      return dialog ?? element.closest("form, section") ?? element.parentElement;
    }

    // Some LinkedIn variants omit stable modal semantics. The field is already
    // focused when a shortcut is pressed, so inspect only its nearby ancestors
    // for the exact connection-note heading instead of scanning the whole page.
    let ancestor = element.parentElement;
    for (let depth = 0; ancestor && ancestor !== document.body && depth < 16; depth++) {
      const ancestorText = ancestor.innerText || ancestor.textContent || "";
      if (UfxLinkedIn.isConnectionNoteContext({ dialogText: ancestorText })) {
        return ancestor;
      }
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  function isConnectionNoteComposer(element) {
    return !!connectionNoteDialog(element);
  }

  function editableComposerFromNode(node) {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element?.matches) return null;
    let editable = isEditableComposer(element)
      ? element
      : element.closest?.(EDITABLE_COMPOSER_SELECTOR);
    if (!editable || !isEditableComposer(editable)) return null;

    // Keyboard events can originate from a paragraph inside a contenteditable
    // host. Return the outer editing host so insertion and selection operate on
    // the element that owns the editor state.
    while (editable.parentElement?.isContentEditable) editable = editable.parentElement;
    return editable;
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

  function composerCandidates(triggerPath = []) {
    const candidates = new Set();
    for (const selector of [...COMPOSER_SELECTORS, ...CONNECTION_NOTE_COMPOSER_SELECTORS]) {
      for (const el of document.querySelectorAll(selector)) candidates.add(el);
    }
    // LinkedIn changes editor attributes often. Scan editable controls, then
    // retain only recognized messaging or invitation-note contexts below.
    for (const element of document.querySelectorAll(EDITABLE_COMPOSER_SELECTOR)) {
      candidates.add(element);
    }
    for (const node of [document.activeElement, ...triggerPath]) {
      const editable = editableComposerFromNode(node);
      if (editable) candidates.add(editable);
    }
    return [...candidates]
      .filter(isVisible)
      .filter((element) => isMessagingComposer(element) || isConnectionNoteComposer(element));
  }

  function activeComposer(triggerPath = []) {
    const visible = composerCandidates(triggerPath);
    const focused = visible.find(
      (candidate) => candidate === document.activeElement || candidate.contains(document.activeElement)
    );
    // A connection modal is the active task even if focus briefly moves to its
    // buttons. Otherwise overlays are appended last and remain the best fallback.
    const connectionNote = visible.findLast?.(isConnectionNoteComposer) ??
      [...visible].reverse().find(isConnectionNoteComposer);
    return connectionNote ?? focused ?? visible[visible.length - 1] ?? null;
  }

  function conversationScope(composer) {
    const noteDialog = connectionNoteDialog(composer);
    if (noteDialog) return noteDialog;
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

  function profileCurrentCompanyCandidates(scope) {
    const elements = new Set();
    for (const selector of PROFILE_CURRENT_COMPANY_SELECTORS) {
      addIfMatches(elements, scope, selector);
    }
    const values = [];
    for (const element of elements) {
      if (!isVisible(element)) continue;
      values.push(
        element.getAttribute("aria-label") || "",
        element.innerText || element.textContent || "",
        element.querySelector("img[alt]")?.getAttribute("alt") || ""
      );
    }
    return values.filter(Boolean);
  }

  function profileExperienceCompanyCandidates() {
    const values = [];
    const headings = document.querySelectorAll('h2, h3, [role="heading"]');
    for (const heading of headings) {
      const headingText = (heading.innerText || heading.textContent || "").trim();
      if (!/^Experience$/i.test(headingText)) continue;
      const section = heading.closest("section") ?? heading.parentElement;
      if (!section) continue;
      const rows = section.querySelectorAll('li, [data-view-name="profile-component-entity"]');
      for (const row of rows) {
        const rowText = row.innerText || row.textContent || "";
        if (!/\bPresent\b/i.test(rowText)) continue;
        const companyElements = row.querySelectorAll(
          'a[href*="/company/"], img[alt$=" logo" i]'
        );
        for (const element of companyElements) {
          values.push(
            element.getAttribute("aria-label") || "",
            element.getAttribute("alt") || "",
            element.innerText || element.textContent || "",
            element.querySelector?.("img[alt]")?.getAttribute("alt") || ""
          );
        }
      }
    }
    return values.filter(Boolean);
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

  function profilePageScope() {
    const profileCard = document.querySelector(".pv-top-card") ??
      document.querySelector(".pv-text-details__left-panel") ??
      document.querySelector('main [data-view-name="profile-card"]') ??
      document.querySelector('[data-view-name="profile-card"]');
    return profileCard ?? document.querySelector("main") ?? document;
  }

  function currentProfileHrefs() {
    return [
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      location.href,
    ].filter(Boolean);
  }

  function profileTitleCandidates() {
    return [
      document.querySelector('meta[property="og:title"]')?.getAttribute("content"),
      document.querySelector('meta[name="twitter:title"]')?.getAttribute("content"),
      document.title,
    ].filter(Boolean);
  }

  function resolveProfileRecipient() {
    const scope = profilePageScope();
    return UfxLinkedIn.recipientFromProfile({
      nameCandidates: textCandidates(scope, PROFILE_NAME_SELECTORS),
      profileHrefs: currentProfileHrefs(),
      titleCandidates: profileTitleCandidates(),
    });
  }

  function resolveRecipient(composer) {
    if (isConnectionNoteComposer(composer)) return resolveProfileRecipient();
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
    const isConnectionNote = isConnectionNoteComposer(composer);
    const scope = isConnectionNote ? profilePageScope() : conversationScope(composer);
    const selectors = isConnectionNote ? PROFILE_HEADLINE_SELECTORS : HEADLINE_SELECTORS;
    const headlines = [];
    if (isConnectionNote) {
      headlines.push(...textCandidates(scope, selectors));
    } else {
      for (const block of headerBlocks(scope)) {
        headlines.push(...textCandidates(block, selectors));
      }
    }
    const currentCompanyCandidates = isConnectionNote
      ? profileCurrentCompanyCandidates(scope)
      : [];
    const experienceCompanyCandidates = isConnectionNote
      ? profileExperienceCompanyCandidates()
      : [];
    const titleCandidates = isConnectionNote ? profileTitleCandidates() : [];
    const suggestion = isConnectionNote
      ? UfxLinkedIn.companyFromProfileSignals({
        currentCompanyCandidates,
        experienceCompanyCandidates,
        titleCandidates,
        headlines,
      })
      : UfxLinkedIn.companyFromHeadlines(headlines);
    let visibleSource = isConnectionNote
      ? "visible LinkedIn profile headline"
      : "visible LinkedIn headline";
    if (suggestion?.source === "profile-current-company") {
      visibleSource = "visible LinkedIn current company";
    } else if (suggestion?.source === "profile-experience") {
      visibleSource = "current LinkedIn Experience entry";
    } else if (suggestion?.source === "profile-title") {
      visibleSource = "LinkedIn profile title";
    }
    return {
      status: suggestion ? "suggested" : "none",
      company: suggestion?.company ?? "",
      confidence: suggestion?.confidence ?? "",
      source: suggestion ? visibleSource : `no clear ${visibleSource}`,
      headlinesFound: headlines.filter((value) => value.trim()).length,
      currentCompanyCandidates,
      experienceCompanyCandidates,
      titleCandidates,
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

  function exceededCharacterLimit(composer, text) {
    const nativeLimit = Number(composer.maxLength);
    const noteDialog = connectionNoteDialog(composer);
    const limit = Number.isInteger(nativeLimit) && nativeLimit > 0
      ? nativeLimit
      : noteDialog
        ? UfxLinkedIn.connectionNoteCharacterLimit(
          noteDialog.innerText || noteDialog.textContent || ""
        )
        : 0;
    if (!limit) return 0;
    return UfxLinkedIn.exceedsCharacterLimit({
      currentText: composerText(composer),
      insertedText: text,
      maxLength: limit,
    }) ? limit : 0;
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

  async function runTemplate(template, triggerPath = []) {
    const composer = activeComposer(triggerPath);
    if (!composer) {
      toast("Click inside a LinkedIn conversation or connection note first", "error");
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

    const characterLimit = exceededCharacterLimit(composer, text);
    if (characterLimit) {
      toast(`Connection notes allow ${characterLimit} characters. Shorten the template first.`, "error");
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
      toast(`Suggested “${suggestedCompany}” from ${recipient.firstName || "the recipient"}'s ${companyLookup.source} — review & send`);
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
    const triggerPath = typeof event.composedPath === "function"
      ? event.composedPath()
      : [event.target];
    templateRunInFlight = true;
    runTemplate(template, triggerPath)
      .catch(() => toast("Couldn't insert the template", "error"))
      .finally(() => { templateRunInFlight = false; });
  }

  // Console helper for diagnosing LinkedIn selector drift.
  window.__ufxLinkedInDmDebug = () => {
    const composer = activeComposer();
    const info = {
      platform: "linkedin",
      surface: composer && isConnectionNoteComposer(composer) ? "connection-note" : "conversation",
      composerFound: !!composer,
      composerCandidates: composerCandidates().map((element) => ({
        tag: element.tagName,
        classes: element.className,
        role: element.getAttribute("role"),
        ariaLabel: element.getAttribute("aria-label"),
        placeholder: element.getAttribute("placeholder") || element.getAttribute("data-placeholder"),
        maxLength: element.maxLength,
        surface: isConnectionNoteComposer(element) ? "connection-note" : "conversation",
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
