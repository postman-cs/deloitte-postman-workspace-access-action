import { access, chmod, copyFile, cp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { DEFAULT_CONFIG_FILE, DEFAULT_DELOITTE_CONFIG } from './config.js';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function packageRoot(): Promise<string> {
  const entrypoint = await realpath(process.argv[1] ?? 'dist/cli.cjs');
  return resolve(dirname(entrypoint), '..');
}

export interface InstallResult {
  target: string;
  mode: 'installed' | 'upgraded';
  configFile: string;
  files: string[];
}

export async function installStarterKit(target: string, upgrade = false): Promise<InstallResult> {
  const sourceRoot = await packageRoot();
  const consumerRoot = resolve(target);
  if (!(await exists(consumerRoot))) throw new Error(`Target repository does not exist: ${consumerRoot}`);
  const actionRoot = resolve(consumerRoot, '.github/actions/deloitte-postman-workspace-access');
  const destinations = {
    actionRoot,
    workflow: resolve(consumerRoot, '.github/workflows/deloitte-postman-workspace-access.yml'),
    pendingWorkflow: resolve(consumerRoot, '.github/workflows/deloitte-postman-pending-reconcile.yml'),
    doctor: resolve(consumerRoot, 'scripts/deloitte-postman-doctor.sh'),
    runbook: resolve(consumerRoot, 'docs/deloitte-postman-workspace-access.md'),
    prerequisites: resolve(consumerRoot, 'docs/deloitte-postman-prerequisites.md'),
    sandbox: resolve(consumerRoot, 'docs/deloitte-postman-sandbox-smoke.md'),
    notifications: resolve(consumerRoot, 'docs/deloitte-postman-notifications.md'),
    emailTemplate: resolve(consumerRoot, 'docs/deloitte-postman-onboarding-email.md'),
    logicApp: resolve(consumerRoot, 'docs/deloitte-postman-logic-app'),
    config: resolve(consumerRoot, DEFAULT_CONFIG_FILE)
  };
  const owned = Object.entries(destinations)
    .filter(([name]) => name !== 'config')
    .map(([, path]) => path);
  if (!upgrade) {
    const conflict = (await Promise.all(owned.map(async (path) => ({ path, exists: await exists(path) }))))
      .find((entry) => entry.exists);
    if (conflict) throw new Error(`Starter-kit destination already exists: ${conflict.path}`);
  }

  await mkdir(resolve(actionRoot, 'dist'), { recursive: true });
  await mkdir(dirname(destinations.workflow), { recursive: true });
  await mkdir(dirname(destinations.doctor), { recursive: true });
  await mkdir(dirname(destinations.runbook), { recursive: true });
  await copyFile(resolve(sourceRoot, 'action.yml'), resolve(actionRoot, 'action.yml'));
  await copyFile(resolve(sourceRoot, 'LICENSE'), resolve(actionRoot, 'LICENSE'));
  await copyFile(resolve(sourceRoot, 'README.md'), resolve(actionRoot, 'README.md'));
  await copyFile(resolve(sourceRoot, 'dist/index.cjs'), resolve(actionRoot, 'dist/index.cjs'));
  await copyFile(resolve(sourceRoot, 'dist/cli.cjs'), resolve(actionRoot, 'dist/cli.cjs'));
  await copyFile(resolve(sourceRoot, 'templates/deloitte-postman-workspace-access.yml'), destinations.workflow);
  await copyFile(resolve(sourceRoot, 'templates/deloitte-postman-pending-reconcile.yml'), destinations.pendingWorkflow);
  await copyFile(resolve(sourceRoot, 'templates/deloitte-postman-doctor.sh'), destinations.doctor);
  await copyFile(resolve(sourceRoot, 'docs/SHAROOQ-RUNBOOK.md'), destinations.runbook);
  await copyFile(resolve(sourceRoot, 'docs/POSTMAN-PREREQUISITES.md'), destinations.prerequisites);
  await copyFile(resolve(sourceRoot, 'docs/SANDBOX-SMOKE.md'), destinations.sandbox);
  await copyFile(resolve(sourceRoot, 'docs/NOTIFICATIONS.md'), destinations.notifications);
  await copyFile(resolve(sourceRoot, 'templates/deloitte-postman-onboarding-email.md'), destinations.emailTemplate);
  await cp(resolve(sourceRoot, 'templates/logic-app'), destinations.logicApp, { recursive: true, force: true });
  if (!(await exists(destinations.config))) {
    await writeFile(destinations.config, DEFAULT_DELOITTE_CONFIG, { mode: 0o600 });
  }
  await chmod(resolve(actionRoot, 'dist/cli.cjs'), 0o755);
  await chmod(destinations.doctor, 0o755);
  return {
    target: consumerRoot,
    mode: upgrade ? 'upgraded' : 'installed',
    configFile: destinations.config,
    files: [...owned, destinations.config]
  };
}
