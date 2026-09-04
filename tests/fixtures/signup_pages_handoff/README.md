# Signup pages wire fixture

Status: **real Core corpus, captured from the deployed contract** (was a hand-written handoff
shape until T-671 landed).

`t771-signup-composer-envelopes.json` is a byte-identical copy of

    team/handoffs/t771-signup-composer-envelopes.json
    sha256 ccf0c231a23f0aa9fba621a21c5903f64e9f4941ccbdd7a4a6c70009c90870d3   (103243 bytes)

It is the fourth capture of the same five cases. The chain: T-670 dumped them by calling
`WebadminController::listSignupOptions` / `::saveSignupPageLayout` against a throwaway replica set
with `team/handoffs/t670-signup-composer-envelopes-generator.php`
(sha256 `baea729fe8b44be8f1be290a15d08bd97435bee0d44885f5ff53983ba770e611`) at Core
`7c6e5aaad7829d61f070c27d52860f94569db8ec`; T-689 re-ran it at `4969ae4` after Core began serving
localized gender labels (`Woman`/`Nő`, `Man`/`Férfi`) where the T-670 bodies carried the raw storage
values `woman`/`man` (`team/messages/20260903T012612Z-opus-api-t689-done.md`); T-716 re-ran it at
`672b25e` so the unchanged segment keys carry the neutral gender-plus-audience labels. T-683 pinned
the Webadmin test to the T-689 bytes and asserts those four labels.

**T-771 re-captured at Core `b3a45fb04bc694d4091d5cfdad75d2ff716d8cf4`** (`api` origin/main at capture
time, and an ancestor of it since) with
`team/handoffs/t771-signup-composer-envelopes-generator.php`
(sha256 `c36ff03c42cb22479321721ee119ddfc8f8ad2f278f80865eac0da8bc3a0d5f4`), which is the T-670
generator with its five cases, their order and their inputs unchanged plus ONE seeded difference:
the seven D-019 system rows are inserted into `user_cast_groups` before the read. Every earlier
capture ran against an empty collection, so `catalog.cast_groups` was `[]` in all of them — a wire
value no deployed decoder had ever been exercised on, and precisely the shape that darkened three
admin pages in T-769 (RULES 47). The seeded documents are the same `_id`s, labels, rules and
revisions Core's own `tests/audience_visibility_fixture_dump.php` seeds, and they are INSERTED, so
the capture proves `UserCastGroupService::visibilityRowFromDocument()` accepted them on the read
path the controller takes.

Exactly two things moved beyond the documented per-run values:

| field | T-689 (Core `672b25e`) | T-771 (Core `b3a45fb0`) | why |
|---|---|---|---|
| `catalog.cast_groups` (both `list_signup_options` bodies) | `[]` | the seven D-019 system rows | this re-capture's purpose; deep-equal to `audience_visibility_admin_wire_t669/admin-catalog.json`'s `data.groups`, asserted |
| `catalog.groups` (both `list_signup_options` bodies) | 9 groups | `gender` alone | T-669 retired the legacy identity answers end to end; not this task's change, and the composer never reads the sibling |

Nothing else differs. Re-running this generator against Core `cf0b3790d331352be7e3fb5dc18db91a1f79421e`
(the T-718 release, `api` origin/main at hand-over) reproduces this capture except for the two per-run
values below, and none of the composer path — `WebadminController`, `SignupOptionCatalog`,
`SignupPageCatalog`, `UserCastGroupService`, `AudienceVisibilityPolicy`, `ProfileFieldPolicy`,
`SignupPagePolicy`, `Webadmin`, `Response`, `Request` — moved between the two commits, so these bytes
are the current contract.

The nine-group body is not lost — it stays on the board as
`team/handoffs/t689-signup-composer-envelopes.json`
(sha256 `9ace11ca374d0efc012ab77f4633d02ce7824197d7cbe5707f4b95e4703dc7bc`, 187965 bytes) — and
`tests/audienceVisibilityAdmin.test.mts` still proves the composer decodes identically on the
terminal catalogue, on a nine-key one, on an empty one and with the whole `catalog` sibling removed.

Core has NO committed `list_signup_options` fixture corpus of its own, so this file — not a
Core-side manifest — is the provenance record. `tests/signupPages.test.mts` re-checks the sha256
on every run, so an edited body fails the suite instead of silently drifting from the wire.

Five envelopes, keyed by `<action>.<case>`:

| key | what it is |
|---|---|
| `list_signup_options.empty` | 200, fresh install: revision 0, zero pages |
| `save_signup_page_layout.200` | the accepted save (top-level `revision` beside the whole document) |
| `save_signup_page_layout.409` | `signup-page-conflict`, carrying the current document under `pages` |
| `save_signup_page_layout.422` | `signup-page-layout-refused`, per-item rows under `details.items[]` |
| `list_signup_options.composed` | 200 after the save |

Two values are per-run and must never be equality-checked by a test: the minted `p_<8hex>` page
keys and the `updated_at` epoch.

`t702-looking-for-envelopes.json` is a **byte-identical copy of the REAL Core capture**
published by the T-702 lane, and it REPLACES the hand-written `system-intents-handoff.json`
that T-701 shipped as a placeholder (that file is deleted):

    team/handoffs/t702-looking-for-envelopes.json
    sha256 e66bfba768b636b93ba9cfd9740c8e5178bd0d7c295d2e4ef71a01e0a374deb2   (45696 bytes)

Fourteen envelopes, `core_commit` `4ce08364b4390d3e2dff84249fcd7dbf884496c3`, every one captured
by driving the real controller against a disposable replica set with the committed generator
`tests/t702_looking_for_envelope_dump.php` (`team/messages/20260903T1237Z-opus-api-t702-done.md`).
`tests/signupPages.test.mts` re-checks the sha256 on every run.

Five of those envelopes are what this console reads or writes:

| key | what it is |
|---|---|
| `list_signup_options_system_questions` | the REAL three-row `system_questions` array, `required_min` 0 and `max` 2 on the third row |
| `list_signup_options_system_questions_minimum_one` | the same third row after the owner raises the minimum (`required_min` 1) |
| `save_intents_selection_limits_200` | the accepted D-114 write: the whole intents singleton beside `replayed` |
| `save_intents_selection_limits_409` | `audience-visibility-conflict`, carrying the CURRENT singleton under `data.intents` |
| `save_intents_selection_limits_422` | `audience-visibility-request-invalid`, with NO per-field details — the console derives them |

`register_intents_count_invalid` is pinned too, informationally: it is the member-side 422 the
raised minimum produces, and it is the reason an operator's edit here is not cosmetic. Nothing in
this console reads that route.

The T-702 capture carries only the `system_questions` array, not a whole `list_signup_options`
body, so the composer read under test is that array spliced into the T-771 capture above. That is
not a hand-written body: the test asserts that the T-702 array's FIRST TWO rows are deep-equal to
the T-771 capture's two rows in all three complete payloads, so the splice is provably the same
body Core will serve once the third row is switched on. Those two rows did not move between the
T-689 and the T-771 captures.

To re-capture: re-run the published generator against a throwaway replica set at the Core tip
under test, replace this file, and update the sha256 above and in `tests/signupPages.test.mts`.
Name the replacement after the task that captured it, so the file name records which Core tip
these bytes came from.
