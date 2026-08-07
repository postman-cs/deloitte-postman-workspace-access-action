# Deloitte Postman Workspace Access Action

Plug-and-play workspace membership for API onboarding pipelines. Feed the action the workspace ID produced by onboarding and the collaborator inventory produced by a GitHub scanner. It will:

1. Map GitHub repository permissions to Postman workspace roles.
2. Resolve current Postman team members by SCIM ID or email.
3. Provision or invite users who are not current team members.
4. Assign the resolved users to the onboarded workspace.
5. Render a Deloitte onboarding email for every detected collaborator and optionally deliver the batch through Deloitte's approved mail gateway.
6. Keep valid contributors moving while reporting missing identities for remediation.
7. Return machine-readable reconciliation, notification, and adoption metrics for later pipeline steps.

The implementation uses the public Postman [SCIM create-user API](https://learning.postman.com/api-docs/api-reference/scim/create-scim-user) and [workspace-role API](https://learning.postman.com/api-docs/api-reference/workspaces/update-workspace-roles). Workspace role updates use SCIM IDs, so the scanner never needs to know Postman-internal user IDs.

For a customer handoff, start with [QUICKSTART.md](QUICKSTART.md). Sharooq's one-command installer adds the pinned action, reusable workflow, read-only doctor, and operations runbook to Deloitte's pipeline repository. See [BUILD_LOG.md](BUILD_LOG.md) for the release gates and verification evidence.

## Sharooq's golden path

```bash
git clone --branch v0.6.0 --depth 1 \
  https://github.com/postman-cs/deloitte-postman-workspace-access-action.git

./deloitte-postman-workspace-access-action/scripts/deloitte-init.sh \
  /path/to/deloitte-pipeline
```

Then set the system service account's long-lived `POSTMAN_API_KEY` and the separate `POSTMAN_SCIM_API_KEY` as GitHub Actions secrets. The installed workflows mint a fresh short-lived access token for every run; don't store that token as a long-lived secret. To send an explicit email to every detected collaborator, also set `DELOITTE_NOTIFICATION_WEBHOOK_URL` and, when required by the gateway, `DELOITTE_NOTIFICATION_WEBHOOK_TOKEN`. Run the installed read-only preflight with a freshly minted `POSTMAN_ACCESS_TOKEN` in the environment:

```bash
cd /path/to/deloitte-pipeline
./scripts/deloitte-postman-doctor.sh \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --scanner-search-root artifacts
```

The installer also creates `.deloitte-postman.yml`, a scheduled pending-access workflow, and a Microsoft Logic Apps email adapter. The installed runbook contains the caller job Sharooq adds after Deloitte's onboarding and GitHub scanner jobs. Pull requests preview the access plan; pushes to `main` apply it.

Before requesting either credential, validate the scanner artifact locally:

```bash
./scripts/deloitte-postman-doctor.sh validate \
  --scanner-search-root artifacts
```

Validation checks identities and permission mapping, normalizes duplicate emails, and reports resolved, unresolved, and excluded contributors without making a network request.

Edit `.deloitte-postman.yml` once to set the scanner location, identity map, exclusions, onboarding links, and notification domains. Intentional local configuration is preserved by `upgrade`; repository variables control the scheduled pending-reconciliation workflow.

## Fastest integration

```yaml
- name: Mint Postman service-account token
  id: postman_token
  uses: postman-cs/postman-resolve-service-token-action@71bb640cde9e070238b90ab80801c91ce73e0564 # v2.1.1
  with:
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}

- name: Onboard API into Postman
  id: onboard
  uses: postman-cs/postman-api-onboarding-action@v3
  with:
    project-name: ${{ github.event.repository.name }}
    spec-path: openapi.yaml
    postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
    postman-access-token: ${{ steps.postman_token.outputs.token }}

- name: Reconcile workspace access
  id: access
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

The release tag is immutable. Deloitte can also vendor the self-contained action bundle into its own repository if direct private-repository access isn't available.

When neither `members-json` nor `members-file` is supplied, the action recursively finds one uniquely named `deloitte-github-scanner-output.json`, `github-scanner-output.json`, or `scanner-output.json`. It fails safely when none or multiple are present.

## Scanner contract

The scanner can emit a bare array, `{ "members": [...] }`, or `{ "collaborators": [...] }`.

```json
{
  "collaborators": [
    {
      "login": "octocat",
      "email": "octocat@example.com",
      "permission": "admin",
      "externalId": "github-user-583231"
    },
    {
      "login": "hubot",
      "email": "hubot@example.com",
      "permissions": {
        "admin": false,
        "maintain": false,
        "push": true,
        "triage": true,
        "pull": true
      }
    },
    {
      "email": "existing@example.com",
      "scimId": "405775fe15ed41872a8eea4c8aa2b38cda9749812cc55c99",
      "workspaceRole": "Viewer"
    }
  ]
}
```

Required per person:

- A valid `email`, either emitted directly by the scanner or supplied through the configured login-to-email identity map.

Optional fields:

- `scimId` skips the SCIM lookup for a known current user.
- `login` or `externalId` becomes the SCIM external ID when a user must be provisioned.
- `givenName`, `familyName`, and `displayName` improve the invitation profile.
- Snake-case versions of the fields are accepted.

Duplicate emails are collapsed case-insensitively and the strongest requested role wins.

By default, one malformed scanner record does not block everybody else. `invalid-member-policy: continue` processes valid contributors and exposes each unresolved identity through `unresolved-json`, `unresolved-count`, `metrics-json`, the CLI report, and workflow artifacts. Set the policy to `fail` when Deloitte wants strict all-or-nothing validation. Bot accounts and approved service logins can be excluded explicitly; they remain counted and auditable.

## Default role mapping

| GitHub permission | Postman workspace role |
| --- | --- |
| `admin` | Admin |
| `maintain`, `write`, `push` | Editor |
| `triage`, `read`, `pull` | Viewer |
| Unmapped or missing permission | Viewer |

GitHub custom repository roles are supported without dropping collaborators. If `role_name` has an explicit entry in `role-map-json`, that mapping wins. Otherwise the action examines every `true` value in GitHub's native `permissions` object and uses the highest mapped base permission. If no mapped permission is available, the inclusive `default-workspace-role` baseline assigns `Viewer`. Postman receives one effective workspace role per user, as required by the workspace-role API.

Extend or override individual mappings with `role-map-json`; omitted standard permissions keep their defaults:

```yaml
role-map-json: '{"admin":"Admin","write":"Editor","read":"Viewer"}'
```

The action resolves Postman's current role IDs dynamically from `GET /workspace-roles`; IDs are not hard-coded.

## Existing users versus invitations

- If the input includes `scimId`, the action assigns the workspace role directly.
- Otherwise, it looks up the email with the Postman SCIM API.
- An existing but inactive SCIM user is reactivated before workspace access is assigned.
- When no team user exists, it calls `POST /scim/v2/Users`.
  - A matching Postman account receives a team invitation when the domain is not auto-verified.
  - A user in a verified domain can be added immediately.
  - A brand-new account is activated for the Postman team.
- The action then attempts the workspace assignment. If Postman requires invitation acceptance first, the result is `pending`; rerunning the action after acceptance completes the assignment safely.

The workspace-role API is idempotent, so the step can run on every onboarding execution.

## Guaranteed notification handoff

Postman's native email behavior differs by lifecycle, so this action also renders a consistent Deloitte onboarding message for every unique scanner email. The message explains why the user was onboarded, their workspace role, their next step, the workspace link, and practical ways to start using Postman.

- `notifications-file` writes the complete plain-text and HTML email batch for audit or downstream delivery.
- `notification-webhook-url` sends the eligible batch to Deloitte's approved HTTPS mail gateway.
- `notification-webhook-token` supplies an optional bearer token and is always masked.
- Dry runs render preview messages with `send: false` and never call the gateway.
- Configured gateway rejection fails the action; transient responses are retried with an idempotency key.

See [the notification gateway contract](docs/NOTIFICATIONS.md) and [the human-readable email template](templates/deloitte-postman-onboarding-email.md). The action confirms gateway acceptance, not downstream mailbox delivery; Deloitte's gateway remains responsible for domain policy, final sending, and delivery telemetry.

The starter kit includes a Microsoft Logic Apps definition for Office 365 delivery. Before enabling it, Deloitte binds its approved shared-mailbox connection, protects the HTTP trigger, and sets `notification.allowedDomains` in `.deloitte-postman.yml`. A guarded `notify-test` command requires an explicit confirmation token and sends to exactly one address.

## Generic CI / CLI

The bundle also exposes a CI-neutral executable:

```bash
export POSTMAN_API_KEY="${POSTMAN_API_KEY}"
export POSTMAN_ACCESS_TOKEN="${POSTMAN_ACCESS_TOKEN}"
export POSTMAN_SCIM_API_KEY="${POSTMAN_SCIM_API_KEY}"
export DELOITTE_NOTIFICATION_WEBHOOK_URL="${DELOITTE_NOTIFICATION_WEBHOOK_URL}"
export DELOITTE_NOTIFICATION_WEBHOOK_TOKEN="${DELOITTE_NOTIFICATION_WEBHOOK_TOKEN}"

npx --yes github:postman-cs/deloitte-postman-workspace-access-action \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --members-file scanner-output.json \
  --postman-workspace-url "${POSTMAN_WORKSPACE_URL}" \
  --notifications-file .deloitte-postman/notifications.json
```

The CLI writes the reconciliation summary to stdout and operational messages to stderr. Exit code `1` indicates failed entries. With `--fail-on-pending-invites`, exit code `2` indicates pending invitations.

## Dry run

```yaml
with:
  workspace-id: ${{ steps.onboard.outputs['workspace-id'] }}
  members-file: scanner-output.json
  postman-api-key: ${{ secrets.POSTMAN_API_KEY }}
  postman-access-token: ${{ steps.postman_token.outputs.token }}
  postman-scim-api-key: ${{ secrets.POSTMAN_SCIM_API_KEY }}
  dry-run: 'true'
```

Dry run performs role and user lookups but does not provision users or modify workspace access.

## Doctor

The CI-neutral CLI includes a stricter preflight:

```bash
postman-workspace-access doctor \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --scanner-search-root artifacts
```

Doctor verifies the target workspace, Postman and SCIM credentials, scanner contract, user resolution, and role map. It issues only read-only requests and returns a machine-readable plan.

See [Postman prerequisites](docs/POSTMAN-PREREQUISITES.md) for the plan, service-account, workspace, scanner-email, and credential requirements.

## Outputs

- `summary-json` — Complete reconciliation result.
- `added-count` — Users assigned a workspace role.
- `invited-count` — Users submitted to SCIM for provisioning or invitation.
- `pending-count` — Invited users who must accept before workspace access can be assigned.
- `skipped-count` — Planned operations in dry-run mode.
- `failed-count` — Entries that failed.
- `detected-count` — Raw scanner contributor records.
- `resolved-count` — Unique contributors eligible for onboarding.
- `unresolved-count` / `unresolved-json` — Records needing identity or role remediation.
- `excluded-count` — Intentionally excluded bot or service records.
- `scanner-source` — The exact scanner input selected by discovery.
- `config-source` — The configuration file selected by the action.
- `summary-file` — The JSON report path when `summary-file` is configured.
- `notification-count` — Messages rendered for detected collaborators.
- `notification-eligible-count` — Messages eligible for delivery; previews are excluded.
- `notification-delivered-count` — Messages accepted by the configured Deloitte gateway.
- `notifications-file` — The rendered plain-text and HTML email batch.
- `metrics-json` — Scanner resolution, workspace access, and notification adoption counts.

The reusable workflow always uploads the JSON report as a retained GitHub Actions artifact. Its job summary shows outcome counts and a per-user remediation table.

The optional scheduled workflow reuses the latest successful scanner artifact to complete workspace role assignment after users accept invitations. It intentionally omits the notification gateway so recipients are not repeatedly emailed.

## Protected live smoke test

The manual `Postman sandbox smoke test` workflow provides the final tenant-level validation. It uses a dedicated `postman-sandbox` environment and separate sandbox secrets, always previews first, and requires the exact confirmation `INVITE_DISPOSABLE_USER` before it can invite an approved disposable address. See [the sandbox smoke guide](docs/SANDBOX-SMOKE.md).

## Release integrity and external handoff

Every release contains:

- A ready-to-send starter-kit archive.
- The packed npm artifact.
- A CycloneDX SBOM.
- A manifest and SHA-256 checksums.
- GitHub build-provenance attestations.

This allows an internal maintainer to download and securely transfer the starter kit when Sharooq cannot access the private `postman-cs` repository directly.

## Credentials and permissions

- `POSTMAN_API_KEY` / `postman-api-key`: must be allowed to view available workspace roles and manage the target workspace.
- `POSTMAN_ACCESS_TOKEN` / `postman-access-token`: freshly minted, short-lived system service-account token used with the PMAK for Postman API calls. The installed GitHub workflows mint it automatically.
- `POSTMAN_SCIM_API_KEY` / `postman-scim-api-key`: required only when the scanner doesn't supply SCIM IDs and the action must look up or provision users.
- `DELOITTE_NOTIFICATION_WEBHOOK_URL` / `notification-webhook-url`: optional approved HTTPS mail-gateway endpoint.
- `DELOITTE_NOTIFICATION_WEBHOOK_TOKEN` / `notification-webhook-token`: optional bearer credential for that endpoint.

Never put any credential in scanner output, repository variables, artifacts, or logs. Store them in the CI platform's secret manager.

## Local development

```bash
npm ci
npm run verify
```
