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
| `dates_event_intake_admin_wire` | Core main `a5bbba5c2d12351e4b012e4a1f3bcdba1d9e359b` (the submission leaderboard; source `7175aabe`, on Core main). Against the pin before it (Core lane tip `62cee304`, not on Core main, set `4415fcb2…`): one body, `admin-configuration.json`, with 74 appended lines | 161 | `a672e1e6462e5d7db462f261ecb932647fe8b05de4f878db164e4aa0ad7ecaca` | `tests/datesIntakeWire.test.mts` |
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

## Third-party pin catalogue (AreYouIn submission system, 2026-10-09)

`dates_external_pins_wire` (contract `dates-external-pins-v1`) is copied byte-for-byte from Core main
`7276444db15d365fce4db334bca6d04b994bc6ce`; its manifest records scoped source
`a356553affc4a2afddad46e5b38345d9d2f34df7`. Ten bodies: nine of the console's two routes
(`dates_external_pins`, `dates_external_pins_save`) and the iOS lane's `member-event-icons.json`, vendored
only so that the set digest can be recomputed. `fixture_set_sha256`
`396410cdfafe787e6b54bc4cc1853ff9a69706e166412e908bed6a7097031bbd`, pinned in
`tests/datesExternalPins.test.mts`, which also checks every body against the sha256 its manifest names.

Two files of that directory are the console's own and not part of Core's corpus: `provenance.txt`, and
`webadmin-pins-save.request`, the parameters of the genuine save, reconstructed from Core's generator
because the corpus does not carry them (the note says how).

Both Core commits were local on Core main when the corpus was copied (two ahead of the published tip). If
Core is rebased before it is published, re-pin as the reachability rule above requires.

## Submission leaderboard settings (2026-10-09)

Two pins, both copied byte-for-byte from Core main `a5bbba5c2d12351e4b012e4a1f3bcdba1d9e359b`; both
manifests record scoped source `7175aabe9268a3e42b2aa832add2049b699a59a4` (on Core main).

`dates_event_intake_admin_wire` is re-vendored: `admin-configuration.json` gains the four
`dates_suggestion_leaderboard_*` rows after the 50 it had (74 lines appended, none changed) and the
manifest follows; the other 160 bodies are the previous pin's, byte for byte. Set
`a672e1e6462e5d7db462f261ecb932647fe8b05de4f878db164e4aa0ad7ecaca` (before:
`4415fcb2f85025205eda028fa1e10591b457355e688627e5f438648843fbe79c`). `tests/datesIntakeWire.test.mts`
proves the difference from bytes: without the appended lines the body has the previous digest, and
with that one digest the previous set digest comes back.

`dates_suggestion_leaderboard_member_wire` (contract `dates-suggestion-leaderboard-v1`) is new: 21
bodies, set `77fe61840ea49a3d0de1bde82f634e3a45c7e80042596d23d29663312bbe40d3`, pinned in
`tests/datesSuggestionLeaderboard.test.mts` with the digest of its manifest and of every body. Six
bodies are the console's: the four leaderboard rows of the configuration read before and after Core's
saves (an excerpt, not a route body), the receipts of two `dates_configuration_save` calls and three
refusals of a bad value. The fifteen `member-*` bodies are the iOS lane's and are vendored only so
that the set digest can be recomputed.

The requests of the two genuine saves are in Core's generator
(`tests/dates_suggestion_leaderboard_member_fixture_dump.php`), form-encoded as `lib/core.ts` encodes
them: `value={"HUN":true}` and `value={"HUN":"city"}`, a storefront map as the JSON text of an
object. That is the form the leaderboard card sends; the test builds both commands from the card's
reducer and settles them with Core's two receipts. What no genuine body carries (a replay of these
saves, the default switch and scope saved, an invalid stored row) is DERIVED there from the genuine
rows and receipts and is marked so.

## Host moderation console corpus (2026-10-11)

`dates_host_moderation_admin_wire` (contract `dates-host-moderation-v1`, Core `docs/EVENT_HOST_MODERATION_V1.md`,
"Console") is copied byte for byte from the git objects of Core
`28439d7e5549e09cf8d663fcb6ff7cc85172decb`, the final tip of Core's `host-moderation` branch; its manifest records
scoped source `50100ad334ca2a0c8d7be2515b3d458361e2a876`, an ancestor of that tip. Fourteen bodies, all the
console's, each with the request that produced it:

