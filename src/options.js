// Template manager page logic. Storage shape:
// dmTemplates: { version: 1, templates: [{ id, name, body, shortcut, createdAt, updatedAt }] }

const $ = (id) => document.getElementById(id);
const listEl = $("templateList");
const editorEl = $("editor");
const emptyEl = $("emptyState");
const nameEl = $("tplName");
const bodyEl = $("tplBody");
const previewEl = $("preview");
const shortcutBtn = $("shortcutBtn");
const shortcutWarning = $("shortcutWarning");
const saveStateEl = $("saveState");

let store = { version: 1, templates: [] };
let selectedId = null;
let recording = false;

// ---------- persistence ----------

async function load() {
  const { dmTemplates } = await chrome.storage.sync.get("dmTemplates");
  if (dmTemplates?.templates) store = dmTemplates;
  selectedId = store.templates[0]?.id ?? null;
  renderAll();
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.sync.set({ dmTemplates: store });
    saveStateEl.hidden = false;
    saveStateEl.style.opacity = "1";
    setTimeout(() => (saveStateEl.style.opacity = "0"), 1200);
  }, 350);
}

const selected = () => store.templates.find((t) => t.id === selectedId) ?? null;

function touch(template) {
  template.updatedAt = Date.now();
  scheduleSave();
}

// ---------- rendering ----------

function renderAll() {
  renderList();
  renderEditor();
}

function renderList() {
  listEl.textContent = "";
  for (const t of store.templates) {
    const li = document.createElement("li");
    li.className = "template-item" + (t.id === selectedId ? " selected" : "");
    li.addEventListener("click", () => {
      selectedId = t.id;
      renderAll();
    });

    const top = document.createElement("div");
    top.className = "template-item-top";
    const name = document.createElement("span");
    name.className = "template-item-name";
    name.textContent = t.name || "Untitled";
    top.appendChild(name);
    const combo = UfxTemplates.formatShortcut(t.shortcut);
    if (combo) {
      const kbd = document.createElement("span");
      kbd.className = "kbd";
      kbd.textContent = combo;
      top.appendChild(kbd);
    }

    const snippet = document.createElement("div");
    snippet.className = "template-item-snippet";
    snippet.textContent = t.body;

    li.append(top, snippet);
    listEl.appendChild(li);
  }
}

function renderEditor() {
  const t = selected();
  editorEl.hidden = !t;
  emptyEl.hidden = !!t;
  if (!t) return;
  if (document.activeElement !== nameEl) nameEl.value = t.name;
  if (document.activeElement !== bodyEl) bodyEl.value = t.body;
  renderShortcutButton();
  renderPreview();
}

function renderShortcutButton() {
  const t = selected();
  if (!t) return;
  if (recording) {
    shortcutBtn.textContent = "Press keys…";
    shortcutBtn.classList.add("recording");
    warn("Press a combo including ⌘, ⌥ or ⌃ — Esc cancels, ⌫ clears.");
    return;
  }
  shortcutBtn.classList.remove("recording");
  shortcutBtn.textContent = UfxTemplates.formatShortcut(t.shortcut) || "Set shortcut";

  const clash = t.shortcut
    ? store.templates.find(
        (o) => o.id !== t.id && o.shortcut &&
          UfxTemplates.formatShortcut(o.shortcut) === UfxTemplates.formatShortcut(t.shortcut)
      )
    : null;
  if (clash) {
    warn(`Also assigned to “${clash.name || "Untitled"}” — only the first match will fire.`);
  } else if (t.shortcut && UfxTemplates.isReservedShortcut(t.shortcut)) {
    warn("The browser reserves this combo — it may never reach x.com. Pick another.");
  } else {
    warn(null);
  }
}

function warn(message) {
  shortcutWarning.hidden = !message;
  shortcutWarning.textContent = message ?? "";
}

// Keep this regex in sync with UfxTemplates.substitute.
const VAR_PATTERN = /\{\{\s*([a-zA-Z_]+)\s*\}\}|\{\s*([a-zA-Z_]+)\s*\}/g;

