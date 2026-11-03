// Browser-safe basket helpers. Stored data never includes prices or customer details.
export const BASKET_KEY = "restaurant.basket.v1";
export const ATTEMPT_KEY = "restaurant.submission.v1";
export const isId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isToken = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const validQuantity = value => Number.isInteger(value) && value >= 1 && value <= 20;
export function parseBasket(raw) {
  const cart = new Map();
  let repaired = false;
  try {
    const entries = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(entries)) return { cart, repaired: true };
    for (const entry of entries) {
      if (!entry || !isId(entry.menuItemId) || !validQuantity(entry.quantity) || cart.size >= 50) { repaired = true; continue; }
      if (cart.has(entry.menuItemId)) { repaired = true; continue; }
      if (Object.keys(entry).some(key => !["menuItemId", "quantity"].includes(key))) repaired = true;
      cart.set(entry.menuItemId, entry.quantity);
    }
  } catch { repaired = true; }
  return { cart, repaired };
}
export const basketItems = cart => Array.from(cart, ([menuItemId, quantity]) => ({ menuItemId, quantity }));
export const serializeBasket = cart => JSON.stringify(basketItems(cart));
export function reconcileBasket(cart, menu) {
  const byId = new Map(menu.map(item => [item.id, item]));
  return basketItems(cart).map(line => ({
    ...line, item: byId.get(line.menuItemId),
    available: byId.get(line.menuItemId)?.available === true,
  }));
}
export const money = minor => new Intl.NumberFormat("en-KE", {
  style: "currency", currency: "KES", currencyDisplay: "narrowSymbol", minimumFractionDigits: 2,
}).format(minor / 100);
export const statusLabel = status => ({
  PENDING: "Legacy pending order — contact the restaurant", ACCEPTED: "Accepted", PREPARING: "Preparing",
  PICKUP: "Pickup", DELIVERY: "Delivery", REQUESTED: "Legacy requested — decision outstanding", CONTACTED: "Legacy contacted — decision outstanding", CLOSED: "Legacy closed — outcome unconfirmed", CONFIRMED: "Confirmed", DECLINED: "Declined",
  READY: "Ready", OUT_FOR_DELIVERY: "Out for delivery", COMPLETED: "Completed", CANCELLED: "Cancelled",
}[status] ?? "Status unavailable");
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function renderLines(container, lines) {
  container.replaceChildren(...lines.map(line => {
    const row = element("li", undefined, "receipt-item");
    row.append(element("span", line.quantity + " × " + line.name),
      element("span", money(line.unitPriceMinor) + " each · " + money(line.lineTotalMinor)));
    return row;
  }));
}


// Validate receipt structure before clearing a basket or showing saved-order confirmation.
// These checks do not price an order: PostgreSQL-backed server quotes remain authoritative.
export function validAmounts(value) {
  if (!value || value.currency !== "KES" || !["PICKUP", "DELIVERY"].includes(value.fulfilment) ||
      !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 50) return false;
  if (!value.items.every(line => line && isId(line.menuItemId) && typeof line.name === "string" &&
      validQuantity(line.quantity) && Number.isSafeInteger(line.unitPriceMinor) && line.unitPriceMinor >= 0 &&
      Number.isSafeInteger(line.lineTotalMinor) && line.lineTotalMinor === line.unitPriceMinor * line.quantity)) return false;
  if (new Set(value.items.map(line => line.menuItemId)).size !== value.items.length) return false;
  return Number.isSafeInteger(value.subtotalMinor) && Number.isSafeInteger(value.deliveryFeeMinor) &&
    value.deliveryFeeMinor >= 0 && (value.fulfilment !== "PICKUP" || value.deliveryFeeMinor === 0) &&
    value.subtotalMinor === value.items.reduce((sum, line) => sum + line.lineTotalMinor, 0) &&
    Number.isSafeInteger(value.totalMinor) && value.totalMinor === value.subtotalMinor + value.deliveryFeeMinor;
}
export function validPublicOrder(order) {
  const statuses = ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED"];
  return validAmounts(order) && isId(order.id) && statuses.includes(order.status) &&
    Array.isArray(order.history) && order.history.every(entry => entry && statuses.includes(entry.status) && (entry.reason == null || (typeof entry.reason === "string" && entry.reason.length <= 1000)) &&
      Number.isFinite(Date.parse(entry.createdAt)));
}
