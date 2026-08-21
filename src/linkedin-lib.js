// Pure LinkedIn parsing helpers. Keep DOM and chrome.* access in the content
// module so recipient/group behavior can be regression-tested in Node.

const UfxLinkedIn = ((Templates) => {
  const LINKEDIN_HOSTS = new Set(["linkedin.com", "www.linkedin.com"]);
  const GENERIC_HEADER_RE = /^(?:active now|available on mobile|conversation|conversation details|details|linkedin|messaging|new message|online|you)$/i;
  const GROUP_LABEL_RE = /(?:\band\s+\d+\s+others?\b|\b\d+\s+(?:members?|participants?)\b|\bgroup conversation\b)/i;
  const CONNECTION_NOTE_TITLE_RE = /\badd a note to your invitation\b/i;
  const CONNECTION_NOTE_PLACEHOLDER_RE = /\bwe know each other from\b/i;
  const CURRENT_COMPANY_HELP_RE = /\s*[.·|]?\s*click to skip to (?:the )?experience card\b.*$/i;

  function profileSlugFromHref(href, baseUrl = "https://www.linkedin.com/") {
    if (!href) return "";
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return "";
    }
    if (url.protocol !== "https:" || !LINKEDIN_HOSTS.has(url.hostname.toLowerCase())) return "";
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    if (!match) return "";

    let slug;
    try {
      slug = decodeURIComponent(match[1]);
    } catch {
      return "";
    }
    return /^[\p{L}\p{N}][\p{L}\p{N}._-]{1,99}$/u.test(slug) ? slug : "";
  }

  function cleanHeaderName(raw) {
    if (!raw) return "";
    const lines = String(raw).split(/\n+/);
    for (let line of lines) {
      line = line
        .replace(/^open\s+(?:the\s+)?conversation details(?:\s+for)?\s*/i, "")
        .replace(/^view\s+(?:the\s+)?profile(?:\s+for|\s+of)?\s*/i, "")
        .replace(/^open\s+(.+?)(?:'s|’s)\s+profile$/i, "$1")
        .replace(/\s*[·•]\s*(?:1st|2nd|3rd)(?:-degree)?(?: connection)?\s*$/i, "")
        .replace(/\s+(?:active now|available on mobile|online)\s*$/i, "")
        .trim();
      const cleaned = Templates.cleanDisplayName(line);
      if (!cleaned || cleaned.length > 100 || GENERIC_HEADER_RE.test(cleaned)) continue;
      return cleaned;
    }
    return "";
  }

  function profileNameFromTitle(raw) {
    let title = String(raw || "")
      .replace(/\s*\|\s*LinkedIn\b.*$/i, "")
      .trim();
    const detailSeparator = title.search(/\s[-–—]\s/);
    if (detailSeparator > 0) title = title.slice(0, detailSeparator).trim();
    if (!title || /^(?:LinkedIn|Sign in|Log in)\b/i.test(title)) return "";
    return cleanHeaderName(title);
  }

  function isGroupLabel(value) {
    return GROUP_LABEL_RE.test(value || "");
  }

  function isConnectionNoteContext({ dialogText = "", placeholder = "" } = {}) {
    return CONNECTION_NOTE_TITLE_RE.test(dialogText) ||
      CONNECTION_NOTE_PLACEHOLDER_RE.test(dialogText) ||
      CONNECTION_NOTE_TITLE_RE.test(placeholder) ||
      CONNECTION_NOTE_PLACEHOLDER_RE.test(placeholder);
  }

  function connectionNoteCharacterLimit(counterText = "", fallback = 300) {
    const match = String(counterText).match(/\b\d+\s*\/\s*(\d{1,4})\b/);
    const parsed = Number(match?.[1]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  function exceedsCharacterLimit({ currentText = "", insertedText = "", maxLength = -1 } = {}) {
    return maxLength > 0 && currentText.length + insertedText.length > maxLength;
  }

  function recipientFromHeader({ nameCandidates = [], profileHrefs = [], headerText = "" } = {}) {
    const slugs = [...new Map(
      profileHrefs
        .map((href) => profileSlugFromHref(href))
        .filter(Boolean)
        .map((slug) => [slug.toLowerCase(), slug])
    ).values()];
    const names = [...new Map(
      nameCandidates
        .map(cleanHeaderName)
        .filter(Boolean)
        .map((name) => [name.toLocaleLowerCase(), name])
    ).values()];

    if (
      slugs.length > 1 ||
      names.length > 1 ||
      isGroupLabel(headerText) ||
      nameCandidates.some(isGroupLabel)
    ) {
      return {
        fullName: "",
        firstName: "",
        handle: "",
        reason: "multiple people found — group conversation?",
      };
    }

    const fullName = names[0] || "";
    return {
      fullName,
      firstName: Templates.firstNameFrom(fullName),
      // LinkedIn has no @handles. The public /in/ identifier is the closest
      // stable equivalent for templates that already use {{handle}}.
      handle: slugs[0] || "",
      reason: fullName ? "" : "no conversation header found",
    };
  }

  function recipientFromProfile({
    nameCandidates = [],
    profileHrefs = [],
    titleCandidates = [],
  } = {}) {
    const visibleNames = nameCandidates.map(cleanHeaderName).filter(Boolean);
    const fallbackNames = visibleNames.length
      ? []
      : titleCandidates.map(profileNameFromTitle).filter(Boolean);
    const recipient = recipientFromHeader({
      nameCandidates: visibleNames.length ? visibleNames : fallbackNames,
      profileHrefs,
      headerText: (visibleNames.length ? visibleNames : fallbackNames).join("\n"),
    });
    if (recipient.reason === "no conversation header found") {
      return { ...recipient, reason: "no profile header found" };
    }
    return recipient;
  }

  function companyFromHeadlines(headlines = []) {
    const suggestions = [];
    for (const raw of headlines) {
      const inference = Templates.inferCompanyFromBio(raw);
      if (inference) suggestions.push(inference);
    }
    const unique = new Map();
    for (const suggestion of suggestions) {
      const key = suggestion.company.toLowerCase().replace(/[^a-z0-9]/g, "");
      const existing = unique.get(key);
      if (!existing || (existing.confidence === "medium" && suggestion.confidence === "high")) {
        unique.set(key, suggestion);
      }
    }
    return unique.size === 1 ? [...unique.values()][0] : null;
  }

  function cleanProfileCompany(raw) {
    const lines = String(raw || "").split(/\n+/);
    for (let line of lines) {
      line = line
        .replace(/^current company\s*:\s*/i, "")
        .replace(CURRENT_COMPANY_HELP_RE, "")
        .replace(/\s+logo\s*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (
        !line ||
        line.length > 100 ||
        /^(?:company|current company|experience)$/i.test(line) ||
        /https?:\/\/|www\./i.test(line)
      ) continue;
      return line;
    }
    return "";
  }

  function companyFromProfileSignals({ currentCompanyCandidates = [], headlines = [] } = {}) {
    const companies = [...new Map(
      currentCompanyCandidates
        .map(cleanProfileCompany)
        .filter(Boolean)
        .map((company) => [company.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ""), company])
    ).values()];
    if (companies.length === 1) {
      return {
        company: companies[0],
        source: "profile-current-company",
        confidence: "high",
      };
    }
    if (companies.length > 1) return null;
    return companyFromHeadlines(headlines);
  }

  return {
    cleanHeaderName,
    cleanProfileCompany,
    companyFromHeadlines,
    companyFromProfileSignals,
    connectionNoteCharacterLimit,
    exceedsCharacterLimit,
    isConnectionNoteContext,
    isGroupLabel,
    profileNameFromTitle,
    profileSlugFromHref,
    recipientFromHeader,
    recipientFromProfile,
  };
})(typeof UfxTemplates !== "undefined" ? UfxTemplates : require("./template-lib.js"));

if (typeof module !== "undefined") module.exports = UfxLinkedIn;
