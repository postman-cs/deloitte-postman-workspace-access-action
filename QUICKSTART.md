# Deloitte Pipeline Quickstart

This action expects two things from the existing onboarding flow:

1. The ID of the Postman workspace that was created or reused.
2. A JSON collaborator inventory from Deloitte's GitHub scanner.

## Fastest path for Sharooq

Clone the immutable release and install the complete starter kit into Deloitte's pipeline repository:

```bash
git clone --branch v0.3.1 --depth 1 \
  https://github.com/postman-cs/deloitte-postman-workspace-access-action.git

./deloitte-postman-workspace-access-action/scripts/deloitte-init.sh \
  /path/to/deloitte-pipeline
```

The installer adds:

```text
.github/actions/deloitte-postman-workspace-access/  # pinned runnable action
.github/workflows/deloitte-postman-workspace-access.yml  # reusable preview/apply workflow
scripts/deloitte-postman-doctor.sh                  # read-only preflight
docs/deloitte-postman-workspace-access.md           # Sharooq's runbook
docs/deloitte-postman-prerequisites.md              # Postman and scanner checklist
docs/deloitte-postman-sandbox-smoke.md              # controlled tenant test
```

It refuses to overwrite an existing installation. Use `--upgrade` only when intentionally replacing starter-kit-owned files.

## 1. Configure secrets

Store these in the CI platform's secret manager:

- `POSTMAN_API_KEY` — manages roles on the onboarded workspace.
- `POSTMAN_SCIM_API_KEY` — looks up current users and provisions or invites missing users.

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

The action also accepts GitHub's native `permissions` object, known `scimId` values, and explicit `workspaceRole` values. See `examples/deloitte-scanner-output.json` for the full shape.

Name an artifact file `deloitte-github-scanner-output.json`, `github-scanner-output.json`, or `scanner-output.json` and the installed workflow will find it recursively. Multiple matches fail with an explicit error.

## 3A. Reference the released action

Use this when the consumer repository is allowed to run private actions from `postman-cs`:

```yaml
- name: Reconcile Deloitte workspace access
  id: deloitte-access
  uses: postman-cs/deloitte-postman-workspace-access-action@v0.3.1
  with:
    workspace-id: ${{ steps.onboard.outputs['workspace-id'] }}
    members-json: ${{ steps['github-scanner'].outputs['members-json'] }}
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
    postman-scim-api-key: ${{ secrets.POSTMAN_SCIM_API_KEY }}
```

## 3B. Vendor the action into Deloitte's repository

Use this when Deloitte wants the runnable bundle in the same repository as its pipeline:

```bash
git clone --branch v0.3.1 --depth 1 \
  https://github.com/postman-cs/deloitte-postman-workspace-access-action.git

cd deloitte-postman-workspace-access-action
./scripts/vendor-action.sh /path/to/deloitte-service-repo
```

This creates:

```text
.github/actions/deloitte-postman-workspace-access/
  action.yml
  dist/index.cjs
  LICENSE
  README.md
```

The consuming workflow then uses the local path:

```yaml
- uses: actions/checkout@v7
- name: Reconcile Deloitte workspace access
  uses: ./.github/actions/deloitte-postman-workspace-access
  with:
    workspace-id: ${{ steps.onboard.outputs['workspace-id'] }}
    members-file: scanner-output.json
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
    postman-scim-api-key: ${{ secrets.POSTMAN_SCIM_API_KEY }}
```

## 3C. Run from another CI platform

```bash
export POSTMAN_API_KEY
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

## 6. Complete the protected sandbox smoke test

Configure the repository's `postman-sandbox` environment with `POSTMAN_SANDBOX_API_KEY` and `POSTMAN_SANDBOX_SCIM_API_KEY`, then follow `docs/deloitte-postman-sandbox-smoke.md`. Run `preview` first. Invitation mode requires the explicit confirmation `INVITE_DISPOSABLE_USER` and an approved disposable mailbox.
