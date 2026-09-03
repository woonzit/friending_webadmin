# Into-tag moderation wire fixture

Status: **real Core corpus, captured from the deployed contract.**

`t682-into-tag-moderation-envelopes.json` is a byte-identical copy of

    team/handoffs/t682-into-tag-moderation-envelopes.json
    sha256 42bf71bcd5178e9579dbb8118cc9c21d60ef769fd30a35f05cc46786b61ba1ce   (95935 bytes)

published by the T-682 Core lane for contract `into-tag-moderation-v1` (D-107). Every body in it
is the exact bytes the production controller served through the production encoder at Core
`01f2383b68c891d91950189e3c658f3547db3064`; none was written by hand. It was produced by the
generator published beside it (`team/handoffs/t682-into-tag-moderation-envelopes-generator.php`)
over Core's own committed corpus `api/tests/fixtures/into_tag_moderation_wire`
(`fixture_set_sha256` `389a9612d3ad04f9c759f52bd07567fc67575bfa7da2546c4e1b0861bf99b6cf`).

`tests/intoTagModeration.test.mts` re-checks the sha256 on every run, so an edited body fails the
suite instead of drifting into the decoder's expectations.

Two blocks:

| block | what it is |
|---|---|
| `webadmin_actions` | the three receipted moderation actions plus the `save_profile_tag_catalog` moderation lock — request fields and every 200/404/409/422/401/403 body |
| `member_routes` | the member-facing search/create/catalogue/selection reads, for provenance; this console never calls them |

Four facts the corpus pins that the design prose alone would not:

- the Webadmin bodies carry the legacy V1 compatibility trio (`message`/`status`/`can_send`),
  because Core builds them with `Webadmin::noStoreReply` to stay byte-identical with the legacy
  webadminapi;
- `next_cursor` is the **empty string** on the last page, never `null`;
- `principal.capabilities` arrives read-first (`into_tag_moderation_read`, then
  `into_tag_moderation`), which is not lexicographic order;
- the audit receipt is derivable: `wai:` + `sha256("into_tag_moderation" NUL <request_id>)`, so a
  receipt can be checked against the request the browser actually sent.

To re-capture: re-run the published generator at the Core tip under test, replace this file, and
update the sha256 above and in `tests/intoTagModeration.test.mts`.
