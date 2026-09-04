# Generation console wire fixture (D-122, T-730)

Status: **real Core corpus, captured in-process from Core's own services.**

`t730-generation-console-envelopes.json` is the output of

    team/handoffs/t730-generation-console-envelopes-generator.php
    sha256 fa9e8fc3cbaa6d09ada14e90bc046964a455480ead953ee23e6041ad5ee0d52a

run against Core `b60cf6bf483116b375fff92e1fcc8add9584fa20` (the T-762 transport
fix stacked after T-759 and the T-729 source contract) with a disposable loopback
`mongod`. Nothing in it was written by hand: every body is what
`ProfilePresentationAdminService` and `AgeDisplayPolicy` returned.

    sha256 2cfa78253a02add9fab538435ce4280f6de7848a84fe3aaeb2e7c75c2b19dd57   (13809 bytes)

`tests/generationOptionIcons.test.mts` re-checks that sha256 on every run, so an
edited body fails the suite instead of drifting into the decoder's expectations.

## Blocks

| block | what it is |
|---|---|
| `presentation_seeded` | `POST /v1/webadmin/profile_presentation` → `data.sources.builtins`, the `generation` entry and a `work` entry, with nothing saved |
| `save_four_icons_structured` | the four uploads posted in the STRUCTURED shape, and the source Core served back |
| `save_labels_only` | the next save, mentioning no option at all — the four uploads survive it |
| `save_clear_one_icon` | clearing exactly one icon, explicitly, with an empty `url` |
| `refusals` | `profile-presentation-icon-unmanaged`, `profile-presentation-source-definition-invalid`, `profile-presentation-source-conflict` with their status codes |
| `member_page_facts` | `age_display` / `birthday_locked` / `realdob` for five member shapes, from the policy `WebadminController::userDetail` assigns verbatim |

## Four facts the corpus pins that the design prose does not

- **A source without a per-value vocabulary sends `[]`, not nothing.**
  `reports/t729-age-generation/envelope-shapes.md` says such a source "omits
  these blocks entirely". It does not:
  `ProfilePresentationDefinitionCatalog::definitions()` writes
  `'option_labels' => self::OPTION_DEFINITIONS[$key] ?? []` and
  `'option_icons' => self::emptyOptionIcons($key)` on **every** builtin, and an
  empty PHP array encodes as a JSON **array**. So `work` arrives as
  `"option_labels": [], "option_icons": []`. The console's discriminator is
  therefore "non-empty map", not "key present", and the decoder reads absent,
  `[]` and `{}` as the same thing.
- **The option maps survive a save that does not mention them.** `save_labels_only`
  raises the revision to 2 and still serves all four uploads; that is the rule
  the console's diffing save body exists to honour.
- **An option key the source does not define is a refusal, not a silent drop** —
  `profile-presentation-source-definition-invalid`, 422.
- **`realdob` absent means CONFIRMED.** `AgeDisplayPolicy::birthdayConfirmed`
  returns `true` when the key is missing, which is the opposite of what a
  missing boolean usually implies; `hidden_no_birthday_realdob_absent` pins it.

## Core transport proof

The corpus deliberately captures the service contract. T-762 additionally
pins the HTTP boundary in Core's `tests/generation_display_storage_test.php`:
`WebadminProfilePresentationController::saveSource` forwards the structured
`option_icons`, `option_labels`, `option_labels_json`, and flat
`option_icon_<key>_url` / `_mime` forms. That route-level test uses the JSON
strings produced by Webadmin's form encoder, verifies the saved icon in the
returned admin projection, and proves that an unmentioned icon stays stored.

## To re-capture

    T730_MONGO_URI=mongodb://127.0.0.1:<your disposable port> \
    T730_CORE_ROOT=<core checkout> \
      php team/handoffs/t730-generation-console-envelopes-generator.php \
        tests/fixtures/profile_presentation_generation_wire/t730-generation-console-envelopes.json

then update the two sha256 values above and the one in
`tests/generationOptionIcons.test.mts`.
