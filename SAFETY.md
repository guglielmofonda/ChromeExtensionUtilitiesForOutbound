# X and LinkedIn policy review — what this extension does and does not make safe

The X section was reviewed 2026-07-31 against the live X Terms of Service and
archived (Apr–Jul 2026) help.x.com policy pages, plus enforcement reporting.
Summary: **the tool as designed
(human opens the thread → shortcut pre-fills the composer → human reviews → human
clicks Send) sits on the right side of X's own enforcement line.** The real risk is
not the tool — it's the sending behavior of the person using it.

The LinkedIn section was reviewed 2026-08-10 against LinkedIn's current User
Agreement, Professional Community Policies, and messaging help. LinkedIn's written
terms are stricter about browser add-ons. The safeguards below reduce automation
and spam risk, but **do not guarantee that LinkedIn considers the extension compliant.**

## X: what the policies actually say

### Terms of Service (x.com/en/tos, effective Apr 2026)

- Prohibits accessing the service "by any means (automated or otherwise) other than
  through our currently available, published interfaces", crawling/scraping, and
  "scripting the creation of Content in such a manner as to interfere with or create
  an undue burden on the Services".
- Interpretation: the extension runs inside the published web interface in your own
  logged-in browser and does not call X's API or an external service. A company
  template may navigate one inactive tab to the open recipient's public X profile;
  it closes that tab immediately after reading the description metadata. One
  pre-filled compose box at human speed does not plausibly create an undue burden.

### Automation rules (help.x.com/en/rules-and-policies/x-automation, Apr 2026)

- "You may not send unsolicited Direct Messages in a bulk or automated manner."
- The one gray-zone clause: "[Don't] use non-API-based forms of automation, such as
  scripting the X website. The use of these techniques may result in the permanent
  suspension of your account." A maximalist reading covers any DOM manipulation;
  in context the document regulates automating *actions* (sending, posting,
  following). This extension automates no action — it types a draft.
- X's 2026 enforcement framing draws the line exactly where this tool sits: per X's
  head of product, "If a human is not tapping on the screen, the account … will
  likely be suspended", while AI-assisted composition/proofreading is acceptable.
  A human taps Send for every message here.

### Authenticity / spam policy (help.x.com/en/rules-and-policies/authenticity)

These apply to **human-sent messages too** — no automation qualifier:

- "Sending bulk, aggressive, high-volume unsolicited replies, mentions, or direct
  messages" — not allowed.
- Repeatedly sending "identical direct messages" or link-only messages — not allowed.

### DM limits & duplicate detection (official, help.x.com DM FAQ + limits page)

- Hard cap: **500 DMs sent per day**.
- **X runs duplicate detection on manually sent DMs**: "If you are sending duplicate
  Direct Messages to multiple accounts (including sending the same link to multiple
  accounts), this may be reported as spam activity" → temporary DM block, ~30-minute
  cooldown before you can send again.
- DMing non-followers may require a verified phone number; if someone reports you,
  you can't message them again unless they message you first.
- Cold DMs only land for people with open/Verified-inbox settings; a Premium
  (Verified) sender account materially widens reach.

## LinkedIn: the stricter browser-extension boundary

### User Agreement

[LinkedIn's User Agreement](https://www.linkedin.com/legal/user-agreement) restricts:

- browser plugins or add-ons used to scrape or copy profiles or other service data;
- bots or other unauthorized automation used to access LinkedIn or send messages;
- software that overlays or otherwise modifies the service or its appearance.

The LinkedIn adapter therefore does **not** open profile tabs, fetch profiles, build
lists, iterate conversations, or trigger Send. It reads only the open conversation
header or the visible header of the member profile the user already opened. It fills
only the conversation composer or connection note the user opened, in direct response
to the user's shortcut. That is materially narrower than outreach automation, but it
still interacts with LinkedIn's page. Treat account-policy risk as non-zero.

### Professional Community Policies and messaging access

[LinkedIn's Professional Community Policies](https://www.linkedin.com/legal/professional-community-policies)
prohibit untargeted, irrelevant, unwanted, or repetitive messages. This applies
regardless of whether a human pressed Send. LinkedIn's own
[messaging help](https://www.linkedin.com/help/linkedin/answer/a541865) also makes
clear that message access depends on connection status, message requests, InMail,
and the recipient's settings. The extension never bypasses those product controls.

There is no defensible universal "safe daily number" for LinkedIn outreach. Keep it
relevant and low-volume, and stop on any warning or restriction rather than trying
to work around it.

## Operating guardrails

### X-specific pacing and duplicate controls

1. **Volume**: stay under ~30–50 templated first-contact DMs/day, ≤10–15/hour.
   Never approach the 500/day cap — that range is itself a spam signal.
2. **Variation**: X detects identical messages. Personalize beyond
   `{{first_name}}` — one specific sentence per person defeats duplicate detection
   and converts better anyway. Rotate 3–5 templates; retire heavily-used ones.
3. **No links in first messages**, never link shorteners. Send links after a reply.
4. **Soft block = stop for the day.** Don't retry-hammer; the 30-min cooldown
   escalates if you keep pushing.
5. **New/quiet accounts warm up**: ~5–10/day for the first weeks, phone verified.
6. **Prefer warm targets**: mutuals, repliers, existing threads. Keep cold
   non-follower DMs a minority of daily volume; no follow-up barrages on silence.

### Shared guardrails

- Review and personalize every draft before sending it.
- Prefer warm, contextual conversations; do not run repetitive cold campaigns.
- Never use templates to evade product limits, recipient preferences, or a warning.
- A soft block or account restriction means stop, not retry.

## Features this extension must NEVER grow

Each of these converts a human-triggered text expander into platform automation:

- Auto-send, synthetic clicks/Enter on the Send button
- Scheduling, queueing, send-to-list, multi-recipient anything
- Auto-opening or iterating through conversations
- Scraping profiles, followers, or search results to build target lists
- AI auto-replies or any action taken while the user isn't present pressing a key
- Public distribution as a "growth/outreach" product (ToS facilitation clause)

## Why X detection risk is structurally low

The extension generates no X API traffic and performs no send action. The optional
company lookup is one ordinary top-level profile navigation for the recipient the
user already opened; it is not a target-list scan. The strongest signals X can
observe remain the messages actually sent: their volume, similarity, links, and
recipient reactions. Keep those human; make them spammy, and no tool choice would
save the account anyway. Do not extend that conclusion to LinkedIn; its User
Agreement has a broader browser-add-on restriction even when the extension does not
send.
