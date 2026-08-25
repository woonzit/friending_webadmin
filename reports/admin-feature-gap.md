# Friending Webadmin feature-gap inventory

Status: research snapshot for T-203, 2026-08-25.

## Scope and method

This report compares the complete set of 23 top-level PHP files in
`friending_app_legacy/webadmin/*.php` with the 33 authenticated page routes in the current
Next.js console. Associated legacy JavaScript was used only to identify behavior hidden behind
the PHP shells. The current comparison uses `app/(dashboard)/**/page.tsx`,
`lib/adminHelp.ts`, `lib/adminActions.ts`, and the relevant components and parsers at commit
`0c31bbeb6ddb0bf8d9b98372350e9049eca1547a`.

The Core route catalogue was checked read-only to distinguish a missing Webadmin UI from a
missing provider contract. A route existing in Core does **not** make it safe to expose: every
new console action still needs an explicit `/v1/webadmin/*` contract, server-side capability
checks, audit, bounded validation, a fail-closed response parser, and same-origin proxy policy.

The classifications are:

- **Present**: the operator outcome exists in the current console, although its implementation
  and security model may be newer.
- **Missing — needed**: a valid Friending operations outcome has no current console surface.
  This is a backlog finding, not authorization to expose a legacy route.
- **Retired**: the outcome belongs to AYI, Deplug, waiting room, curated events, or another
  explicitly retired workflow under D-001. It must not be recreated incidentally.

## Conclusions

The current console is not a thin replacement for the legacy admin. It already has extensive
operations surfaces that the legacy PHP tree never had: membership, support inbox, Help CMS,
profile catalogues and presentation, profile-verification casework, member-created Dates,
Footprints, Pinger, App Review controls, and immutable audit history.

The material legacy outcomes still missing are:

1. Persona operator controls and Persona start-screen configuration. This is already assigned to
   T-202 after the T-102 Core contract lands.
2. A global reported-content moderation queue. Photo moderation is present, but it is not a
   substitute for reports about profiles, messages, or other content.
3. Reusable email/SMS/push templates plus tightly controlled outbound sending and per-user
   delivery history.
4. Per-user in-app product messages (the legacy “custom popup” editor).
5. Longitudinal registration, onboarding-funnel, deletion, and fast-quit analytics.
6. Privacy-preserving geographic density and outreach segmentation, if operations still needs
   city-launch planning.
7. A canonical public-profile share outcome, once a dedicated public Friending surface and safe
   Core projection exist.

There is **no standalone giveaway manager** in the 23-file legacy PHP Webadmin. The legacy promo
editors are an AYI map card and a waiting-room card, both retired. Core does expose separate
general promo-box and giveaway client routes; those are an adjacent operational gap requiring a
product decision and a new Webadmin-grade contract, not evidence that the retired editors should
return.

## Current console: all 33 screens