function renderPreview() {
  const t = selected();
  if (!t) return;
  previewEl.textContent = "";
  const known = new Map(UfxTemplates.VARIABLES.map((v) => [v.key, v]));
  let last = 0;
  for (const match of t.body.matchAll(VAR_PATTERN)) {
    const key = match[1] || match[2];
    const isDouble = !!match[1];
    if (!isDouble && !known.has(key)) continue; // literal {word}, leave in text run
    previewEl.appendChild(document.createTextNode(t.body.slice(last, match.index)));
    const span = document.createElement("span");
    const variable = known.get(key);
    if (!variable) {
      span.className = "var-missing";
      span.textContent = match[0] + " ⟵ unknown variable";
    } else if (variable.kind === "manual") {
      span.className = "var-manual";
      span.textContent = variable.placeholder;
      span.title = "Inserted pre-selected — you type the real value over it";
    } else {
      span.className = "var";
      span.textContent = variable.sample;
    }
    previewEl.appendChild(span);
    last = match.index + match[0].length;
  }
  previewEl.appendChild(document.createTextNode(t.body.slice(last)));
}

// ---------- variable chips ----------

for (const v of UfxTemplates.VARIABLES) {
  const chip = document.createElement("button");
  chip.className = "chip";
  chip.type = "button";
  chip.textContent = `{{${v.key}}}`;
  chip.title = `${v.label} — e.g. ${v.sample}`;
  chip.addEventListener("click", () => {
    const t = selected();
    if (!t) return;
    const token = `{{${v.key}}}`;
    const start = bodyEl.selectionStart ?? bodyEl.value.length;
    const end = bodyEl.selectionEnd ?? start;
    bodyEl.setRangeText(token, start, end, "end");
    bodyEl.focus();
    t.body = bodyEl.value;
    touch(t);
    renderList();
    renderPreview();
  });
  $("variableChips").appendChild(chip);
}

// ---------- field wiring ----------

nameEl.addEventListener("input", () => {
  const t = selected();
  if (!t) return;
  t.name = nameEl.value;
  touch(t);
  renderList();
});

bodyEl.addEventListener("input", () => {
  const t = selected();
  if (!t) return;
  t.body = bodyEl.value;
  touch(t);
  renderList();
  renderPreview();
});

// ---------- shortcut recorder ----------

shortcutBtn.addEventListener("click", () => {
  recording = !recording;
  renderShortcutButton();
});

window.addEventListener(
  "keydown",
  (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    const t = selected();
    if (!t) return;

    if (e.key === "Escape") {
      recording = false;
    } else if (e.key === "Backspace" || e.key === "Delete") {
      t.shortcut = null;
      touch(t);
      recording = false;
    } else {
      const combo = UfxTemplates.shortcutFromEvent(e);
      if (combo) {
        t.shortcut = combo;
        touch(t);
        recording = false;
      }
    }
    renderList();
    renderShortcutButton();
  },
  true
);

// ---------- create / delete ----------

$("newTemplate").addEventListener("click", () => {
  const now = Date.now();
  const t = {
    id: crypto.randomUUID(),
    name: "",
    body: "Hey {{first_name}}! ",
    shortcut: null,
    createdAt: now,
    updatedAt: now,
  };
  store.templates.push(t);
  selectedId = t.id;
  scheduleSave();
  renderAll();
  nameEl.focus();
});

let deleteArmed = false;
const deleteBtn = $("deleteTemplate");
deleteBtn.addEventListener("click", () => {
  if (!deleteArmed) {
    deleteArmed = true;
    deleteBtn.textContent = "Really delete?";
    setTimeout(() => {
      deleteArmed = false;
      deleteBtn.textContent = "Delete template";
    }, 2500);
    return;
  }
  deleteArmed = false;
  deleteBtn.textContent = "Delete template";
  store.templates = store.templates.filter((t) => t.id !== selectedId);
  selectedId = store.templates[0]?.id ?? null;
  scheduleSave();
  renderAll();
});

load();
