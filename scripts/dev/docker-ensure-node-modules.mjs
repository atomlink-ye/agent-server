import {
  access,
  constants,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { computeDependencyStamp } from './dependency-stamp.mjs';

const workspaceNodeModules = '/workspace/node_modules';
const workspaceWebNodeModules = '/workspace/apps/web/node_modules';
const imageNodeModules = '/home/node/image-node-modules';
const imageWebNodeModules = '/home/node/image-web-node-modules';
const includeWebNodeModules =
  process.env.DOCKER_ENSURE_WEB_NODE_MODULES !== 'false';
const restoreLockPath = `${workspaceNodeModules}/.dependency-restore.lock`;
const restoreLockTimeoutMs = Number(
  process.env.DEPENDENCY_RESTORE_LOCK_TIMEOUT_MS ?? 120000,
);
const command = process.argv.slice(2);

const stampPath = (nodeModules) => `${nodeModules}/.docker-dependencies-stamp`;

// The canonical web package is Vite. Verify the root TypeScript toolchain plus
// the Vite/React artifacts used by apps/web; there is no second web-vite tree.
const criticalArtifacts = [
  {
    displayPath: 'node_modules/.bin/tsc',
    relativePath: '.bin/tsc',
    workspace: workspaceNodeModules,
    image: imageNodeModules,
    accessMode: constants.X_OK,
  },
  ...(includeWebNodeModules
    ? [
        {
          displayPath: 'apps/web/node_modules/.bin/vite',
          relativePath: '.bin/vite',
          workspace: workspaceWebNodeModules,
          image: imageWebNodeModules,
          accessMode: constants.X_OK,
        },
        {
          displayPath: 'apps/web/node_modules/react/jsx-dev-runtime.js',
          relativePath: 'react/jsx-dev-runtime.js',
          workspace: workspaceWebNodeModules,
          image: imageWebNodeModules,
          accessMode: constants.F_OK,
        },
      ]
    : []),
];

const dependencyTrees = [
  [workspaceNodeModules, imageNodeModules],
  ...(includeWebNodeModules
    ? [[workspaceWebNodeModules, imageWebNodeModules]]
    : []),
];

const checkCriticalArtifacts = async (scope, rootKind) => {
  for (const {
    displayPath,
    relativePath,
    workspace,
    image,
    accessMode,
  } of criticalArtifacts) {
    const root = rootKind === 'image' ? image : workspace;
    const path = `${root}/${relativePath}`;
    try {
      await access(path, accessMode);
    } catch (error) {
      const code = error?.code ? ` (${error.code})` : '';
      return `${scope} missing required artifact ${displayPath}${code}`;
    }
  }
  return null;
};

const workspaceOwnershipMessage =
  'Workspace write preflight failed. Ensure the bind-mounted source is provisioned writable by container uid/gid 1000:1000; do not chown, chmod, or escalate privileges in the container.';

const runWorkspaceWritePreflight = async () => {
  const probePath = `/workspace/.docker-workspace-write-probe-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let failure;
  try {
    await writeFile(probePath, 'probe', { flag: 'wx' });
  } catch (error) {
    failure = error;
  }
  try {
    await rm(probePath, { force: true });
  } catch (cleanupError) {
    failure ??= cleanupError;
  }
  if (failure) {
    const code = failure?.code ? ` (${failure.code})` : '';
    throw new Error(`${workspaceOwnershipMessage}${code}`);
  }
};

const clearAndRestore = async (workspace, image, preserveEntries = []) => {
  await mkdir(workspace, { recursive: true });
  for (const entry of await readdir(workspace)) {
    if (preserveEntries.includes(entry)) continue;
    await rm(`${workspace}/${entry}`, { recursive: true, force: true });
  }
  for (const entry of await readdir(image)) {
    if (entry === '.docker-dependencies-stamp') continue;
    await cp(`${image}/${entry}`, `${workspace}/${entry}`, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
  }
};

const acquireRestoreLock = async () => {
  const deadline =
    Date.now() +
    (Number.isFinite(restoreLockTimeoutMs) && restoreLockTimeoutMs > 0
      ? restoreLockTimeoutMs
      : 120000);
  while (Date.now() < deadline) {
    try {
      await mkdir(restoreLockPath);
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      await delay(250);
    }
  }
  throw new Error(
    `Dependency restore lock is busy at ${restoreLockPath}; refusing to remove or steal an uncertain lock`,
  );
};

const releaseRestoreLock = async () => {
  await rmdir(restoreLockPath);
};

if (command.length === 0) {
  process.stderr.write(
    'Usage: node scripts/dev/docker-ensure-node-modules.mjs <command> [args...]\n',
  );
  process.exitCode = 2;
} else {
  try {
    await runWorkspaceWritePreflight();
    const expectedStamp = await computeDependencyStamp('/workspace');
    const imageStamps = await Promise.all(
      dependencyTrees.map(async ([, imageTree]) => {
        try {
          return await readFile(stampPath(imageTree), 'utf8');
        } catch {
          return null;
        }
      }),
    );
    if (imageStamps.some((stamp) => stamp !== expectedStamp)) {
      process.stderr.write(
        'Image dependencies are stale; run make setup or the scripts/dev/docker-compose wrapper build path.\n',
      );
      process.exitCode = 1;
    } else {
      const imageArtifactFailure =
        (await checkCriticalArtifacts('image dependency seed', 'image')) ?? null;
      if (imageArtifactFailure) {
        process.stderr.write(
          `[docker-ensure-node-modules] dependency_restore failed reason=${imageArtifactFailure}; rebuild the image\n`,
        );
        throw new Error(imageArtifactFailure);
      }
      await acquireRestoreLock();
      try {
        const currentStamps = await Promise.all(
          dependencyTrees.map(async ([workspaceTree]) => {
            try {
              return await readFile(stampPath(workspaceTree), 'utf8');
            } catch {
              return null;
            }
          }),
        );
        const workspaceArtifactFailure =
          (await checkCriticalArtifacts(
            'workspace dependency tree',
            'workspace',
          )) ?? null;
        const stampMismatch = currentStamps.some(
          (stamp) => stamp !== expectedStamp,
        );
        if (stampMismatch || workspaceArtifactFailure) {
          const restoreStartedAt = Date.now();
          process.stderr.write(
            `[docker-ensure-node-modules] dependency_restore start reason=${workspaceArtifactFailure ?? 'stamp_mismatch'}\n`,
          );
          try {
            await clearAndRestore(workspaceNodeModules, imageNodeModules, [
              '.dependency-restore.lock',
            ]);
            if (includeWebNodeModules) {
              await clearAndRestore(
                workspaceWebNodeModules,
                imageWebNodeModules,
              );
            }
            await writeFile(
              stampPath(workspaceNodeModules),
              expectedStamp,
              'utf8',
            );
            if (includeWebNodeModules) {
              await writeFile(
                stampPath(workspaceWebNodeModules),
                expectedStamp,
                'utf8',
              );
            }
            const restoredArtifactFailure =
              (await checkCriticalArtifacts(
                'restored workspace dependency tree',
                'workspace',
              )) ?? null;
            if (restoredArtifactFailure) {
              throw new Error(
                `Dependency restore completed but ${restoredArtifactFailure}`,
              );
            }
          } finally {
            process.stderr.write(
              `[docker-ensure-node-modules] dependency_restore end duration_ms=${Date.now() - restoreStartedAt}\n`,
            );
          }
        } else {
          process.stderr.write(
            '[docker-ensure-node-modules] dependency_restore skipped reason=stamp_match\n',
          );
        }
      } finally {
        await releaseRestoreLock();
      }

      const child = spawn(command[0], command.slice(1), {
        cwd: '/workspace',
        env: process.env,
        stdio: 'inherit',
      });
      const forwardSignal = (signal) => {
        if (child.exitCode === null) child.kill(signal);
      };
      process.on('SIGINT', forwardSignal);
      process.on('SIGTERM', forwardSignal);

      const exitCode = await new Promise((resolve) => {
        child.once('error', () => {
          process.stderr.write('Failed to start the container command.\n');
          resolve(1);
        });
        child.once('exit', (code, signal) => {
          resolve(code ?? (signal ? 1 : 0));
        });
      });
      process.off('SIGINT', forwardSignal);
      process.off('SIGTERM', forwardSignal);
      process.exitCode = exitCode;
    }
  } catch (error) {
    process.stderr.write(
      `Failed to prepare container dependencies: ${error?.stack ?? error}\n`,
    );
    process.exitCode = 1;
  }
}
