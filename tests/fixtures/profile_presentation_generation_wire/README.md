# Generation console wire fixture (D-122, T-730)

Status: **real Core corpus, captured in-process from Core's own services.**

`t730-generation-console-envelopes.json` is the output of

    team/handoffs/t730-generation-console-envelopes-generator.php
    sha256 fa9e8fc3cbaa6d09ada14e90bc046964a455480ead953ee23e6041ad5ee0d52a

run against Core `dad0df7bd9d3df91e1b4342572e22d39bfa8f8e7` (`api` `main`, which
contains the T-729 tip `8d18f32cefc170c7f4bfdd122b8ef367d2323b68` this console is pinned on) with a disposable
loopback `mongod`. Nothing in it was written by hand: every body is what
`ProfilePresentationAdminService` and `AgeDisplayPolicy` returned.

    sha256 9cacf66a4b1c17053ba4bae79b61a124a90c3376327fa34b2893bd2a35b0f5e3   (13809 bytes)

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

## Known Core gap this corpus makes visible

The corpus was captured by calling `ProfilePresentationAdminService::saveSource`
**directly**, which is also what Core's own `tests/generation_display_storage_test.php`
does. The HTTP transport in front of it,
`WebadminProfilePresentationController::saveSource`, forwards only
`source_key`, `expected_revision`, `labels`, `labels_json`, `icon`, `icon_url`
and `icon_mime` — it does **not** forward `option_icons`, `option_labels`,
`option_labels_json` or the flat `option_icon_<key>_url` / `_mime` pairs. Over
the wire every option field is therefore dropped before
`ProfilePresentationDefinitionCatalog::save()` sees it, the save succeeds, and
"an option the request does not mention keeps what is stored" quietly means
*nothing an operator uploads is ever stored*. Reported with T-730; the console
half is complete and correct against the contract, and starts working the
moment the controller forwards the fields.

## To re-capture

    T730_MONGO_URI=mongodb://127.0.0.1:<your disposable port> \
    T730_CORE_ROOT=<core checkout> \
      php team/handoffs/t730-generation-console-envelopes-generator.php \
        tests/fixtures/profile_presentation_generation_wire/t730-generation-console-envelopes.json

then update the two sha256 values above and the one in
`tests/generationOptionIcons.test.mts`.
