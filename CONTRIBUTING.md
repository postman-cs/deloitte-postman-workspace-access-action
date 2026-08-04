# Contributing

## Development

Use Node.js 24 and install exactly from the lockfile:

```bash
npm ci
npm run qa
npm run verify:dist
```

Runtime changes must include updated tests and rebuilt `dist/`. Scanner discovery must remain deterministic, dry-run and doctor must remain read-only, and credentials must never appear in logs or artifacts.

## Pull requests

- Branch from `main`.
- Keep changes focused and document user-visible behavior.
- Run the full QA suite from a clean checkout.
- Update examples, schemas, and the installed runbook when an interface changes.
- Pin every external GitHub Action to a full commit SHA with the release version in a comment.

## Releases

1. Update `package.json`, `package-lock.json`, and documentation references to the new exact semantic version.
2. Merge through a pull request after all required checks pass.
3. Create and push an annotated tag matching the package version, for example `v0.3.0`.
4. The Release workflow reruns QA, verifies the committed bundle, builds the starter kit and npm package, emits a CycloneDX SBOM and SHA-256 checksums, attests the artifacts, and creates the GitHub release.

Never move or reuse a published version tag.
