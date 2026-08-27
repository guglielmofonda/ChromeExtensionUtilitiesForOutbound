// Full-page template workbench. Stored data remains intentionally small and
// backwards-compatible with the original v1 shape.

const $ = (id) => document.getElementById(id);

const listEl = $("templateList");
const editorEl = $("editor");
const emptyEl = $("emptyState");
const previewPaneEl = $("previewPane");
const nameEl = $("tplName");
const bodyEl = $("tplBody");
const previewEl = $("preview");
const shortcutBtn = $("shortcutBtn");
const shortcutWarning = $("shortcutWarning");
const saveStateEl = $("saveState");
const saveStateTextEl = $("saveStateText");
const searchEl = $("templateSearch");
const templateCountEl = $("templateCount");
const libraryEmptyEl = $("libraryEmpty");
const appNoticeEl = $("appNotice");
const importDialogEl = $("importDialog");
const importSummaryEl = $("importSummary");
const deleteBtn = $("deleteTemplate");
const deleteLabelEl = $("deleteTemplateLabel");

const MAX_IMPORT_BYTES = 1_000_000;
const MAX_IMPORT_TEMPLATES = 200;
const MAX_TEMPLATE_NAME = 80;
const MAX_TEMPLATE_BODY = 12_000;
const BACKUP_FORMAT = "dm-templates-backup";

let store = { version: 1, templates: [] };
let selectedId = null;
let recording = false;
let saveTimer = null;
let noticeTimer = null;
let deleteTimer = null;
let pendingImport = null;

const previewSample = {
  fullName: "Jane Doe",
  handle: "janedoe",
  company: "Acme",
};

// ---------- shared data helpers ----------

const selected = () => store.templates.find((template) => template.id === selectedId) ?? null;

