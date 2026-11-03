// Runs without imports so a directly opened HTML file can explain its missing server.
if (location.protocol === "file:") {
  const message = "Start the application with npm run dev and open http://localhost:3000/. The database menu and ordering cannot run by opening an HTML file directly.";
  for (const target of document.querySelectorAll("[data-menu-message], #order-message, #admin-message, #tracking-message, #catering-message")) target.textContent = message;
  const rows = document.querySelector("[data-menu-rows]");
  if (rows) {
    const row = document.createElement("tr"), cell = document.createElement("td");
    cell.colSpan = 6; cell.textContent = message; row.append(cell); rows.replaceChildren(row);
  }
}
