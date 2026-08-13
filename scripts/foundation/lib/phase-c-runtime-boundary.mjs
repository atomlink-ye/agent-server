export function runtimeIsNonroot(identity) {
  return (
    identity?.process_uid === 1000 &&
    identity.process_gid === 1000 &&
    identity.pid1_uid === 1000 &&
    identity.pid1_gid === 1000
  );
}

export function runtimeStateIsWritable(probe) {
  return (
    probe?.write_exit === 0 &&
    probe.error_code === null &&
    probe.file_present === false
  );
}

export function runtimeStateIsReadOnly(probe) {
  return (
    probe?.write_exit === 1 &&
    probe.error_code === 'EROFS' &&
    probe.file_present === false
  );
}
