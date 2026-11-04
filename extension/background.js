// The toolbar button: on a Cardmarket tab it opens or closes the Conclave panel, anywhere else it opens the cart
// in a new tab with the panel open.
const CART = "https://www.cardmarket.com/en/Magic/ShoppingCart";

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && /^https:\/\/www\.cardmarket\.com\//.test(tab.url)) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "toggle" });
      return;
    } catch {
      // the tab was open before the extension was installed: it has no content script yet
      await chrome.storage.local.set({ openPanel: true });
      await chrome.tabs.reload(tab.id);
      return;
    }
  }
  await chrome.storage.local.set({ openPanel: true });
  await chrome.tabs.create({ url: CART });
});
