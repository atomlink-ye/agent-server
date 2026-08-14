const MAX_COMM_LENGTH = 64;
const MAX_PROCESS_RECORDS = 4096;
const MAX_RAW_CMDLINE_LENGTH = 8192;
const MAX_PROCESS_OUTPUT_LENGTH = 1024 * 1024;
const PROCESS_SNAPSHOT_COUNT = 2;
const PROCESS_COLLECTION_ERROR_CLASSES = Object.freeze({
  NONE: 'none',
  ENOENT: 'enoent',
  READ_ERROR: 'read_error',
  LIMIT: 'limit',
  SNAPSHOT_ERROR: 'snapshot_error',
});
const PROCESS_IDENTITIES = Object.freeze({
  PASEO_RUNTIME_LAUNCHER: 'paseo-runtime-launcher',
  PASEO_SUPERVISOR: 'paseo-supervisor',
  PASEO_DAEMON: 'paseo-daemon',
  OTHER: 'other',
});

function isNodeExecutable(value) {
  return (
    value === 'node' ||
    value === '/usr/bin/node' ||
    value === '/usr/local/bin/node'
  );
}

function isRuntimeSupervisorInvocation(argv) {
  return (
    Array.isArray(argv) &&
    argv.length === 2 &&
    isNodeExecutable(argv[0]) &&
    (argv[1] === 'scripts/dev/paseo-runtime.mjs' ||
      argv[1] === '/workspace/scripts/dev/paseo-runtime.mjs')
  );
}

function isValidListenAddress(value) {
  const match = /^(\S+):(\d+)$/u.exec(String(value ?? ''));
  if (!match) return false;
  const port = Number(match[2]);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535;
}

function hasExactPaseoStartGrammar(argv, executable) {
  if (
    !Array.isArray(argv) ||
    argv.length < 11 ||
    argv[0] !== executable ||
    argv[1] !== 'start' ||
    argv[2] !== '--foreground' ||
    argv[3] !== '--listen' ||
    !isValidListenAddress(argv[4]) ||
    argv[5] !== '--home' ||
    typeof argv[6] !== 'string' ||
    !/^\/[^\u0000\r\n]*$/u.test(argv[6])
  )
    return false;

  const tail = argv.slice(7);
  if (
    tail.length < 4 ||
    tail[0] !== '--no-relay' ||
    tail[1] !== '--no-mcp' ||
    tail[2] !== '--no-inject-mcp' ||
    (tail[3] !== '--no-web-ui' && tail[3] !== '--web-ui')
  )
    return false;
  if (tail.length === 4) return true;
  return (
    tail.length === 6 &&
    tail[4] === '--hostnames' &&
    typeof tail[5] === 'string' &&
    /^\S+$/u.test(tail[5])
  );
}

/**
 * Returns true only for the provider-toolchain Paseo CLI, including its
 * Node shebang form. This is intentionally an exact path check; a basename,
 * suffix, or lookalike path is not an identity anchor.
 */
export function isStrongPaseoInvocation(argv) {
  if (!Array.isArray(argv)) return false;
  const directPath =
    '/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/.bin/paseo';
  const scriptPath =
    '/opt/provider-toolchain-volume/current/paseo-toolchain/node_modules/@getpaseo/cli/bin/paseo';
  if (argv[0] === directPath)
    return hasExactPaseoStartGrammar(argv, directPath);
  return (
    isNodeExecutable(argv[0]) &&
    argv[1] === '--disable-warning=DEP0040' &&
    (argv[2] === directPath || argv[2] === scriptPath) &&
    hasExactPaseoStartGrammar(argv.slice(2), argv[2])
  );
}

/**
 * Classifies a process while its raw invocation is still collector memory.
 * The returned enum is intentionally finite; callers must never persist argv.
 * Title identities are candidates only. enumerateNumericProcessRecords will
 * promote them after proving ancestry to a strong CLI process.
 */
export function classifyProcessIdentity(argv) {
  if (isRuntimeSupervisorInvocation(argv)) return 'paseo-runtime-launcher';
  if (isStrongPaseoInvocation(argv)) return 'paseo-daemon';
  if (Array.isArray(argv) && argv[0] === 'Paseo Supervisor')
    return 'paseo-supervisor';
  if (Array.isArray(argv) && argv[0] === 'Paseo Daemon') return 'paseo-daemon';
  return 'other';
}

