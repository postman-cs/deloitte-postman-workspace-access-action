# Deloitte Pipeline Quickstart

This action expects two things from the existing onboarding flow:

1. The ID of the Postman workspace that was created or reused.
2. A JSON collaborator inventory from Deloitte's GitHub scanner.

## Fastest path for Sharooq

Clone the immutable release and install the complete starter kit into Deloitte's pipeline repository:

```bash
git clone --branch v0.6.0 --depth 1 \
  https://github.com/postman-cs/deloitte-postman-workspace-access-action.git

./deloitte-postman-workspace-access-action/scripts/deloitte-init.sh \
  /path/to/deloitte-pipeline
```

The installer adds:

```text
.github/actions/deloitte-postman-workspace-access/  # pinned runnable action
.github/workflows/deloitte-postman-workspace-access.yml  # reusable preview/apply workflow
.github/workflows/deloitte-postman-pending-reconcile.yml # optional scheduled completion
.deloitte-postman.yml                             # central, upgrade-safe policy
scripts/deloitte-postman-doctor.sh                  # read-only preflight
docs/deloitte-postman-workspace-access.md           # Sharooq's runbook
docs/deloitte-postman-prerequisites.md              # Postman and scanner checklist
docs/deloitte-postman-sandbox-smoke.md              # controlled tenant test
docs/deloitte-postman-notifications.md               # Deloitte mail-gateway contract
docs/deloitte-postman-onboarding-email.md            # ready-to-review email template
docs/deloitte-postman-logic-app/                     # Office 365 email adapter
```

It refuses to overwrite an existing installation. Use `--upgrade` only when intentionally replacing starter-kit-owned files.

## 1. Configure secrets

Store these in the CI platform's secret manager:

- `POSTMAN_API_KEY` — long-lived system service-account PMAK used to mint a short-lived token.
- `POSTMAN_SCIM_API_KEY` — looks up current users and provisions or invites missing users.
- `DELOITTE_NOTIFICATION_WEBHOOK_URL` — optional approved endpoint that sends the rendered email batch.
- `DELOITTE_NOTIFICATION_WEBHOOK_TOKEN` — optional bearer token for that endpoint.

Do not put either key in the scanner output.

Before requesting credentials, validate the scanner output locally with no network access:

```bash
./scripts/deloitte-postman-doctor.sh validate \
  --scanner-search-root artifacts
```

Review `docs/deloitte-postman-prerequisites.md` before connecting a real team or workspace.

## 2. Produce scanner JSON

The smallest accepted payload is:

```json
{
  "collaborators": [
    { "email": "owner@example.com", "permission": "admin" },
    { "email": "developer@example.com", "permission": "write" },
    { "email": "reviewer@example.com", "permission": "read" }
  ]
}
```

The action also accepts GitHub's native `permissions` object, known `scimId` values, and explicit `workspaceRole` values. Custom GitHub roles fall back to their highest mapped base permission; an otherwise unmapped collaborator receives `Viewer`. Postman SCIM is email-addressed, so a record needs either a corporate email or a GitHub login found in the configured JSON/CSV identity map. See `examples/deloitte-scanner-output.json` for the full shape.

The installed default processes resolvable contributors even when another record lacks an email. Review `unresolved-count` and `unresolved-json`; set `scanner.invalidMemberPolicy: fail` for strict all-or-nothing validation.

Name an artifact file `deloitte-github-scanner-output.json`, `github-scanner-output.json`, or `scanner-output.json` and the installed workflow will find it recursively. Multiple matches fail with an explicit error.

## 3A. Reference the released action

Use this when the consumer repository is allowed to run private actions from `postman-cs`:

```yaml
- name: Mint Postman service-account token
  id: postman_token
  uses: postman-cs/postman-resolve-service-token-action@71bb640cde9e070238b90ab80801c91ce73e0564 # v2.1.1
  with:
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}

- name: Reconcile Deloitte workspace access
  id: deloitte-access
  uses: postman-cs/deloitte-postman-workspace-access-action@v0.6.0
  with:
    workspace-id: ${{ steps.onboard.outputs['workspace-id'] }}
    members-json: ${{ steps['github-scanner'].outputs['members-json'] }}
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
    postman-access-token: ${{ steps.postman_token.outputs.token }}
    postman-scim-api-key: ${{ secrets.POSTMAN_SCIM_API_KEY }}
    postman-workspace-url: ${{ steps.onboard.outputs['workspace-url'] }}
    notification-webhook-url: ${{ secrets.DELOITTE_NOTIFICATION_WEBHOOK_URL }}
    notification-webhook-token: ${{ secrets.DELOITTE_NOTIFICATION_WEBHOOK_TOKEN }}
```

