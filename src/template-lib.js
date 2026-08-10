// Shared pure helpers for DM templates.
// Loaded by both the content script (via manifest) and the options page (via <script>).
// No DOM access, no chrome.* — keep it pure so both contexts can use it.

const UfxTemplates = (() => {
  // Order matters for the options-page chips.
  // kind "auto" resolves from the conversation DOM. "assisted" uses a
  // high-confidence suggestion when available, otherwise inserts a selected
  // placeholder the user types over.
  const VARIABLES = [
    { key: "first_name", label: "First name", sample: "Jane", kind: "auto" },
    { key: "full_name", label: "Full name", sample: "Jane Doe", kind: "auto" },
    { key: "handle", label: "Handle", sample: "janedoe", kind: "auto" },
    {
      key: "company",
      label: "Company",
      sample: "Acme",
      kind: "assisted",
      placeholder: "[company]",
      help: "Suggested from a clear bio signal; otherwise selected for you to type",
    },
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

  const COMPANY_ROLE = "(?:co[- ]?founder|founder|chief executive|ceo|cto|cpo|coo|president|owner|creator|maker)";
  const COMPANY_ACTION = "(?:building|working on|creating|making)";
  const COMPANY_BREAK_RE = /\s+(?:while|previously|formerly|currently|based|investing|writing|helping)\b/i;
  const GENERIC_COMPANY_RE = /^(?:stealth(?: startup)?|startup|company|project|product|software|tools?|apps?|agents?|community|the future|something new|my next thing)$/i;
  const GENERIC_BUILDING_WORD_RE = /^(?:ai|consumer|developer|dev|enterprise|open source|social|software|hardware|tools?|products?|apps?|agents?|infrastructure|community|communities|companies|startups?)$/i;

  function looksLikeCompanyWord(word) {
    return (
      /^[A-Z0-9][A-Za-z0-9+&.'’_-]*$/.test(word) ||
      /^[a-z][A-Za-z0-9+&.'’_-]*[A-Z0-9][A-Za-z0-9+&.'’_-]*$/.test(word)
    );
  }

  function cleanCompanyCandidate(raw, source) {
    if (!raw) return "";
    const candidate = raw
      .replace(EMOJI_RE, " ")
      .split(COMPANY_BREAK_RE)[0]
      .replace(/\s+(?:and|but)\s+(?:building|working|investing|writing|helping)\b.*$/i, "")
      .replace(/^[\s@'\"“”‘’([{]+|[\s'\"“”‘’\])}]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!candidate || candidate.length > 60 || /https?:\/\/|www\./i.test(candidate)) return "";
    const words = candidate.split(/\s+/);
    if (words.length > 6 || GENERIC_COMPANY_RE.test(candidate)) return "";

    // A plain-text inference must look like a proper name. Handles are already
    // explicit identifiers, so preserve their original casing and underscores.
    if (source !== "bio-mention") {
      const meaningful = words.filter((word) => !/^(?:the|of|and|&|for)$/i.test(word));
      if (!meaningful.length || meaningful.some((word) => !looksLikeCompanyWord(word))) {
        return "";
      }
    }

    if (source === "bio-building" && GENERIC_BUILDING_WORD_RE.test(candidate)) return "";
    return candidate;
  }

  // Returns one unambiguous company suggestion from explicit bio language such
  // as "Founder @WorkOS", "CEO of Acme Labs", or "Building Modal". Generic
  // claims like "building AI tools" deliberately return null.
  function inferCompanyFromBio(rawBio) {
    const bio = (rawBio || "").replace(/\s+/g, " ").trim();
    if (!bio) return null;

    const candidates = [];
    const add = (raw, source, confidence) => {
      const company = cleanCompanyCandidate(raw, source);
      if (!company) return;
      candidates.push({ company, source, confidence });
    };

    const roleMention = new RegExp(`\\b(?:${COMPANY_ROLE}|${COMPANY_ACTION})\\b[^@|•·;.!?]{0,48}?@([A-Za-z0-9_]{1,15})`, "gi");
    for (const match of bio.matchAll(roleMention)) add(match[1], "bio-mention", "high");

    const roleName = new RegExp(`\\b${COMPANY_ROLE}(?:\\s*(?:&|/)\\s*${COMPANY_ROLE})?\\s+(?:at|of)\\s+([^|•·;.!?]{2,60})`, "gi");
    for (const match of bio.matchAll(roleName)) add(match[1], "bio-role", "high");

    const buildingName = new RegExp(`\\b${COMPANY_ACTION}\\s+([^|•·;.!?]{2,60})`, "gi");
    for (const match of bio.matchAll(buildingName)) add(match[1], "bio-building", "medium");

    const unique = new Map();
    for (const candidate of candidates) {
      const key = candidate.company.toLowerCase().replace(/[^a-z0-9]/g, "");
      const existing = unique.get(key);
      if (!existing || (existing.confidence === "medium" && candidate.confidence === "high")) {
        unique.set(key, candidate);
      }
    }
    if (unique.size !== 1) return null;
    return [...unique.values()][0];
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
      if (variable.placeholder) {
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
    VARIABLES, cleanDisplayName, firstNameFrom, inferCompanyFromBio, substitute,
    formatShortcut, eventMatchesShortcut, shortcutFromEvent,
    isReservedShortcut, SAMPLE_RECIPIENT, IS_MAC,
  };
})();

if (typeof module !== "undefined") module.exports = UfxTemplates;
