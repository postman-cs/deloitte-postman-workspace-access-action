# Build and Verification Log

This file describes the build gates applied to the Deloitte Postman Workspace Access Action. The release candidate documented here is `v0.6.0`.

## v0.6.0 scope

- The GitHub Action and CI-neutral CLI accept a freshly minted Postman system service-account access token while preserving regular user API-key compatibility.
- Postman API requests send the short-lived token as a bearer credential together with the long-lived PMAK; SCIM continues to use its independent key.
- Installed reconciliation and pending-invite workflows mint a fresh token on every run with the pinned `postman-resolve-service-token-action` release.
- Prerequisites and runbooks require the service account to belong to the owning team and hold `Admin` on the target workspace.
- End-to-end coverage verifies bearer authentication, secret masking, vendored execution, installation, packaging, and release assets.

## Local release-candidate verification — 2026-08-07

- 47 unit and contract tests passed across 10 test files.
- CLI E2E passed bearer-token authentication, lifecycle, partial scanner recovery, identity mapping, notification delivery, discovery, retry, doctor, validation, and exit-code paths.
- GitHub Action E2E passed bearer-token authentication and masking, scanner metrics, delivery, pending-invite messaging, dry-run suppression, outputs, summaries, and vendored execution.
- Installer, package, release, and vendor E2E passed config preservation, token-aware workflows, packaged CLI, npm artifact, starter-kit archive, SBOM, manifest, checksums, and overwrite protection.
- TypeScript compilation and deterministic Node 24 bundles passed.
- The npm package dry run completed with the expected `v0.6.0` contents.

## Required release gates

Every release runs the following from a clean GitHub-hosted runner:

```bash
npm ci
npm run qa
npm run verify:dist
npm run release:verify -- "${GITHUB_REF_NAME}"
npm run release:assets
```

`npm run qa` covers unit and contract tests, TypeScript compilation, bundled Action generation, CLI/Action/installer/package/release end-to-end tests, vendoring, and an npm package dry run. Pull requests additionally run dependency review and the organization security scanners.

## Release evidence

Each GitHub release includes:

- `README.md` for integration instructions.
- `BUILD_LOG.md` generated for that exact tag, commit, and workflow run.
- The Deloitte starter-kit archive and npm package.
- A CycloneDX SBOM and release manifest.
- `SHA256SUMS` covering every downloadable artifact.
- GitHub build-provenance attestations.

Verify a downloaded release with:

```bash
shasum -a 256 -c SHA256SUMS
gh attestation verify \
  deloitte-postman-workspace-access-starter-kit-v0.6.0.tar.gz \
  --repo postman-cs/deloitte-postman-workspace-access-action
```

The authoritative hosted history is available under [Actions](https://github.com/postman-cs/deloitte-postman-workspace-access-action/actions) and [Releases](https://github.com/postman-cs/deloitte-postman-workspace-access-action/releases).
