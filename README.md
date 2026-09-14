# Lead Router

Run `npm install`, configure `.env`, and start with `npm start`.
Run the synthetic provider tests with `npm test` on Node.js 18 or newer.
The tests start the real HTTP server with isolated configuration and replace all
provider fetches with synthetic responses. They never call live providers.

## Legacy routing control

`LEGACY_ROUTING_ENABLED` permits legacy routing only when absent or exactly `1`.
Set it to `0` to disable routing. Empty, misspelled, or other values also disable it.

When disabled, new `POST /route-lead` requests return HTTP 503 with
`code: "LEGACY_ROUTING_DISABLED"` before advisor reads, alerts, or writes.
Advisor mutation endpoints return the same refusal after the existing admin
authentication check. Direct advisor create, update, and delete helpers also
refuse writes. Authenticated `GET /advisors`, Meta sync, spend and metrics jobs,
Zoom webhooks, health, and static/admin pages remain available.

`GET /health` reports `status`, `legacyRoutingEnabled`, and `renderGitCommit`.
The release field comes from Render's `RENDER_GIT_COMMIT` and is `null` when that
variable is unavailable. These fields contain no credentials. A healthy process
alone does not prove the intended release and disable setting have been adopted.

## Cutover and rollback

1. At the approved cutover, set `LEGACY_ROUTING_ENABLED=0` on the legacy service
   and redeploy. Keep the existing Airtable advisor table.
2. Wait for the deployment to finish and read back `/health`. Require the exact
   intended `renderGitCommit` and `legacyRoutingEnabled: false`. Confirm a new
   `POST /route-lead` receives the disabled response before switching intake.
3. Promptly switch intake to the new routing path. Brief gaps and completion of
   requests accepted by the previous process are expected during this transition.
   Sustained simultaneous routing by both paths is a deployment defect.
4. Verify the new path's routing and observe the legacy disabled state. Keep the
   shared Meta and Zoom services running.

This switch does not drain old processes or prove their work has completed.
Cached old embeds retain their existing error fallback behavior. If no fallback
URL is configured, a disabled response may leave the visitor without a booking
redirect. This control does not guarantee lossless intake or bridge cached clients
to the replacement.

To roll back, disable replacement routing admission and its effect dispatch,
and verify those controls before setting the legacy flag to `1` and redeploying.
Stopping intake links alone leaves callable replacement endpoints enabled.
Preserve the new router's recovery rules for unresolved counter work throughout
rollback. Verify the intended legacy release and enabled health state before
restoring intake to the legacy path. Brief legacy overlap or gaps remain accepted
during the transition. Reconcile them under the cutover's operational procedure.
