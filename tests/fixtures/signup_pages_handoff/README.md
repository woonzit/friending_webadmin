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

`system-intents-handoff.json` is the **handoff shape until Core T-702 publishes the real
envelope**:

    sha256 79851687152d6193129edb9a03496e586b7b746f4dc9cd2120f77f0b33dfe1b5   (199338 bytes)

It began as a byte-identical copy of `t689-signup-composer-envelopes.json`. The only hand-written
change is one contract-only `intents` System row appended to each of the three complete payloads
(`list_signup_options.empty`, `save_signup_page_layout.200`, and
`list_signup_options.composed`). Each row carries `kind: "system"`, `synthetic: true`,
`required_min: 1`, the binding bilingual title, and the live catalogue's 14 ordered bilingual
options; it deliberately does not pretend to be a Core capture. Tests pin both its bytes and the
fact that every pre-existing envelope member and System row is unchanged.

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

To re-capture: re-run the published generator against a throwaway replica set at the Core tip
under test, replace this file, and update the sha256 above and in `tests/signupPages.test.mts`.
Name the replacement after the task that captured it, so the file name records which Core tip
these bytes came from.