## 3B. Vendor the action into Deloitte's repository

Use this when Deloitte wants the runnable bundle in the same repository as its pipeline:

```bash
git clone --branch v0.6.0 --depth 1 \
  https://github.com/postman-cs/deloitte-postman-workspace-access-action.git

cd deloitte-postman-workspace-access-action
./scripts/vendor-action.sh /path/to/deloitte-service-repo
```

This creates:

```text
.github/actions/deloitte-postman-workspace-access/
  action.yml
  dist/index.cjs
  docs/NOTIFICATIONS.md
  templates/deloitte-postman-onboarding-email.md
  LICENSE
  README.md
```

The consuming workflow then uses the local path:

```yaml
- uses: actions/checkout@v7
- name: Mint Postman service-account token
  id: postman_token
  uses: postman-cs/postman-resolve-service-token-action@71bb640cde9e070238b90ab80801c91ce73e0564 # v2.1.1
  with:
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
- name: Reconcile Deloitte workspace access
  uses: ./.github/actions/deloitte-postman-workspace-access
  with:
    workspace-id: ${{ steps.onboard.outputs['workspace-id'] }}
    members-file: scanner-output.json
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
    postman-access-token: ${{ steps.postman_token.outputs.token }}
    postman-scim-api-key: ${{ secrets.POSTMAN_SCIM_API_KEY }}
```

## 3C. Run from another CI platform

```bash
export POSTMAN_API_KEY
export POSTMAN_ACCESS_TOKEN
export POSTMAN_SCIM_API_KEY

./dist/cli.cjs \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --members-file scanner-output.json
```

The CLI writes JSON to stdout, so the pipeline can archive or inspect the reconciliation result.

## 4. Start with dry run

Set `dry-run: 'true'` or pass `--dry-run`. Dry run performs lookups but sends no invitations and changes no workspace roles.

For the first connection, use the installed doctor. It additionally verifies that both credentials can read the target workspace and team directory:

```bash
./scripts/deloitte-postman-doctor.sh \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --scanner-search-root artifacts
```

## 5. Handle pending invitations

If a user must accept a Postman team invitation before receiving workspace access, the action reports the user as `pending`. Rerun the same step after acceptance; role assignment is idempotent.

Set `fail-on-pending-invites: 'true'` if pending users should block the pipeline. The default is to report them without failing successful onboarding.

The installed reusable workflow adds a human-readable per-user job summary and uploads the complete JSON result as a GitHub Actions artifact.

Enable `.github/workflows/deloitte-postman-pending-reconcile.yml` after setting repository variables `POSTMAN_WORKSPACE_ID` and `DELOITTE_PENDING_RECONCILIATION_ENABLED=true`. It periodically reuses the latest successful scanner artifact so accepted invitations receive their workspace role without a manual rerun. Set `DELOITTE_SCANNER_WORKFLOW` and `DELOITTE_SCANNER_ARTIFACT` repository variables only when the defaults do not match Deloitte's scanner. Manual dispatch remains available before the schedule is enabled.

## 6. Deliver explicit onboarding email

Postman sends a native team invitation only for some identity states. To notify everyone consistently, configure Deloitte's approved mail gateway secrets and pass the exact `postman-workspace-url`. The action renders one HTML/plain-text message per unique scanner email and sends one idempotent batch after reconciliation. Gateway rejection fails the job; dry runs never send.

See `docs/deloitte-postman-notifications.md` for the request contract and `docs/deloitte-postman-onboarding-email.md` for the installed template.

For Office 365, import the installed Logic Apps workflow and bind Deloitte's approved connection. After protecting the trigger and setting an allowed-domain list, run exactly one guarded delivery check:

```bash
export DELOITTE_NOTIFICATION_WEBHOOK_URL
export DELOITTE_NOTIFICATION_WEBHOOK_TOKEN

./.github/actions/deloitte-postman-workspace-access/dist/cli.cjs notify-test \
  --email sharooq@deloitte.com \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --allowed-domain deloitte.com \
  --confirm SEND_TEST_NOTIFICATION
```

## 7. Complete the protected sandbox smoke test

Configure the repository's `postman-sandbox` environment with `POSTMAN_SANDBOX_API_KEY` and `POSTMAN_SANDBOX_SCIM_API_KEY`, then follow `docs/deloitte-postman-sandbox-smoke.md`. Run `preview` first. Invitation mode requires the explicit confirmation `INVITE_DISPOSABLE_USER` and an approved disposable mailbox.
