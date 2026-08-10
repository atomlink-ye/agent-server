import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { computeDependencyStamp } from './dependency-stamp.mjs';

const workspaceNodeModules = '/workspace/node_modules';
const workspaceWebNodeModules = '/workspace/apps/web/node_modules';
const imageNodeModules = '/home/node/image-node_modules';
const imageWebNodeModules = '/home/node/image-web-node_modules';
const command = process.argv.slice(2);

const stampPath = (nodeModules) => `${nodeModules}/.docker-dependencies-stamp`;

const clearAndRestore = async (workspace, image) => {
  await mkdir(workspace, { recursive: true });
  for (const entry of await readdir(workspace)) {
    await rm(`${workspace}/${entry}`, { recursive: true, force: true });
  }
  for (const entry of await readdir(image)) {
    await cp(`${image}/${entry}`, `${workspace}/${entry}`, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
  }
};

if (command.length === 0) {
  process.stderr.write(
    'Usage: node scripts/dev/docker-ensure-node-modules.mjs <command> [args...]\n',
  );
  process.exitCode = 2;
} else {
  try {
    const expectedStamp = await computeDependencyStamp('/workspace');
    const imageStamps = await Promise.all(
      [imageNodeModules, imageWebNodeModules].map(async (nodeModules) => {
        try {
          return await readFile(stampPath(nodeModules), 'utf8');
        } catch {
          return null;
        }
      }),
    );
    if (imageStamps.some((stamp) => stamp !== expectedStamp)) {
      process.stderr.write(
        'Image dependencies are stale; run make setup or docker compose build.\n',
      );
      process.exitCode = 1;
    } else {
      const currentStamps = await Promise.all(
        [workspaceNodeModules, workspaceWebNodeModules].map(
          async (nodeModules) => {
            try {
              return await readFile(stampPath(nodeModules), 'utf8');
            } catch {
              return null;
            }
          },
        ),
      );
      if (currentStamps.some((stamp) => stamp !== expectedStamp)) {
        await clearAndRestore(workspaceNodeModules, imageNodeModules);
        await clearAndRestore(workspaceWebNodeModules, imageWebNodeModules);
        await writeFile(stampPath(workspaceNodeModules), expectedStamp, 'utf8');
        await writeFile(
          stampPath(workspaceWebNodeModules),
          expectedStamp,
          'utf8',
        );
      }

      const child = spawn(command[0], command.slice(1), {
        cwd: '/workspace',
        env: process.env,
        stdio: 'inherit',
      });
      const forwardSignal = (signal) => {
        if (child.exitCode === null) {
          child.kill(signal);
        }
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
  } catch {
    process.stderr.write('Failed to prepare container dependencies.\n');
    process.exitCode = 1;
  }
}
