# Fast Food World

A restaurant menu, guest ordering and catering application. The brown-and-gold HTML/CSS/JavaScript frontend is served by a Node.js/TypeScript/Express backend using hosted PostgreSQL, Prisma and Zod.

Features include a standalone landing page and database-backed ordering catalog, an editable guest basket, server-priced order review, private order tracking, a protected admin dashboard, catering requests and responsive navigation. Payments, customer accounts, image uploads and automated messages are outside the current scope.

See the [API reference](docs/API.md) for endpoints, request formats, authentication and errors, and the [implementation record](PROJECT_PLAN.md) for migration history and verification limits. Browser tests use API fixtures and do not prove PostgreSQL persistence.

## Menu missing or Add to basket not working

Use the Node application at http://localhost:3000/, not VS Code Live Server (port 5500) or a directly opened HTML file. The order page and its Add buttons read the menu from PostgreSQL through Express. The landing page works independently and optionally loads current restaurant contact details.

Follow the setup below to configure `.env`, apply migrations, seed the menu and start Express. If `.env` already exists, preserve its configured database URL and secrets. The landing page introduces the restaurant and links to **menu.html** for browsing, searching, filtering and sorting current prices before ordering. Guests build their basket and check out on **order.html**.

## First-time setup (PowerShell)

You need **Node.js 24 LTS (24.11 or newer on the 24 line)**, npm, and a hosted PostgreSQL database. No local PostgreSQL installation is required.

1. Open a terminal in this project folder:

   ```powershell
   node --version
   npm ci
   npm run db:generate
   ```

2. Create your private configuration file:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   ```

   If you already have `.env`, edit it instead of replacing it. It is ignored by Git. Never put credentials in browser code, screenshots, issue reports or chat.

3. In your hosted PostgreSQL provider's dashboard, create/select the restaurant database. Copy its **direct PostgreSQL connection string**, not an HTTP API URL or transaction-pooler URL, into `DATABASE_URL` in `.env`. The database user needs permission to apply migrations and read/write application tables.

   Use verified TLS with `sslmode=verify-full`. Copy the provider's complete URL so password characters are correctly URL-encoded. Allow your computer's IP in the provider's network settings if required. Do not disable certificate verification to solve a connection error.

4. Generate two independent secrets by running this command **twice** in your own terminal:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   Put one result in `SESSION_SECRET` and the other in `TRACKING_SECRET` in `.env`. Keep `APP_ORIGIN=http://localhost:3000` and `TRUST_PROXY_HOPS=0` for local development. Replace all application `CHANGE_ME` values.

5. Apply the migration and seed your hosted database:

   ```powershell
   npm run db:migrate
   npm run db:seed
   ```

   These write to the database in `DATABASE_URL`. The seed adds 19 menu items and 5 categories. Running it again preserves existing menu/settings edits. It does not reset data or create an administrator.

6. Create your administrator, replacing the example email:

   ```powershell
   npm run admin:create -- --email owner@example.com
   ```

   Enter and confirm a unique password of 12–128 characters. Input is hidden; passwords are not accepted in command arguments. The command stores only an Argon2id hash and does not overwrite existing accounts. There is no default password or public registration endpoint.

