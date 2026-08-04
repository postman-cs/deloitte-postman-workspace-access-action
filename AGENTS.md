# deloitte-postman-workspace-access-action

Reconciles GitHub scanner collaborator data into Postman workspace membership. Dual entry: GitHub Action (`dist/index.cjs`) and CI-neutral CLI (`dist/cli.cjs`).

## Commands

```bash
npm ci
npm run qa
npm run verify:dist
```

## Behavioral contracts

- Use the public Postman SCIM and workspace-role APIs.
- Keep role IDs dynamic; resolve them from `GET /workspace-roles`.
- Use SCIM IDs with `identifierType: scim` for workspace role writes.
- Provision only users absent from the SCIM lookup.
- Treat a successful SCIM provision followed by a 400/404/409/422 role error as a pending invite.
- Never log Postman or SCIM API keys.
- Preserve dry-run as read-only.
- Preserve doctor mode as GET-only and require both credentials for its preflight.
- Auto-discover scanner output only when exactly one recognized file exists; never guess between candidates.
- Keep role updates idempotent and retryable.
- Rebuild and commit `dist/` whenever runtime source changes.
