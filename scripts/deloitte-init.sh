#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 /path/to/deloitte-pipeline [--upgrade]" >&2
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage
  exit 64
fi

consumer_root="$1"
command="init"
if [[ $# -eq 2 ]]; then
  if [[ "$2" != "--upgrade" ]]; then
    usage
    exit 64
  fi
  command="upgrade"
fi

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "${source_root}/dist/cli.cjs" "${command}" --target "${consumer_root}"

echo "Next: edit .deloitte-postman.yml, add the documented GitHub secrets, and run the doctor command."