7. Start the application:

   ```powershell
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Use this exact origin rather than `127.0.0.1` or a separate static server. **Ctrl+C** stops the app.

   [API health](http://localhost:3000/api/health) checks database connectivity. [Menu API](http://localhost:3000/api/menu) shows the seeded menu. `/healthz` checks only the HTTP process.

   Review [the shared menu](http://localhost:3000/#menu), [guest ordering](http://localhost:3000/order.html), [catering requests](http://localhost:3000/catering.html), and [admin sign in](http://localhost:3000/admin.html). Sign in using the account created above. Tracking links are issued only after saved orders.

   When updating an existing environment, run `npm run db:migrate` before restarting the server. This applies all pending migrations, including catering quotes, approval statuses, new-record defaults and cancellation reasons. The additive migrations preserve existing records and histories; do not reset or use `migrate dev` against restaurant data.

For the compiled backend:

```powershell
npm run build
npm start
```

Run commands from the project root so the server can find the existing frontend files.

## Menu and settings

Money fields ending in `Minor` are integer hundredths of a Kenyan shilling: `5000` means **KSh 50.00**. The server reads prices/fees from PostgreSQL and rejects client-supplied price fields.

The seed uses the existing home table's **Bhajias KSh 100** and **Spring Rolls KSh 80** where pages disagreed. Other items retain the prices found in the original pages. These are starting prices for owner review. All image references start as `null`; no product photos were invented.

Delivery initially costs **KSh 150**. Address/opening-hour text comes from the existing page. Phone/email settings start empty because the existing values appear to be placeholders. Opening hours are informational; `acceptingOrders`, `pickupEnabled` and `deliveryEnabled` control ordering. Update these through the dashboard’s Restaurant settings section.

## Order and catering workflows

Ordinary orders are confirmed immediately after server validation and saved as **ACCEPTED**. Administrators manage preparation and fulfilment; there is no approval step for ordinary orders.

| Fulfilment | Status progression |
| --- | --- |
| Pickup | ACCEPTED → PREPARING → READY → COMPLETED |
| Delivery | ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY → COMPLETED |

An administrator can cancel a nonterminal order with a reason of 1–1000 trimmed characters. That reason appears in private customer tracking. Completed and cancelled orders cannot change status. Historical PENDING orders remain unchanged and can only be cancelled.

Catering submissions start **PENDING** and are **not confirmed bookings**. An authenticated administrator must explicitly choose **CONFIRMED** or **DECLINED** after restaurant follow-up. Saving a quote or internal notes does not confirm a booking. Decisions cannot reopen or switch, but notes and quotes remain editable. Legacy REQUESTED/CONTACTED requests await an explicit decision; legacy CLOSED requests remain closed. Administrators contact customers separately; the application sends no automated notifications.

The server calculates order totals from current database prices and stores item snapshots. Exact retries reuse the original submission key and payload to prevent duplicate orders or catering requests. See the [API reference](docs/API.md) for retry rules, concurrency checks and tracking privacy.

## Verification

The latest recorded workflow update in [PROJECT_PLAN.md](PROJECT_PLAN.md), dated 28 October 2026, reports successful application of all four migrations to the configured development database, a passing build/type check and 21 passing unit/HTTP checks. Those tests include stubbed persistence checks; they do not establish live transaction or concurrency behavior. Full live customer/admin flows, durable sessions, isolated database integration tests and browser verification of the latest workflow remain outstanding.

For a lightweight compile check without running tests:

    npm run verify:build

## Optional checks


```powershell
npm run check
npm run secrets:check
npm run test:browser
npm audit
```

`check` runs TypeScript, unit/HTTP tests and the build without database credentials. The HTTP boundary tests stub the rate-limit query; they do not verify persistence.

For real database tests, create a **separate hosted test database or branch**. Set its direct URL as `TEST_DATABASE_URL` in `.env`, also with `sslmode=verify-full`, then run:

```powershell
npm run test:integration
```

The runner refuses the restaurant database. It creates a unique `restaurant_test_...` schema in the test database, applies the actual migrations, seeds it, runs the suite and removes only that schema. Its database user needs permission to create/drop schemas and create tables/functions. Forced termination can leave that named test schema behind; inspect it in your provider dashboard before removing it.

Tests cover concurrent duplicate submissions, rollback after an injected database failure, totals/availability, immutable snapshots, private tracking, admin access, status races, durable/expired sessions, logout, rate limits and catering persistence. Missing test credentials produce an explicit **NOT RUN** failure, not a false pass.

Browser tests require Google Chrome installed. To use Microsoft Edge instead:

```powershell
$env:PLAYWRIGHT_CHANNEL = "msedge"
npm run test:browser
```

The suite starts an isolated local static host on `127.0.0.1:4173` and intercepts API calls with test fixtures; it never starts a local database or uses your restaurant data. It checks 375, 390, 768 and 1440px widths and writes screenshots to ignored `.local/screenshots/`. The fixture host is test infrastructure, not a demo authentication bypass in the application.

For browser review against your hosted database, run `npm run dev`, open the URLs above at the same exact origin, and use browser responsive mode at each width. Add two items, edit/remove quantities, reload, choose delivery then pickup, review and place once. Confirm the saved order starts ACCEPTED. Open the private tracking link and confirm contact details are absent. Sign in as admin, advance through valid fulfilment statuses, and check cancellation with a customer-visible reason on a separate nonterminal order. Toggle menu availability and edit prices/categories/settings. Submit a catering request, confirm its receipt says it is not a confirmed booking, then explicitly confirm or decline it as admin. Check that saving only notes or a quote leaves its status unchanged.

Catering retries keep the exact payload and key only in memory after an uncertain response. Keep that tab open until resolved; details are not stored on disk. Order baskets store only IDs/quantities; submission recovery uses a random key in session storage. Guests should save their private tracking link.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for actual test results and unavailable checks.

## Secrets and security

- Environment files and private keys are ignored; `.env.example` contains placeholders only.
- `secrets:check` checks Git's index, tracked working files and non-ignored new files for secret environment files and common credential patterns without printing matched values. Pattern scanning is not a guarantee; review new/untracked files and staged diffs too.
- If a real secret is ever tracked, remove it from tracking and rotate the credential. Ignoring it alone does not remove it from Git or its history.
- Only explicit frontend files and `images/` are served. Environment files, backend source and the repository root are inaccessible over HTTP.
- Admin APIs check an active database administrator on each request. Sessions rotate on login and expire after eight hours of authentication. Disabling an account immediately blocks access.
- Same-origin JSON mutations require a session CSRF token and exact Origin header, including login/logout. Cookies are HttpOnly and SameSite=Strict. Production requires HTTPS and Secure cookies.
- Rate limits use atomic PostgreSQL counters across processes. Expired counters/sessions are pruned; database failures do not bypass limits.
- Tracking tokens and submission keys are private bearer capabilities. Only tracking-token hashes are stored. Never put these values in query strings or server logs.
- Keep `TRACKING_SECRET` stable for retry-token reconstruction. Rotation changes retry tokens; previously issued tokens still match their stored hashes. Rotating `SESSION_SECRET` invalidates sessions.
- All administrators share one management role. Production proxy trust must match the actual proxy topology. Nothing has been deployed.

Security choices follow the [Express security guidance](https://expressjs.com/advanced/best-practice-security/) and [session documentation](https://expressjs.com/en/resources/middleware/session/). Prisma 7 uses the [PostgreSQL driver adapter and explicit client output](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

## Troubleshooting

- **Invalid configuration:** check the named `.env` fields and remove placeholders. Error messages omit secret values.
- **Database/TLS error:** check provider availability, the direct URL, your IP allowlist and the certificate chain. Keep certificate verification enabled.
- **Missing tables:** run `npm run db:migrate` before seeding or starting.
- **403:** get `/api/csrf`, retain its cookie/token, send JSON and use the configured origin. Login returns a replacement token.
- **409:** refresh stale quotes/availability/status. Reuse a submission key only for an exact retry.
- **429:** wait for `Retry-After`. Do not bypass limits by trusting arbitrary proxy headers.

