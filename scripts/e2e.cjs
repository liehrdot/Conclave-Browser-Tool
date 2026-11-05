// End-to-end run of the extension in Chromium against stand-in Cardmarket pages (tests/fixtures), with screenshots.
// cardmarket.com itself is never contacted: every request to it is answered here. Needs Playwright:
//   node scripts/e2e.cjs [out-dir] [light|dark]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.join(__dirname, "..");
const fixture = (n) => fs.readFileSync(path.join(root, "tests/fixtures", n), "utf8");
const out = process.argv[2] || path.join(root, "dist/screens");
const scheme = process.argv[3] || "light";
const SOLD = "2164329369";
const RELISTED = "2199000005";  // tests/fixtures/offers-search.html: the same Divine Visitation under a new article number  // Divine Visitation: "sold" while the cart was empty, so the check has something to report

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "cc-")), {
    headless: true, channel: "chromium", colorScheme: scheme, viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${path.join(root, "extension")}`, `--load-extension=${path.join(root, "extension")}`],
  });
  const full = fixture("cart.html");
  let cart = full, added = [], requests = 0, challengeNext = false;
  await ctx.route("https://www.cardmarket.com/**", async (route) => {
    const req = route.request(), url = new URL(req.url());
    requests++;
    if (url.pathname === "/__test/add") {
      added = [...new URLSearchParams(req.postData()).keys()].filter((k) => k.startsWith("idArticle")).map((k) => k.match(/\d+/)[0]);
      if (added.includes(RELISTED)) {  // the seller's new article for the sold one
        cart = full.replace(`data-article-id="${SOLD}"`, `data-article-id="${RELISTED}"`).replace(`name="idArticle" value="${SOLD}"`, `name="idArticle" value="${RELISTED}"`).replace("7,67 €", "7,90 €");
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      // what Cardmarket would do: the sold one doesn't come back
      cart = full.replace(new RegExp(`<tr data-article-id="${SOLD}">[\\s\\S]*?</tr>`), "")
        .replace("9 Articles", "8 Articles").replace("74,18 €", "66,51 €").replace("77,68 €", "70,01 €");
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    }
    if (url.pathname.endsWith("/ShoppingCart")) {
      if (req.method() === "POST") { cart = fixture("cart-empty.html"); return route.fulfill({ status: 200, contentType: "text/html", body: cart }); }
      return route.fulfill({ status: 200, contentType: "text/html", body: cart });
    }
    if (url.pathname.includes("/Offers/Singles") && url.searchParams.get("name") && challengeNext) {  // Cloudflare answers 403 with its check
      challengeNext = false;
      return route.fulfill({ status: 403, contentType: "text/html", body: "<html><head><title>Just a moment...</title></head><body>cf-challenge</body></html>" });
    }
    if (url.pathname.includes("/Offers/Singles") && url.searchParams.get("name")) return route.fulfill({ status: 200, contentType: "text/html", body: fixture("offers-search.html") });
    if (url.pathname.includes("/Offers/Singles")) return route.fulfill({ status: 200, contentType: "text/html", body: fixture("offers.html") });
    return route.fulfill({ status: 404, body: "" });
  });
  let [worker] = ctx.serviceWorkers();
  if (!worker) worker = await ctx.waitForEvent("serviceworker");
  const page = await ctx.newPage();
  const toggle = () => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://www.cardmarket.com/*" });
    await chrome.tabs.sendMessage(tab.id, { type: "toggle" });
  });
  const panel = page.locator("conclave-cart");
  const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(out, `${scheme}-${name}.png`) }); };
  const click = (text) => panel.getByRole("button", { name: text, exact: true }).click();
  const note = () => panel.locator(".note").textContent();
  const check = (ok, what) => { if (!ok) { console.error("FAILED:", what); process.exitCode = 1; } else console.log("ok:", what); };

  await page.goto("https://www.cardmarket.com/en/Magic/ShoppingCart");
  await page.waitForTimeout(500);
  await toggle();
  await panel.locator(".panel").waitFor();
  await shot("1-cart");
  await click("Save cart");
  await panel.locator(".note.ok").waitFor();
  check((await note()).includes("9 articles from 2 sellers"), "save reads 9 articles from 2 sellers");
  await shot("2-saved");

  await click("Empty cart …");
  await shot("3-empty-ask");
  await panel.locator(".confirm").getByRole("button", { name: "Empty cart", exact: true }).click();
  await page.waitForLoadState("load");
  await panel.locator(".note.ok").waitFor({ timeout: 8000 });
  check((await panel.locator(".cart").textContent()).includes("Your cart is empty"), "empty empties the cart");
  check((await panel.locator(".list li").count()) === 1, "the same cart isn't saved twice before emptying");
  await shot("4-emptied");

  await click("Restore");
  await shot("5-restore-ask");
  const started = Date.now();
  await click("Put into cart");
  await page.waitForURL(/ShoppingCart/, { timeout: 30000 });
  await panel.locator(".note.warn").waitFor({ timeout: 15000 });
  check(added.length === 4, `one request added all 4 articles (${added.join(", ")})`);
  check(Date.now() - started >= 2500, "waits at least 2.5 s between its own requests");
  check((await note()).includes("3 of 4 articles"), "the check names the missing article");
  await shot("6-restored");

  challengeNext = true;
  await click("Look for 1 again");
  await panel.locator(".note.warn").filter({ hasText: "checking your browser" }).waitFor({ timeout: 15000 });
  check(true, "a Cloudflare check served with 403 asks the person to solve it");
  await panel.getByRole("button", { name: "Compare", exact: true }).first().click();  // solved: compare again, then look again
  await panel.locator(".note.warn").filter({ hasText: "3 of 4" }).waitFor({ timeout: 15000 });
  await click("Look for 1 again");
  await panel.locator(".note.warn, .note.ok").filter({ hasText: "Found" }).waitFor({ timeout: 15000 });
  check((await panel.locator(".diff").textContent()).includes("€7.90"), "the re-listed Divine Visitation is found, marked as more expensive");
  await shot("7-found");
  await click("Put 1 into cart");
  await page.waitForURL(/ShoppingCart/, { timeout: 30000 });
  await panel.locator(".note.ok").waitFor({ timeout: 15000 });
  check(added.length === 1 && added[0] === RELISTED, "only the found article was sent");
  check((await note()).includes("All 4 articles"), "the cart matches the updated snapshot");
  await shot("8-complete");
  console.log(`requests to the stand-in cardmarket.com: ${requests}`);
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
