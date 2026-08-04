# Build and Verification Log

This file describes the build gates applied to the Deloitte Postman Workspace Access Action. The release candidate documented here is `v0.5.0`.

## v0.5.0 scope

- A central, upgrade-safe `.deloitte-postman.yml` controls scanner, identity, role, and notification policy.
- Valid contributors continue onboarding when another scanner record is unresolved; missing identities and explicit exclusions remain counted and auditable.
- GitHub login-to-email identity maps, bot exclusions, adoption links, recipient-domain allowlists, and compact metrics are supported.
- The installer adds a scheduled pending-invite reconciliation workflow and Microsoft Logic Apps/Office 365 email adapter.
- The CLI adds `init`, `upgrade`, config validation, and a guarded one-recipient notification test.

## Local release-candidate verification — 2026-08-04

- 47 unit and contract tests passed across 10 test files.
- CLI E2E passed lifecycle, partial scanner recovery, identity mapping, bot exclusion, notification delivery, discovery, retry, doctor, validation, and exit-code paths.
- GitHub Action E2E passed scanner metrics, partial-record continuation, successful delivery, pending-invite messaging, dry-run suppression, rejected-gateway failure, outputs, summaries, and vendored execution.
- Installer and upgrade E2E passed config preservation, scheduled workflow/Logic App installation, packaged CLI, npm artifact, starter-kit archive, SBOM, manifest, checksums, and overwrite protection.
- TypeScript compilation and deterministic Node 24 bundles passed.
- Production dependency audit reported zero vulnerabilities.

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
  deloitte-postman-workspace-access-starter-kit-v0.5.0.tar.gz \
  --repo postman-cs/deloitte-postman-workspace-access-action
```

The authoritative hosted history is available under [Actions](https://github.com/postman-cs/deloitte-postman-workspace-access-action/actions) and [Releases](https://github.com/postman-cs/deloitte-postman-workspace-access-action/releases).
