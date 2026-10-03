# Wire corpus pinning and provenance

Webadmin pins a wire corpus's released bodies separately from the provider
provenance recorded in its manifest. The body file hashes, inventory and
`fixture_set_sha256` prove what the browser decodes. `source_commit` proves
which Core revision generated that accepted corpus; it is not a request to
follow every later Core provenance-only rebind.

Consequently, a newer Core manifest is not by itself evidence that Webadmin's
corpus is stale. Do not re-pin solely to make `source_commit` byte-identical.
Re-pin when a task owns that corpus and the body bytes, body inventory,
contract binding or another consumed manifest field changes. A body or
`fixture_set_sha256` change outside the task's scope is a stop-and-review
condition, not a mechanical provenance update.

This rule was already enforced in fixture tests, including
`tests/adminGrantedVerification.test.mts`, but had no home under `docs/` before
T-621.

## T-621 six-corpus decision

At Webadmin `781499a`, all body files in the following six Admin-pinned corpora
are byte-identical to Core `b988f05`. Core's manifests differ only in
`source_commit`, after its provenance rebind. The lead decision is to leave the
Admin manifests and their independently accepted provenance unchanged:

| Corpus | Webadmin-pinned `source_commit` | Core `b988f05` manifest `source_commit` |
|---|---|---|
| `appearance_rules_wire` | `24aae647f976e0f014088d62a088e95c331e126b` | `c513a5fb4e3b7d183b5ab1a5e087ef32401cbc20` |
| `auth_policy_wire` | `2994068b40a7a16d3948baec0d0b13b75659a380` | `c513a5fb4e3b7d183b5ab1a5e087ef32401cbc20` |
| `feature_switches_wire` | `b50432bd04b571f52d6191bd4feac4a6cc376085` | `c513a5fb4e3b7d183b5ab1a5e087ef32401cbc20` |
| `persona_screens_wire` | `8e9a82dce491ab42e26d9339c805868c360ad340` | `c513a5fb4e3b7d183b5ab1a5e087ef32401cbc20` |
| `profile_text_moderation_wire` | `6a8d226aad51bbacebd478d122b6907447e74f5b` | `c513a5fb4e3b7d183b5ab1a5e087ef32401cbc20` |
| `section_availability_wire` | `d9a6c6bab4cd2814e41dd22a1eba24dc0586ae13` | `c513a5fb4e3b7d183b5ab1a5e087ef32401cbc20` |

T-621 records this decision only. It does not modify any corpus body, manifest,
test constant or fixture hash.

## Pin reachability (added 2026-09-04, T-771)

A `source_commit` must be a commit that exists on Core `main` (an ancestor of the published tip), never a lane's
pre-rebase commit. A body can be byte-identical while its pin names a commit no Core release can verify (T-771
found two such pins: a T-669 lane commit and a T-706 lane commit). Verify with
`git -C ../api merge-base --is-ancestor <source_commit> main`; when a pin is unreachable, re-pin to the FIRST
published Core commit whose manifest carries the same `fixture_set_sha256` (Core's own manifest history is the
proof — a blob-equality proof over coarse `source_paths` cannot work for a rebased lane commit), in a
manifest-only commit. Do not re-pin reachable pins just to move the sha (the rule above still stands).

## T-865 coordinated P0 provider/consumer handoff

The task explicitly pins this consumer to the completed Core lane tip
`3f715f3245211c933bfaae53b2398847d42d514e`; publish that provider before this
consumer. `mode_cards_wire` is copied byte-for-byte from that tip, whose manifest
records scoped source `bb3a7d6d1046aa2484d700fe40d592fb5edc4a65`. Only three
fallback subtitle responses change, replacing romantic copy with joining/hosting
activities in EN/HU; the 33-body inventory and decoder shape stay unchanged.

The Dates console also follows that provider's existing four-key activity
catalogue and `active` flags, including old Core's still-active legacy row.
It never newly assigns the retired key, but retains it for existing activities.
The three invite-limit/cooldown settings appear only when Core returns them;
the help panel explicitly marks absent settings as not returned. The additive
`effective_by_storefront` answer remains optional for compatibility with old Core.
Presence retains `date_enabled` and the `date` key; only its EN/HU labels change.

## Dates console pins after D-143 and T-891 (current)

These supersede the P2a figures below; the tests named here are the authority.

