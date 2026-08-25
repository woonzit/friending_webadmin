# Persona Webadmin contract v1

Status: **CLOSED, DORMANT CONTRACT** for Core T-102 and Webadmin T-202.

Provider: Friending Core. Consumer: Friending Webadmin. This document is normative where it uses
**MUST**, **MUST NOT**, **SHOULD**, or **SHOULD NOT**. It describes only the
`/v1/webadmin/*` aliases; native app moderator routes are outside this contract.

## Scope

This contract covers:

- `persona_start_get_config_admin` — read the complete Persona start-screen singleton;
- `persona_start_update_config` — partial update of that singleton;
- `admin_force_persona_verify` — promote a member's current avatar to accepted verification
  evidence;
- `admin_apply_fake_persona` — apply the guarded synthetic Persona marker;
- `admin_revoke_fake_persona` — revoke only that guarded synthetic marker;
- the `persona` capability block emitted by `admin_me`.

These operations do not expose provider keys, provider identity attributes, raw Persona responses,
session tokens, phone ownership, or arbitrary user documents.

## Activation state

The schema version is 1, but Core currently emits `contract_ready=false`. T-202 may implement and
test the typed proxy, parser, editor, previews, and disabled controls, but **MUST NOT** list the
actions in its browser allow-list, show active navigation, or enable a production mutation while
that flag is false.

The reason is explicit: the current compatibility aliases audit before mutation but do not yet use
the shared caller-owned request-id/mutation-receipt primitive assigned to T-108. A later Core patch
must add strict receipt/replay semantics and set `contract_ready=true` before this surface becomes
live. T-202 must use the Core-authored flag rather than a build-time assumption.

## Transport and trust boundary

1. Every action is `POST application/x-www-form-urlencoded` to
   `https://core.friending.com/v1/webadmin/<action>`.
2. The browser **MUST NOT** call Core. The authenticated Next.js same-origin proxy rechecks the
   administrator session, overwrites any caller-supplied identity, and injects exactly one
   server-only `secret` and normalized `admin_email`.
3. Core independently reloads the active `admin_emails` row on every action. A stale browser role
   never grants authority.
4. Viewer may read configuration. Every mutation requires the stored editor capability
   (`admin`/`owner` in the current role model) and a durable audit intent before domain mutation.
5. Logical failures retain HTTP 200; the decoded `status_code` and `error` are authoritative.
6. The current compatibility request carries no browser-supplied `contract_version` or
   `request_id`. The version is negotiated through `admin_me.persona`; strict mutation fields are
   reserved for the receipt follow-up that will flip `contract_ready`.

Decoded success with data is exactly:

```ts
type PersonaAdminDataSuccess<T> = {
  success: true;
  status_code: 200;
  data: T;
  message: 200;
  status: 200;
  can_send: 0;
};
```

Decoded mutation success without data is exactly:

```ts
type PersonaAdminEmptySuccess = {
  success: true;
  status_code: 200;
  message: 200;
  status: 200;
  can_send: 0;
};
```

Decoded failure is exactly:

```ts
type PersonaAdminFailure = {
  success: false;
  status_code: number;
  error: string;
  message: 200;
  status: 200;
  can_send: 0;
};
```

Webadmin response JSON uses the legacy encoder, so slashes and non-ASCII text may be escaped on the
wire. Parsers compare decoded values, not raw spelling. Material `data` objects below are closed;
unknown/missing/wrongly typed material is a failed response.

## Capability model: `admin_me.persona`

The exact additive block is:

```ts
type PersonaAdminCapabilities = {
  contract_version: 1;
  contract_ready: boolean;
  can_read: true;
  can_write: boolean;
  actions: Array<
    | "apply_fake"
    | "revoke_fake"
    | "force_verify"
    | "read_start_config"
    | "write_start_config"
  >;
};
```

For a viewer, `can_write=false` and `actions` is exactly
`["read_start_config"]`. For a current admin/owner, `can_write=true` and the ordered array is
exactly:

```text
[apply_fake, revoke_fake, force_verify, read_start_config, write_start_config]
```

Webadmin **MUST** drive every control from `actions`, recheck the relevant action before each proxy
call, and never infer capability from display role. `contract_ready=false` overrides every mutation
action and keeps the feature dormant.

## Canonical Persona start configuration

Every config read/write success returns one complete object with this exact key set:

