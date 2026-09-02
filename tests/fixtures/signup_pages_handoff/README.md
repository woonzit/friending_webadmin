# Signup pages wire fixture

Status: **real Core corpus, captured from the deployed contract** (was a hand-written handoff
shape until T-671 landed).

`t670-signup-composer-envelopes.json` is a byte-identical copy of

    team/handoffs/t670-signup-composer-envelopes.json
    sha256 e28422821ae30a5f23a78b316755743e27d24635ca7237fb1039731c04668d71   (187710 bytes)

published by the T-670 Core landing lane
(`team/messages/20260902T2236Z-opus-api-land-t670-done.md`). It was dumped by calling
`WebadminController::listSignupOptions` / `::saveSignupPageLayout` at Core `main`
`7c6e5aaad7829d61f070c27d52860f94569db8ec` against a throwaway replica set, with the generator
published beside it (`team/handoffs/t670-signup-composer-envelopes-generator.php`,
sha256 `baea729fe8b44be8f1be290a15d08bd97435bee0d44885f5ff53983ba770e611`).

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

To re-capture: re-run the published generator against a throwaway replica set at the Core tip
under test, replace this file, and update the sha256 above and in `tests/signupPages.test.mts`.
