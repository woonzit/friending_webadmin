# Signup pages wire fixture

Status: **real Core corpus, captured from the deployed contract** (was a hand-written handoff
shape until T-671 landed).

`t689-signup-composer-envelopes.json` is a byte-identical copy of

    team/handoffs/t689-signup-composer-envelopes.json
    sha256 6aa8a94c8e510850960621307758c1d1e941627b8ce297ee899ce7b3837e610d   (187713 bytes)

published by the T-689 Core lane, which re-captured the T-670 corpus after Core began serving
localized gender labels (`Woman`/`Nő`, `Man`/`Férfi`) where the T-670 bodies carried the raw
storage values `woman`/`man`. Nothing else changed but the per-run page keys and `updated_at`.
T-683 re-pinned the Webadmin test to it and asserts those four labels. It was dumped by calling
`WebadminController::listSignupOptions` / `::saveSignupPageLayout` against a throwaway replica set
with the published, unchanged generator (`team/handoffs/t670-signup-composer-envelopes-generator.php`,
sha256 `baea729fe8b44be8f1be290a15d08bd97435bee0d44885f5ff53983ba770e611`) — run at Core
`7c6e5aaad7829d61f070c27d52860f94569db8ec` for the T-670 capture and re-run at the T-689 tip
`4969ae4` for this one (`team/messages/20260903T012612Z-opus-api-t689-done.md`).

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
body, so the composer read under test is that array spliced into the T-689 capture above. That is
not a hand-written body: the test asserts that the T-702 array's FIRST TWO rows are deep-equal to
the T-689 capture's two rows in all three complete payloads, so the splice is provably the same
body Core will serve once the third row is switched on.

To re-capture: re-run the published generator against a throwaway replica set at the Core tip
under test, replace this file, and update the sha256 above and in `tests/signupPages.test.mts`.
Name the replacement after the task that captured it, so the file name records which Core tip
these bytes came from.
