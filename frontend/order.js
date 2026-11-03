import { renderMenu, menuControls } from "./shared.js";
import { get, post, ApiError } from "./api-client.js";
import { BASKET_KEY, ATTEMPT_KEY, isId, isToken, validAmounts, validPublicOrder, validQuantity, parseBasket, basketItems, serializeBasket, reconcileBasket, money, statusLabel, element, renderLines } from "./order-core.js";

const $ = id => document.getElementById(id);
let cart = new Map(), catalog = [], settings, ready = false, busy = false;
let review, attempt, submissionKey, uncertain = false, itemToRemove;
let restorationNotice = "";
try {
  const restored = parseBasket(localStorage.getItem(BASKET_KEY));
  cart = restored.cart;
  if (restored.repaired) restorationNotice = "Invalid saved basket entries were removed. Please check your basket.";
} catch { restorationNotice = "This browser cannot save your basket. You can still order in this tab."; }
try {
  const key = sessionStorage.getItem(ATTEMPT_KEY);
  if (isId(key)) submissionKey = key;
} catch { /* In-memory retries still use the same key. */ }

function message(text) { $("order-message").textContent = text; $("order-message").hidden = !text; }
function error(text, focus = true) {
  $("order-error").textContent = text; $("order-error").hidden = !text;
  if (text && focus) $("order-error").focus();
}
function persist() {
  try { localStorage.setItem(BASKET_KEY, serializeBasket(cart)); }
  catch { message("Your basket is available in this tab, but this browser cannot save it for later."); }
}
const cardMenu = document.querySelector("[data-menu]");
function addCard(item) {
  if (busy || !ready || !item.available) return;
  if ((cart.get(item.id) || 0) >= 20 || (!cart.has(item.id) && cart.size >= 50)) return error("Basket limit reached. Edit the quantities before adding more.");
  cart.set(item.id, (cart.get(item.id) || 0) + 1); review = undefined; persist(); renderCart(); error(""); message(item.name + " added to your basket.");
}
function paintCards() {
  renderMenu(cardMenu, catalog, addCard, busy || !ready);
  cardMenu.querySelector("[data-menu-refresh]").disabled = busy;
  if (!ready) cardMenu.querySelector("[data-menu-message]").textContent = busy
    ? "Loading current prices and availability…" : "Menu unavailable. Use Reload menu to try again.";
}
cardMenu.querySelector("[data-menu-refresh]").onclick = () => { if (!busy) void loadMenu(); };
function setBusy(value, text) {
  busy = value;
  $("order-builder").setAttribute("aria-busy", String(value));
  $("order-review").setAttribute("aria-busy", String(value));
  $("menu-controls").disabled = value || !ready || !catalog.some(i => i.available);
  $("details-controls").disabled = value || !ready;
  $("review-order").disabled = value || !ready || !settings?.acceptingOrders ||
    (settings && !settings.pickupEnabled && !settings.deliveryEnabled);
  $("refresh-menu").disabled = value;
  for (const control of document.querySelectorAll("#cart-items button, #cart-items input")) {
    control.disabled = value || control.dataset.unavailable === "true";
  }
  $("place-order").disabled = value;
  $("edit-order").disabled = value || uncertain;
  $("check-submission").disabled = value;
  paintCards();
  if (text) message(text);
}
function syncFulfilment() {
  const delivery = $("fulfilment").value === "DELIVERY";
  $("address-field").hidden = !delivery;
  $("delivery-address").disabled = !delivery;
  $("delivery-address").required = delivery;
}
function renderCart() {
  const lines = reconcileBasket(cart, catalog);
  $("cart-items").replaceChildren();
  if (!lines.length) $("cart-items").append(element("li", "Your basket is empty. Add something tasty to get started.", "empty-cart"));
  for (const line of lines) {
    const row = element("li", undefined, "cart-item");
    const copy = element("div", undefined, "cart-item-copy");
    const name = line.item?.name ?? (ready ? "Item no longer on the menu" : "Loading saved item…");
    copy.append(element("span", name, "cart-item-name"),
      element("span", line.available ? money(line.item.priceMinor) + " each" : (ready ? "Unavailable — remove before reviewing" : "Checking availability…"), "cart-item-detail"));
    const actions = element("div", undefined, "cart-item-actions");
    const label = element("label", "Quantity", "quantity-label");
    const input = element("input");
    input.type = "number"; input.min = "1"; input.max = "20"; input.step = "1"; input.required = true;
    input.value = String(line.quantity); input.dataset.itemId = line.menuItemId;
    input.setAttribute("aria-label", "Quantity for " + name);
    input.dataset.unavailable = String(!line.available);
    input.disabled = busy || !line.available;
    input.addEventListener("input", () => input.setCustomValidity(""));
    input.addEventListener("change", () => {
      const quantity = Number(input.value);
      if (!validQuantity(quantity)) {
        input.setCustomValidity("Choose a whole quantity from 1 to 20.");
        input.reportValidity(); return;
      }
      cart.set(line.menuItemId, quantity); review = undefined; persist(); renderCart();
      $("cart-items").querySelector('[data-item-id="' + line.menuItemId + '"]')?.focus();
      message("Basket quantity updated. Review your order to check the final total.");
    });
    label.append(input);
    const remove = element("button", "Remove", "remove-item-btn");
    remove.type = "button"; remove.disabled = busy; remove.setAttribute("aria-label", "Remove " + name + " from basket");
    remove.addEventListener("click", () => {
      itemToRemove = line.menuItemId;
      $("remove-confirmation-message").textContent = "Remove " + name + " from your basket?";
      $("remove-confirmation").showModal();
    });
    actions.append(label, element("strong", line.available ? money(line.quantity * line.item.priceMinor) : "—"), remove);
    row.append(copy, actions); $("cart-items").append(row);
  }
  const count = basketItems(cart).reduce((sum, line) => sum + line.quantity, 0);
  $("item-count").textContent = "(" + count + (count === 1 ? " item)" : " items)");
  const usable = ready && lines.every(line => line.available);
  const subtotal = lines.reduce((sum, line) => sum + (line.item?.priceMinor ?? 0) * line.quantity, 0);
  const fee = count && $("fulfilment").value === "DELIVERY" ? settings?.deliveryFeeMinor ?? 0 : 0;
  $("subtotal").textContent = usable ? money(subtotal) : "—";
  $("delivery-fee").textContent = usable ? money(fee) : "—";
  $("grand-total").textContent = usable ? money(subtotal + fee) : "—";
}
async function loadMenu(notice = "") {
  setBusy(true, "Checking current menu prices and availability…");
  try {
    const [menu, configuration] = await Promise.all([get("api/menu"), get("api/settings")]);
    if (!Array.isArray(menu.items) || !configuration.settings) throw new ApiError("The menu could not be read. Please refresh it.");
    catalog = menu.items; settings = configuration.settings; ready = true;
    menuControls(cardMenu, catalog, paintCards);
    const selected = $("menu-item").value;
    $("menu-item").replaceChildren();
    const groups = new Map();
    for (const item of catalog) {
      const category = item.category?.name ?? "Menu";
      if (!groups.has(category)) {
        const group = element("optgroup"); group.label = category; groups.set(category, group); $("menu-item").append(group);
      }
      const option = element("option", item.name + " — " + money(item.priceMinor) + (item.available ? "" : " (unavailable)"));
      option.value = item.id; option.disabled = !item.available; groups.get(category).append(option);
    }
    if (catalog.some(i => i.id === selected && i.available)) $("menu-item").value = selected;
    else $("menu-item").value = catalog.find(i => i.available)?.id ?? "";
    const pickup = $("fulfilment").querySelector('[value="PICKUP"]');
    const delivery = $("fulfilment").querySelector('[value="DELIVERY"]');
    pickup.textContent = "Pickup — free"; pickup.disabled = !settings.pickupEnabled;
    delivery.textContent = "Delivery — " + money(settings.deliveryFeeMinor); delivery.disabled = !settings.deliveryEnabled;
    if ($("fulfilment").selectedOptions[0]?.disabled) $("fulfilment").value = settings.pickupEnabled ? "PICKUP" : "DELIVERY";
    syncFulfilment(); renderCart(); persist(); error("");
    const blocked = reconcileBasket(cart, catalog).some(line => !line.available);
    message(!settings.acceptingOrders || (!settings.pickupEnabled && !settings.deliveryEnabled)
      ? "The restaurant has paused ordering. Your basket is kept for later."
      : blocked ? "Some saved items are unavailable. Remove them before reviewing your order."
      : notice || restorationNotice || (cart.size ? "Basket restored with current menu prices. Review the final total before ordering." : "Menu ready. Add your favourites."));
    restorationNotice = "";
    return true;
  } catch (failure) {
    ready = false; renderCart();
    error(failure.message + " Your basket and details have been kept. Use Refresh menu to try again.", false);
    message(""); return false;
  } finally { setBusy(false); }
}
function customerDetails() {
  const name = $("customer-name"), phone = $("customer-phone"), address = $("delivery-address");
  name.setCustomValidity(name.value.trim() ? "" : "Enter your name.");
  phone.setCustomValidity(/^\+?[0-9 ()-]{7,30}$/.test(phone.value.trim()) && phone.value.replace(/\D/g, "").length >= 7 ? "" : "Enter a valid phone number.");
  address.setCustomValidity($("fulfilment").value !== "DELIVERY" || address.value.trim() ? "" : "Enter your delivery address.");
  if (!$("order-form").reportValidity()) return;
  const result = { customerName: name.value.trim(), phone: phone.value.trim(), fulfilment: $("fulfilment").value };
  if (result.fulfilment === "DELIVERY") result.deliveryAddress = address.value.trim();
  if ($("order-notes").value.trim()) result.notes = $("order-notes").value.trim();
  return result;
}
function showReview() {
  $("order-builder").hidden = true; $("order-confirmation").hidden = true; $("order-review").hidden = false;
  renderLines($("review-items"), review.quote.items);
  $("review-details").replaceChildren();
  const details = [["Name", review.payload.customerName], ["Phone", review.payload.phone],
    ["Fulfilment", review.payload.fulfilment === "DELIVERY" ? "Delivery" : "Pickup"],
    ["Address", review.payload.deliveryAddress], ["Instructions", review.payload.notes]];
  for (const [label, value] of details) if (value) $("review-details").append(element("dt", label), element("dd", value));
  $("review-subtotal").textContent = money(review.quote.subtotalMinor);
  $("review-delivery").textContent = money(review.quote.deliveryFeeMinor);
  $("review-total").textContent = money(review.quote.totalMinor);
  $("place-order").textContent = "Place order"; $("check-submission").hidden = true;
  $("review-heading").focus();
}
function showBuilder() {
  $("order-review").hidden = true; $("order-confirmation").hidden = true; $("order-builder").hidden = false;
  $("details-heading").setAttribute("tabindex", "-1"); $("details-heading").focus();
}
function saved(result, clearBasket = true) {
  if (!validPublicOrder(result.order) || !isToken(result.trackingToken)) throw new ApiError("The saved-order response could not be verified.", 0, "INVALID_RESPONSE");
  uncertain = false; attempt = undefined; review = undefined; submissionKey = undefined;
  try { sessionStorage.removeItem(ATTEMPT_KEY); } catch { /* No customer data is stored. */ }
  if (clearBasket) { cart.clear(); persist(); renderCart(); }
  $("order-builder").hidden = true; $("order-review").hidden = true; $("order-confirmation").hidden = false;
  $("order-reference").textContent = result.order.id;
  $("confirmation-status").textContent = statusLabel(result.order.status);
  $("confirmation-message").textContent = result.order.status === "PENDING"
    ? "This historical order is still pending. Contact the restaurant; it has not been accepted automatically."
    : result.order.status === "CANCELLED" ? "Your saved order has been cancelled. Open tracking for its history and any recorded reason."
    : "Your order is confirmed. Track preparation and fulfilment using your private link.";
  $("confirmation-total").textContent = money(result.order.totalMinor);
  renderLines($("confirmation-items"), result.order.items);
  $("tracking-link").href = "track.html#" + result.trackingToken;
  history.replaceState(null, "", "order.html#" + result.trackingToken);
  error(""); message(result.order.status === "PENDING" ? "Historical pending order retrieved." : "Saved order retrieved: " + statusLabel(result.order.status) + ".");
  $("confirmation-heading").focus();
}
async function recover() {
  if (!submissionKey) return false;
  const result = await post("api/orders/recover", {}, submissionKey);
  saved(result); return true;
}

