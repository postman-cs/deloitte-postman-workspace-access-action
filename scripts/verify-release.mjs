import { readFile } from 'node:fs/promises';

const tag = process.argv[2]?.trim();
if (!tag) throw new Error('Usage: node scripts/verify-release.mjs <tag>');
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const expected = `v${packageJson.version}`;
if (tag !== expected) {
  throw new Error(`Release tag ${tag} does not match package version ${packageJson.version}; expected ${expected}.`);
}
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`Release tag ${tag} is not an exact semantic version.`);
}
process.stdout.write(`Release tag ${tag} matches package version.\n`);
