# Postman Prerequisites

Complete this checklist before connecting a Deloitte pipeline to a real workspace.

## Postman plan and identity

- The Postman team must support SCIM provisioning. SCIM is an Enterprise capability.
- SSO must be configured before SCIM is enabled.
- An Admin or Super Admin must enable SCIM and create the SCIM key.
- Prefer keys owned by a dedicated service account so automation does not stop when an employee leaves.

Official references:

- [SCIM provisioning overview](https://learning.postman.com/docs/administration/scim-provisioning/scim-provisioning-overview/)
- [Manage Postman API keys](https://learning.postman.com/docs/administration/managing-your-team/managing-api-keys/)

## Required credentials

Create and store two independent credentials:

| GitHub secret | Purpose | Minimum validation |
| --- | --- | --- |
| `POSTMAN_API_KEY` | Reads the workspace and available roles, then assigns workspace roles. | `doctor` can read the target workspace and `GET /workspace-roles`. |
| `POSTMAN_SCIM_API_KEY` | Looks up, provisions, invites, and reactivates team users. | `doctor` can read `GET /scim/v2/Users`. |

The Postman API key belongs to a Postman identity. That identity must be authorized to manage user roles in the target workspace. The doctor command is the supported permission test; do not validate permissions by attempting an unreviewed production write.

Never place either key in repository variables, workflow YAML, scanner JSON, artifacts, command history, or logs. Use GitHub Actions secrets or an equivalent CI secret manager.

## Workspace requirements

- Use a team workspace, not a personal workspace. Postman does not support role assignment on personal workspaces.
- Confirm the workspace exposes every role requested by the configured map. The defaults are `Admin`, `Editor`, and `Viewer`.
- The API limits workspace role updates to 50 operations per request; the action batches automatically at that limit.
- The action identifies users by SCIM ID and sends `identifierType: scim` on role updates.

Official references:

- [Update workspace roles](https://learning.postman.com/api-docs/api-reference/workspaces/update-workspace-roles)
- [Postman workspace roles](https://learning.postman.com/docs/administration/roles-and-permissions/#workspace-roles)

## Scanner requirements

Every collaborator must have:

- A valid email address that corresponds to the person's Postman identity.
- A supported GitHub permission or explicit `workspaceRole`/`postmanRole`.

GitHub profiles frequently omit private email addresses. Deloitte's scanner must obtain an approved corporate email from its authoritative identity source rather than assuming the public GitHub profile contains one.

Validate the scanner artifact before requesting credentials:

```bash
./scripts/deloitte-postman-doctor.sh validate \
  --scanner-search-root artifacts
```

This performs no network requests and requires no Postman keys.

## Invitation behavior

Postman's [SCIM create-user API](https://learning.postman.com/api-docs/api-reference/scim/create-scim-user) can produce different outcomes:

- A new account is created and activated.
- A matching account on a verified domain is added immediately.
- A matching account outside the verified domain receives a team invitation.
- A user already belonging to another team can return `409 Conflict` when the domain is not verified.

An invited user may need to accept before the workspace role can be assigned. The action reports this as `pending`; rerun after acceptance.

## Rotation and recovery

1. Create the replacement key before revoking the old key.
2. Update the CI secret.
3. Run scanner validation and doctor.
4. Run a pull-request preview or protected sandbox smoke test.
5. Revoke the previous key.

For a suspected exposure, rotate immediately, preserve the relevant CI logs, and follow `SECURITY.md`.
