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
