# CLAUDE.md

Conclave Browser Tool: browser extensions next to Conclave (github.com/liehrdot/Conclave). The first one,
"Conclave for Cardmarket" (`extension/`), saves and restores a Cardmarket shopping cart. Chromium first, Manifest V3
with only standard WebExtension APIs so Firefox and others can follow. Answer in English; the panel's texts are in
English and German (`scripts/messages.mjs`). Flo reviews every PR and wants to learn from them: keep PRs small and
explain the why.

## Commands

```bash
npm ci              # install
npm test            # unit tests (node:test + jsdom), offline
npm run messages    # write extension/_locales/*/messages.json from scripts/messages.mjs (a test checks it)
npm run e2e         # the extension in Chromium against tests/fixtures, screenshots into dist/screens (Playwright)
```

## Layout

- `extension/lib/cart.js`: all rules without browser APIs (reading offer and cart pages, Cloudflare check, snapshots,
  import/export, the restore's field pairs, compare, finding a missing article again). Sets `globalThis.ConclaveCart`, `require()`-able for tests.
- `extension/content.js`: the panel (shadow DOM, `panel.css`) and the actions; steps across page loads as a `job` in
  `chrome.storage.local`. `extension/background.js`: the toolbar button.
- `tests/fixtures/`: stand-in Cardmarket pages (shaped after Flo's notes; the real cart markup is still unverified).
- `docs/how-it-works.md`: the method and the rules.

## Rules

- Never automate checkout. At least `MIN_GAP_MS` (2.5 s) between the extension's own requests. Stop at a Cloudflare
  check and let the person solve it; never work around it. Ask before filling or emptying the cart.
- Use Cardmarket's own add-to-cart form (its script attached); never build a form or call endpoints directly.
- Tests never hit the network; the e2e answers every cardmarket.com request itself.
- Every logic change gets a test. Change texts in `scripts/messages.mjs`, both languages.
