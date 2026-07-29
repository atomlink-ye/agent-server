import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const workspaceNodeModules = '/workspace/node_modules';
const imageNodeModules = '/home/node/image-node_modules';
const dependencyStamp = `${workspaceNodeModules}/.docker-dependencies-stamp`;
const imageDependencyStamp = `${imageNodeModules}/.docker-dependencies-stamp`;
const command = process.argv.slice(2);

if (command.length === 0) {
  process.stderr.write(
    'Usage: node scripts/dev/docker-ensure-node-modules.mjs <command> [args...]\n',
  );
  process.exitCode = 2;
} else {
  try {
    const dependencyHash = createHash('sha256');
    for (const file of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
    ]) {
      dependencyHash.update(await readFile(`/workspace/${file}`));
    }
    const expectedStamp = `${dependencyHash.digest('hex')}\n`;
    let imageStamp;
    try {
      imageStamp = await readFile(imageDependencyStamp, 'utf8');
    } catch {
      imageStamp = null;
    }
    if (imageStamp !== expectedStamp) {
      process.stderr.write(
        'Image dependencies are stale; run make setup or docker compose build.\n',
      );
      process.exitCode = 1;
    } else {
      let currentStamp;
      try {
        currentStamp = await readFile(dependencyStamp, 'utf8');
      } catch {
        currentStamp = null;
      }
      if (currentStamp !== expectedStamp) {
        await mkdir(workspaceNodeModules, { recursive: true });
        for (const entry of await readdir(workspaceNodeModules)) {
          await rm(`${workspaceNodeModules}/${entry}`, {
            recursive: true,
            force: true,
          });
        }
        for (const entry of await readdir(imageNodeModules)) {
          await cp(
            `${imageNodeModules}/${entry}`,
            `${workspaceNodeModules}/${entry}`,
            { recursive: true, force: true },
          );
        }
        await writeFile(dependencyStamp, expectedStamp, 'utf8');
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
