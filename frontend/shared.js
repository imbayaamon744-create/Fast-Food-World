import { get, ApiError } from "./api-client.js";
import { parseBasket, serializeBasket, BASKET_KEY, money, element } from "./order-core.js";

const toggle = document.querySelector(".nav-toggle"), links = document.querySelector(".site-links");
if (toggle && links) {
  toggle.hidden = false;
  const close = () => { toggle.setAttribute("aria-expanded", "false"); links.classList.remove("is-open"); };
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open)); links.classList.toggle("is-open", open);
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".site-nav")) close();
  });
  window.matchMedia("(min-width: 768px)").addEventListener("change", close);
  links.addEventListener("click", event => { if (event.target.closest("a")) close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") { close(); toggle.focus(); } });
}
const currentPage = location.pathname.split("/").pop() || "index.html";
for (const link of document.querySelectorAll(".site-links a")) {
  if (link.getAttribute("href") === currentPage) link.setAttribute("aria-current", "page");
}
const settingsTargets = document.querySelectorAll("[data-contact], [data-setting]");
if (settingsTargets.length) get("api/settings").then(({ settings }) => {
  const map = document.querySelector("[data-map]");
  if (settings.address) {
    const query = "https://www.google.com/maps?q=" + encodeURIComponent(settings.address);
    if (map) map.src = query + "&output=embed";
    const link = document.querySelector("[data-map-link]"); if (link) link.href = query;
  }
  for (const target of document.querySelectorAll("[data-setting]")) target.textContent = settings[target.dataset.setting] || "Details will be published by the restaurant.";
  for (const target of document.querySelectorAll("[data-contact]")) {
    target.replaceChildren();
    for (const [field, prefix] of [["phone", "tel:"], ["email", "mailto:"]]) if (settings[field]) {
      const link = element("a", settings[field]); link.href = prefix + settings[field]; target.append(link, document.createTextNode(" "));
    }
    if (!target.childNodes.length) target.textContent = "Contact details have not yet been published. Use the order or catering form to send your request.";
  }
}).catch(() => { for (const target of settingsTargets) target.textContent = "Restaurant details are temporarily unavailable. Please try again later."; });

function basketButton(item, onAdd, disabled) {
  const button = element("button", item.available ? "Add to basket" : "Unavailable", "add-item-btn");
  button.type = "button"; button.disabled = disabled || !item.available;
  button.setAttribute("aria-label", item.available ? "Add " + item.name + " to basket" : item.name + " is unavailable");
  button.addEventListener("click", () => onAdd(item));
  return button;
}
function tableNotice(host, text) {
  const body = host.querySelector("[data-menu-rows]");
  if (!body) { host.querySelector("[data-menu-grid]").replaceChildren(); return; }
  const row = element("tr"), cell = element("td", text);
  cell.colSpan = 6; row.append(cell); body.replaceChildren(row);
}
export function renderMenu(host, items, onAdd, disabled = false) {
  const grid = host.querySelector("[data-menu-grid]");
  const tableView = host.dataset.menuView === "table";
  const rows = tableView ? grid.querySelector("[data-menu-rows]") : grid;
  rows.replaceChildren();
  const search = host.querySelector("[data-menu-search]").value.trim().toLowerCase();
  const category = host.querySelector("[data-menu-category]").value;
  const available = host.querySelector("[data-menu-available]").checked;
  const filtered = items.filter(item => (!search || (item.name + " " + item.description).toLowerCase().includes(search)) &&
    (!category || (item.category?.slug || item.category?.name) === category) && (!available || item.available));
  const sort = host.querySelector("[data-menu-sort]")?.value;
  if (sort === "price-asc") filtered.sort((a, b) => a.priceMinor - b.priceMinor || a.name.localeCompare(b.name));
  if (sort === "price-desc") filtered.sort((a, b) => b.priceMinor - a.priceMinor || a.name.localeCompare(b.name));
  if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name));
  if (tableView) {
    for (const item of filtered) {
      const row = element("tr");
      const name = element("th"); name.scope = "row";
      if (item.imageUrl) {
        const image = element("img"); image.src = item.imageUrl; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => image.remove()); name.append(image);
      }
      name.append(document.createTextNode(item.name));
      const button = basketButton(item, onAdd, disabled);
      const action = element("td"); action.append(button);
      row.append(name, element("td", item.category?.name || "Menu"), element("td", item.description),
        element("td", money(item.priceMinor)), element("td", item.available ? "Available" : "Unavailable"), action);
      rows.append(row);
    }
    if (!filtered.length) {
      const row = element("tr"), cell = element("td", "No matching items. Try another search or category.");
      cell.colSpan = 6; row.append(cell); rows.append(row);
    }
    host.querySelector("[data-menu-message]").textContent = filtered.length
      ? filtered.length + (filtered.length === 1 ? " menu item." : " menu items.") + " Add items to your basket, then review your order."
      : "No matching items. Try another search or category.";
    return;
  }
  for (const item of filtered) {
    const card = element("article", undefined, "product-card");
    if (item.imageUrl) {
      const image = element("img"); image.src = item.imageUrl; image.alt = ""; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => image.remove()); card.append(image);
    }
    card.append(element("p", item.category?.name || "Menu", "product-category"), element("h3", item.name), element("p", item.description, "product-description"));
    const foot = element("div", undefined, "product-footer");
    const action = onAdd ? basketButton(item, onAdd, disabled)
      : element("span", item.available ? "Available" : "Currently unavailable", "menu-availability");
    foot.append(element("strong", money(item.priceMinor)), action); card.append(foot); grid.append(card);
  }
  host.querySelector("[data-menu-message]").textContent = filtered.length ? filtered.length + (filtered.length === 1 ? " menu item." : " menu items.") + " Prices and availability are checked before ordering." : "No matching items. Try another search or category.";
}
export function menuControls(host, items, repaint) {
  const select = host.querySelector("[data-menu-category]"), selected = select.value;
  select.replaceChildren(new Option("All categories", ""));
  const groups = new Map(items.map(item => [item.category?.slug || item.category?.name || "", item.category?.name || "Menu"]));
  for (const [key, name] of groups) select.append(new Option(name, key));
  select.value = Array.from(select.options).some(option => option.value === selected) ? selected : "";
  for (const control of host.querySelectorAll("input, select")) control.oninput = repaint;
}
const homeMenu = document.querySelector("body > main.container [data-menu]");
if (homeMenu) {
  let items = [], loading = false;
  const add = item => {
    if (loading) return;
    try {
      const { cart } = parseBasket(localStorage.getItem(BASKET_KEY));
      if ((cart.get(item.id) || 0) >= 20 || (!cart.has(item.id) && cart.size >= 50)) {
        homeMenu.querySelector("[data-menu-message]").textContent = "Basket limit reached. Edit your basket on the order page."; return;
      }
      cart.set(item.id, (cart.get(item.id) || 0) + 1);
      localStorage.setItem(BASKET_KEY, serializeBasket(cart));
      const count = Array.from(cart.values()).reduce((sum, quantity) => sum + quantity, 0);
      homeMenu.querySelector("[data-menu-message]").textContent = item.name + " added to basket. " + count + (count === 1 ? " item" : " items") + " in your basket. Choose View basket & checkout to continue.";
    } catch { homeMenu.querySelector("[data-menu-message]").textContent = "Basket storage is unavailable. Open the order page to add items in this tab."; }
  };
  const paint = () => renderMenu(homeMenu, items, add, loading);
  const load = async () => {
    if (loading) return;
    loading = true;
    homeMenu.querySelector("[data-menu-refresh]").disabled = true;
    renderMenu(homeMenu, items, add, true);
    homeMenu.setAttribute("aria-busy", "true");
    homeMenu.querySelector("[data-menu-message]").textContent = "Loading current menu…";
    tableNotice(homeMenu, "Loading menu from the restaurant…");
    try { const data = await get("api/menu"); if (!Array.isArray(data.items)) throw new ApiError("The menu response could not be read."); items = data.items; menuControls(homeMenu, items, paint); renderMenu(homeMenu, items, add); }
    catch (error) { items = []; tableNotice(homeMenu, error.message); homeMenu.querySelector("[data-menu-message]").textContent = error.message + " Use Reload menu to try again."; }
    finally {
      loading = false; homeMenu.setAttribute("aria-busy", "false");
      homeMenu.querySelector("[data-menu-refresh]").disabled = false;
    }
  };
  homeMenu.querySelector("[data-menu-refresh]").onclick = load; void load();
}