$("add-item-form").addEventListener("submit", event => {
  event.preventDefault(); if (busy || !ready) return;
  const quantity = Number($("item-quantity").value);
  const id = $("menu-item").value, item = catalog.find(i => i.id === id);
  if (!$("add-item-form").reportValidity() || !validQuantity(quantity)) return;
  if (!item?.available) return error("Choose an available menu item.");
  if ((cart.get(id) ?? 0) + quantity > 20) return error("You can add up to 20 of each item.");
  if (!cart.has(id) && cart.size >= 50) return error("A basket can contain up to 50 different items.");
  cart.set(id, (cart.get(id) ?? 0) + quantity); persist(); renderCart(); error("");
  $("item-quantity").value = "1"; message(item.name + " added to your basket.");
});
$("cancel-remove").addEventListener("click", () => $("remove-confirmation").close());
$("confirm-remove").addEventListener("click", () => {
  if (!itemToRemove || busy) return;
  cart.delete(itemToRemove); persist(); renderCart(); review = undefined;
  $("remove-confirmation").close(); $("basket-heading").focus(); message("Item removed from your basket.");
});
$("remove-confirmation").addEventListener("close", () => { itemToRemove = undefined; });
$("fulfilment").addEventListener("change", () => { syncFulfilment(); renderCart(); review = undefined; });
$("order-form").addEventListener("input", event => { event.target.setCustomValidity?.(""); });
$("refresh-menu").addEventListener("click", () => { if (!busy) { error(""); void loadMenu("Menu prices and availability refreshed."); } });
$("order-form").addEventListener("submit", async event => {
  event.preventDefault(); if (busy || !ready) return;
  error("");
  if (!cart.size) return error("Add at least one item before reviewing your order.");
  for (const input of $("cart-items").querySelectorAll("input")) if (!input.reportValidity()) return;
  if (reconcileBasket(cart, catalog).some(line => !line.available)) return error("Remove unavailable items before reviewing your order.");
  const customer = customerDetails(); if (!customer) return;
  const items = basketItems(cart);
  setBusy(true, "Getting your final total from the restaurant…");
  try {
    const data = await post("api/orders/quote", { items, fulfilment: customer.fulfilment });
    if (!validAmounts(data.quote) || !isToken(data.quote.quoteFingerprint) || data.quote.fulfilment !== customer.fulfilment) {
      throw new ApiError("The quote could not be read. Please try reviewing again.");
    }
    review = { quote: data.quote, payload: { ...customer, items, expectedTotalMinor: data.quote.totalMinor, quoteFingerprint: data.quote.quoteFingerprint } };
    showReview(); message("Review the current items, details and total. Nothing has been sent yet.");
  } catch (failure) {
    if (["ITEM_UNAVAILABLE", "ORDERING_UNAVAILABLE"].includes(failure.code)) await loadMenu();
    error(failure.message + (failure.fields?.length ? " " + failure.fields.map(field => field.path + ": " + field.message).join("; ") : ""));
  } finally { setBusy(false); }
});
$("edit-order").addEventListener("click", () => {
  if (busy || uncertain) return;
  review = undefined; attempt = undefined; showBuilder(); message("Update your order, then review it again.");
});
$("place-order").addEventListener("click", async () => {
  if (busy || !review) return;
  error(""); setBusy(true, "Sending your order. Please wait for confirmation…");
  try {
    submissionKey ??= crypto.randomUUID();
    try { sessionStorage.setItem(ATTEMPT_KEY, submissionKey); }
    catch { message("Sending your order. Keep this tab open until you see confirmation."); }
    attempt ??= { key: submissionKey, payload: structuredClone(review.payload) };
    const result = await post("api/orders", attempt.payload, attempt.key);
    saved(result);
  } catch (failure) {
    // Only explicit pre-commit rejections permit a changed review. Keep the key in all cases.
    if (["PRICE_CHANGED", "ITEM_UNAVAILABLE", "ORDERING_UNAVAILABLE", "VALIDATION_ERROR"].includes(failure.code)) {
      uncertain = false; attempt = undefined; review = undefined; showBuilder();
      await loadMenu("The order was not placed. Please check and review the current items and total again.");
      error(failure.message + " Please review again before placing the order.");
    } else if (failure.code === "IDEMPOTENCY_CONFLICT") {
      uncertain = true;
      try { await recover(); }
      catch { error("This submission may already be saved. Check whether it was saved before starting another order."); }
    } else {
      uncertain = true;
      error(failure.message + " We have not confirmed whether it was saved. Retry this same submission or check its status; your basket and details are kept.");
    }
  } finally {
    setBusy(false);
    $("place-order").textContent = uncertain ? "Retry submission" : "Place order";
    $("check-submission").hidden = !uncertain;
  }
});
$("check-submission").addEventListener("click", async () => {
  if (busy) return; setBusy(true, "Checking your submission…");
  try { await recover(); }
  catch (failure) { error(failure.code === "SUBMISSION_NOT_FOUND" ? "No saved order found yet. Retry this same submission to finish safely." : failure.message); }
  finally { setBusy(false); }
});
$("new-order").addEventListener("click", () => {
  if (busy) return;
  history.replaceState(null, "", "order.html"); $("order-form").reset(); syncFulfilment();
  showBuilder(); error(""); void loadMenu("Choose items for your new order.");
});
window.addEventListener("storage", event => {
  if (event.key !== BASKET_KEY || busy || uncertain || review || !$("order-confirmation").hidden) return;
  cart = parseBasket(event.newValue).cart; renderCart();
  message("Your basket was updated in another tab. Review the current items before ordering.");
});
window.addEventListener("beforeunload", event => {
  if (uncertain || (busy && attempt)) { event.preventDefault(); event.returnValue = ""; }
});
async function initialize() {
  syncFulfilment(); renderCart();
  const receiptToken = location.hash.slice(1);
  if (isToken(receiptToken)) {
    setBusy(true, "Loading your saved order…");
    try { saved({ ...(await post("api/orders/track", { token: receiptToken })), trackingToken: receiptToken }, false); return; }
    catch (failure) { error(failure.message, false); }
    finally { setBusy(false); }
  }
  if (submissionKey) {
    setBusy(true, "Checking your previous submission before another order…");
    try { if (await recover()) return; }
    catch (failure) {
      restorationNotice = failure.code === "SUBMISSION_NOT_FOUND"
        ? "No stored order found yet. Re-enter your details and review; the same submission key will prevent duplicates."
        : "Your previous submission could not be checked. Its key is kept so another submission cannot duplicate it.";
    } finally { setBusy(false); }
  }
  await loadMenu();
}
void initialize();