| Directory | Provider tip | Bodies | `fixture_set_sha256` | Pinned in |
|---|---|---|---|---|
| `dates_event_intake_admin_wire` | Core lane `opus-core-p2`, `62cee304c68eaeda456ddf0b042cb340b8702d48` (rebased onto Core main `33265e46`; bodies of `8a621565`, manifest rebound on `2034a93a`) | 161 | `4415fcb2f85025205eda028fa1e10591b457355e688627e5f438648843fbe79c` | `tests/datesIntakeWire.test.mts` |
| `dates_external_admin_wire` | Core main `33265e469650a48202eb21c25a171bc2aea09139` (T-891 landed; source `b5118909`) | 138 | `ba9ebf7a93d120d0ecd8c4efc94ce67964cdb2a86c248b3d389d974c4858bae7` | `tests/datesExternalWire.test.mts` |
| `dates_admin_command_wire` | the same branch, commit `754b9eb310016abdcca11584e44ad525a1bee34b` (source `11a999d6`): the 61 command bodies of `33265e46` unchanged, and three evidence reads after a legal hold was placed, amended and released | 64 | `b9b921db4a15684bd4df0d4a9a9e9b8a50dd625c33c472c8e82b415149e2b126` | `tests/datesAdminCommandWire.test.mts` |
| `dates_external_admin_wire_released` | Core main `0721529847602d4298f881119428f0e99eae9d53` | 138 | `d84a3e162703db1578db59f0a0a972de24fffc8562f23a13bf5715101306e4ed` | `tests/datesAdminCompatibility.test.mts` |

`dates_external_admin_wire` is captured without the Admin intake contract selector (D-143) and
equals the released corpus body for body except four bodies, each by one revision value: a legal
hold moves the case revision since T-891, and the capture holds case 01 before resolving it
(`admin-moderation-resolve` and `-resolve-replay` `revision` 3 -> 4, `admin-moderation-detail-closed`
`case.revision` 3 -> 4, `admin-moderation-detail-purged` 3 -> 5). Both tests prove that from bytes.
`dates_admin_command_wire` keeps its requests in Core's generator
(`tests/dates_admin_command_fixture_dump.php`, digest pinned); the tests transcribe each request
they use with its line. The P1 directory is Core main's now (T-891 landed at `33265e46`); the command corpus
comes from commit `754b9eb3` of the lane branch, not yet on Core main: re-pin
to the published commit with the same set digests when it lands.

## T-865 P2a coordinated provider/consumer handoff (T-884 / T-885)

Both corpora are copied byte-for-byte from the Core lane tip
`285b14a87c2e9977130d4b8a0bae19cb8bbb18b9`; both manifests record scoped source
`3d4a0b40c57bc254e8c59480bc06e9f398d6791e`.

`dates_event_intake_admin_wire` (contract `dates-event-intake-admin-v1`): 114 bodies,
`fixture_set_sha256` `fc099c0b960ae628c29a82654a4917eca79611588875e643c1716a13fbd58d14`. The two
`member-*` bodies are the iOS lane's and are vendored only so that the set digest can be recomputed.
Its first pin (Core `06c8c3ea`, 113 bodies, set `fcf9b1ab...54ee`) differs by one new body (the
external list with an AI-assisted row) and by the intake reference appended to the two AI-assisted
details; the pin test takes those out again and checks that the first digest comes back.

`dates_external_admin_wire`: 138 bodies, set
`112db40de1134bffbfebda663b8f4d79e09e9d9e87fc312b3ec7c3c225911958`. Three pins are kept apart in
`tests/datesExternalWire.test.mts`, so that no change can hide behind the newest set digest:

| Against | Changed | Byte-identical |
|---|---|---|
| the previous pin, Core `06c8c3ea` (set `9ac34b0b...29a3`) | 23 bodies, each by one appended key: nine lists (`ai_assisted: false` on every row), thirteen details and the external activity detail (`intake: null`) | 115 |
| the accepted P1 pin, Core `51140a6f` (set `d84a3e16...e4ed`) | those 23, and the two configuration reads (eight intake settings after the 33 P1 rows) | 113 (digest `390d733b...d631`, computed from the P1 manifest at Webadmin `7825bc13`) |

The first row is proven from bytes: removing the one appended key from the raw text of each of the
23 bodies reproduces the previous set digest. All source commits are lane commits until Core
publishes; re-pin to the first published Core commit carrying the same set digests, as the
reachability rule above requires.