| # | Route | Current operator outcome | Legacy relationship |
|---:|---|---|---|
| 1 | `/` | Overview metrics, quick actions, and recent audit events | Newer operations overview; not the legacy registration-statistics dashboard |
| 2 | `/users` | User search, real/demo and avatar filters, contact/location summary, membership summary, demo visibility permission | Partial successor to `dashboard.php`; advanced cohort/reachability filters and bulk messaging are missing |
| 3 | `/users/[uid]` | Profile facts and answers, albums, media editing/deletion/crop, membership, moderation, profile copy, tags, and coarse location facts | Strong successor to `user_detail.php`; product popup, outbound history, share link, and Persona controls are missing |
| 4 | `/membership` | Rollout, benefits, limits, products, preview, and readiness | New current capability |
| 5 | `/photo-moderation` | Pending/denied image queues and approve/reject actions | Present successor to the verification-image half of `moderation.php` |
| 6 | `/profile-verification` | Internal profile-verification case queue and configuration access | New current verification workflow; this is not Persona |
| 7 | `/profile-verification/[caseId]` | Case lease, evidence, challenge, decision, and history | New current verification workflow; this is not Persona |
| 8 | `/profile-location` | Global and country-specific profile-location policy | New safer policy surface; not the legacy individual-pin density map |
| 9 | `/dates` | Filtered member-created Date activity list | New current product capability; not curated legacy events |
| 10 | `/dates/configuration` | Date runtime settings, activity types, and report reasons | New current product capability |
| 11 | `/dates/moderation` | Date report/case queue | New feature-specific moderation; not a global reported-content queue |
| 12 | `/dates/moderation/[caseId]` | Claims, evidence, notes, escalation, resolution, holds, and history | New current capability |
| 13 | `/dates/[activityId]` | Date detail, controlled exact location, commands, host transfer, moderation, membership/chat, and history | New current capability; not a curated-event editor |
| 14 | `/heroes` | People hero campaigns, targeting, ordering, media, copy, typography, and lifecycle | New campaign system; not an AYI/waiting-room promo replacement |
| 15 | `/landing` | Web landing campaigns, targeting, responsive media, gradients, login card, and lifecycle | New current capability |
| 16 | `/app-landing` | App landing rules, targeting, visual content, and inheritance preview | New current capability |
| 17 | `/signup-options` | Signup questions, answers, audiences, ordering, and archive behavior | New current signup catalogue; not Deplug onboarding |
| 18 | `/signup-photos` | Signup photo grid, moderation notice, avatar screen, and tip cards | New current capability |
| 19 | `/user-groups` | Rule-driven user groups and archive behavior | New current capability |
| 20 | `/profile-fields` | Profile sections, field/option catalogue, audience, and archive behavior | New current capability |
| 21 | `/profile-presentation` | Highlight/more-about composition, sources, and preview | New current capability |
| 22 | `/profile-tags` | Tag catalogues, groups/items, audiences, and preview | New current capability |
| 23 | `/icebreakers` | Prompt search, edit, placement/audience, and archive behavior | New current capability |
| 24 | `/layer2-intents` | Intent catalogue, limits, reciprocal sets, archive/restore, and conflict handling | New current capability |
| 25 | `/footprints` | Limits, badges, audiences, overrides, reports, and archive behavior | New current capability |
| 26 | `/pinger` | Runtime controls, icons, copy, and audit context | New current capability |
| 27 | `/invite-configuration` | Global/storefront invite copy and delivery-mode configuration | Configuration only; it is not an arbitrary bulk-message sender |
| 28 | `/support` | Support threads, conversation context, attachments, and replies | Member-initiated support; it is not campaign messaging or the legacy per-user delivery history |
| 29 | `/help-cms` | Help categories/articles, bilingual blocks, publishing, and archive | New current capability; not canned outbound messages |
| 30 | `/configuration` | Product, session, appearance, public-link, presence, verification, and safety settings | New typed configuration surface; no giveaway or promo-box editor |
| 31 | `/app-review` | Sandbox readiness, counts, checks, guarded reset, and interpretation | New current capability |
| 32 | `/admins` | Administrator allow-list, roles, active access, and owner boundary | Present successor to `admins.php`, with stronger authorization |
| 33 | `/audit` | Immutable audit event list and safe details | New current capability |

Two naming traps matter throughout the comparison:

- Current **Dates** are member-created activities. They do not replace the retired curated-event
  editor, invitee roster, or event wall.
- Current **profile verification** is a Core-owned evidence/case workflow. It does not replace
  Persona verification or its fake/forced operator controls.

## Complete legacy PHP file inventory

