#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/consumer-repository" >&2
  exit 64
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
consumer_root="$(cd "$1" && pwd)"
destination="${consumer_root}/.github/actions/deloitte-postman-workspace-access"

if [[ -e "${destination}" ]]; then
  echo "Destination already exists: ${destination}" >&2
  echo "Remove or rename it explicitly before installing a new bundle." >&2
  exit 73
fi

mkdir -p "${destination}/dist" "${destination}/docs" "${destination}/templates"
cp "${repo_root}/action.yml" "${destination}/action.yml"
cp "${repo_root}/LICENSE" "${destination}/LICENSE"
cp "${repo_root}/README.md" "${destination}/README.md"
cp "${repo_root}/dist/index.cjs" "${destination}/dist/index.cjs"
cp "${repo_root}/docs/NOTIFICATIONS.md" "${destination}/docs/NOTIFICATIONS.md"
cp "${repo_root}/templates/deloitte-postman-onboarding-email.md" "${destination}/templates/deloitte-postman-onboarding-email.md"

echo "Vendored Deloitte Postman workspace access action to ${destination}"
