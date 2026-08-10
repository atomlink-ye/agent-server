import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const workspaceNodeModules = '/workspace/node_modules';
const workspaceWebNodeModules = '/workspace/apps/web/node_modules';
// Seeds are tar archives rather than directory trees: restoring by extracting
// one sequential archive costs a fraction of copying ~200k small files, which
// matters because `docker compose run --rm` gives the runner a fresh volume
// and this restore therefore happens on every single invocation.
const imageNodeModulesArchive = '/home/node/image-node_modules.tar';
const imageWebNodeModulesArchive = '/home/node/image-web-node_modules.tar';
const imageStampPath = '/home/node/image-dependencies-stamp';
const dependencyFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/web/package.json',
];
const command = process.argv.slice(2);

const stampPath = (nodeModules) => `${nodeModules}/.docker-dependencies-stamp`;

const run = (file, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${file} exited with ${code ?? signal}`));
    });
  });

const clearAndRestore = async (workspace, archive) => {
  await mkdir(workspace, { recursive: true });
  for (const entry of await readdir(workspace)) {
    await rm(`${workspace}/${entry}`, { recursive: true, force: true });
  }
  await run('tar', ['-xf', archive, '-C', workspace]);
};

if (command.length === 0) {
  process.stderr.write(
    'Usage: node scripts/dev/docker-ensure-node-modules.mjs <command> [args...]\n',
  );
  process.exitCode = 2;
} else {
  try {
    const dependencyHash = createHash('sha256');
    for (const file of dependencyFiles) {
      dependencyHash.update(await readFile(`/workspace/${file}`));
    }
    const expectedStamp = `${dependencyHash.digest('hex')}\n`;
    const imageStamp = await readFile(imageStampPath, 'utf8').catch(() => null);
    if (imageStamp !== expectedStamp) {
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
        await clearAndRestore(workspaceNodeModules, imageNodeModulesArchive);
        await clearAndRestore(
          workspaceWebNodeModules,
          imageWebNodeModulesArchive,
        );
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
