function nonemptyLines(value) {
  return String(value ?? '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function exactServiceContainerId(output, service) {
  const ids = nonemptyLines(output);
  if (ids.length !== 1)
    throw new Error(`container_count:${service}:${ids.length}`);
  if (!/^[a-f0-9]{12,64}$/u.test(ids[0]))
    throw new Error(`container_id_invalid:${service}`);
  return ids[0];
}

export function parseProcessUserComm(output) {
  return nonemptyLines(output).map((line) => {
    const match = /^(\S+)\s+(\S+)$/u.exec(line);
    if (!match) throw new Error('process_row_invalid');
    return { user: match[1], comm: match[2] };
  });
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
  const processes = parseProcessUserComm(
    run('docker', ['top', containerId, '-eo', 'user=,comm='], {
      identity: `${identity}-processes`,
    }).stdout,
  );
  return { containerId, processes };
}
