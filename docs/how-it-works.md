# How it works

Based on Flo's notes from restoring a 63-card cart (15 sellers) by hand with Claude in Chrome on 2026-11-04.
Everything runs as the person's own browser on cardmarket.com, so their session and cookies go along; there is no
server and no API key. Cardmarket's official API is closed to private apps.

## Rules

- **Never automated:** "Proceed to Checkout" and everything after it.
- **Slow:** at least 2.5 s between two requests the extension makes (`MIN_GAP_MS`, kept in storage so it also holds
  across page loads). A burst of about 20 quick requests once brought up a Cloudflare check; with pauses 45 went through.
- **Cloudflare:** "Just a moment …", "Attention Required!" or `cf-chl` in a page means stop. The person solves the check;
  a waiting step carries on by itself on the next page.
- **Fill the cart late:** Cardmarket's cart says "Abuse of the shopping cart may result in account suspension". The
  restore asks first and says so. Snapshots are how a cart is kept, not a full cart.

## Reading the cart (Save cart, Compare)

`/en/Magic/ShoppingCart`. The cart's markup isn't known yet (cardmarket.com blocks the cloud machine this was built
on), so `parseCart()` looks for article ids wherever Cardmarket puts them on other pages: `data-article-id`-style
attributes, row ids like `stockRow<id>`, `idArticle[<id>]` fields, `idArticle=` links. Each id's row is the smallest
element around it with a card link (`/Products/Singles/<set>/<card>`) and no other article's id; the seller is the
nearest `/Users/<name>` link outside the row. Prices come from `span.color-primary`, the condition from `span.badge`
(never the row's whole text: the stock count sticks to the price, "7" + "7,67 €" reads as 77,67 €), the language
from the flag icon's `aria-label` or `data-bs-original-title`. Compare lists every article that isn't English (a
Russian and two German cards once slipped into an English cart); it never counts as wrong, a snapshot may hold a
German card on purpose. The summary
(articles, value, shipping, total) is read from the page text.

If saving says it can't find the articles, **Copy page info** copies the rows' structure (tags, classes, attribute
names, form field names; no names or prices) so the reader can be fixed.

## Restoring (one request for everything)

Every offer row on a seller's page (`/en/Magic/Users/<seller>/Offers/Singles`) has an add-to-cart form with
`data-ajax-action="ShoppingCart_Add_AddArticlesFromUserOffers"` and Cardmarket's script attached. The endpoint takes
any number of `idArticle[<id>]` / `amount[<id>]` pairs, also from different sellers. So the extension:

1. opens an offer page (of the snapshot's seller with most articles) unless one is open,
2. takes the first row's form, removes its `idArticle`/`amount` fields and adds one pair per snapshot article,
3. clicks that form's own button: one AJAX request for all articles,
4. waits for Cardmarket's answer, opens the cart and compares.

A form the extension builds itself would not work: it has no handler, the browser sends a plain POST, the page
reloads and nothing is added. Steps across pages are kept as a `job` in `chrome.storage.local` (dropped after 3 min).

## Emptying

On the cart page, `input[type=submit][value="Remove all articles"]`. Cardmarket doesn't ask, so the panel does, and
saves the cart as a snapshot first (unless the newest snapshot already is this cart). Cardmarket then removes the
articles while the page reloads (about 6 s); leaving the page before that stops it halfway (12 of 15 sellers left).
So the extension never navigates after the click, and checks the reloaded cart: articles still there get a warning.

## Snapshot format

```json
{ "conclave": "cardmarket-cart", "version": 1, "name": "Zurgo", "created": "2026-11-04T10:00:00.000Z",
  "items": [{ "id": "2183623163", "seller": "PapaSven", "name": "Hero of Bladehold", "slug": "Hero-of-Bladehold",
              "set": "Modern-Horizons", "price": 1.49, "cond": "NM", "lang": "English", "qty": 1 }] }
```

Import also takes the short form from Flo's notes: `{"PapaSven": ["2183623163", "2102303005x6"]}` (`x6` = 6 copies).
Article ids stay valid until the seller changes or sells the offer.

## Next steps

- Find an offer again when an article is gone or its price changed: the seller's offers by name
  (`?name=<card>`, `&sortBy=price_asc` for basics, `&idExpansions=<id>,<id>` for editions: the ids are in the live
  page's `select[name="idExpansions[]"]`, not in fetched HTML), matched by card slug, price and language, then
  NM › EX › GD, `setHint`.
- A Conclave deck's buy list as the target: which of the deck's cards are still missing from the cart.
