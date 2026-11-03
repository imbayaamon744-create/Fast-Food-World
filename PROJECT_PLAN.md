# Restaurant ordering system — current implementation

## Scope and verification policy

Complete Stages 3–6 while preserving the shared menu and existing HTML/CSS/JavaScript frontend, Node.js 24, TypeScript, Express, hosted PostgreSQL, Prisma and Zod.
No Docker/local PostgreSQL, payments, customer accounts, invented product photos, database resets, commits, pushes or deployment.
Current verification policy (28 October 2026): run one final build/type check (npm run verify:build: browser JavaScript syntax, Prisma generation, full TypeScript type check and production compile), plus brief focused workflow checks. Do not run extensive/repeated browser tests. Prior verification descriptions below are historical.

## Audit at resume — 27 October 2026

The previous roadmap still called Stages 3–6 pending, despite implemented files. The actual code was inspected before changes: order.js/order-core.js/order.html/order.css, tracking, admin HTML/JS/CSS, shared menu/navigation, catering form, server/app.ts/orders.ts/security.ts/validation.ts/config.ts/db.ts, Prisma schema and migrations, admin CLI and README.

| Requirement | State at resume | Evidence / remaining work identified |
| --- | --- | --- |
| Stage 2 shared menu and photo-optional cards | Complete in code | shared.js fetches /api/menu for home and checkout; search/category/availability and optional images exist. Preserve. |
| Stage 3 persistent editable basket and pickup/delivery | Partially implemented | Working IDs/quantities persistence and address toggling; order.js has corrupted punctuation and no cross-tab basket refresh. |
| Stage 3 review, authoritative totals, validation and retries | Partially implemented | Existing quote fingerprint, exact retry key and saved receipt; malformed receipt could clear basket before rendering fails. Paused ordering was not reflected by the review button. |
| Stage 3 transactional storage and duplicate prevention | Implemented but verification blocked | server/orders.ts uses serializable transactions, snapshots, unique hashed keys and price fingerprints. Hosted credentials absent. Preserve backend. |
| Stage 3 tracking privacy | Partially implemented | Server projection excludes name/phone/address/notes and uses hashed tokens; in-flight old tracking response could render after URL fragment changes. |
| Stage 4 admin dashboard | Complete in code with polish remaining | Login/logout, summaries, pagination, filters, details/history/transitions, menu/categories, optional images and settings exist. Dynamic labels, field constraints and restored page privacy need refinement. |
| Stage 4 authentication/authorization | Implemented but verification blocked | Argon2id, PostgreSQL sessions, active-admin guard, exact-origin/CSRF and persistent limits exist; private CLI, no public registration. Hosted session verification unavailable. |
| Stage 5 catering requests and management | Complete in code with polish remaining | Idempotent storage; REQUESTED/CONTACTED/CLOSED; notes and nullable quoteMinor; additive migration exists. Improve client validation/loading and booking wording. |
| Stage 6 glass navbar/mobile navigation/design | Partially implemented | Brown/gold shared sticky navbar, opaque blur fallback, Escape toggle and responsive cards exist. Finish focus, Safari blur, outside-click/resize handling, checkout layout and text repair. |
| Stage 6 runtime verification | Implemented but verification blocked | Prior browser evidence is historical; current user requests no browser reruns. No hosted DATABASE_URL/.env configured. |

No requested core feature was wholly missing at resume. Working ordering, security, dashboard, catering and migrations were retained.

## Completed remaining implementation

### Stage 3 — guest ordering

- Preserved multi-item basket, quantities 1–20, removals, 50-line cap, local IDs/quantity-only persistence and pickup/delivery address validation.
- Repaired corrupted UTF-8 punctuation in checkout and added editable-basket cross-tab refresh; uncertain submissions are never replaced.
- Preserved server-priced review, quote fingerprint reconciliation, transactional order snapshots, idempotency/recovery and private fragment tracking.
- Validate receipt items, amounts, statuses and history before clearing basket or confirming a saved order; validate quote amounts before review.
- Disabled review when ordering or all fulfilment options are paused; retain details/basket on failures and show field errors.
- Prevent an old tracking request from rendering for a different URL fragment; refresh the new token after an in-flight request finishes.
- Preserve order.html → order.js module reference and external order.css.

### Stage 4 — administration

- Preserved responsive sign-in/out, active-server-session checks, summaries/filtering/pagination, order details/history, valid pickup/delivery transitions, menu/category editing, availability, image references and restaurant settings.
- Added explicit dynamic label associations, slug/length constraints, readable details and status-filter layout.
- Clear private dashboard DOM on restored cached pages and revalidate the server session; admin shell responses use Cache-Control: no-store.
- Password hashing, CSRF, authorization, session rotation/expiry, rate limits and private admin CLI remain intact. Login and expired-session logout are intentional guard exceptions; all management endpoints require an active administrator.

### Stage 5 — catering