| Legacy file | What it supplied | Classification and current mapping |
|---|---|---|
| `_help.php` | Shared page-guide modal partial | **Present.** `AdminHelp` provides route-closed contextual guidance across all 33 screens in EN/HU. |
| `_modals.php` | Shared email/SMS/push composer, canned-template picker, delivery history, and curated-event assignment modal | **Missing — needed** for controlled outbound messaging/templates/history. **Retired** for curated-event assignment. |
| `_nav.php` | Shared desktop/mobile navigation, admin identity, logout, and light/dark theme switch | **Present** through `Shell`, locale switcher, and auth routes. The light theme is intentionally not carried into the dark-only product. |
| `admins.php` | List/add/update/disable/delete administrators, including self/owner safeguards | **Present** at `/admins`, backed by owner-only mutation policy and audit. |
| `api.php` | Authenticated AJAX switch forwarding all legacy feature actions | **Mixed.** The current same-origin proxy is present and stricter, while each feature action is classified separately below. Arbitrary forwarding must not return. |
| `auth.php` | Session guard and Core-backed sign-in helpers | **Present** with six-digit email login, independent signed session cookie, and active-member rechecks. |
| `ayi_card.php` | AYI map “start or join” promo card, media, copy, styling, and map/curated-event switch | **Retired** with AYI and curated events. |
| `canned.php` | CRUD editor for reusable email, SMS, and push templates; email subject/HTML and channel-specific length guidance | **Missing — needed.** No current screen or allow-listed action manages outbound templates. |
| `config.php` | Legacy environment/bootstrap constants and endpoint helpers | **Present as infrastructure** through environment validation and server-only modules. No legacy credential or browser-side provider key should be ported. |
| `dashboard.php` | Registered-user search and pagination, advanced cohort/reachability/geography filters, bulk messaging, user history, waiting-room exception, and fake Persona controls | **Present** for core search/list/detail. **Missing — needed** for advanced segmentation, communication/history, and Persona operations (T-202). **Retired** for waiting-room exception. |
| `density.php` | City-radius search and user-density clustering using last location or hometown; cohort, Persona, country, and channel filters; individual/bulk outreach; curated-event assignment | **Missing — needed** only as privacy-preserving density/outreach segmentation if operations confirms the need. **Retired** for curated-event assignment. The legacy individual coordinate map is not an acceptable implementation target. |
| `deplug.php` | Deplug categories, cities, vibe question, onboarding, signup flow/questions, feed-wall broadcasts/moderation, and bans | **Retired** in full. Current generic signup catalogues do not restore Deplug semantics. |
| `events.php` | Curated event CRUD/lifecycle, media/location/eligibility, candidate and invitee management, channel invites/history, and event-wall post/moderation/broadcast tools | **Retired** in full. Current Dates are intentionally separate. |
| `index.php` | Email/code sign-in page and session redirect | **Present** at `/login` with current authentication controls. |
| `lib_api.php` | Server-side Core request helper and legacy response handling | **Present as infrastructure** in `lib/core.ts`, with typed envelopes and fail-closed decoding. |
| `logout.php` | Session destruction and sign-in redirect | **Present** at `/api/auth/logout`. |
| `moderation.php` | Verification-image queue/actions and a separate reported-content queue/actions | **Present** for image moderation at `/photo-moderation`. **Missing — needed** for the general reported-content queue. Feature-specific Date and Footprint reports do not cover every reportable surface. |
| `registration_stats.php` | Window/timezone/scope analytics; global/USA KPIs; signup, avatar, Persona, deletion, verified-deletion, and 24-hour fast-quit charts/funnels | **Missing — needed.** The current overview is a point-in-time operations snapshot, not cohort/funnel/churn analytics. |
| `share.php` | Anonymous public profile page with an intentionally reduced data projection | **Missing — needed**, but as a dedicated public Friending surface rather than an authenticated-admin route. D-005 records that no Join/public-profile app exists yet. |
| `share_api.php` | Public share-page data bridge | **Missing — needed** only as support for a reviewed public-profile contract. It must not proxy the Webadmin secret or expose the full admin user-detail response. |
| `share_lib.php` | Allow-listed projection that excluded contact IDs, exact coordinates, moderation data, and Persona selfie evidence | **Missing — needed** as a useful security design reference for the future public projection; do not copy it without a current Core contract and tests. |
| `user_detail.php` | Identity/profile/gallery/tags/location view; crop/rotate/replace/delete media; public share link; per-user product popup; message history; waiting-room and fake-Persona controls | **Present** for most profile, album, media, membership, moderation, and safe-location work. **Missing — needed** for product popup, delivery history/share outcome, and Persona operations. **Retired** for waiting-room controls. |
| `waiting_room.php` | Waiting-room Browse card: header and city images, launch-status/profile/thanks cards, share/rate/invite buttons, push/share copy, order, and AYI/Deplug promo card | **Retired** in full, including its promo card and city-launch presentation. It is not evidence for a generic promo-box editor. |

## Capability-level disposition

### Access, administration, and safe transport

| Legacy outcome | Status | Evidence/notes |
|---|---|---|
| Email/code authentication and logout | **Present** | `/login` and `/api/auth/*`; current sessions are host-only, HttpOnly, Secure, SameSite=Lax, and continuously membership-checked. |
| Admin allow-list management | **Present** | `/admins`; explicit owner boundary and immutable audit. |
| Responsive navigation and operator identity | **Present** | `Shell`; EN/HU locale switching is added. |
| Server-side Core bridge | **Present** | `/api/admin/[action]` with a closed action list, origin checks, active-admin recheck, and no browser-to-Core traffic. |
| Legacy light theme | **Retired** | Friending Webadmin is dark-only. |

