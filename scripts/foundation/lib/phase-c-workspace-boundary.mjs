export function workspaceIsReadOnly(probe) {
  return (
    probe?.write_exit === 1 &&
    probe.error_code === 'EROFS' &&
    probe.file_present === false
  );
}

export function workspaceIsWritable(probe) {
  return (
    probe?.write_exit === 0 &&
    probe.error_code === null &&
    probe.file_present === true
  );
}
