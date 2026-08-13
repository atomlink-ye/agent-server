const MAX_COMM_LENGTH = 64;
const PROCESS_IDENTITIES = Object.freeze({
  PASEO_RUNTIME_LAUNCHER: 'paseo-runtime-launcher',
  PASEO_SUPERVISOR: 'paseo-supervisor',
  PASEO_DAEMON: 'paseo-daemon',
  OTHER: 'other',
});

function executableName(value) {
  const text = String(value ?? '');
  return text.slice(text.lastIndexOf('/') + 1);
}

function isNodeExecutable(value) {
  return executableName(value) === 'node';
}

function isRuntimeSupervisorInvocation(argv) {
  return (
    Array.isArray(argv) &&
    argv.length === 2 &&
    isNodeExecutable(argv[0]) &&
    /(?:^|\/)scripts\/dev\/paseo-runtime\.mjs$/u.test(String(argv[1]))
  );
}

function isPaseoDaemonInvocation(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length < 11 ||
    executableName(argv[0]) !== 'paseo' ||
    argv[1] !== 'start' ||
    argv[2] !== '--foreground' ||
    argv[3] !== '--listen' ||
    !/^\S+:\d{1,5}$/u.test(String(argv[4])) ||
    argv[5] !== '--home' ||
    typeof argv[6] !== 'string' ||
    !argv[6].startsWith('/')
  )
    return false;

  const requiredTail = ['--no-relay', '--no-mcp', '--no-inject-mcp'];
  const tail = argv.slice(7);
  if (
    tail.length < requiredTail.length + 1 ||
    tail[0] !== requiredTail[0] ||
    tail[1] !== requiredTail[1] ||
    tail[2] !== requiredTail[2]
  )
    return false;
  const webUi = tail[3];
  if (webUi !== '--no-web-ui' && webUi !== '--web-ui') return false;
  if (tail.length === 4) return true;
  return (
    tail.length === 6 &&
    tail[4] === '--hostnames' &&
    typeof tail[5] === 'string' &&
    tail[5].length > 0
  );
}

/**
 * Classifies a process while its raw invocation is still collector memory.
 * The returned enum is intentionally finite; callers must never persist argv.
 */
export function classifyProcessIdentity(argv) {
  const executableNameInInvocation = (value) => {
    const text = String(value ?? '');
    return text.slice(text.lastIndexOf('/') + 1);
  };
  const isNode = (value) => executableNameInInvocation(value) === 'node';
  const supervisorTitle = argv?.[0] === 'Paseo Supervisor';
  const daemonTitle = argv?.[0] === 'Paseo Daemon';
  const supervisor =
    Array.isArray(argv) &&
    argv.length === 2 &&
    isNode(argv[0]) &&
    /(?:^|\/)scripts\/dev\/paseo-runtime\.mjs$/u.test(String(argv[1]));
  if (supervisorTitle) return 'paseo-supervisor';
  if (supervisor) return 'paseo-runtime-launcher';
  if (
    Array.isArray(argv) &&
    argv.length >= 11 &&
    executableNameInInvocation(argv[0]) === 'paseo' &&
    argv[1] === 'start' &&
    argv[2] === '--foreground' &&
    argv[3] === '--listen' &&
    /^\S+:\d{1,5}$/u.test(String(argv[4])) &&
    argv[5] === '--home' &&
    typeof argv[6] === 'string' &&
    argv[6].startsWith('/')
  ) {
    const tail = argv.slice(7);
    const requiredTail = ['--no-relay', '--no-mcp', '--no-inject-mcp'];
    if (
      tail.length >= requiredTail.length + 1 &&
      tail[0] === requiredTail[0] &&
      tail[1] === requiredTail[1] &&
      tail[2] === requiredTail[2] &&
      (tail[3] === '--no-web-ui' || tail[3] === '--web-ui') &&
      (tail.length === 4 ||
        (tail.length === 6 &&
          tail[4] === '--hostnames' &&
          typeof tail[5] === 'string' &&
          tail[5].length > 0))
    )
      return 'paseo-daemon';
  }
  if (daemonTitle) return 'paseo-daemon';
  return 'other';
}

