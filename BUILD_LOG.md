# Build and Verification Log

This file describes the build gates applied to the Deloitte Postman Workspace Access Action. The current public release is [v0.3.1](https://github.com/postman-cs/deloitte-postman-workspace-access-action/releases/tag/v0.3.1).

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
  deloitte-postman-workspace-access-starter-kit-v0.3.1.tar.gz \
  --repo postman-cs/deloitte-postman-workspace-access-action
```

The authoritative hosted history is available under [Actions](https://github.com/postman-cs/deloitte-postman-workspace-access-action/actions) and [Releases](https://github.com/postman-cs/deloitte-postman-workspace-access-action/releases).