function makeId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `template-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeShortcut(shortcut) {
  if (!shortcut || typeof shortcut !== "object" || typeof shortcut.code !== "string") {
    return null;
  }
  const code = shortcut.code.trim().slice(0, 40);
  const normalized = {
    code,
    alt: !!shortcut.alt,
    ctrl: !!shortcut.ctrl,
    meta: !!shortcut.meta,
    shift: !!shortcut.shift,
  };
  if (!code || (!normalized.alt && !normalized.ctrl && !normalized.meta)) return null;
  return normalized;
}

function normalizeTemplate(template, index, usedIds) {
  if (!template || typeof template !== "object") {
    throw new Error(`Template ${index + 1} is not valid.`);
  }

  let id = typeof template.id === "string" ? template.id.trim().slice(0, 120) : "";
  if (!id || usedIds.has(id)) id = makeId();
  usedIds.add(id);

  const now = Date.now();
  return {
    id,
    name: String(template.name ?? "").slice(0, MAX_TEMPLATE_NAME),
    body: String(template.body ?? "").slice(0, MAX_TEMPLATE_BODY),
    shortcut: normalizeShortcut(template.shortcut),
    platforms: UfxTemplates.normalizePlatforms(template.platforms),
    createdAt: Number.isFinite(template.createdAt) ? template.createdAt : now,
    updatedAt: Number.isFinite(template.updatedAt) ? template.updatedAt : now,
  };
}

function normalizeStore(candidate) {
  const source = candidate?.dmTemplates ?? candidate;
  if (!source || !Array.isArray(source.templates)) {
    throw new Error("This file does not contain a DM Templates backup.");
  }
  if (source.templates.length > MAX_IMPORT_TEMPLATES) {
    throw new Error(`A backup can contain at most ${MAX_IMPORT_TEMPLATES} templates.`);
  }

  const usedIds = new Set();
  return {
    version: 1,
    templates: source.templates.map((template, index) =>
      normalizeTemplate(template, index, usedIds)
    ),
  };
}

function templatePlatforms(template) {
  return UfxTemplates.normalizePlatforms(template?.platforms);
}

function platformLabel(platforms) {
  if (platforms.length === 2) return "X and LinkedIn";
  return platforms[0] === "linkedin" ? "LinkedIn" : "X";
}

function shortcutClashFor(template) {
  const formatted = UfxTemplates.formatShortcut(template?.shortcut);
  if (!formatted) return null;
  return (
    store.templates.find(
      (other) =>
        other.id !== template.id &&
        UfxTemplates.templatesSharePlatform(template, other) &&
        UfxTemplates.formatShortcut(other.shortcut) === formatted
    ) ?? null
  );
}

function diagnosticsFor(template) {
  const analysis = UfxTemplates.analyzeTemplate(template?.body);
  const clash = shortcutClashFor(template);
  const shortcut = UfxTemplates.formatShortcut(template?.shortcut);
  const reserved = !!template?.shortcut && UfxTemplates.isReservedShortcut(template.shortcut);
  const blockers = [];

  if (!template?.name?.trim()) blockers.push("name");
  if (!template?.body?.trim()) blockers.push("message");
  if (!shortcut) blockers.push("shortcut");
  if (clash) blockers.push("shortcut conflict");
  if (reserved) blockers.push("reserved shortcut");
  if (analysis.unknown.length) blockers.push("unknown variables");

  return { ...analysis, clash, shortcut, reserved, blockers };
}

function touch(template) {
  template.updatedAt = Date.now();
  scheduleSave();
}

// ---------- persistence and feedback ----------

function setSaveState(state) {
  saveStateEl.classList.toggle("is-saving", state === "saving");
  saveStateEl.classList.toggle("is-error", state === "error");
  saveStateTextEl.textContent =
    state === "saving" ? "Saving…" : state === "error" ? "Couldn’t save" : "Saved just now";
}

async function persistStore() {
  clearTimeout(saveTimer);
  saveTimer = null;
  setSaveState("saving");
  try {
    await chrome.storage.sync.set({ dmTemplates: store });
    setSaveState("saved");
    return true;
  } catch {
    setSaveState("error");
    showNotice("Your changes could not be saved. Check Chrome sync and try again.", "error", 0);
    return false;
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveState("saving");
  saveTimer = setTimeout(() => void persistStore(), 350);
}

function showNotice(message, kind = "info", duration = 3200) {
  clearTimeout(noticeTimer);
  appNoticeEl.textContent = message;
  appNoticeEl.className = `notice${kind === "info" ? "" : ` is-${kind}`}`;
  appNoticeEl.setAttribute("role", kind === "error" ? "alert" : "status");
  appNoticeEl.hidden = false;
  if (duration > 0) {
    noticeTimer = setTimeout(() => {
      appNoticeEl.hidden = true;
    }, duration);
  }
}

async function load() {
  try {
    const { dmTemplates } = await chrome.storage.sync.get("dmTemplates");
    if (dmTemplates?.templates) store = normalizeStore(dmTemplates);
    selectedId = store.templates[0]?.id ?? null;
    setSaveState("saved");
  } catch {
    store = { version: 1, templates: [] };
    selectedId = null;
    showNotice("Templates could not be loaded from Chrome sync.", "error", 0);
  }
  renderAll();
}

// ---------- reusable DOM pieces ----------

function createPlatformMark(platform, compact = false) {
  const mark = document.createElement("span");
  mark.className = compact
    ? `platform-mini platform-mini-${platform}`
    : `platform-logo platform-logo-${platform}`;
  mark.textContent = platform === "linkedin" ? "in" : "X";
  mark.setAttribute("aria-label", platform === "linkedin" ? "LinkedIn" : "X");
  return mark;
}

function appendText(parent, className, text) {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

// ---------- library ----------

function renderList() {
  listEl.textContent = "";
  const query = searchEl.value.trim().toLocaleLowerCase();
  const filtered = store.templates.filter((template) => {
    if (!query) return true;
    return `${template.name} ${template.body}`.toLocaleLowerCase().includes(query);
  });

  templateCountEl.textContent = query
    ? `${filtered.length} of ${store.templates.length}`
    : String(store.templates.length);
  libraryEmptyEl.hidden = filtered.length > 0 || store.templates.length === 0;

  for (const template of filtered) {
    const item = document.createElement("li");
    item.className = "template-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-button";
    button.setAttribute("aria-current", String(template.id === selectedId));
    button.setAttribute("aria-label", `Edit ${template.name || "untitled template"}`);
    button.addEventListener("click", () => {
      selectedId = template.id;
      resetDeleteButton();
      renderAll();
    });

    const top = document.createElement("span");
    top.className = "template-item-top";
    appendText(top, "template-item-name", template.name || "Untitled");
    const shortcut = UfxTemplates.formatShortcut(template.shortcut);
    if (shortcut) appendText(top, "kbd", shortcut);

    const snippet = document.createElement("span");
    snippet.className = "template-item-snippet";
    snippet.textContent = template.body || "No message yet";

    const meta = document.createElement("span");
    meta.className = "template-item-meta";
    const platforms = document.createElement("span");
    platforms.className = "template-platforms";
    for (const platform of templatePlatforms(template)) {
      platforms.appendChild(createPlatformMark(platform, true));
    }

    const diagnostics = diagnosticsFor(template);
    appendText(
      meta,
      `template-ready${diagnostics.blockers.length ? " needs-work" : ""}`,
      diagnostics.blockers.length ? "Needs setup" : "Ready"
    );
    meta.prepend(platforms);

    button.append(top, snippet, meta);
    item.appendChild(button);
    listEl.appendChild(item);
  }
}

// ---------- editor ----------

function renderAll() {
  renderList();
  renderEditor();
  renderPreviewPane();
}

function renderEditor() {
  const template = selected();
  editorEl.hidden = !template;
  emptyEl.hidden = !!template;
  if (!template) return;

  if (document.activeElement !== nameEl) nameEl.value = template.name;
  if (document.activeElement !== bodyEl) bodyEl.value = template.body;

  $("editorTitle").textContent = template.name || "Untitled template";
  $("characterCount").textContent = `${template.body.length} ${
    template.body.length === 1 ? "character" : "characters"
  }`;

  const platforms = templatePlatforms(template);
  $("platformX").checked = platforms.includes("x");
  $("platformLinkedIn").checked = platforms.includes("linkedin");

  const diagnostics = diagnosticsFor(template);
  const statusEl = $("templateStatus");
  statusEl.classList.toggle("needs-work", diagnostics.blockers.length > 0);
  statusEl.textContent = diagnostics.blockers.length
    ? `${diagnostics.blockers.length} setup ${diagnostics.blockers.length === 1 ? "item" : "items"} to fix`
    : `Ready on ${platformLabel(platforms)}`;

  renderShortcutButton();
}

function renderShortcutButton() {
  const template = selected();
  if (!template) return;

  if (recording) {
    shortcutBtn.textContent = "Press keys…";
    shortcutBtn.setAttribute("aria-label", "Recording shortcut. Press a key combination.");
    shortcutBtn.classList.add("recording");
    shortcutBtn.classList.remove("has-shortcut");
    warnShortcut("Use a combination with ⌘, ⌥, or ⌃. Escape cancels; Delete clears.");
    return;
  }

  const shortcut = UfxTemplates.formatShortcut(template.shortcut);
  const clash = shortcutClashFor(template);
  shortcutBtn.textContent = shortcut || "Set shortcut";
  shortcutBtn.setAttribute(
    "aria-label",
    shortcut ? `Shortcut ${shortcut}. Press to change.` : "Set shortcut"
  );
  shortcutBtn.classList.remove("recording");
  shortcutBtn.classList.toggle("has-shortcut", !!shortcut);

  if (clash) {
    warnShortcut(
      `Also used by “${clash.name || "Untitled"}” on the same platform. Only the first match will run.`,
      "error"
    );
  } else if (template.shortcut && UfxTemplates.isReservedShortcut(template.shortcut)) {
    warnShortcut("The browser reserves this combination, so the message page may never receive it.");
  } else {
    warnShortcut(null);
  }
}

function warnShortcut(message, kind = "warning") {
  shortcutWarning.hidden = !message;
  shortcutWarning.textContent = message ?? "";
  shortcutWarning.classList.toggle("is-error", kind === "error");
}

function updateDerivedSurfaces() {
  renderList();
  renderEditor();
  renderPreviewPane();
}

// ---------- preview and readiness ----------

function currentPreviewRecipient() {
  const fullName = previewSample.fullName.trim();
  return {
    fullName,
    firstName: UfxTemplates.firstNameFrom(fullName),
    handle: previewSample.handle.trim().replace(/^@+/, ""),
    company: previewSample.company.trim(),
  };
}

function renderPreviewPane() {
  const template = selected();
  previewPaneEl.hidden = !template;
  if (!template) return;

  renderPreviewContext(template);
  renderPreview(template);
  renderReadiness(template);
}

function renderPreviewContext(template) {
  const context = $("previewContext");
  context.textContent = "";
  const platforms = templatePlatforms(template);
  for (const platform of platforms) context.appendChild(createPlatformMark(platform, true));
  appendText(context, "preview-context-label", `Preview on ${platformLabel(platforms)}`);
}

function renderPreview(template) {
  previewEl.textContent = "";
  const recipient = currentPreviewRecipient();
  const known = new Map(UfxTemplates.VARIABLES.map((variable) => [variable.key, variable]));
  const pattern = /\{\{\s*([a-zA-Z_]+)\s*\}\}|\{\s*([a-zA-Z_]+)\s*\}/g;
  const values = {
    first_name: recipient.firstName,
    full_name: recipient.fullName,
    handle: recipient.handle,
    company: recipient.company,
  };
  let last = 0;

  for (const match of template.body.matchAll(pattern)) {
    const key = match[1] || match[2];
    const isDouble = !!match[1];
    if (!isDouble && !known.has(key)) continue;

    previewEl.appendChild(document.createTextNode(template.body.slice(last, match.index)));
    const variable = known.get(key);
    const span = document.createElement("span");
    if (!variable) {
      span.className = "var-missing";
      span.textContent = match[0];
      span.title = "Unknown variable";
    } else if (values[key]) {
      span.className = key === "company" ? "var-assisted" : "var";
      span.textContent = values[key];
      span.title = `${variable.label} sample value`;
    } else if (variable.placeholder) {
      span.className = "var-assisted";
      span.textContent = variable.placeholder;
      span.title = "Review and replace this value";
    } else {
      span.className = "var-missing";
      span.textContent = match[0];
      span.title = `${variable.label} is missing from the sample recipient`;
    }
    previewEl.appendChild(span);
    last = match.index + match[0].length;
  }

  previewEl.appendChild(document.createTextNode(template.body.slice(last)));
  if (!template.body) {
    appendText(previewEl, "preview-placeholder", "Your message preview will appear here.");
  }
}

function readinessRow({ label, detail, state = "success" }) {
  const row = document.createElement("li");
  row.className = `readiness-row ${state}`;
  appendText(row, "readiness-icon", state === "success" ? "✓" : state === "warning" ? "!" : "×");
  appendText(row, "readiness-label", label);
  appendText(row, "readiness-detail", detail);
  return row;
}

function renderReadiness(template) {
  const list = $("readinessList");
  list.textContent = "";
  const diagnostics = diagnosticsFor(template);

  if (diagnostics.clash) {
    list.appendChild(
      readinessRow({
        label: "Shortcut conflict",
        detail: diagnostics.clash.name || "Another template",
        state: "error",
      })
    );
  } else if (diagnostics.reserved) {
    list.appendChild(
      readinessRow({ label: "Shortcut may be reserved", detail: diagnostics.shortcut, state: "warning" })
    );
  } else if (diagnostics.shortcut) {
    list.appendChild(
      readinessRow({ label: "Shortcut assigned", detail: diagnostics.shortcut })
    );
  } else {
    list.appendChild(
      readinessRow({ label: "Assign a shortcut", detail: "Required", state: "warning" })
    );
  }

  if (!template.body.trim()) {
    list.appendChild(
      readinessRow({ label: "Write a message", detail: "Required", state: "error" })
    );
  } else if (diagnostics.unknown.length) {
    list.appendChild(
      readinessRow({
        label: "Fix unknown variables",
        detail: diagnostics.unknown.join(", "),
        state: "error",
      })
    );
  } else {
    list.appendChild(
      readinessRow({
        label: "Variables recognized",
        detail: String(diagnostics.variables.length),
      })
    );
  }

  list.appendChild(
    diagnostics.usesCompany
      ? readinessRow({
          label: "Personalize the company",
          detail: "Review each time",
          state: "warning",
        })
      : readinessRow({ label: "Company placeholder", detail: "Not used" })
  );

  list.appendChild(
    diagnostics.hasLink
      ? readinessRow({ label: "Link in first message", detail: "Consider removing", state: "warning" })
      : readinessRow({ label: "No link in first message", detail: "Good" })
  );
}

// ---------- variable insertion ----------

for (const variable of UfxTemplates.VARIABLES) {
  const button = document.createElement("button");
  button.className = "variable-button";
  button.type = "button";
  button.textContent = `{{${variable.key}}}`;
  button.title = variable.help || `${variable.label}, for example ${variable.sample}`;
  button.addEventListener("click", () => {
    const template = selected();
    if (!template) return;
    const token = `{{${variable.key}}}`;
    const start = bodyEl.selectionStart ?? bodyEl.value.length;
    const end = bodyEl.selectionEnd ?? start;
    bodyEl.setRangeText(token, start, end, "end");
    bodyEl.focus();
    template.body = bodyEl.value;
    touch(template);
    updateDerivedSurfaces();
  });
  $("variableChips").appendChild(button);
}

// ---------- field wiring ----------

nameEl.addEventListener("input", () => {
  const template = selected();
  if (!template) return;
  template.name = nameEl.value;
  touch(template);
  updateDerivedSurfaces();
});

bodyEl.addEventListener("input", () => {
  const template = selected();
  if (!template) return;
  template.body = bodyEl.value;
  touch(template);
  updateDerivedSurfaces();
});

for (const [id, key] of [
  ["sampleFullName", "fullName"],
  ["sampleHandle", "handle"],
  ["sampleCompany", "company"],
]) {
  $(id).addEventListener("input", (event) => {
    previewSample[key] = event.target.value;
    const template = selected();
    if (template) renderPreview(template);
  });
}

function updatePlatform(platform, checked) {
  const template = selected();
  if (!template) return;
  const platforms = new Set(templatePlatforms(template));
  if (checked) platforms.add(platform);
  else platforms.delete(platform);

  if (!platforms.size) {
    $(platform === "x" ? "platformX" : "platformLinkedIn").checked = true;
    showNotice("A template needs to work on at least one platform.", "error");
    return;
  }

  template.platforms = UfxTemplates.PLATFORMS.filter((candidate) => platforms.has(candidate));
  touch(template);
  updateDerivedSurfaces();
}

$("platformX").addEventListener("change", (event) => updatePlatform("x", event.target.checked));
$("platformLinkedIn").addEventListener("change", (event) =>
  updatePlatform("linkedin", event.target.checked)
);

// ---------- shortcut recorder ----------

shortcutBtn.addEventListener("click", () => {
  recording = !recording;
  renderShortcutButton();
});

window.addEventListener(
  "keydown",
  (event) => {
    if (!recording) return;
    event.preventDefault();
    event.stopPropagation();
    const template = selected();
    if (!template) return;

    if (event.key === "Escape") {
      recording = false;
    } else if (event.key === "Backspace" || event.key === "Delete") {
      template.shortcut = null;
      touch(template);
      recording = false;
    } else {
      const shortcut = UfxTemplates.shortcutFromEvent(event);
      if (shortcut) {
        template.shortcut = shortcut;
        touch(template);
        recording = false;
      }
    }
    updateDerivedSurfaces();
  },
  true
);

// ---------- create, duplicate, delete ----------

function createTemplate() {
  const now = Date.now();
  const template = {
    id: makeId(),
    name: "",
    body: "hey {{first_name}}, ",
    shortcut: null,
    platforms: ["x", "linkedin"],
    createdAt: now,
    updatedAt: now,
  };
  store.templates.push(template);
  selectedId = template.id;
  searchEl.value = "";
  resetDeleteButton();
  scheduleSave();
  renderAll();
  nameEl.focus();
}

$("newTemplate").addEventListener("click", createTemplate);
$("emptyNewTemplate").addEventListener("click", createTemplate);

$("duplicateTemplate").addEventListener("click", () => {
  const template = selected();
  if (!template) return;
  const now = Date.now();
  const duplicate = {
    ...template,
    id: makeId(),
    name: `${template.name || "Untitled"} copy`.slice(0, MAX_TEMPLATE_NAME),
    shortcut: null,
    platforms: [...templatePlatforms(template)],
    createdAt: now,
    updatedAt: now,
  };
  const index = store.templates.findIndex((candidate) => candidate.id === template.id);
  store.templates.splice(index + 1, 0, duplicate);
  selectedId = duplicate.id;
  scheduleSave();
  renderAll();
  nameEl.focus();
  nameEl.select();
  showNotice("Template duplicated. Add a shortcut when it is ready.", "success");
});

function resetDeleteButton() {
  clearTimeout(deleteTimer);
  deleteTimer = null;
  deleteBtn.classList.remove("is-armed");
  deleteLabelEl.textContent = "Delete";
}

deleteBtn.addEventListener("click", () => {
  if (!deleteTimer) {
    deleteBtn.classList.add("is-armed");
    deleteLabelEl.textContent = "Delete now";
    deleteTimer = setTimeout(resetDeleteButton, 3000);
    return;
  }

  const deleted = selected();
  clearTimeout(deleteTimer);
  deleteTimer = null;
  store.templates = store.templates.filter((template) => template.id !== selectedId);
  selectedId = store.templates[0]?.id ?? null;
  scheduleSave();
  resetDeleteButton();
  renderAll();
  showNotice(`“${deleted?.name || "Untitled"}” deleted.`, "success");
});

// ---------- search and compact header ----------

searchEl.addEventListener("input", () => {
  const query = searchEl.value.trim().toLocaleLowerCase();
  if (query) {
    const matches = store.templates.filter((template) =>
      `${template.name} ${template.body}`.toLocaleLowerCase().includes(query)
    );
    if (matches.length && !matches.some((template) => template.id === selectedId)) {
      selectedId = matches[0].id;
      resetDeleteButton();
      renderAll();
      return;
    }
  }
  renderList();
});
$("clearSearch").addEventListener("click", () => {
  searchEl.value = "";
  renderList();
  searchEl.focus();
});

$("searchShortcut").textContent = UfxTemplates.IS_MAC ? "⌘K" : "Ctrl K";
window.addEventListener("keydown", (event) => {
  if (recording) return;
  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
    event.preventDefault();
    searchEl.focus();
    searchEl.select();
  }
});

const mobileActionsBtn = $("mobileActions");

function setMobileActionsOpen(open) {
  const actions = mobileActionsBtn.closest(".topbar-actions");
  actions.classList.toggle("actions-open", open);
  mobileActionsBtn.setAttribute("aria-expanded", String(open));
  mobileActionsBtn.setAttribute(
    "aria-label",
    `${open ? "Hide" : "Show"} import and export actions`
  );
}

mobileActionsBtn.addEventListener("click", () => {
  const actions = mobileActionsBtn.closest(".topbar-actions");
  const open = !actions.classList.contains("actions-open");
  setMobileActionsOpen(open);
});

for (const action of document.querySelectorAll(".header-action")) {
  action.addEventListener("click", () => setMobileActionsOpen(false));
}

document.addEventListener("click", (event) => {
  const actions = mobileActionsBtn.closest(".topbar-actions");
  if (!actions.contains(event.target)) {
    setMobileActionsOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMobileActionsOpen(false);
});

// ---------- backup and restore ----------

function exportTemplates() {
  const payload = {
    format: BACKUP_FORMAT,
    exportedAt: new Date().toISOString(),
    dmTemplates: store,
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dm-templates-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showNotice(`${store.templates.length} ${store.templates.length === 1 ? "template" : "templates"} exported.`, "success");
}

$("exportTemplates").addEventListener("click", exportTemplates);

$("importTemplates").addEventListener("click", () => {
  $("importFile").value = "";
  $("importFile").click();
});

$("importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) {
    showNotice("That backup is too large to import.", "error", 0);
    return;
  }

  try {
    pendingImport = normalizeStore(JSON.parse(await file.text()));
    importSummaryEl.textContent = `“${file.name}” contains ${pendingImport.templates.length} ${
      pendingImport.templates.length === 1 ? "template" : "templates"
    }.`;
    importDialogEl.showModal();
  } catch (error) {
    pendingImport = null;
    showNotice(error instanceof Error ? error.message : "That backup could not be imported.", "error", 0);
  }
});

$("confirmImport").addEventListener("click", async () => {
  if (!pendingImport) return;
  store = pendingImport;
  pendingImport = null;
  selectedId = store.templates[0]?.id ?? null;
  searchEl.value = "";
  importDialogEl.close();
  const saved = await persistStore();
  renderAll();
  if (saved) showNotice("Template library imported.", "success");
});

importDialogEl.addEventListener("close", () => {
  pendingImport = null;
});

load();