function numericProcessRecords({
  procEntries,
  readComm,
  readStatus,
  readCmdline,
}) {
  const maxCommLength = 64;
  const records = [];
  for (const pidText of procEntries) {
    if (!/^\d+$/u.test(String(pidText))) continue;

    let comm;
    let status;
    let cmdline;
    try {
      comm = readComm(String(pidText)).trim();
      status = readStatus(String(pidText));
      cmdline = readCmdline(String(pidText));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    const uid = /^Uid:\s+(\d+)(?:\s+\d+){3}\s*$/mu.exec(status)?.[1];
    const ppid = /^PPid:\s+(\d+)\s*$/mu.exec(status)?.[1];
    if (!comm || uid === undefined || ppid === undefined)
      throw new Error('process_status_invalid');
    const argv = String(cmdline).split('\u0000');
    if (argv.at(-1) === '') argv.pop();
    const identity = classifyProcessIdentity(argv);
    // Linux comm is normally 15 bytes, but keep the projection bounded even
    // when a fixture or alternate procfs implementation returns more.
    records.push({
      pid: Number(pidText),
      ppid: Number(ppid),
      uid: Number(uid),
      comm: comm.slice(0, maxCommLength),
      candidate_identity: identity,
    });
  }
  if (!records.length) throw new Error('process_records_empty');
  const byPid = new Map(records.map((record) => [record.pid, record]));
  const init = byPid.get(1);
  const hasDockerInitAncestry =
    init?.pid === 1 &&
    init.ppid === 0 &&
    init.comm === 'docker-init' &&
    Number.isSafeInteger(init.uid) &&
    init.uid > 0;
  const acceptedSupervisor = (record) =>
    hasDockerInitAncestry &&
    record.candidate_identity === 'paseo-supervisor' &&
    byPid.get(record.ppid)?.candidate_identity === 'paseo-runtime-launcher' &&
    record.ppid > 1 &&
    acceptedLauncher(byPid.get(record.ppid)) &&
    record.uid === init.uid;
  const acceptedLauncher = (record) =>
    hasDockerInitAncestry &&
    record.candidate_identity === 'paseo-runtime-launcher' &&
    record.ppid === 1 &&
    record.uid === init.uid;
  return records
    .map((record) => {
      const launcher = acceptedLauncher(record);
      const supervisor = acceptedSupervisor(record);
      const parent = byPid.get(record.ppid);
      const identity =
        record.candidate_identity === 'paseo-daemon' &&
        acceptedSupervisor(parent) &&
        record.uid === parent.uid
          ? 'paseo-daemon'
          : launcher
            ? 'paseo-runtime-launcher'
            : supervisor
              ? 'paseo-supervisor'
              : 'other';
      return {
        pid: record.pid,
        ppid: record.ppid,
        uid: record.uid,
        comm: record.comm,
        identity,
      };
    })
    .sort((left, right) => left.pid - right.pid);
}

export function enumerateNumericProcessRecords({
  procEntries,
  readComm,
  readStatus,
  readCmdline,
}) {
  return numericProcessRecords({
    procEntries,
    readComm,
    readStatus,
    readCmdline: readCmdline ?? (() => ''),
  });
}

export const processInspectionScript = `const fs=require('node:fs');const classifyProcessIdentity=(${classifyProcessIdentity.toString()});const records=(${numericProcessRecords.toString()})({procEntries:fs.readdirSync('/proc'),readComm:pid=>fs.readFileSync('/proc/'+pid+'/comm','utf8'),readStatus:pid=>fs.readFileSync('/proc/'+pid+'/status','utf8'),readCmdline:pid=>fs.readFileSync('/proc/'+pid+'/cmdline','utf8')});process.stdout.write(JSON.stringify(records));`;

function strictProcessRecords(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('process_records_empty');
  const seen = new Set();
  return value.map((record) => {
    if (record === null || typeof record !== 'object')
      throw new Error('process_record_invalid');
    const keys = Object.keys(record).sort();
    if (keys.join(',') !== 'comm,identity,pid,ppid,uid')
      throw new Error('process_record_schema_invalid');
    if (
      !Number.isSafeInteger(record.pid) ||
      record.pid < 1 ||
      !Number.isSafeInteger(record.ppid) ||
      record.ppid < 0 ||
      !Number.isSafeInteger(record.uid) ||
      record.uid < 0 ||
      typeof record.comm !== 'string' ||
      record.comm.length === 0 ||
      record.comm.length > MAX_COMM_LENGTH ||
      /[\u0000\r\n]/u.test(record.comm) ||
      !Object.values(PROCESS_IDENTITIES).includes(record.identity)
    )
      throw new Error('process_record_value_invalid');
    if (seen.has(record.pid)) throw new Error('process_pid_duplicate');
    seen.add(record.pid);
    return {
      pid: record.pid,
      ppid: record.ppid,
      uid: record.uid,
      comm: record.comm,
      identity: record.identity,
    };
  });
}

export function parseProcessRecords(output) {
  if (typeof output !== 'string' || output.trim() === '')
    throw new Error('process_json_empty');
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error('process_json_invalid');
  }
  return strictProcessRecords(value);
}

export function exactServiceContainerId(output, service) {
  const ids = String(output ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (ids.length !== 1)
    throw new Error(`container_count:${service}:${ids.length}`);
  if (!/^[a-f0-9]{12,64}$/u.test(ids[0]))
    throw new Error(`container_id_invalid:${service}`);
  return ids[0];
}

export function isPaseoExecutableProcess(process) {
  return process?.identity === PROCESS_IDENTITIES.PASEO_DAEMON;
}

export function isPaseoProcess(process) {
  return (
    process?.identity === PROCESS_IDENTITIES.PASEO_RUNTIME_LAUNCHER ||
    process?.identity === PROCESS_IDENTITIES.PASEO_DAEMON ||
    process?.identity === PROCESS_IDENTITIES.PASEO_SUPERVISOR
  );
}

export function collectServiceProcesses({
  run,
  composeCommand,
  service,
  identity,
}) {
  const containerId = exactServiceContainerId(
    run('docker', [...composeCommand, 'ps', '-q', service], {
      identity: `${identity}-container-id`,
    }).stdout,
    service,
  );
  const output = run(
    'docker',
    ['exec', containerId, 'node', '-e', processInspectionScript],
    { identity: `${identity}-processes` },
  ).stdout;
  return { containerId, processes: parseProcessRecords(output) };
}
