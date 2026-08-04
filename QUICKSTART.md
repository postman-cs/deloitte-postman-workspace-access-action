# Deloitte Pipeline Quickstart

This action expects two things from the existing onboarding flow:

1. The ID of the Postman workspace that was created or reused.
2. A JSON collaborator inventory from Deloitte's GitHub scanner.

## 1. Configure secrets

Store these in the CI platform's secret manager:

- `POSTMAN_API_KEY` — manages roles on the onboarded workspace.
- `POSTMAN_SCIM_API_KEY` — looks up current users and provisions or invites missing users.

Do not put either key in the scanner output.

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

## 3A. Reference the released action

Use this when the consumer repository is allowed to run private actions from `postman-cs`:

```yaml
- name: Reconcile Deloitte workspace access
  id: deloitte-access
  uses: postman-cs/deloitte-postman-workspace-access-action@v0.1.0
  with:
    workspace-id: ${{ steps.onboard.outputs.workspace-id }}
    members-json: ${{ steps.github-scanner.outputs.members-json }}
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
    postman-scim-api-key: ${{ secrets.POSTMAN_SCIM_API_KEY }}
```

## 3B. Vendor the action into Deloitte's repository

Use this when Deloitte wants the runnable bundle in the same repository as its pipeline:

```bash
git clone --branch v0.1.0 --depth 1 \
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
- uses: actions/checkout@v4
- name: Reconcile Deloitte workspace access
  uses: ./.github/actions/deloitte-postman-workspace-access
  with:
    workspace-id: ${{ steps.onboard.outputs.workspace-id }}
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

## 5. Handle pending invitations

If a user must accept a Postman team invitation before receiving workspace access, the action reports the user as `pending`. Rerun the same step after acceptance; role assignment is idempotent.

Set `fail-on-pending-invites: 'true'` if pending users should block the pipeline. The default is to report them without failing successful onboarding.
