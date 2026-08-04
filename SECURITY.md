# Security Policy

## Supported versions

Only the latest tagged release receives security fixes. Consumers should pin the newest exact version and verify the published checksum and build-provenance attestation.

## Reporting a vulnerability

Do not disclose credentials, customer identities, scanner artifacts, or vulnerability details in a public issue or pull request.

Report suspected vulnerabilities privately to `security@postman.com` with:

- The affected release, commit, and file.
- Reproduction steps that use accounts you own or are explicitly authorized to test.
- Expected impact and any relevant logs with secrets removed.
- A safe proof of concept when available.

Follow Postman's [security and vulnerability reporting policy](https://www.postman.com/security/vulnerability-reporting/). Do not perform denial-of-service testing, access another user's data, or send invitations to unapproved identities.

## Credential handling

- Store Postman and SCIM keys only in the CI secret manager.
- Never commit or upload real scanner data or API keys.
- Use the dedicated `postman-sandbox` environment for live tests.
- Rotate credentials immediately after suspected exposure.
