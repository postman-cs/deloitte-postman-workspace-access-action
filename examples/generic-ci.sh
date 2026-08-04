#!/usr/bin/env bash
set -euo pipefail

: "${POSTMAN_API_KEY:?POSTMAN_API_KEY is required}"
: "${POSTMAN_SCIM_API_KEY:?POSTMAN_SCIM_API_KEY is required}"
: "${POSTMAN_WORKSPACE_ID:?POSTMAN_WORKSPACE_ID is required}"

members_file="${1:-scanner-output.json}"

npx --yes github:postman-cs/deloitte-postman-workspace-access-action \
  --workspace-id "${POSTMAN_WORKSPACE_ID}" \
  --members-file "${members_file}"
