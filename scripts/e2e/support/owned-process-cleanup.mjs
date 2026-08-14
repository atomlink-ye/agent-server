export const CLEANUP_COMPLETE = 'complete';
export const CLEANUP_MISSING = 'missing';
export const CLEANUP_RESIDUAL = 'residual';

export async function cleanupOwnedProcess(
  child,
  { signal = 'SIGTERM', timeoutMs = 2_000, killImpl = (value, name) => value.kill(name) } = {},
) {
  if (!child || typeof child.once !== 'function')
    return { complete: false, residual: false, status: CLEANUP_MISSING, reason: 'collector-unavailable' };
  if (child.exitCode !== null)
    return { complete: true, residual: false, status: CLEANUP_COMPLETE, exitCode: child.exitCode };
  try {
    killImpl(child, signal);
  } catch (error) {
    return { complete: false, residual: false, status: CLEANUP_MISSING, reason: String(error) };
  }
  const exited = await new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      finish(true);
    });
  });
  if (!exited)
    return { complete: false, residual: true, status: CLEANUP_RESIDUAL, reason: 'term-timeout' };
  return { complete: true, residual: false, status: CLEANUP_COMPLETE, exitCode: child.exitCode };
}
