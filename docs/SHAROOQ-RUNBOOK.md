# Deloitte Workspace Access Runbook

This is Sharooq's operating path for adding GitHub scanner users to a Postman workspace.

## One-time setup

Add these GitHub Actions secrets to the Deloitte pipeline repository:

- `POSTMAN_API_KEY`
- `POSTMAN_SCIM_API_KEY`
- `DELOITTE_NOTIFICATION_WEBHOOK_URL` (optional until Deloitte's mail gateway is ready)
- `DELOITTE_NOTIFICATION_WEBHOOK_TOKEN` (optional bearer credential)

The installer creates a local action, a reusable workflow, a notification template, and a doctor command. Do not store credentials in a repository variable, scanner artifact, or log.

Before credentials are available, validate the scanner artifact without network access:

```bash
./scripts/deloitte-postman-doctor.sh validate \
  --scanner-search-root artifacts
```

Read `docs/deloitte-postman-prerequisites.md` for the complete Postman and scanner checklist.

## Verify before the first run

From the consumer repository:

```bash
export POSTMAN_API_KEY
export POSTMAN_SCIM_API_KEY

./scripts/deloitte-postman-doctor.sh \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --scanner-search-root artifacts
```

Doctor mode checks the workspace, both credentials, scanner contract, user lookups, and role mapping. It sends only `GET` requests and never invites users or changes workspace access.

Recognized scanner filenames are:

- `deloitte-github-scanner-output.json`
- `github-scanner-output.json`
- `scanner-output.json`

The action searches recursively. If more than one recognized file exists, set `members-file` explicitly rather than risking the wrong inventory.

## Add the reusable workflow to Deloitte's pipeline

If the scanner uploads an artifact, add this job after the existing onboarding and scanner jobs. Replace the two job IDs and output names with Deloitte's actual values:

```yaml
  deloitte-workspace-access:
    needs: [onboard, github-scanner]
    uses: ./.github/workflows/deloitte-postman-workspace-access.yml
    with:
      workspace-id: ${{ needs.onboard.outputs['workspace-id'] }}
      scanner-artifact: ${{ needs['github-scanner'].outputs['artifact-name'] }}
      postman-workspace-url: ${{ needs.onboard.outputs['workspace-url'] }}
      apply: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
      fail-on-pending-invites: false
    secrets: inherit
```

This gives Sharooq a read-only preview on pull requests and applies the same plan after merge to `main`.

Each run adds a per-user remediation table to the job summary and uploads the reconciliation and rendered-email JSON as a retained Actions artifact. Apply runs send the batch when `DELOITTE_NOTIFICATION_WEBHOOK_URL` is configured; previews render messages with `send: false` but never call the gateway.

If the scanner writes its JSON into the checked-out workspace instead of an artifact, omit `scanner-artifact`. The action will find the file automatically.

## Understand a run

The GitHub job summary lists every user and one of these outcomes:

- `added`: workspace access was assigned.
- `would-add`: preview only; no write occurred.
- `pending`: Postman invited the user, but workspace access must wait for acceptance.
- `failed`: the entry needs intervention.

Lifecycle values explain what happened to the team user:

- `existing` or `provided-scim-id`: current user.
- `reactivated`: inactive user restored.
- `provisioned`: missing user invited or created.
- `would-reactivate` or `would-provision`: preview of a planned action.

## Fix common failures

| Symptom | What Sharooq should do |
| --- | --- |
| No scanner output found | Confirm the scanner artifact was downloaded or rename its JSON to one of the recognized filenames. |
| Multiple scanner outputs found | Remove stale artifacts or pass one exact `members-file` path in a direct action step. |
| Unknown GitHub permission | The user receives the `Viewer` baseline. Include native `permissions`, add the custom role to `role-map-json`, or emit `workspaceRole` only when the user should receive stronger access. |
| No GitHub permission | No intervention is required; the inclusive baseline assigns `Viewer`. Use `default-workspace-role` only if Deloitte approves a different baseline. |
| Workspace role is unavailable | Confirm the Postman workspace exposes `Admin`, `Editor`, and `Viewer`, or update the role map. |
| `401` or `403` from Postman | Rotate the affected secret and confirm it belongs to an account authorized for the workspace/team. |
| Invitation is pending | Ask the user to accept the Postman team invite, then rerun the same job. |
| One user fails after a batch retry | Use that user's error in the job summary; successful users have already been handled idempotently. |
| Notification gateway rejects the batch | Review the gateway policy and `.deloitte-postman/notifications.json`; the action fails instead of silently dropping email. |

## Notification operations

The email transport is deliberately owned by Deloitte. The action sends a vendor-neutral JSON batch containing the recipient, subject, plain text, escaped HTML, workspace role, and lifecycle status. The gateway must return `2xx` only after accepting the whole batch.

Use `notification-delivered-count` to confirm gateway acceptance and the mail gateway's own telemetry to confirm final mailbox delivery. The installed `docs/deloitte-postman-notifications.md` contains the complete contract and `docs/deloitte-postman-onboarding-email.md` contains the message template.

## Upgrade

Run the newer release's installer with `--upgrade`. It overwrites only the files owned by this starter kit:

```bash
./scripts/deloitte-init.sh /path/to/deloitte-pipeline --upgrade
```

Run doctor again, review the pull-request preview, and merge only after it matches the expected access plan.

For the final tenant-level test, follow `docs/deloitte-postman-sandbox-smoke.md`. The protected workflow uses separate sandbox secrets and refuses invitation mode without explicit confirmation.
