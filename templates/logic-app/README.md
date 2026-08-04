# Microsoft Logic Apps notification adapter

Use `deloitte-postman-notifier.workflow.json` as the workflow definition for a Consumption Logic App, then bind its `office365` API connection to Deloitte's approved shared mailbox.

Before production use:

1. Restrict the HTTP trigger with Azure API Management, Entra authentication, or a secret-bearing gateway.
2. Validate every recipient against Deloitte's approved domain allowlist.
3. Configure the gateway to deduplicate the incoming `Idempotency-Key` header.
4. Return `2xx` only after the complete batch is accepted.
5. Store the resulting HTTPS trigger URL and credential as `DELOITTE_NOTIFICATION_WEBHOOK_URL` and `DELOITTE_NOTIFICATION_WEBHOOK_TOKEN`.

The included workflow is intentionally connection-agnostic: Deloitte must supply and authorize the Office 365 connection in its own Azure tenant.
