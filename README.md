# Lead Router

James's router remains the only production routing and redirect authority.

## Capture-only shadow tee

The optional tee emits a PII-minimized observation after the existing route response is sent. It never returns candidate output, writes GHL, or changes advisor selection.

Required Render variables:

```text
SHADOW_CAPTURE_ENABLED=0
SHADOW_CAPTURE_URL=<authenticated LPG capture endpoint>
SHADOW_CAPTURE_SECRET=<shared HMAC secret>
SHADOW_COHORT_REF=<approved shadow cohort UUID>
SHADOW_CAPTURE_TIMEOUT_MS=1000
```

Deploy with `SHADOW_CAPTURE_ENABLED=0`. Verify `/health`, a synthetic `/route-lead` request, and unchanged `ghl-embed.js` before enabling a bounded canary.

Rollback order:

1. Set `SHADOW_CAPTURE_ENABLED=0` and redeploy or restart.
2. Verify `/route-lead` still returns James's existing response exactly once.
3. If needed, roll Render back to the previous commit.
4. Do not delete captured evidence. It is immutable and can be drained later.

Run tests:

```bash
npm ci
npm test
npm audit --omit=dev
```
