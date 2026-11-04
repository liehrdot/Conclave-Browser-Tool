# Conclave Browser Tool

Browser extensions that work next to [Conclave](https://github.com/liehrdot/Conclave), Flo's Commander deckbuilder.

## Conclave for Cardmarket

Saves your Cardmarket shopping cart as a snapshot and puts it back later with one click. Fill the cart (for example
with Cardmarket's Shopping Wizard), save it, empty it, and restore it shortly before you order, so sellers' articles
aren't held in your cart for days.

- **Save cart**: reads the cart page and keeps every article (seller, card, condition, price, amount).
- **Restore**: puts all articles of a snapshot back in one request, then opens the cart and compares.
- **Compare**: shows what is missing (sold or changed by the seller), has fewer copies, a new price or isn't English.
- **Look for N again**: finds a missing card at the same seller (same card, language, condition or better) and puts it in.
- **Empty cart …**: asks first, saves the cart as a snapshot, then clicks Cardmarket's "Remove all articles".
- **Deck lists**: paste a deck's buy list from Conclave („Für Cardmarket kopieren“) and compare: which of its cards
  are still missing from the cart, copied as a Wants list if you like.
- **Copy / Import …**: a snapshot as text, to keep it or move it to another computer.

What it never does: checkout or anything after it, getting around Cloudflare's browser check (it stops and lets you
solve it), or more than one request every 2.5 seconds. Snapshots stay in your browser (`chrome.storage.local`).
The panel speaks English or German, following the browser's language.

### Install (Chrome, Edge, Brave, other Chromium browsers)

1. Download the `conclave-cardmarket-extension` artifact of the newest CI run (Actions › CI) and unzip it, or use the
   `extension/` folder of a checkout.
2. Open `chrome://extensions`, switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder.
4. Pin the green "C" in the toolbar. Click it on cardmarket.com to open the panel.

Other browsers (Firefox, Safari) come later; the code uses only standard WebExtension APIs (Manifest V3).

## Development

```bash
npm ci            # install (jsdom for the tests)
npm test          # unit tests, offline, < 2 s
npm run messages  # after changing scripts/messages.mjs: writes extension/_locales/*/messages.json
npm run e2e       # the extension in Chromium against stand-in pages, with screenshots (needs Playwright)
```

How the cart is read and restored: [docs/how-it-works.md](docs/how-it-works.md).
