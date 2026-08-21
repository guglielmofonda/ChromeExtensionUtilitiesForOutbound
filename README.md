# DM Templates for X & LinkedIn

A Manifest V3 Chrome extension for shortcut-driven, human-reviewed message templates
on X and LinkedIn.

## Load locally

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this directory
4. After any local code change, click **Reload** on the extension card, then refresh existing X and LinkedIn tabs

## DM templates

Outbound messages with variables, filled from the conversation or LinkedIn connection
note you're looking at. There is no AI, auto-send, or campaign automation; you always
press Send yourself.

1. Click the toolbar icon → the template manager opens.
2. Write a template, e.g. `Hey {{first_name}}! …`, and record a shortcut (defaults: ⌥1, ⌥2).
3. Open a one-to-one conversation on X or LinkedIn, or open **Add a note** while
   connecting from a LinkedIn member profile, and press the shortcut. The extension
   pre-fills only that open field. Review, personalize, and press Send yourself.

Variables: `{{first_name}}`, `{{full_name}}`, `{{handle}}` resolve automatically from
the conversation header or the already-open LinkedIn profile header. Names are cleaned
programmatically: emoji stripped, `| Building X`-style suffixes cut, `JANE` → `Jane`,
and LinkedIn unread-count prefixes or numeric UI badges rejected.
If one can't be resolved (group chat, no header found), nothing is inserted and a
toast explains why.

`{{handle}}` is the X handle on X and the public `/in/` profile identifier on
LinkedIn. LinkedIn overlay variants that do not expose a profile link can still fill
name variables, but a template that explicitly needs `{{handle}}` fails closed.

`{{company}}` is deliberately conservative:

- On X, it checks the recipient's public bio for explicit signals such as
  `Founder @WorkOS`, `CEO of Acme Labs`, or `Building Modal`. When needed, the
  existing X-only background path briefly opens that one public profile in an
  inactive tab, reads its description metadata, then closes it.
- On LinkedIn, it only uses a clear company signal from the conversation or member
  profile already open: the top-card company row beside the education row, one current
  Experience entry already loaded on that page, profile-title metadata, then the
  headline. It never opens or reads
  another LinkedIn profile in the background.

A single clear company is inserted and selected for immediate review. Generic,
conflicting, or unavailable details fall back to a selected `[company]` token. No
external AI is called, and the extension has no send action.

Troubleshooting: in DevTools, switch to the extension's JavaScript context and run
`__ufxDmDebug()` on X or `__ufxLinkedInDmDebug()` on LinkedIn. Each helper reports
the composer, recipient, route, and templates detected without sending anything.
Both sites ship DOM changes regularly; these helpers make selector drift visible.

**Read `SAFETY.md` before using templates for outreach.** The extension never
automates sending, but both platforms can restrict repetitive or unwanted messages,
and LinkedIn's User Agreement is stricter about browser add-ons.

## Layout

| Path                   | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `manifest.json`        | Extension manifest (MV3)                                   |
| `src/background.js`    | Opens the manager, seeds templates, and serves the existing X-only profile lookup |
| `src/content.js`       | Platform-neutral runner for registered utilities           |
| `src/dm-templates.js`  | Existing X/XChat adapter (kept isolated)                    |
| `src/linkedin-dm-templates.js` | LinkedIn conversation and connection-note adapter  |
| `src/linkedin-lib.js`  | Pure LinkedIn recipient and profile-signal parsing           |
| `src/template-lib.js`  | Pure template helpers shared by both platforms and the manager |
| `src/options.*`        | Template manager (list, editor, shortcut recorder, preview) |
| `src/content.css`      | Shared injected styles (all selectors prefixed `ufx-`)      |
| `SAFETY.md`            | X and LinkedIn policy review plus operating guardrails      |
| `test/`                | X/LinkedIn browser harnesses and Node regression tests      |

## Validate

```sh
for file in src/*.js test/*.js; do node --check "$file"; done
node --test test/*.test.js
git diff --check
```

`test/xchat-harness.html`, `test/linkedin-harness.html`, and
`test/linkedin-connection-harness.html` exercise the production content-script stacks
against local DOM fixtures. None of the harnesses triggers Send.

## Adding a utility

Create `src/<utility>.js` that pushes `{ id, label, run() }` onto
`window.__ufxUtilities`, and list it in the relevant platform entry in
`manifest.json` before `src/content.js`. Each utility runs inside its own try/catch,
so one failing utility will not take down the rest. Per-utility on/off state lives
in `chrome.storage.sync` under `enabled`.

## Roadmap

- Daily send counter with soft-limit nudges (see `SAFETY.md` guardrails)
- Link-in-first-message warning
- Hosted web version of the template manager, synced to the extension