- booleans: `active`, `progress_active`, `trust_active`, `safety_active`, `skip_active`;
- number: `progress_value`;
- integers: `header_brand_size`, `title_size`, `subtitle_size`, `benefit_title_size`,
  `benefit_body_size`, `trust_title_size`, `trust_body_size`, `cta_title_size`,
  `secured_text_size`, `about_title_size`, `safety_title_size`, `safety_body_size`,
  `skip_title_size`;
- strings: `header_logo_url`, `header_brand_text`, `header_brand_color`,
  `progress_filled_color`, `progress_track_color`, `title_main`, `title_highlight`,
  `title_color`, `title_highlight_color`, `subtitle_text`, `subtitle_highlight`,
  `subtitle_color`, `subtitle_highlight_color`, `benefit1_icon_url`, `benefit1_icon_name`,
  `benefit1_icon_color`, `benefit1_icon_bg_color`, `benefit1_title`, `benefit1_body`,
  `benefit2_icon_url`, `benefit2_icon_name`, `benefit2_icon_color`,
  `benefit2_icon_bg_color`, `benefit2_title`, `benefit2_body`, `benefit3_icon_url`,
  `benefit3_icon_name`, `benefit3_icon_color`, `benefit3_icon_bg_color`, `benefit3_title`,
  `benefit3_body`, `trust_icon_url`, `trust_icon_name`, `trust_icon_color`,
  `trust_icon_bg_color`, `trust_title`, `trust_body_prefix`, `trust_body_link_text`,
  `trust_body_link_url`, `trust_brand_logo_url`, `trust_card_bg_color`, `trust_text_color`,
  `trust_link_color`, `cta_title`, `cta_icon_name`, `cta_bg_color`, `cta_text_color`,
  `secured_text`, `secured_text_color`, `secured_icon_name`, `about_title`,
  `about_icon_name`, `about_icon_color`, `about_text_color`, `about_pill_bg_color`,
  `about_pill_border_color`, `safety_icon_url`, `safety_icon_name`, `safety_icon_color`,
  `safety_icon_bg_color`, `safety_title`, `safety_body`, `safety_illustration_url`,
  `safety_card_bg_color`, `safety_title_color`, `safety_body_color`, `skip_title`,
  `skip_text_color`, `page_bg_color`.

`{{highlight}}` in title/subtitle copy is a literal renderer marker. An empty image URL means the
preview/client uses the named-icon or local fallback; it is not a parse failure.

## Read: `persona_start_get_config_admin`

Browser-owned request fields: none. The proxy adds `secret` and `admin_email`.

Success is `PersonaAdminDataSuccess<PersonaStartConfig>`. A missing singleton or a Mongo read
failure returns the complete Core default object; the route never returns a partial config or a
false empty success.

The action requires `read_start_config` and an active administrator row. It does not write an audit
row because it is a configuration read.

## Update: `persona_start_update_config`

Browser-owned request fields are one or more keys from `PersonaStartConfig`. A partial update is
allowed. The proxy sends booleans as exact `"1"`/`"0"`, integers/numbers as canonical decimal
strings, and strings as strings. It **MUST NOT** send null, arrays, objects, duplicate fields,
unknown fields, `secret`, or `admin_email` from browser input.

Current compatibility normalization is exact:

- boolean false values are `"0"` or exact lowercase `"false"`; T-202 uses only `"0"`/`"1"`;
- every `*_size` integer is clamped to `8...80`;
- `progress_value` is cast to a JSON number;
- strings are trimmed and capped: URL keys 1000 scalars, color keys 16, icon-name keys 60,
  body keys 600, subtitle keys 400, all other strings 200;
- unknown fields are ignored by Core today; the strict browser nevertheless treats them as a
  client bug and never sends them;
- no recognized field yields `no-fields`.

Success is `PersonaAdminDataSuccess<PersonaStartConfig>` containing the full normalized singleton,
not merely the patch. Webadmin replaces its draft with that canonical returned object.

Before storage mutation, Core records action `persona.start_config.update`; audit details contain
only sorted field names and `field_count`, never the copy, URLs, or color values.

## Force verification: `admin_force_persona_verify`

Browser-owned request:

```ts
type ForcePersonaRequest = { uid: string }; // canonical positive base-10 integer
```

Success data is exactly:

```ts
type ForcePersonaData = { verify_image_url: string };
```

Core reloads the target user, requires a durable current avatar source, replaces that member's
existing `_type=8` verification image with the promoted avatar, and marks Persona accepted. The
returned value is the legacy relative cache path. It leaves phone ownership unchanged and does not
write Profile Video Verification collections.