- Preserved database-backed idempotent requests and admin status/notes/quote management.
- Added client name/location/phone validation, safe date/day formatting, a live saving announcement and focused saved receipt.
- Failed saves keep inputs; uncertain saves keep the exact in-memory payload/key for retries. No contact details are stored in browser storage.
- Strengthened wording: a reply alone is not booking confirmation; availability, menu and price require agreement.
- Dates remain validated server-side in Africa/Nairobi. No package prices or automated messages.
- Existing additive migration 202610270002_catering_quote adds a nullable integer quoteMinor with a nonnegative bound. No migration was edited or applied during this continuation.

### Stage 6 — design/accessibility

- Preserved brown #21150f / gold #f2b65d and optional photo-free cards; no new image assets.
- Finished blur support including Safari prefix plus opaque fallback, current-page indication, outside-click/resize close and Escape/focus behavior.
- Refined skip-link positioning, focusable main targets, scroll margins, summary targets, narrow-screen brand wrapping and admin form/history layout.
- Styled checkout heading consistently and constrained the full catalog to a scrollable menu so the basket remains reachable; responsive cards remain intact.
- Kept all checkout styles in order.css. Existing shared reduced-motion rules remain.

## Current completion classification

| Requirement | Current classification | Verification limits |
| --- | --- | --- |
| Guest basket, fulfilment, review and recovery UI | Implemented; runtime verification deferred | Code inspected and repaired; no new browser/tests run per latest instruction. |
| Server totals, validation, transactions, idempotency, tracking privacy | Implemented but verification blocked | Real hosted persistence/concurrency cannot be claimed without configured database. |
| Admin dashboard and management forms | Implemented; runtime verification deferred | Existing functionality preserved; this continuation does not rerun browser flows. |
| Admin security/session persistence | Implemented but verification blocked | Server guards inspected; hosted auth/session behavior remains untested here. |
| Catering requests/statuses/notes/quotes | Implemented but verification blocked | Code and additive migration complete; live saves/migration application need hosted database. |
| Navbar, responsive styles, text and accessibility fixes | Implemented; runtime verification deferred | No repeated visual/browser checks requested; manual device/assistive-technology review remains. |
| Build/type check | Complete and verified | npm run verify:build exited 0: 7 browser modules parsed, Prisma generated, full TypeScript check and production compile passed. Compilation does not prove runtime behavior. |
| Secrets boundaries | Complete by inspection | .env absent and untracked; ignored environment/key files and placeholder-only .env.example retained; explicit public static allowlist retained. |

No code implementation tasks from Stages 3–6 remain known after this inspection. Runtime and hosted verification are outstanding, not claimed complete.

## Verification and blockers

- This continuation adds no test suites and runs no unit/integration/browser suites.
- Prior results (historical, not rerun): 18 unit/HTTP tests and build passed; 40 checkout browser cases passed at the four requested widths; corrected 4-case menu/admin/catering run passed at 375px. Earlier cross-width admin/menu runs had locator failures later repaired; no blanket browser success is claimed.
- DATABASE_URL/.env is absent. No hosted connection, migrations, seed, admin creation, real order/catering saves, durable sessions or transaction races were exercised.
- No fresh screenshots or browser width checks; accessibility/device/optional remote-image/map behavior remains untested.
- Final build/type result: PASSED. npm run verify:build exited 0; frontend syntax (7 modules), Prisma client generation (7.10.1), tsc --noEmit and tsc -p tsconfig.build.json completed. This was the only build/type verification run in this continuation.

## Exact local setup and review (PowerShell)

1. Use Node 24.11+ on the 24 line. From the project root, run npm ci if dependencies are not installed.
2. If .env does not exist: Copy-Item .env.example .env. Set your hosted PostgreSQL DATABASE_URL with sslmode=verify-full and two independent SESSION_SECRET/TRACKING_SECRET values. Do not share or commit them. Keep APP_ORIGIN=http://localhost:3000.
3. Run npm run db:migrate, then npm run db:seed. These preserve existing data and seed edits; do not reset the database.
4. First admin only: npm run admin:create -- --email owner@example.com, then enter the hidden password.
5. Run npm run dev. Open http://localhost:3000/order.html, /admin.html and /catering.html using that exact origin.
6. Review two-item basket edit/remove/reload, delivery/pickup, quote/review/submit and private tracking. Sign in, manage the saved order/status/menu/categories/settings, then submit and manage a catering request with a quote. Confirm no booking is automatically claimed.
7. Optionally verify at 375/390/768/1440px after hosted setup. Existing test commands are documented in README; no extensive runs are required for this implementation pass.

No existing data was reset. No commit, push or deployment performed.

## Ordering/menu follow-up

Confirmed actual local blocker: only VS Code Live Server on port 5500 was listening; no Node application on port 3000. DATABASE_URL, APP_ORIGIN, SESSION_SECRET and TRACKING_SECRET were absent from process environment and .env did not exist. Live Server serves HTML/CSS but cannot serve the Express APIs, so the menu and item Add buttons could not load.