### Users, media, moderation, and identity

| Legacy outcome | Status | Evidence/notes |
|---|---|---|
| Basic user lookup, pagination, contact/location summary | **Present** | `/users`. |
| Display-name/phone/date/Persona/country/reachability/distance filter set | **Missing — needed** | Current filters cover free-text, real/demo, and avatar only. Add filters only when Core owns validation and sensitive-location policy. |
| Full profile, answers, tags, and account facts | **Present** | `/users/[uid]`, with a deliberately reduced location projection. |
| Crop/replace/delete album images and select main photo | **Present** | `UserAlbumsPanel` and the bounded image bridge. |
| Suspend/ban/IP-ban/force-logout and content edits | **Present** | `UserModerationPanel`, `UserContentEditor`, and profile data editor. |
| Verification/photo moderation | **Present** | `/photo-moderation`. |
| Global reported-content queue/action | **Missing — needed** | Legacy actions were `moderation_reported_list` and `moderation_report_action`; matching Core routes exist, but the new console does not allow-list or parse them. |
| Fake Persona apply/revoke, force verify, and start-screen config | **Missing — needed** | T-202 is the committed surface after T-102 publishes `handoffs/persona-admin-contract.md`. |
| Waiting-room exception | **Retired** | The parent feature is retired. |

### Communications and product messages

| Legacy outcome | Status | Evidence/notes |
|---|---|---|
| Email/SMS/push canned templates | **Missing — needed** | Core still has `list_canned`, `save_canned`, and `delete_canned`; Webadmin has no matching action/page. |
| Individual and bulk outbound email/SMS/push | **Missing — needed** | Core still has `send_message`; Webadmin has no safe composer or action. Support replies and invite templates are not substitutes. |
| Per-user delivery history | **Missing — needed** | Core still has `user_history`; the current membership history and support thread history are different data. |
| Per-user in-app product popup | **Missing — needed** | Core still has `admin_get_user_popup`, `admin_set_user_popup`, and `admin_clear_user_popup`; the current user detail has no editor. Legacy fields were title, message, forced re-show, optional button title/action/URL, and clear. |
| Event invites and event-wall broadcasts | **Retired** | They belong to curated events. |
| Deplug feed-wall broadcasts | **Retired** | They belong to Deplug. |

### Analytics and geographic operations

| Legacy outcome | Status | Evidence/notes |
|---|---|---|
| Registration/onboarding/deletion statistics | **Missing — needed** | Core still has `registration_stats`; no current screen parses or renders it. |
| City-radius user list and density clusters | **Missing — needed** | Core still has `users_by_distance` and `users_density`; no current screen exposes them. Any successor should default to aggregate/coarse geography rather than individual coordinates. |
| Bulk outreach to a geographic/cohort segment | **Missing — needed** | This depends on the reviewed outbound-message surface and recipient-preview controls. |
| Add geographic cluster to curated event | **Retired** | Curated events are retired. |

### Public profile sharing

The legacy share page demonstrated a valid outcome and a useful boundary: an operator could copy a
login-free profile link, while the public response omitted email, phone, social identifiers, exact
coordinates, moderation data, and verification evidence. The current admin has neither a copy-link
action nor a public renderer.

This remains **missing — needed**, but it cannot be implemented solely inside Webadmin today.
D-005 records no public-profile/Join application. The safe sequence is:

1. define a Core-owned, explicitly public projection with negative-field tests;
2. host it on a dedicated public Friending surface with no Webadmin secret;
3. then let `/users/[uid]` copy the canonical URL returned by that provider.

## Promo boxes and giveaway: adjacent gap, not a retired-page revival

No `giveaway.php`, giveaway action, general promo-box action, or corresponding navigation entry
exists in the 23 legacy PHP files. The only PHP-admin promo editors are:

- `ayi_card.php`: AYI/map/curated-event promo — **Retired**.
- `waiting_room.php`: waiting-room card with an AYI/Deplug promo — **Retired**.

The current Core route catalogue separately exposes client-facing general promo and giveaway
routes, including:

