# Fast-Food-World

A responsive, static website for Fast Food Restaurant. It introduces the restaurant, showcases its menu and location, and provides a client-side ordering demo.

## Pages and features

- **Home (`index.html`)** — restaurant introduction, story, services, menu, owners, location map, and contact details.
- **Order (`order.html`)** — choose menu items and quantities, manage a basket, select pickup or delivery, and review an order total.
- **Styles (`app.css`)** — shared layout, colors, and responsive styling.
- **Images (`images/`)** — page background, founder portraits, and delivery partner logos.

The order page is a demo only. It calculates a basket and displays a confirmation-style summary in the browser; it does not send or save orders and has no backend or payment processing.

## Run locally

No build step or package installation is required. Open `index.html` in a browser, or serve the repository root with Python:

```powershell
python -m http.server 8000
```

Then visit <http://localhost:8000>.The location map is embedded from Google Maps and needs an internet connection.

