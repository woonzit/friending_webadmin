# Mobile invites console wire fixture (D-124 point 3 / D-126, T-757)

Status: **real Core corpus, captured in-process from Core's own services.**

`t757-invite-configuration-envelopes.json` is the output of

    team/handoffs/t757-invite-configuration-envelopes-generator.php
    sha256 7dd8729b7b01e5a5848efad332783697e837c4aeb15311b4413b19fd9af0cf8e

run against Core **`d47bb451`** (the published T-768 tip: the additive
`attribution` key on `InviteConfigurationService::adminPayload()`, plus its
mechanical caller-census re-pin) with a disposable loopback `mongod`
(RULES 40/43 — own port, own dbPath, own pid file). Nothing in it was written by
hand: every body is what `InviteConfigurationService::adminPayload()` and
`InviteAttributionService::adminSummary()` returned in-process, over rows
written by `InviteAttributionService::record()` and
`::attributeRegistration()` — the real writers.

    sha256 7f4252dc4106343a3c3548cf5182bf24494a88148a927c4a188634543b354f36   (9917 bytes)

`tests/inviteAttribution.test.mts` re-checks that sha256 on every run, so an
edited body fails the suite instead of drifting into the decoder's expectations.

## Blocks

| block | what it is |
|---|---|
| `configuration_with_attribution` | `POST /v1/webadmin/invite_configuration` → `data`: the four configuration keys plus a populated `attribution`. `save_invite_configuration` returns the same `adminPayload()`. |
| `attribution_truncated_limit_2` | `InviteAttributionService::adminSummary(2)` — the page is cut to two senders and `truncated` is `true`, while the totals still describe all nine rows |
| `configuration_with_empty_attribution` | the same envelope with no `invite_matches` rows at all: zeros, both channels still named, `senders` an empty ARRAY |
| `configuration_with_null_attribution` | the fail-soft case — the collection made unreadable, so `attribution` is `null` and the configuration half is served whole |

## The seed, and what each number proves

Four senders, nine rows, both channels, two registrations:

| sender | rows | converted | why it is in the seed |
|---|---|---|---|
| `950101` | 4 (all `device_sms`) | 2 | the busiest sender: first in the served order |
| `950102` | 2 (`server_sms`) | 1 | ties with `950104` on (converted, recorded); the lower uid sorts first |
| `950104` | 2 (one of each) | 1 | the other half of that tie |
| `950103` | 1 (`server_sms`) | 0 | **no `userinfo` row**: the counts stay, `display_name` is `""`, and `last_converted_at` is `0` |

- `recorded` 9 · `converted` 4 · `senders` 4 · `converted_members` **2** — four
  converted ROWS, two distinct members, because each of the two registrations
  converted the rows of two different senders. A console that reported four
  members joining would be wrong by a factor of two.
- `expiring_within_7d` 2, split `device_sms` 1 / `server_sms` 1: two of the four
  unconverted rows were created `RETENTION_SECONDS` minus 2 and 3 days ago, and
  two minus 10 and 15 days. Converted rows have no `expires_at` and are never
  counted.
- The served sender order is `950101, 950102, 950104, 950103` — `converted` desc,
  then `recorded` desc, then uid asc, INCLUDING the uid tie-break.

## Privacy, asserted over the bytes

The generator refuses to write the file if the encoded JSON contains any
recipient number in either shape, any 64-hex run, either converted member's uid,
or the strings `phone_hash` / `converted_uid`. Senders ARE named — they are the
console's subject and the operator already sees them by uid on every other page.
The invited person is a number in a total and nothing else.

No real member data: the four senders, the two registering members and the six
recipient numbers are invented for this capture, and the numbers exist only
inside the throwaway database.

## `generated_at` and the timestamps are capture-time values

`adminPayload()` calls `adminSummary()` with no `$now`, so `generated_at` is the
second the capture ran, and the row timestamps are relative to it (that is the
only way to seed rows that really are inside the seven-day expiry window). The
tests therefore assert the COUNTS and the ORDER from the corpus, and read the
timestamps out of it rather than pinning literals.

## To re-capture

    T757_MONGO_URI=mongodb://127.0.0.1:<your disposable port> \
    T757_CORE_ROOT=<a git-archive extraction of the Core commit, with a cp -R vendor> \
      php team/handoffs/t757-invite-configuration-envelopes-generator.php \
        tests/fixtures/invite_configuration_wire/t757-invite-configuration-envelopes.json

then update the two sha256 values above and the one in
`tests/inviteAttribution.test.mts`.
