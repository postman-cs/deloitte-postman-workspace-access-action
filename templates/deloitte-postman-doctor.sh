#!/usr/bin/env bash
set -euo pipefail

script_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
consumer_root="$(cd "${script_root}/.." && pwd)"

if [[ "${1:-}" == "validate" ]]; then
  shift
  exec node "${consumer_root}/.github/actions/deloitte-postman-workspace-access/dist/cli.cjs" validate "$@"
fi

exec node "${consumer_root}/.github/actions/deloitte-postman-workspace-access/dist/cli.cjs" doctor "$@"