This is an explicit high-impact operator override. T-202 **MUST** show the target UID/display name,
describe that the current avatar becomes verification evidence, and require a fresh confirmation.
Core records action `persona.force_verify` with the target UID before mutation.

## Apply synthetic marker: `admin_apply_fake_persona`

Browser-owned request is `{ uid: string }`, with the same canonical positive UID rule. Success is
`PersonaAdminEmptySuccess`.

Core refuses a user who already has accepted verification or any non-empty Persona inquiry. If the
same guarded synthetic marker is already present, apply is idempotent and succeeds without changing
the marker. Otherwise it marks the user accepted with an explicitly synthetic, removable marker;
an existing avatar may be used for the compatibility verify-image path. Phone verification remains
unchanged. Core records `persona.fake.apply` with the target UID before mutation.

T-202 **MUST** label this as synthetic/admin-applied and require explicit confirmation. It must not
present the action as a provider-backed identity check.

## Revoke synthetic marker: `admin_revoke_fake_persona`

Browser-owned request is `{ uid: string }`. Success is `PersonaAdminEmptySuccess`.

Core succeeds only when the current verification carries the guarded synthetic marker. It refuses
provider-backed and force-promoted states, clears the synthetic Persona acceptance fields and
compatibility verify path, and leaves phone verification unchanged. Core records
`persona.fake.revoke` with the target UID before mutation.

T-202 **MUST** describe that this removes the member's synthetic verified state and require explicit
confirmation.

## Audit ordering and uncertain responses

Every mutation writes its Core-owned audit intent before calling the domain mutation. An audit
write failure returns `audit-write-failed` and leaves Persona/config state untouched. General audit
rows contain actor email/role, bounded action, target, field-name metadata where applicable, an
internal request id, and timestamp; they do not copy config text, provider payloads, member contact
data, identity attributes, or image bytes.

The current internal audit request id is not a caller-owned idempotency receipt. Until
`contract_ready=true`:

- Webadmin **MUST NOT** automatically retry any mutation after network timeout, 5xx, malformed
  response, or lost connection;
- the operator must reload authoritative configuration/user state before deciding whether to
  issue a new gesture;
- fake apply is state-idempotent, but revoke, force, and config update must still be treated as
  uncertain after a lost response;
- enabling the feature merely because the handlers exist violates this contract.

The receipt follow-up must bind actor, action, target, and normalized material to a caller UUID,
replay the original canonical result, reject payload-conflicting reuse, and prevent duplicate
image replacement/audit/state changes before setting `contract_ready=true`.

## Closed error vocabulary

| Error | Status | Applies to / client behavior |
|---|---:|---|
| `unauthorized` | 401 | server secret absent/mismatched; server configuration failure |
| `admin-session-invalid` | 401 | proxy supplied no valid active administrator identity; sign in |
| `admin-revoked` | 403 | administrator no longer active; sign out |
| `admin-write-required` | 403 | viewer attempted a mutation; refresh capabilities |
| `query-failed` | 500 | administrator/config lookup failure; retry read only |
| `audit-write-failed` | 500 | mutation did not begin; remain dormant/manual recovery |
| `no-fields` | 400 | config patch contained no recognized non-null field |
| `db-write-failed` | 500 | config write failed after audit; reload authoritative config |
| `uid-invalid` | 400 | fake apply/revoke target absent or invalid |
| `uid-missing` | 400 | force target absent or invalid |
| `user-not-found` | 404 | target user absent |
| `already-verified-real` | 409 | fake apply refused accepted/non-empty inquiry state |
| `not-fake-persona` | 409 | fake revoke target is not synthetic |
| `user-has-no-avatar` | 422 | force target has no avatar record |
| `avatar-file-not-found` | 422 | force target avatar source is not durable |
| `copy-failed` | 500 | force image promotion failed; reload before another gesture |
| `mark-failed` | 500 | fake/force mark failed; reload before another gesture |
| `unmark-failed` | 500 | fake revoke failed; reload before another gesture |

Unknown errors map to generic localized failure copy. Only the known authentication/revocation
errors invalidate the browser session. No error is interpreted as a successful mutation.

## T-202 acceptance tests

T-202 must cover exact success/failure parsers, escaped legacy JSON, guest/cross-origin rejection,
server-owned `secret`/`admin_email`, viewer read and mutation denial, action-driven capabilities,
`contract_ready=false` dormancy, full config round-trip, boolean/number serialization, local bounds
and preview, all confirmations, every closed error, no automatic uncertain retry, and proof that no
provider key or identity evidence reaches browser logs/state.
