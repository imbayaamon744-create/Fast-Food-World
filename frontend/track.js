import { post, ApiError } from "./api-client.js";
import { isToken, validPublicOrder, statusLabel, money, element, renderLines } from "./order-core.js";
const $ = id => document.getElementById(id);
let busy = false;
async function refresh() {
  if (busy) return;
  const token = location.hash.slice(1);
  $("tracking-error").hidden = true;
  if (!isToken(token)) {
    $("tracking-result").hidden = true;
    $("tracking-message").textContent = "Open the complete private tracking link from your order confirmation.";
    $("refresh-tracking").disabled = true; return;
  }
  busy = true; $("refresh-tracking").disabled = true;
  $("tracking-message").textContent = "Checking the latest order status…";
  try {
    const { order } = await post("api/orders/track", { token });
    if (location.hash.slice(1) !== token) return;
    if (!validPublicOrder(order)) throw new ApiError("The order response could not be read. Refresh to try again.");
    $("tracking-reference").textContent = order.id;
    $("tracking-status").textContent = statusLabel(order.status);
    $("tracking-fulfilment").textContent = order.fulfilment === "DELIVERY" ? "Delivery order" : "Pickup order";
    renderLines($("tracking-items"), order.items);
    $("tracking-subtotal").textContent = money(order.subtotalMinor);
    $("tracking-delivery").textContent = money(order.deliveryFeeMinor);
    $("tracking-total").textContent = money(order.totalMinor);
    const date = new Intl.DateTimeFormat("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" });
    $("tracking-history").replaceChildren(...order.history.map(entry => element("li", statusLabel(entry.status) + (entry.reason ? " · Reason: " + entry.reason : "") + " · " + date.format(new Date(entry.createdAt)) + " (Nairobi)")));
    $("tracking-result").hidden = false;
    $("tracking-message").textContent = "Status checked. Use Refresh status for another update.";
  } catch (failure) {
    if (location.hash.slice(1) !== token) return;
    if (failure.status === 404) $("tracking-result").hidden = true;
    $("tracking-message").textContent = "";
    $("tracking-error").textContent = failure.status === 404 ? "This private link was not found. Check that you copied the complete link." : failure.message + " You can retry; any displayed details are from the last successful check.";
    $("tracking-error").hidden = false;
  } finally {
    busy = false;
    if (location.hash.slice(1) !== token) void refresh();
    else $("refresh-tracking").disabled = false;
  }
}
$("refresh-tracking").addEventListener("click", () => void refresh());
window.addEventListener("hashchange", () => { $("tracking-result").hidden = true; void refresh(); });
void refresh();
