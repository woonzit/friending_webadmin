# Dates moderation console consumer evidence

`tests/datesModerationConsole.test.mts` pins the entire 29-body provider corpus in
`tests/fixtures/dates_moderation_console_wire`, copied byte-for-byte from Core
`262fba782bc23727a376fe499e8c44512c0de711`. Its generator/runtime source is
`51fcf7e4c2eab33280f314e042788c39c8b534b4`. Publish that provider test commit before
this consumer so the provenance is reachable; the provider changes no runtime
code, route or response shape and needs no migration or data action.

The manifest, source, generator, complete inventory, individual body digests and
set digest are independently pinned. Eleven queue, two SLA, eight command-success
and eight refusal bodies come from actual Core Router/Webadmin dispatches on a
guarded disposable replica set. Core verifies stored leases, revisions, audit
rows and durable receipts before bounded clock/random-ID normalization. Negative
or compatibility variants made by these consumer tests are explicitly synthetic.

The live queue uses `datesModerationQueue` and `datesModerationConsoleSla` from
`lib/datesModerationRead.ts`; successful but malformed metadata, pagination and
logical envelopes fail as an error, never as an empty list. Queue and detail use
the same closed case-row projection. Unknown target labels and zero target UIDs
remain readable; this boundary adds no member-host policy. Counts are not forced
to match rows because Core reads them separately and concurrent changes are real.

Every queue load, including manual Refresh and Retry, owns a generation shared
across renders. A newer load or filter/page effect cleanup invalidates earlier
callbacks before any rows, count, SLA or ready/error state can be installed.
Already-aborted invocations issue no reads and cannot displace a current load.
`tests/datesModerationQueueOrdering.test.mts` executes the actual load and cleanup
callbacks through TypeScript AST extraction with the production decoders and
held pinned Core replies. Its ordering, stale-success/refusal, cleanup and abort
controls are source-handler tests, not a mounted React/browser or live traffic
claim. The control keeps later fresh authority adoptable; no contract or
moderation policy is changed.

Claim, heartbeat, release, note and escalation use a closed audited receipt
boundary before success feedback. The receipt must belong to the requested case,
action and exact next revision, including on replay. It acknowledges the original
command only: a replayed lease can already be expired, and the page still reads
fresh detail instead of applying the receipt as live state. This does not change
request IDs, mutation retries, Core authority, evidence access or role policy.
Resolve, trail-evidence and legal-hold flows remain unchanged.

The existing nine-body `dates_moderation_wire` metadata/evidence corpus and its
privacy/conflict/hold tests remain independently pinned and unchanged. No new
EN/HU copy or moderation product decision is introduced.

```sh
npm ci
npx tsx --test tests/datesModerationQueueOrdering.test.mts tests/datesModerationConsole.test.mts tests/datesModerationRead.test.mts tests/datesAdmin.test.mts tests/localizationParity.test.mts
npm test
npm run typecheck
npm run build
```
