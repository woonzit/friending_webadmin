# Registered Users membership truth — additive Core requirements

Status: Webadmin renders only the existing `list_users` membership summary. The filter and
source-date fields in this document are **not deployed contracts** and must not be sent by the
browser until Core implements and publishes them.

## Existing contract and safe UI boundary

`POST /v1/webadmin/list_users` currently applies account/search filters, sorts and paginates the
`userinfo` query, and only then calls `MembershipAdminService::listSummaries()` for those rows. Each
returned row may therefore render these existing, Core-resolved facts:

- `tier`: `free|plus`;
- `entitled`: boolean;
- `lifecycle_state`: the closed Membership V1 lifecycle;
- `effective_expires_at`: the current union-of-access expiry, or `null` when no access is active;
- `first_subscribed_at`: the earliest timestamp across every normalized source kind;
- `source_kinds`: zero or more of `apple|google|admin_grant|legacy_compat`.

`first_subscribed_at` is an aggregate source timestamp. It may be an Apple/Google purchase date, an
administrator-grant date, or a legacy compatibility start. It is not proof of a verified payment.
The Webadmin must continue to call it “earliest source date” until the source-specific contract
below exists.

The current membership summary is computed after pagination. Consequently it supports truthful
display for the returned page, but it cannot support a global membership filter, a membership sort,
or a membership aggregate over the complete result set.

## Required global filter contract

Core must add the following optional form fields to `list_users`. Missing fields retain today's
behavior. Values are exact, lowercase and case-sensitive.

| Field | Closed values and semantics |
| --- | --- |
| `membership_tier` | `all|free|plus`; default `all`. Match Core's resolved effective tier. |
| `membership_lifecycle` | `all|none|pending|scheduled|active|grace|billing_retry|on_hold|paused|expired|revoked|invalid`; default `all`. `unavailable` is a client failure state and is not filterable membership data. |
| `membership_source` | `all|none|apple|google|admin_grant|legacy_compat`; default `all`. A concrete kind matches when it occurs in `source_kinds`; `none` matches an empty list. It does not imply that the source is currently contributing or Store-verified. |
| `membership_expiry` | `all|has_effective_expiry|no_effective_expiry`; default `all`. This refers only to `effective_expires_at`. |
| `membership_expires_from` | Optional strict UTC instant `YYYY-MM-DDTHH:mm:ssZ`, inclusive. Rows with a null effective expiry do not match. |
| `membership_expires_before` | Optional strict UTC instant `YYYY-MM-DDTHH:mm:ssZ`, exclusive. Rows with a null effective expiry do not match. |

All supplied membership predicates combine with one another and with the existing account/search
predicates using logical AND. `membership_expires_from` must be earlier than
`membership_expires_before` when both are present. Core must reject invalid values with logical
`status_code: 422` and stable machine errors rather than silently broadening the query:

- `membership-tier-filter-invalid`;
- `membership-lifecycle-filter-invalid`;
- `membership-source-filter-invalid`;
- `membership-expiry-filter-invalid`;
- `membership-expiry-range-invalid`.

The response must echo a normalized `membership_filters` object containing all six effective
values. This prevents the console from presenting a filter that an older Core silently ignored.

### Global pagination semantics

Membership resolution and every membership predicate must run before `total`, sort, skip and limit
are calculated. `total` must count the complete combined result, not only matches on the current
page. Existing page size, page numbering and account/search behavior stay unchanged, and the
existing registration-date ordering remains the default.

One server-clock instant must govern resolution for the whole request. Core may satisfy this with a
queryable projection or another server-side plan, but it must account for time-only transitions
(scheduled starts, expiry and grace expiry) before filtering. A stored projection whose
`next_transition_at` is due cannot be treated as current merely because no write occurred. If Core
cannot obtain an authoritative result, the complete request must fail; it must not omit uncertain
rows or label them FREE.

Any queryable projection requires indexes covering the selected implementation and a bounded
performance test over production-scale cardinality. That is a Core storage decision, not a browser
contract. Webadmin must not emulate it by filtering or sorting the 25 already-returned rows.

## Required paid-versus-granted date facts

Core must add these fields to each row's existing `membership` block:

```json
{
  "effective_starts_at": null,
  "first_verified_store_purchase_at": null,
  "first_granted_at": null,
  "legacy_compat_started_at": null
}
```

Every non-null value is a strict UTC `YYYY-MM-DDTHH:mm:ssZ` instant:

- `effective_starts_at` is the Core-resolved start of the current effective access union. It may be
  supplied by Store, administrator or compatibility access and is not itself a purchase date.
- `first_verified_store_purchase_at` is the earliest `first_purchased_at` from a retained Apple or
  Google source whose provider verification is successful. Pending, invalid or merely imported
  evidence cannot populate it. It proves a verified provider transaction timestamp, not a price or
  captured-charge amount.
- `first_granted_at` is the earliest `first_subscribed_at` among the normalized first-class
  administrator sources included in the authoritative resolution. It records when an operator
  issued access and never a payment.
- `legacy_compat_started_at` is the legacy compatibility source start. It never proves Store
  purchase or verification.

Core already stores `first_verified_store_purchase_at` and `first_granted_at` in the internal
first-class entitlement projection. They are not part of the current `list_users` wire and must not
be read from a stale or rollout-disabled projection merely because the fields exist there.

Unknown or unprovable facts must be `null`; Core must not derive them from `tier`, `entitled`, the
legacy `subscribed/paystart` pair, `source_kinds`, or `first_subscribed_at`. No receipt, provider
transaction identifier, token, source ID, raw provider state or operator reason belongs in the list
response.

The existing `first_subscribed_at` remains for backward compatibility but stays aggregate-only.
After all active clients consume these source-specific fields, a separately versioned contract may
rename it to `earliest_source_at`; Webadmin must not perform that wire rename on its own.

## Core verification required before Webadmin filter work

- policy tests for every closed filter value, invalid value and combined predicate;
- boundary tests for inclusive-from/exclusive-before UTC instants and null expiry;
- integration evidence that filtering occurs before count/sort/skip/limit across more than one
  page;
- time-transition tests proving a due scheduled/expired projection cannot remain in the wrong tier;
- source-date tests covering verified Store, unverified Store, admin-only, legacy-only and
  overlapping sources;
- response-shape tests proving no provider or audit secret enters `list_users`.

Only after that additive contract is deployed may Webadmin add server-backed controls. The client
must reset to page 1 when applying them, send their exact values to Core, and render only the echoed
normalized filter state.
