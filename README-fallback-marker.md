# Independent fallback-use marker

`POST /fallback-use` runs the portable LPG marker in this existing Render service.
It never calls the routing API or a database, touches counters, changes assignedTo,
or runs delayed reconciliation. Unrelated service routes/jobs remain unchanged.

Default: endpoint disabled. Configure `FALLBACK_MARKER_ENABLED=true` only for the
verified isolated Test binding. `FALLBACK_MARKER_PRODUCTION_ENABLED=true` is a
separate Go switch. `FALLBACK_MARKER_CONFIG_JSON` contains the generated nonsecret
LPG independent-marker config. Protected process bindings are `FALLBACK_GHL_TOKEN`,
`FALLBACK_PUBLICATION_SIGNING_KEY`, and `FALLBACK_NATIVE_SIGNING_KEY`. Never place
credential values in this repository or ordinary config JSON.

The HTTP origin must equal the configured native page origin. Requests contain
attemptId, signed publication and optional signed normal reference, never browser
contact IDs or PII. The marker reads complete bounded actual GHL submissions,
authenticates signatures/correlation, and changes only the two configured separate
fallback-use custom fields. Fixed configured advisor and constant outage_fallback
reason make allowed writes idempotent. Existing same fields return verified replay
without PUT, different nonempty values refuse rather than overwrite attribution.
One PUT plus exact readback handles response loss, returning unknown when final
observation is unavailable. No provider CAS, strict exactly-once, or booking-success
claim is made. No pending/final ledger or replica protocol is added.

Canonical implementation: LPG `apps/router/src/application/independent-fallback-marker.ts`.
Build from the reviewed LPG worktree with `node scripts/bundle-fallback-marker.mjs`
inside apps/router, then copy dist/independent-fallback-marker.cjs to
src/vendor/lpg-fallback-marker.cjs. Retain exact source/bundle digests in
src/vendor/lpg-fallback-marker.source.json before publication. Never hand-edit the
vendored bundle. This portable artifact reuses the native token verifier, GHL
submission reader, signed publication schema, and exact GHL marker PUT/readback.

Verification: `node --test tests/fallback-marker.test.js` exercises disabled,
invalid-config and actual HTTP routing using explicit provider fixtures. Hosted
Test acceptance and protected deployment remain separate prerequisites.