| Bodies | What |
|---|---|
| `admin-moderation-queue.json`, `-released` | thirteen cases: wall posts and comments, messages of an event's chat and of a direct thread, members; kept, removed, banned, waiting, and not shown to any host |
| `admin-moderation-detail.json`, `-released` | a wall comment the host kept |
| `admin-moderation-detail-member.json` | a member reported in two events: two `host_reviews` |
| `admin-activity-detail.json` | a whole member-hosted event page, with a banned member and a seat a restriction released |
| `admin-activity-detail-memberships.json` | an excerpt, not a route body: the membership rows of another event, with the selector and as the released console is served them |
| `admin-event-content-wall-posts.json`, `-released`, `-second-event` | a post its author deleted, a post with a link the host removed; a post a moderation decision took down, a photo the host removed |
| `admin-event-content-wall-comments.json`, `-host-erased` | live comments; a comment removed by a host whose account has since been erased |
| `admin-event-content-messages.json` | an event chat with a message the host removed |
| `admin-contract-version-invalid-denied.json` | Core's refusal of another selector value |

A `-released` body is the same read as the released console asks it, without the command contract selector.
`fixture_set_sha256` `abd639fbdd564de36a371dca6bfdf37990064ade00aee0e5bff991ac74ca4127`; the pin is the `PIN` block of
`tests/datesHostModerationWire.test.mts`, which also checks every body against the sha256 its manifest names and the
directory against the manifest's list.

The source commit is on Core's `host-moderation` branch, which was not merged into Core `main` when the corpus was
copied. It satisfies the reachability rule above once that branch is merged as it is. If Core is rebased before it is
published, re-pin to the published commit with the same set digest, with the step below.

Re-vendoring is one step:

```bash
CORE=<Core checkout>; TIP=<the Core commit>; D=tests/fixtures/dates_host_moderation_admin_wire
TMP=$(mktemp -d) && git -C "$CORE" archive "$TIP" "$D" | tar -x -C "$TMP" && cp "$TMP/$D"/* "$D"/
shasum -a 256 "$D/manifest.json"                                   # -> PIN.manifest
grep -m3 -e '"source_commit"' -e '"fixture_set_sha256"' -e '"generator_sha256"' "$D/manifest.json"   # -> PIN.source_commit, PIN.set, PIN.generator
git -C "$CORE" merge-base --is-ancestor "$(sed -n 's/.*"source_commit": "\(.*\)".*/\1/p' "$D/manifest.json")" main && echo reachable
```

then replace the five values of `PIN` (`core` is `$TIP`) and run
`npx tsx --test tests/datesHostModerationWire.test.mts tests/datesCaseLabels.test.mts tests/datesAdminProjection.test.mts`.
A provenance-only re-bind changes `manifest`, `source_commit` and `core` and nothing else. A changed
`fixture_set_sha256` means a body changed: stop and review. (The copy does not remove a file Core has removed; the
pin test compares the directory with the manifest's list and says so.)

The whole event page is the one route body of this corpus whose projection is not the body itself: a membership row
is Core's whole stored row, of which the bridge names ten fields, and the page's reports and decisions are whole
documents that reach the browser as their safe keys and a count of what was withheld. The projection test therefore
does not take it; `tests/datesHostModerationWire.test.mts` holds it to its exact projection.

What no genuine body of this corpus holds is DERIVED in the tests from a genuine body, through the production
decoder, and marked so. After the final capture that is: the negative controls (a body that breaks a rule); a value
the console has no name for (a future surface, state or decision); bodies Core's rule does not produce but the labels
must still say as they are (a case "shown" with no review, a decision that names no host, a surface on a case that is
not about a message); a chat message whose thread Core cannot place (`surface: null`); a member case whose hosts
have all decided; a host removal with nothing kept, kept content without text, a snapshot whose row names no author;
and, of a membership row: a release before or after a host removal, a moderation removal over an older host note, a
removed member whose row names nobody, a ban whose host is not named.