At the user's request, created ignored .env from the placeholder template with two fresh independent random server secrets (never printed). DATABASE_URL remains a placeholder until the user enters their hosted PostgreSQL URL privately. No hosted credentials were fabricated and no database writes performed.

Restored the home menu as an always-present semantic table populated from the shared /api/menu source, with product/category/description/price/availability and Add to basket columns. The table and its error/empty/loading rows remain visible on failure; narrow screens scroll horizontally. Checkout retains product cards and its visible quick-add form, now labelled Add to basket.

Home Add now saves items and announces basket contents without navigating away; a separate View basket & checkout link continues the order. Added explicit local-only help for static Live Server/HTML-file use, without cross-origin API workarounds or fake saves. Real ordering still needs configured hosted PostgreSQL, migrations, seed and npm run dev.

Follow-up verification: npm run verify:build PASSED (8 frontend modules parsed, Prisma generation, TypeScript check and production compile). git diff --check PASSED. .env is ignored and not tracked. Existing browser selectors were aligned with the table and Add to basket labels; no unit/integration/browser suites were run. Live menu data and order persistence remain BLOCKED: DATABASE_URL still contains the placeholder; only Live Server was running during inspection. Configure the hosted URL privately, apply migrations/seed and use npm run dev at http://localhost:3000/.


## Order and catering approval workflow — 28 October 2026

This focused update supersedes the earlier workflow/status descriptions and database-configuration blockers above. Existing design, stack, access/session/CSRF system, guest access, server quotes, authoritative totals, snapshots, serializable writes, idempotency and quote editing remain in place.

- New ordinary orders are validated server-side and saved atomically as ACCEPTED with an initial ACCEPTED history entry. Administrators manage preparation/fulfilment, with no approval step.
- Pickup: ACCEPTED → PREPARING → READY → COMPLETED. Delivery: ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY → COMPLETED. Neither terminal state permits further transitions.
- Admin cancellation is available before completion, requires a trimmed 1–1000 character reason, and records the reason and administrator in transactional status history. The reason is labelled customer-visible and appears in private tracking; contact/address/internal notes remain private.
- New catering submissions start PENDING. Only an authenticated admin can explicitly choose CONFIRMED or DECLINED. Same-status notes/quote edits do not confirm a booking. Decisions are terminal, while quotes and notes remain editable. Customers see the non-confirmation warning before submission and on receipt; retries show the actual current status. There are no automated notifications; admins contact customers separately.
- Historical order PENDING is retained as a legacy label, never backfilled or automatically accepted; it can only be cancelled with a reason. Legacy catering REQUESTED/CONTACTED retain their original status until an explicit admin CONFIRMED/DECLINED decision. Legacy CLOSED remains closed because it does not prove confirmation or decline. Existing histories and quotes are preserved.
- Database inspection found the two previous migrations applied, one ACCEPTED order and no catering requests in the configured development database. No credentials were logged.
- Two additive migrations are necessary: 202610280001_approval_workflows adds catering enum values; 202610280002_workflow_defaults sets future-insert defaults and adds nullable history.reason. Separate migrations commit PostgreSQL enum additions before using a new value as a default. Neither migration updates/deletes records or resets the database.

Verification and migration results:

- CREATED AND APPLIED both additive migrations to the configured NODE_ENV=development hosted PostgreSQL database using Prisma migrate deploy (npm run db:migrate). All four migrations now have successful completion records. Verified Order.status default ACCEPTED, CateringRequest.status default PENDING, and nullable OrderStatusHistory.reason. Post-migration data remains one ACCEPTED order and zero catering requests, matching inspection; no records were backfilled/reset.
- PASSED the single npm run verify:build invocation: eight frontend modules parsed, Prisma client generated, full TypeScript checking and production compilation completed, exit 0.
- PASSED npm test: 21 brief unit/HTTP checks, including exhaustive order/catering transitions, required cancellation reasons and recorded admin/reason history, accepted creation/history and exact-key replay/conflict handling. These focused order persistence checks use a transaction stub; they do not prove live database transaction/concurrency behavior. Existing HTTP checks verify authentication/CSRF boundaries. Existing integration/browser expectations were aligned with the new workflow.
- PASSED git diff --check. Existing unrelated working changes were preserved.
- NOT RUN: full live customer/admin order and catering saves, hosted transaction races/session persistence, browser/visual checks or the isolated integration suite. TEST_DATABASE_URL is not configured; tests did not insert/delete development data. No new customer accounts, payments, Docker, dependencies, commit, push or deployment.
- Remaining setup: none for migrations on this development database. Other environments require npm run db:migrate before starting the updated server. Restart a running development server to load the code. For optional isolated integration verification, configure a separate hosted TEST_DATABASE_URL per README, then run npm run test:integration. Do not reset any database.
