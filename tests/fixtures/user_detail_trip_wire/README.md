# Member trip wire corpus (D-123 / T-749)

`user-detail-trip.json` contains three complete, synthetic-member responses
from `WebadminController::userDetail()` serialized by Core's actual
`Response::send()` path. They were captured from an immutable `git archive main`
at Core `717fe3465a8d4e6d45aca6477f1aa5984098cd03`, which contains T-748
(`4e38cf46`). The archive has a physical vendor copy and the generator checks
that the controller autoloads from that archive.

SHA-256: `ba10a5ac41068f28550d0d4937b2d2741ff38e2bb2bac98510d99545d326e403`
(17,552 bytes). Two independent captures were byte-identical.

The generator is published on the team board at
`handoffs/t749-user-detail-trip-envelopes-generator.php`, SHA-256
`4c82643b96eff09ecf80c27d066a9d52855e04c7db095f185decd8ce0e089862`.
The JSON also records the Core source hashes and frozen evaluation time.

| Case | Stored state and served trip |
|---|---|
| `absent_row` | No row; top-level `trip` is explicitly null. |
| `active` | All eight fields populated, with all six supported intents. |
| `cancelled_hidden_past_travel_off` | Past, cancelled, hidden from locals, empty intents; still served with Travel disabled. |

The corpus test runs the same `userDetail(body, true, true)` decoder as the
member page and renders the shipped `MemberTripPanel` in both locales. Absent
keys and malformed payloads are mutations in `memberTrip.test.mts`, not
claimed as Core output. The controller boundary is captured in process with
a synthetic active owner; this is not a production HTTP/browser capture.

No existing Webadmin corpus contained a complete `user_detail` response.
This dedicated corpus adds that coverage; the similarly named
`admin_granted_verification_wire/compat-user-detail-unselected.json` covers
`verification_user_detail`, a different endpoint, and is unchanged.

To reproduce, export the desired Core commit with `git archive`, copy its
physical vendor tree, and start a disposable loopback Mongo replica set with
a lane-owned dbPath and PID file. Then run:

```text
php <team>/handoffs/t749-user-detail-trip-envelopes-generator.php \
  <core-archive> <core-commit> <owned-dbPath> <loopback-port>
```

The generator verifies the dbPath before use, freezes response evaluation
time, and drops only its PID-named database. Capture stdout as the JSON and
update the corpus hash in `tests/memberTripWire.test.mts` mechanically. It
never loads a Core `.env` file. Normal Webadmin tests need only the committed
JSON, with no PHP, database, team folder or sibling checkout dependency.
