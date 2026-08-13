function numericProcessRecords({ procEntries, readComm, readStatus }) {
  const records = [];
  for (const pidText of procEntries) {
    if (!/^\d+$/u.test(String(pidText))) continue;

    let comm;
    let status;
    try {
      comm = readComm(String(pidText)).trim();
      status = readStatus(String(pidText));
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    const uid = /^Uid:\s+(\d+)(?:\s+\d+){3}\s*$/mu.exec(status)?.[1];
    if (!comm || uid === undefined) throw new Error('process_status_invalid');
    records.push({
      pid: Number(pidText),
      uid: Number(uid),
      comm,
    });
  }
  if (!records.length) throw new Error('process_records_empty');
  return records.sort((left, right) => left.pid - right.pid);
}

export function enumerateNumericProcessRecords({
  procEntries,
  readComm,
  readStatus,
}) {
  return numericProcessRecords({ procEntries, readComm, readStatus });
}

export const processInspectionScript = `const fs=require('node:fs');const records=(${numericProcessRecords.toString()})({procEntries:fs.readdirSync('/proc'),readComm:pid=>fs.readFileSync('/proc/'+pid+'/comm','utf8'),readStatus:pid=>fs.readFileSync('/proc/'+pid+'/status','utf8')});process.stdout.write(JSON.stringify(records));`;

function strictProcessRecords(value) {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error('process_records_empty');
  const seen = new Set();
  return value.map((record) => {
    if (record === null || typeof record !== 'object')
      throw new Error('process_record_invalid');
    const keys = Object.keys(record).sort();
    if (keys.join(',') !== 'comm,pid,uid')
      throw new Error('process_record_schema_invalid');
    if (
      !Number.isSafeInteger(record.pid) ||
      record.pid < 1 ||
      !Number.isSafeInteger(record.uid) ||
      record.uid < 0 ||
      typeof record.comm !== 'string' ||
      record.comm.length === 0 ||
      /[\u0000\r\n]/u.test(record.comm)
    )
      throw new Error('process_record_value_invalid');
    if (seen.has(record.pid)) throw new Error('process_pid_duplicate');
    seen.add(record.pid);
    return { pid: record.pid, uid: record.uid, comm: record.comm };
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
  return /(?:^|\/)paseo$/u.test(String(process?.comm ?? ''));
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