function numericProcessRecords({
  procEntries,
  readComm,
  readStatus,
  readCmdline,
}) {
  if (!Array.isArray(procEntries)) throw new Error('process_entries_invalid');
  const records = [];
  for (const pidText of procEntries) {
    if (!/^\d+$/u.test(String(pidText))) continue;
    if (records.length >= MAX_PROCESS_RECORDS)
      throw new Error('process_records_limit');
    const pid = Number(pidText);
    if (!Number.isSafeInteger(pid) || pid < 1)
      throw new Error('process_pid_invalid');

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
    if (typeof cmdline !== 'string' || cmdline.length > MAX_RAW_CMDLINE_LENGTH)
      throw new Error('process_cmdline_limit');
    const argv = cmdline.split('\u0000');
    if (argv.at(-1) === '') argv.pop();
    const candidateIdentity = classifyProcessIdentity(argv);
    records.push({
      pid,
      ppid: Number(ppid),
      uid: Number(uid),
      comm: comm.slice(0, MAX_COMM_LENGTH),
      candidateIdentity,
      strong: isStrongPaseoInvocation(argv),
    });
  }
  if (!records.length) throw new Error('process_records_empty');

  return classifyProcessRecords(records);
}

function classifyProcessRecords(records) {
  const byPid = new Map(records.map((record) => [record.pid, record]));
  const anchoredByStrongCli = (record) => {
    if (!record || record.strong) return Boolean(record?.strong);
    const visited = new Set([record.pid]);
    let current = record;
    for (let steps = 0; steps < records.length; steps += 1) {
      if (current.strong) return true;
      if (!Number.isSafeInteger(current.ppid) || current.ppid === 0)
        return false;
      if (visited.has(current.ppid)) throw new Error('process_ancestry_cycle');
      visited.add(current.ppid);
      current = byPid.get(current.ppid);
      if (!current) throw new Error('process_ancestry_missing');
    }
    throw new Error('process_ancestry_cycle');
  };

  return records
    .map((record) => {
      const anchored =
        record.candidateIdentity === PROCESS_IDENTITIES.PASEO_SUPERVISOR ||
        record.candidateIdentity === PROCESS_IDENTITIES.PASEO_DAEMON
          ? anchoredByStrongCli(record)
          : false;
      let identity = PROCESS_IDENTITIES.OTHER;
      if (
        record.candidateIdentity === PROCESS_IDENTITIES.PASEO_RUNTIME_LAUNCHER
      )
        identity = PROCESS_IDENTITIES.PASEO_RUNTIME_LAUNCHER;
      else if (record.strong || anchored) identity = record.candidateIdentity;
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

function snapshotProcessRecords({
  procEntries,
  readComm,
  readStatus,
  readCmdline,
}) {
  const numericEntries = procEntries.filter((pidText) =>
    /^\d+$/u.test(String(pidText)),
  );
  const boundedEntries = numericEntries.slice(0, MAX_PROCESS_RECORDS);
  const snapshot = {
    numeric_count: Math.min(numericEntries.length, MAX_PROCESS_RECORDS),
    emitted_count: 0,
    enoent_count: 0,
    read_error_count: numericEntries.length > MAX_PROCESS_RECORDS ? 1 : 0,
    error_class:
      numericEntries.length > MAX_PROCESS_RECORDS
        ? PROCESS_COLLECTION_ERROR_CLASSES.LIMIT
        : PROCESS_COLLECTION_ERROR_CLASSES.NONE,
  };
  const records = [];
  for (const pidText of boundedEntries) {
    let comm;
    let status;
    let cmdline;
    try {
      comm = readComm(String(pidText)).trim();
      status = readStatus(String(pidText));
      cmdline = readCmdline(String(pidText));
      const uid = /^Uid:\s+(\d+)(?:\s+\d+){3}\s*$/mu.exec(status)?.[1];
      const ppid = /^PPid:\s+(\d+)\s*$/mu.exec(status)?.[1];
      if (!comm || uid === undefined || ppid === undefined)
        throw new Error('process_status_invalid');
      if (
        typeof cmdline !== 'string' ||
        cmdline.length > MAX_RAW_CMDLINE_LENGTH
      )
        throw new Error('process_cmdline_limit');
      const argv = cmdline.split('\u0000');
      if (argv.at(-1) === '') argv.pop();
      records.push({
        pid: Number(pidText),
        ppid: Number(ppid),
        uid: Number(uid),
        comm: comm.slice(0, MAX_COMM_LENGTH),
        candidateIdentity: classifyProcessIdentity(argv),
        strong: isStrongPaseoInvocation(argv),
      });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        snapshot.enoent_count += 1;
        if (snapshot.error_class === PROCESS_COLLECTION_ERROR_CLASSES.NONE)
          snapshot.error_class = PROCESS_COLLECTION_ERROR_CLASSES.ENOENT;
      } else {
        snapshot.read_error_count += 1;
        snapshot.error_class = PROCESS_COLLECTION_ERROR_CLASSES.READ_ERROR;
      }
    }
  }
  try {
    const classified = records.length ? classifyProcessRecords(records) : [];
    snapshot.emitted_count = classified.length;
    return { snapshot, records: classified };
  } catch {
    snapshot.read_error_count += 1;
    snapshot.error_class = PROCESS_COLLECTION_ERROR_CLASSES.READ_ERROR;
    return { snapshot, records: [] };
  }
}

function emptyProcessSnapshot(errorClass) {
  return {
    snapshot: {
      numeric_count: 0,
      emitted_count: 0,
      enoent_count: 0,
      read_error_count: 1,
      error_class: errorClass,
    },
    records: [],
    pidSet: [],
  };
}

export function collectProcessSnapshots({
  listProcEntries,
  readComm,
  readStatus,
  readCmdline,
}) {
  const takeSnapshot = () => {
    let procEntries;
    try {
      procEntries = listProcEntries();
      if (!Array.isArray(procEntries))
        throw new Error('process_entries_invalid');
    } catch {
      return emptyProcessSnapshot(
        PROCESS_COLLECTION_ERROR_CLASSES.SNAPSHOT_ERROR,
      );
    }
    const observed = snapshotProcessRecords({
      procEntries,
      readComm,
      readStatus,
      readCmdline,
    });
    return {
      ...observed,
      pidSet: procEntries
        .filter((pidText) => /^\d+$/u.test(String(pidText)))
        .slice(0, MAX_PROCESS_RECORDS)
        .map(Number)
        .sort((left, right) => left - right),
    };
  };
  const snapshots = [takeSnapshot(), takeSnapshot()];
  const [first, second] = snapshots;
  const samePidSet =
    JSON.stringify(first.pidSet) === JSON.stringify(second.pidSet);
  const sameRecords =
    JSON.stringify(first.records) === JSON.stringify(second.records);
  const stable = samePidSet && sameRecords;
  const complete =
    stable &&
    snapshots.every(
      ({ snapshot, records }) =>
        snapshot.enoent_count === 0 &&
        snapshot.read_error_count === 0 &&
        snapshot.error_class === PROCESS_COLLECTION_ERROR_CLASSES.NONE &&
        snapshot.numeric_count === snapshot.emitted_count &&
        records.length > 0,
    );
  return {
    processes: second.records.length ? second.records : first.records,
    process_collection: {
      snapshots: snapshots.map(({ snapshot }) => snapshot),
      stable,
      complete,
    },
  };
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

export const processInspectionScript = `const fs=require('node:fs');const MAX_COMM_LENGTH=${MAX_COMM_LENGTH};const MAX_PROCESS_RECORDS=${MAX_PROCESS_RECORDS};const MAX_RAW_CMDLINE_LENGTH=${MAX_RAW_CMDLINE_LENGTH};const PROCESS_IDENTITIES=${JSON.stringify(PROCESS_IDENTITIES)};const PROCESS_COLLECTION_ERROR_CLASSES=${JSON.stringify(PROCESS_COLLECTION_ERROR_CLASSES)};const isNodeExecutable=(${isNodeExecutable.toString()});const isRuntimeSupervisorInvocation=(${isRuntimeSupervisorInvocation.toString()});const isValidListenAddress=(${isValidListenAddress.toString()});const hasExactPaseoStartGrammar=(${hasExactPaseoStartGrammar.toString()});const classifyProcessIdentity=(${classifyProcessIdentity.toString()});const isStrongPaseoInvocation=(${isStrongPaseoInvocation.toString()});const classifyProcessRecords=(${classifyProcessRecords.toString()});const snapshotProcessRecords=(${snapshotProcessRecords.toString()});const emptyProcessSnapshot=(${emptyProcessSnapshot.toString()});const collectProcessSnapshots=(${collectProcessSnapshots.toString()});const output=JSON.stringify(collectProcessSnapshots({listProcEntries:()=>fs.readdirSync('/proc'),readComm:pid=>fs.readFileSync('/proc/'+pid+'/comm','utf8'),readStatus:pid=>fs.readFileSync('/proc/'+pid+'/status','utf8'),readCmdline:pid=>fs.readFileSync('/proc/'+pid+'/cmdline','utf8')}));if(output.length>${MAX_PROCESS_OUTPUT_LENGTH})throw new Error('process_output_limit');process.stdout.write(output);`;

function strictProcessRecords(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('process_records_empty');
  if (value.length > MAX_PROCESS_RECORDS)
    throw new Error('process_records_limit');
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
  if (output.length > MAX_PROCESS_OUTPUT_LENGTH)
    throw new Error('process_output_limit');
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error('process_json_invalid');
  }
  return strictProcessRecords(value);
}

function strictProcessCollection(value) {
  if (value === null || typeof value !== 'object')
    throw new Error('process_collection_invalid');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'complete,snapshots,stable')
    throw new Error('process_collection_schema_invalid');
  if (!Array.isArray(value.snapshots) || value.snapshots.length !== 2)
    throw new Error('process_collection_snapshot_count_invalid');
  const snapshots = value.snapshots.map((snapshot) => {
    if (snapshot === null || typeof snapshot !== 'object')
      throw new Error('process_snapshot_invalid');
    const snapshotKeys = Object.keys(snapshot).sort();
    if (
      snapshotKeys.join(',') !==
      'emitted_count,enoent_count,error_class,numeric_count,read_error_count'
    )
      throw new Error('process_snapshot_schema_invalid');
    if (
      !['none', 'enoent', 'read_error', 'limit', 'snapshot_error'].includes(
        snapshot.error_class,
      ) ||
      !Number.isSafeInteger(snapshot.numeric_count) ||
      snapshot.numeric_count < 0 ||
      snapshot.numeric_count > MAX_PROCESS_RECORDS ||
      !Number.isSafeInteger(snapshot.emitted_count) ||
      snapshot.emitted_count < 0 ||
      snapshot.emitted_count > MAX_PROCESS_RECORDS ||
      !Number.isSafeInteger(snapshot.enoent_count) ||
      snapshot.enoent_count < 0 ||
      snapshot.enoent_count > MAX_PROCESS_RECORDS ||
      !Number.isSafeInteger(snapshot.read_error_count) ||
      snapshot.read_error_count < 0 ||
      snapshot.read_error_count > MAX_PROCESS_RECORDS
    )
      throw new Error('process_snapshot_value_invalid');
    return {
      numeric_count: snapshot.numeric_count,
      emitted_count: snapshot.emitted_count,
      enoent_count: snapshot.enoent_count,
      read_error_count: snapshot.read_error_count,
      error_class: snapshot.error_class,
    };
  });
  if (typeof value.stable !== 'boolean' || typeof value.complete !== 'boolean')
    throw new Error('process_collection_value_invalid');
  if (
    value.complete &&
    (!value.stable ||
      snapshots.some(
        (snapshot) =>
          snapshot.enoent_count !== 0 ||
          snapshot.read_error_count !== 0 ||
          snapshot.error_class !== 'none' ||
          snapshot.numeric_count !== snapshot.emitted_count ||
          snapshot.emitted_count === 0,
      ))
  )
    throw new Error('process_collection_complete_invalid');
  return {
    snapshots,
    stable: value.stable,
    complete: value.complete,
  };
}

export function parseProcessCollection(value) {
  return strictProcessCollection(value);
}

function parseCollectedProcesses(output) {
  if (typeof output !== 'string' || output.trim() === '')
    throw new Error('process_json_empty');
  if (output.length > MAX_PROCESS_OUTPUT_LENGTH)
    throw new Error('process_output_limit');
  let value;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error('process_json_invalid');
  }
  if (value === null || typeof value !== 'object')
    throw new Error('process_collection_result_invalid');
  const keys = Object.keys(value).sort();
  if (keys.join(',') !== 'process_collection,processes')
    throw new Error('process_collection_result_schema_invalid');
  if (!Array.isArray(value.processes))
    throw new Error('process_records_invalid');
  return {
    processes: value.processes.length
      ? strictProcessRecords(value.processes)
      : [],
    process_collection: strictProcessCollection(value.process_collection),
  };
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
  return (
    process?.identity === PROCESS_IDENTITIES.PASEO_DAEMON ||
    process?.identity === PROCESS_IDENTITIES.PASEO_SUPERVISOR
  );
}

export function isPaseoProcess(process) {
  return (
    process?.identity === PROCESS_IDENTITIES.PASEO_DAEMON ||
    process?.identity === PROCESS_IDENTITIES.PASEO_SUPERVISOR ||
    process?.identity === PROCESS_IDENTITIES.PASEO_RUNTIME_LAUNCHER
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
  const collected = parseCollectedProcesses(output);
  return { containerId, ...collected };
}