- `giveaway_config`;
- `get_promo_box`, `get_all_promo_boxes`, `update_promo_box`, and `copy_promo_box`;
- giveaway chat, draw, claim, confirm/reject, activation, and clear operations.

The current console has no matching page/action, and its configuration page only owns the public
web origin from which marketing/giveaway links may be composed. Therefore:

- do **not** treat `/heroes`, `/landing`, or `/app-landing` as proof that general app promo boxes
  or giveaway operations are covered;
- do **not** proxy the client-facing Core paths through `/api/admin/[action]`;
- classify a general promo-box/giveaway console as **Missing — needed, conditional on confirmed
  client use and owner scope**;
- require dedicated `/v1/webadmin/*` read/mutation contracts, operator capabilities, audit,
  revisions/idempotency, bounded media handling, and EN/HU product copy before implementation.

## Recommended implementation backlog

| Priority | Gap | Delivery boundary |
|---:|---|---|
| Committed | Persona operations and start-screen config | Complete T-202 only after the T-102 typed handoff; keep it separate from the current profile-verification queue. |
| P1 | Global reported-content moderation | Add queue/detail/action contracts with capability gates, safe evidence projection, reason validation, conflict handling, audit, and parser/origin tests. |
| P1 | Per-user product message | Add get/set/clear with exact revision and request ID, URL validation, preview, clear/expiry semantics, capability gate, and audit. Avoid the legacy unbounded “forced forever” behavior. |
| P1 | Canned templates + outbound delivery/history | Design as one audited communications domain. Include recipient preview/count, hard caps, channel availability, durable idempotency, partial-result reporting, D-007 provider semantics, and separate send/template permissions. |
| P2 | Registration and funnel analytics | Prefer aggregate, timezone-explicit response shapes and suppress identifying data. Preserve the distinction between signup-cohort and deletion-date metrics. |
| P2 | Density/geo segmentation | Confirm operational need first. Return coarse aggregates by default; gate any member drill-down separately and never copy the legacy exact-pin map wholesale. |
| P2/external | Public profile sharing | Depends on a dedicated public application and safe Core projection; Webadmin should only copy an authoritative URL. |
| Decision required | General promo boxes and giveaway | Confirm active client consumption and desired operator scope, then create a Webadmin contract task. Do not revive AYI/waiting-room editors. |

## Provider availability versus Webadmin readiness

| Gap | Current Core route evidence | Current Webadmin action | Readiness conclusion |
|---|---|---|---|
| Canned messages | `list_canned`, `save_canned`, `delete_canned` | None | UI and security-contract integration missing |
| Outbound messaging/history | `send_message`, `user_history` | None | UI and security-contract integration missing |
| Per-user product popup | `admin_get_user_popup`, `admin_set_user_popup`, `admin_clear_user_popup` | None | UI and security-contract integration missing |
| Registration analytics | `registration_stats` | None | UI/parser integration missing; privacy review still required |
| Density | `users_by_distance`, `users_density` | None | UI/parser integration missing; sensitive-location redesign required |
| Reported content | `moderation_reported_list`, `moderation_report_action` | None | Queue/action integration missing |
| Persona | T-102/T-202 contract pending | None | Intentionally blocked until typed handoff |
| Public profile share | No dedicated current public-profile contract established | None | Provider/public host dependency |
| General promo/giveaway admin | Client-facing routes exist; no reviewed Webadmin admin contract | None | Product decision and new provider contract required |

## Explicit non-goals

The following are not feature gaps and must stay absent unless D-001 changes:

- AYI/map card and its map/curated-event switch;
- curated event CRUD, invitees, invitations, wall, broadcasts, and density-to-event assignment;
- Deplug categories, cities, onboarding, signup wizard, questions, feed wall, and bans;
- waiting-room exception and all waiting-room Browse cards, city headers, launch progress,
  share/rate/invite controls, push copy, and AYI/Deplug promo;
- a light theme;
- browser calls to Core, arbitrary proxy paths, legacy browser credentials, individual exact-location
  plotting, or public reuse of the full admin user-detail payload.

These boundaries also prevent false equivalence: current Dates, signup catalogues, Heroes, Landing,
App Landing, Support, Help CMS, and invite configuration are valid current features, but none should
be stretched into an unsafe or semantically incorrect replacement for the retired or missing
capabilities above.
