# Protected Postman Sandbox Smoke Test

The `Postman sandbox smoke test` workflow is the final tenant-level validation. It is manual, targets the `postman-sandbox` GitHub environment, and is intentionally separate from ordinary CI.

## Required environment configuration

Create a dedicated, non-production Postman workspace and configure these environment secrets:

- `POSTMAN_SANDBOX_API_KEY`
- `POSTMAN_SANDBOX_SCIM_API_KEY`

Choose two approved identities:

- One current sandbox team user.
- One monitored disposable address that is authorized to receive an invitation.

Do not use a customer, production, or unapproved employee address.

## Run preview first

Open **Actions → Postman sandbox smoke test → Run workflow** and provide:

- The sandbox workspace ID.
- Both test email addresses.
- `preview` mode.
- A test-plan, approval, or change-ticket reference.

Preview performs only lookups and uploads `preview-summary.json` as evidence.

## Run the invitation test

After reviewing the preview, rerun with:

- Mode `apply-and-invite`.
- Confirmation `INVITE_DISPOSABLE_USER`.
- The same workspace, identities, and approval reference.

This may invite the disposable user and assigns both users the workspace Viewer role. The summary distinguishes an immediate addition from an invitation that is waiting for acceptance.

## Verify and clean up

1. Confirm the disposable mailbox received the expected Postman invitation when the team domain did not allow immediate provisioning.
2. Accept the invitation if pending and rerun the same test to verify idempotent role completion.
3. Download the summary artifact and attach it to the test record.
4. Remove the disposable user and sandbox role manually under the approved cleanup procedure. The workflow never deletes or deactivates users automatically.
