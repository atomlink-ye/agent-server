const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const childProcess = require('node:child_process');

const realSpawn = childProcess.spawn;

childProcess.spawn = function patchedSpawn(command, args, options) {
  if (!args?.some((arg) => arg.endsWith('tooling/dev/setup-providers.ts'))) {
    return realSpawn.call(this, command, args, options);
  }

  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  process.nextTick(() => {
    child.stdout.end(
      JSON.stringify({
        status: 'ready',
        binaries: {
          paseo: process.env.TEST_FAKE_PROVIDER_BIN,
          opencode: process.env.TEST_FAKE_PROVIDER_BIN,
          claude: process.env.TEST_FAKE_PROVIDER_BIN,
          codex: process.env.TEST_FAKE_PROVIDER_BIN,
        },
      }),
    );
    child.stderr.end();
    child.emit('close', 0, null);
  });
  return child;
};
