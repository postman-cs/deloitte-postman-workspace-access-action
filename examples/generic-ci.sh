#!/usr/bin/env bash
set -euo pipefail

: "${POSTMAN_API_KEY:?POSTMAN_API_KEY is required}"
: "${POSTMAN_SCIM_API_KEY:?POSTMAN_SCIM_API_KEY is required}"
: "${POSTMAN_WORKSPACE_ID:?POSTMAN_WORKSPACE_ID is required}"

# Set POSTMAN_ACCESS_TOKEN to a freshly minted token when POSTMAN_API_KEY
# belongs to a Postman system service account.

members_file="${1:-scanner-output.json}"

npx --yes github:postman-cs/deloitte-postman-workspace-access-action \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --members-file "${members_file}" \
  --postman-workspace-url "${POSTMAN_WORKSPACE_URL:-https://go.postman.co/}" \
  --notifications-file .deloitte-postman/notifications.json
