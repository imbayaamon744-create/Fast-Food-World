import { get } from "./api-client.js";
import { renderMenu, menuControls } from "./shared.js";

const host = document.querySelector("[data-menu]");
const refresh = host.querySelector("[data-menu-refresh]");
let items = [], loading = false;
const paint = () => renderMenu(host, items, null);
async function load() {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  host.setAttribute("aria-busy", "true");
  host.querySelector("[data-menu-message]").textContent = "Loading the current menu…";
  try {
    const data = await get("api/menu");
    if (!Array.isArray(data.items)) throw new Error("The menu response could not be read.");
    items = data.items;
    menuControls(host, items, paint);
    paint();
  } catch {
    host.querySelector("[data-menu-grid]").replaceChildren();
    host.querySelector("[data-menu-message]").textContent = "The menu is temporarily unavailable. Choose Reload menu to try again.";
  } finally {
    loading = false;
    refresh.disabled = false;
    host.setAttribute("aria-busy", "false");
  }
}
refresh.addEventListener("click", load);
void load();
