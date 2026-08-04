# Deloitte Onboarding Notifications

The action creates one rendered onboarding message for every unique scanner email. Messages explain why the recipient was added, their Postman workspace role, the next step, and three immediate ways to use Postman.

## Delivery model

The action deliberately does not embed an email vendor. Deloitte connects its approved mail gateway using two GitHub Actions secrets:

- `DELOITTE_NOTIFICATION_WEBHOOK_URL` — an HTTPS endpoint that accepts the rendered batch.
- `DELOITTE_NOTIFICATION_WEBHOOK_TOKEN` — an optional bearer token.

When the URL is configured, a non-preview run sends one `POST` request. A non-2xx response fails the step so notification loss is visible. Requests with a GitHub run ID include an `Idempotency-Key` header and retry HTTP `429`, `500`, `502`, `503`, and `504` responses safely.

No webhook is called during `dry-run`. The notification JSON is still rendered for review.

## Webhook contract

Request headers:

```http
Content-Type: application/json
Authorization: Bearer <DELOITTE_NOTIFICATION_WEBHOOK_TOKEN>
Idempotency-Key: deloitte-postman:<workspace-id>:<run-id>:<attempt>
```

Request body:

```json
{
  "schemaVersion": 1,
  "kind": "deloitte-postman-onboarding",
  "workspace": {
    "id": "workspace-id",
    "url": "https://go.postman.co/workspace/example"
  },
  "sourceRepository": "deloitte/example-api",
  "notifications": [
    {
      "to": "contributor@example.com",
      "subject": "Deloitte: Your Postman workspace access",
      "text": "Rendered plain-text email",
      "html": "<html>Rendered HTML email</html>",
      "workspaceRole": "Viewer",
      "lifecycle": "provisioned",
      "workspaceAccess": "added",
      "status": "ready",
      "send": true
    }
  ]
}
```

The gateway should validate the recipient against Deloitte's allowed domains, deduplicate on `Idempotency-Key`, send `text` and `html` as the alternative email bodies, and return any `2xx` response only after accepting the complete batch.

## GitHub Actions setup

Add the two notification secrets next to the existing Postman secrets. Pass the exact workspace URL so the email CTA opens the onboarded workspace:

```yaml
with:
  postman-workspace-url: ${{ needs.onboard.outputs['workspace-url'] }}
secrets: inherit
```

The reusable workflow writes `.deloitte-postman/notifications.json` and uploads it with the reconciliation summary. The artifact contains email addresses and must use the repository's approved retention and access policy.

The source repository ships the human-readable reference at `templates/deloitte-postman-onboarding-email.md`; the installer places it beside this guide as `docs/deloitte-postman-onboarding-email.md`. The runtime renderer escapes user-controlled fields before producing HTML.
