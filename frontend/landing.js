// The landing page works on its own; live restaurant details are optional.
const toggle = document.querySelector(".nav-toggle");
const links = document.querySelector(".site-links");
if (toggle && links) {
  toggle.hidden = false;
  const close = () => {
    toggle.setAttribute("aria-expanded", "false");
    links.classList.remove("is-open");
  };
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    links.classList.toggle("is-open", open);
  });
  links.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (!link) return;
    const destination = new URL(link.href);
    const target = destination.pathname === location.pathname && destination.hash
      ? document.getElementById(destination.hash.slice(1)) : null;
    close();
    if (target) {
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".site-nav")) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      close();
      toggle.focus();
    }
  });
  window.matchMedia("(min-width: 768px)").addEventListener("change", close);
}

if (document.querySelector("[data-setting], [data-contact]") &&
    (location.protocol === "http:" || location.protocol === "https:")) {
  fetch("api/settings", { signal: AbortSignal.timeout(5000) })
    .then(response => {
      if (!response.ok) throw new Error("Restaurant details unavailable");
      return response.json();
    })
    .then(({ settings }) => {
      if (!settings) return;
      for (const target of document.querySelectorAll("[data-setting]")) {
        if (settings[target.dataset.setting]) target.textContent = settings[target.dataset.setting];
      }
      const mapLink = document.querySelector("[data-map-link]");
      if (settings.address && mapLink) {
        mapLink.href = "https://www.google.com/maps?q=" + encodeURIComponent(settings.address);
        mapLink.hidden = false;
      }
      const contact = document.querySelector("[data-contact]");
      const contacts = [];
      for (const [field, prefix] of [["phone", "tel:"], ["email", "mailto:"]]) {
        if (!settings[field]) continue;
        const link = document.createElement("a");
        link.textContent = settings[field];
        link.href = prefix + settings[field];
        contacts.push(link, document.createTextNode(" "));
      }
      if (contact && contacts.length) contact.replaceChildren(...contacts);
    })
    .catch(() => { /* Keep useful static content when no backend is running. */ });
}

for (const link of document.querySelectorAll(".site-links a")) {
  const destination = new URL(link.href);
  const current = location.pathname.endsWith("/") ? location.pathname + "index.html" : location.pathname;
  if (destination.pathname === current && !destination.hash) link.setAttribute("aria-current", "page");
}
