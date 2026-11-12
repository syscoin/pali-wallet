import fs from 'fs';
import path from 'path';

const fileName = 'DevToolsActivePort';
const endpointPrefix = '/devtools/browser/';
const completeRecord =
  /^(\d{1,5})\n\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n?$/i;

function checkedFile(file: string) {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.size > 1024
  )
    throw new Error('Unsafe owned browser debugging port file');
  return stat;
}

/** Call only after validating the run-owned profile and closing its prior browser. */
export function clearOwnedDebuggingPort(profileDir: string) {
  const file = path.join(profileDir, fileName);
  try {
    checkedFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  fs.unlinkSync(file);
}

export async function waitForOwnedDebuggingPort(
  profileDir: string,
  {
    isOpen,
    pollIntervalMs = 25,
    timeoutMs = 10000,
  }: {
    isOpen: () => boolean;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }
): Promise<string> {
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 10000 ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs < 1 ||
    pollIntervalMs > timeoutMs
  )
    throw new Error('Invalid debugging port readiness deadline');
  const file = path.join(profileDir, fileName),
    deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!isOpen())
      throw new Error(
        'Owned browser closed before debugging port became ready'
      );
    try {
      const before = checkedFile(file);
      const fd = fs.openSync(
        file,
        fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
      );
      let text: string;
      try {
        const opened = fs.fstatSync(fd);
        if (
          !opened.isFile() ||
          opened.nlink !== 1 ||
          opened.ino !== before.ino ||
          opened.dev !== before.dev ||
          opened.size > 1024
        )
          throw new Error('Unsafe owned browser debugging port file');
        const bytes = Buffer.alloc(1025);
        const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
        if (count > 1024)
          throw new Error('Unsafe owned browser debugging port file');
        text = bytes.subarray(0, count).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
      const match = completeRecord.exec(text);
      if (match) {
        if (Number(match[1]) < 1 || Number(match[1]) > 65535)
          throw new Error('Invalid owned browser debugging port');
        return match[1];
      }
      const [port, endpoint, ...extra] = text.split('\n');
      const portPrefix = /^\d{0,5}$/.test(port);
      const pendingPort =
        endpoint === undefined && portPrefix && Number(port) <= 65535;
      const pendingEndpoint =
        endpoint !== undefined &&
        extra.length === 0 &&
        /^\d{1,5}$/.test(port) &&
        Number(port) >= 1 &&
        Number(port) <= 65535 &&
        (endpointPrefix.startsWith(endpoint) ||
          (endpoint.startsWith(endpointPrefix) &&
            /^[0-9a-f-]*$/i.test(endpoint.slice(endpointPrefix.length)) &&
            endpoint.length < endpointPrefix.length + 36));
      if (!pendingPort && !pendingEndpoint)
        throw new Error('Invalid owned browser debugging port');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for owned browser debugging port');
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollIntervalMs, deadline - Date.now()))
    );
  }
}
