// Shared pure helpers for DM templates.
// Loaded by both the content script (via manifest) and the options page (via <script>).
// No DOM access, no chrome.* — keep it pure so both contexts can use it.

const UfxTemplates = (() => {
  // Order matters for the options-page chips.
  // kind "auto" resolves from the conversation DOM; kind "manual" inserts a
  // pre-selected placeholder the user types over (until we can auto-resolve it).
  const VARIABLES = [
    { key: "first_name", label: "First name", sample: "Jane", kind: "auto" },
    { key: "full_name", label: "Full name", sample: "Jane Doe", kind: "auto" },
    { key: "handle", label: "Handle", sample: "janedoe", kind: "auto" },
    { key: "company", label: "Company", sample: "Acme", kind: "manual", placeholder: "[company]" },
  ];
  const KNOWN_KEYS = new Set(VARIABLES.map((v) => v.key));
  const byKey = (key) => VARIABLES.find((v) => v.key === key);

  // Emoji, pictographs, ZWJ sequences, variation selectors, skin-tone modifiers.
  const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️⃣]/gu;
  // Decorative separators people put in display names ("Jane Doe | Building X").
  // Deliberately excludes plain hyphen (Anne-Marie) and dots (initials).
  const SEPARATOR_RE = /[|•·—–~\/(\[{«「【]/;
  const HONORIFIC_RE = /^(dr|mr|ms|mrs|prof|sir)\.?$/i;

  function cleanDisplayName(raw) {
    if (!raw) return "";
    let name = raw.replace(EMOJI_RE, " ");
    const sep = name.search(SEPARATOR_RE);
    if (sep > 0) name = name.slice(0, sep);
    return name.replace(/\s+/g, " ").trim();
  }

  function firstNameFrom(fullName) {
    const tokens = cleanDisplayName(fullName).split(/\s+/).filter(Boolean);
    while (tokens.length > 1 && HONORIFIC_RE.test(tokens[0])) tokens.shift();
    let first = tokens[0] || "";
    // Trim stray punctuation but keep in-name chars (O'Brien, Anne-Marie, J.).
    first = first.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}.'’-]+$/u, "");
    // JANE → Jane, but leave stylized-lowercase names alone.
    if (first.length > 2 && first === first.toUpperCase() && /\p{L}/u.test(first)) {
      first = first[0] + first.slice(1).toLowerCase();
    }
    return first;
  }

  // recipient: { fullName, firstName, handle, company? } (any field may be "").
  // Returns { text, missing, placeholders }:
  //   missing      — auto variables that could not be resolved, plus unknown
  //                  {{keys}} (likely typos); caller should refuse to insert.
  //   placeholders — literal tokens (e.g. "[company]") inserted for manual
  //                  variables; caller should select the first one for type-over.
  function substitute(body, recipient) {
    const values = {
      first_name: recipient.firstName || "",
      full_name: recipient.fullName || "",
      handle: recipient.handle || "",
      company: recipient.company || "",
    };
    const missing = [];
    const placeholders = [];
    const text = body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}|\{\s*([a-zA-Z_]+)\s*\}/g, (match, dbl, sgl) => {
      const key = dbl || sgl;
      // Single-brace only substitutes known keys; leaves other {words} as literal text.
      if (!dbl && !KNOWN_KEYS.has(key)) return match;
      if (!KNOWN_KEYS.has(key)) {
        if (!missing.includes(key)) missing.push(key);
        return match;
      }
      if (values[key]) return values[key];
      const variable = byKey(key);
      if (variable.kind === "manual") {
        placeholders.push(variable.placeholder);
        return variable.placeholder;
      }
      if (!missing.includes(key)) missing.push(key);
      return match;
    });
    return { text, missing, placeholders };
  }

  const CODE_LABELS = {
    Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";",
    Quote: "'", BracketLeft: "[", BracketRight: "]", Backquote: "`",
    Minus: "-", Equal: "=", Space: "Space", Enter: "Enter", Tab: "Tab",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  };

  function codeLabel(code) {
    if (!code) return "";
    if (CODE_LABELS[code]) return CODE_LABELS[code];
    if (code.startsWith("Key")) return code.slice(3);
    if (code.startsWith("Digit")) return code.slice(5);
    return code;
  }

  const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  function formatShortcut(s) {
    if (!s || !s.code) return "";
    if (IS_MAC) {
      return (
        (s.ctrl ? "⌃" : "") + (s.alt ? "⌥" : "") + (s.shift ? "⇧" : "") +
        (s.meta ? "⌘" : "") + codeLabel(s.code)
      );
    }
    const parts = [];
    if (s.ctrl) parts.push("Ctrl");
    if (s.alt) parts.push("Alt");
    if (s.shift) parts.push("Shift");
    if (s.meta) parts.push("Win");
    parts.push(codeLabel(s.code));
    return parts.join("+");
  }

  function eventMatchesShortcut(e, s) {
    return (
      !!s && !!s.code && e.code === s.code &&
      e.altKey === !!s.alt && e.ctrlKey === !!s.ctrl &&
      e.metaKey === !!s.meta && e.shiftKey === !!s.shift
    );
  }

  function shortcutFromEvent(e) {
    // Modifier-only presses are not a shortcut.
    if (["Alt", "Control", "Meta", "Shift"].includes(e.key)) return null;
    if (!e.altKey && !e.ctrlKey && !e.metaKey) return null; // require a real modifier
    return { code: e.code, alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey };
  }

  // Combos the browser/OS handles before the page — recording them would silently fail.
  const RESERVED = IS_MAC
    ? ["⌘Q", "⌘W", "⌘T", "⌘N", "⌘H", "⌘M"]
    : ["Ctrl+W", "Ctrl+T", "Ctrl+N", "F11"];

  function isReservedShortcut(s) {
    return RESERVED.includes(formatShortcut(s));
  }

  const SAMPLE_RECIPIENT = { fullName: "Jane Doe", firstName: "Jane", handle: "janedoe" };

  return {
    VARIABLES, cleanDisplayName, firstNameFrom, substitute,
    formatShortcut, eventMatchesShortcut, shortcutFromEvent,
    isReservedShortcut, SAMPLE_RECIPIENT, IS_MAC,
  };
})();

if (typeof module !== "undefined") module.exports = UfxTemplates;
