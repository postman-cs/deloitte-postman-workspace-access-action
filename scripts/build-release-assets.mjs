import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function sha256(path) {
  const content = await readFile(path);
  return createHash('sha256').update(content).digest('hex');
}

const output = resolve(argument('--output', 'release'));
const repositoryRoot = resolve(process.cwd());
if (
  output === repositoryRoot
  || output === resolve('/')
  || output === resolve(homedir())
  || repositoryRoot.startsWith(`${output}${sep}`)
) {
  throw new Error(`Refusing to use unsafe release output directory: ${output}`);
}

const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
const version = String(packageJson.version);
const tag = `v${version}`;
const bundleName = `deloitte-postman-workspace-access-starter-kit-${tag}`;
const temporaryRoot = await mkdtemp(join(tmpdir(), 'deloitte-release-assets-'));

try {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  const bundleRoot = join(temporaryRoot, bundleName);
  await mkdir(bundleRoot);
  for (const path of [
    'action.yml',
    'LICENSE',
    'README.md',
    'BUILD_LOG.md',
    'QUICKSTART.md',
    'dist',
    'docs',
    'examples',
    'schemas',
    'templates'
  ]) {
    await cp(join(repositoryRoot, path), join(bundleRoot, path), { recursive: true });
  }
  await mkdir(join(bundleRoot, 'scripts'));
  await cp(join(repositoryRoot, 'scripts/deloitte-init.sh'), join(bundleRoot, 'scripts/deloitte-init.sh'));

  const archiveName = `${bundleName}.tar.gz`;
  run('tar', ['-czf', join(output, archiveName), '-C', temporaryRoot, bundleName]);

  const packMetadata = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', output]));
  if (!Array.isArray(packMetadata) || packMetadata.length !== 1) {
    throw new Error('npm pack did not return exactly one package artifact.');
  }

  const sbomName = `deloitte-postman-workspace-access-${tag}.cdx.json`;
  const sbom = run('npm', ['sbom', '--sbom-format=cyclonedx', '--omit=dev']);
  JSON.parse(sbom);
  await writeFile(join(output, sbomName), `${sbom.trim()}\n`);

  const commit = run('git', ['rev-parse', 'HEAD']).trim();
  const manifestName = `deloitte-postman-workspace-access-${tag}.manifest.json`;
  const buildUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? 'postman-cs/deloitte-postman-workspace-access-action'}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`
    : 'local release-asset build';
  await cp(join(repositoryRoot, 'README.md'), join(output, 'README.md'));
  await writeFile(join(output, 'BUILD_LOG.md'), `# Build Log — ${tag}\n\n- Version: \`${version}\`\n- Tag: \`${tag}\`\n- Commit: \`${commit}\`\n- Build: ${buildUrl}\n\n## Completed release gates\n\n- \`npm ci\`\n- \`npm run qa\`\n- \`npm run verify:dist\`\n- \`npm run release:verify -- ${tag}\`\n- \`npm run release:assets\`\n\nThe release workflow generated the starter kit, npm package, CycloneDX SBOM, manifest, checksums, and build-provenance attestation from this commit.\n`);
  await writeFile(join(output, manifestName), `${JSON.stringify({
    name: packageJson.name,
    version,
    tag,
    commit,
    starterKit: archiveName,
    npmPackage: packMetadata[0].filename,
    sbom: sbomName,
    readme: 'README.md',
    buildLog: 'BUILD_LOG.md'
  }, null, 2)}\n`);

  const files = (await readdir(output)).sort();
  const checksums = [];
  for (const file of files) {
    checksums.push(`${await sha256(join(output, file))}  ${basename(file)}`);
  }
  await writeFile(join(output, 'SHA256SUMS'), `${checksums.join('\n')}\n`);
  process.stdout.write(`Built ${files.length + 1} release assets for ${tag} in ${output}\n`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
