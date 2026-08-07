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

Create and store two independent long-lived credentials. System service-account runs also mint an ephemeral access token:

| Credential | Purpose | Minimum validation |
| --- | --- | --- |
| `POSTMAN_API_KEY` | Long-lived system service-account PMAK used to mint an access token. | The token resolver can mint a token and resolve the intended team. |
| `POSTMAN_ACCESS_TOKEN` | Ephemeral service-account token used with the PMAK for Postman API reads and workspace-role writes. Do not store it long term. | `doctor` can read the target workspace and `GET /workspace-roles`. |
| `POSTMAN_SCIM_API_KEY` | Looks up, provisions, invites, and reactivates team users. | `doctor` can read `GET /scim/v2/Users`. |

The service account must be assigned to the team that owns the workspace and must have the workspace `Admin` role. The installed workflows exchange its PMAK for a fresh short-lived access token on every run. The doctor command verifies read access; the protected sandbox smoke test is the supported write-permission test.

Never place either long-lived key or the minted access token in repository variables, workflow YAML, scanner JSON, artifacts, command history, or logs. Use GitHub Actions secrets or an equivalent CI secret manager for the long-lived keys and mint the access token at runtime.

## Workspace requirements

- Use a team workspace, not a personal workspace. Postman does not support role assignment on personal workspaces.
- Assign the system service account to the owning team and to the target workspace as `Admin`.
- Confirm the workspace exposes every role requested by the configured map. The defaults are `Admin`, `Editor`, and `Viewer`.
- The API limits workspace role updates to 50 operations per request; the action batches automatically at that limit.
- The action identifies users by SCIM ID and sends `identifierType: scim` on role updates.

Official references:

- [Update workspace roles](https://learning.postman.com/api-docs/api-reference/workspaces/update-workspace-roles)
- [Postman workspace roles](https://learning.postman.com/docs/administration/roles-and-permissions/#workspace-roles)

## Scanner requirements

Every collaborator must resolve to:

- A valid corporate email that corresponds to the person's Postman identity. It can come directly from scanner output or from the configured GitHub-login identity map.

A supported GitHub permission or explicit `workspaceRole`/`postmanRole` produces a stronger or deliberate mapping. When neither is present, the action assigns the inclusive `Viewer` baseline so the collaborator is not dropped.

GitHub profiles frequently omit private email addresses. Deloitte's scanner or identity map must obtain an approved corporate email from its authoritative identity source rather than assuming the public GitHub profile contains one. Unresolved entries are reported and do not block valid contributors unless `scanner.invalidMemberPolicy` is set to `fail`.

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

## Notification gateway

Postman does not guarantee a workspace-assignment email for every identity state. For consistent outreach, configure Deloitte's approved HTTPS mail gateway:

- Store `DELOITTE_NOTIFICATION_WEBHOOK_URL` and the optional `DELOITTE_NOTIFICATION_WEBHOOK_TOKEN` in the CI secret manager.
- Restrict recipients to approved Deloitte domains at the gateway.
- Deduplicate using the supplied `Idempotency-Key`.
- Retain `.deloitte-postman/notifications.json` only under Deloitte's approved policy because it contains email addresses and rendered message bodies.
- Use gateway telemetry—not the action's acceptance count—to confirm final mailbox delivery.

See `docs/deloitte-postman-notifications.md` in the installed starter kit.

## Rotation and recovery

1. Create the replacement key before revoking the old key.
2. Update the CI secret.
3. Run scanner validation and doctor.
4. Run a pull-request preview or protected sandbox smoke test.
5. Revoke the previous key.

For a suspected exposure, rotate immediately, preserve the relevant CI logs, and follow `SECURITY.md`.
