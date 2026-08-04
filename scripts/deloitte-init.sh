#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 /path/to/deloitte-pipeline [--upgrade]" >&2
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 64
fi

consumer_argument="$1"
upgrade=false
if [[ $# -eq 2 ]]; then
  if [[ "$2" != "--upgrade" ]]; then
    usage
    exit 64
  fi
  upgrade=true
fi

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
consumer_root="$(cd "${consumer_argument}" && pwd)"
action_root="${consumer_root}/.github/actions/deloitte-postman-workspace-access"
workflow_path="${consumer_root}/.github/workflows/deloitte-postman-workspace-access.yml"
doctor_path="${consumer_root}/scripts/deloitte-postman-doctor.sh"
runbook_path="${consumer_root}/docs/deloitte-postman-workspace-access.md"
prerequisites_path="${consumer_root}/docs/deloitte-postman-prerequisites.md"
sandbox_smoke_path="${consumer_root}/docs/deloitte-postman-sandbox-smoke.md"

owned_paths=(
  "${action_root}"
  "${workflow_path}"
  "${doctor_path}"
  "${runbook_path}"
  "${prerequisites_path}"
  "${sandbox_smoke_path}"
)
if [[ "${upgrade}" == false ]]; then
  for path in "${owned_paths[@]}"; do
    if [[ -e "${path}" ]]; then
      echo "Starter-kit destination already exists: ${path}" >&2
      echo "Rerun with --upgrade only after reviewing the installed files." >&2
      exit 73
    fi
  done
fi

mkdir -p "${action_root}/dist" "$(dirname "${workflow_path}")" "$(dirname "${doctor_path}")" "$(dirname "${runbook_path}")"
cp "${source_root}/action.yml" "${action_root}/action.yml"
cp "${source_root}/LICENSE" "${action_root}/LICENSE"
cp "${source_root}/README.md" "${action_root}/README.md"
cp "${source_root}/dist/index.cjs" "${action_root}/dist/index.cjs"
cp "${source_root}/dist/cli.cjs" "${action_root}/dist/cli.cjs"
cp "${source_root}/templates/deloitte-postman-workspace-access.yml" "${workflow_path}"
cp "${source_root}/templates/deloitte-postman-doctor.sh" "${doctor_path}"
cp "${source_root}/docs/SHAROOQ-RUNBOOK.md" "${runbook_path}"
cp "${source_root}/docs/POSTMAN-PREREQUISITES.md" "${prerequisites_path}"
cp "${source_root}/docs/SANDBOX-SMOKE.md" "${sandbox_smoke_path}"
chmod +x "${action_root}/dist/cli.cjs" "${doctor_path}"

echo "Installed Deloitte Postman workspace access starter kit in ${consumer_root}"
echo "Next:"
echo "  1. Add POSTMAN_API_KEY and POSTMAN_SCIM_API_KEY as GitHub Actions secrets."
echo "  2. Run scripts/deloitte-postman-doctor.sh --workspace-id <id>."
echo "  3. Copy the caller job from docs/deloitte-postman-workspace-access.md into the onboarding pipeline."
