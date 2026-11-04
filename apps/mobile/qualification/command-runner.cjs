const { Buffer } = require('node:buffer');
const DEFAULT_COMMAND_TIMEOUT_MS = 180000;
const COLD_BOOT_TIMEOUT_MS = 600000;

class QualificationCommandError extends Error {
  constructor(failure) {
    super(`Native command failed: ${failure.command}`);
    this.name = 'QualificationCommandError';
    this.failure = failure;
  }
}

/** Public-fixture diagnostics only, with fixed output and argument bounds. */
function createCommandRunner(spawnSync, redact = (value) => value) {
  const bounded = (value, limit) => redact(String(value ?? '')).slice(-limit);
  const execute = (command, args, optional, timeoutMs, binary, maxBuffer) => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > COLD_BOOT_TIMEOUT_MS ||
      !Number.isSafeInteger(maxBuffer) || maxBuffer < 1 || maxBuffer > 64 * 1024 * 1024)
      throw Error('Invalid native command bounds');
    let result;
    try {
      result = spawnSync(command, args, {
        ...(binary ? {} : { encoding: 'utf8' }), timeout: timeoutMs, maxBuffer,
      });
    } catch (error) {
      result = { status: null, signal: null, error };
    }
    if (result.status === 0)
      return binary ? (result.stdout || Buffer.alloc(0)) : String(result.stdout ?? '').trim();
    // Best-effort cleanup cannot replace the primary thrown failure.
    if (optional) return null;
    throw new QualificationCommandError(Object.freeze({
      kind: 'command',
      command: bounded(command, 256),
      args: Object.freeze(args.slice(0, 24).map((value) => bounded(value, 256))),
      omittedArguments: Math.max(0, args.length - 24),
      timeoutMs,
      timedOut: result.error?.code === 'ETIMEDOUT',
      status: Number.isInteger(result.status) ? result.status : null,
      signal: bounded(result.signal, 64) || null,
      errorCode: bounded(result.error?.code, 64) || null,
      errorMessage: bounded(result.error?.message, 1000) || null,
      stderrTail: bounded(result.stderr, 2000),
      // Database and screenshot bytes must never enter textual artifacts.
      ...(binary ? { stdoutBytes: result.stdout?.byteLength ?? 0 } : { stdoutTail: bounded(result.stdout, 2000) }),
    }));
  };
  const run = (command, args, optional = false, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) =>
    execute(command, args, optional, timeoutMs, false, 8 * 1024 * 1024);
  run.binary = (command, args, optional = false, maxBuffer = 8 * 1024 * 1024) =>
    execute(command, args, optional, DEFAULT_COMMAND_TIMEOUT_MS, true, maxBuffer);
  return run;
}

function describeQualificationFailure(error, redact = (value) => value) {
  if (error instanceof QualificationCommandError) return error.failure;
  return {
    kind: 'qualification',
    message: redact(error instanceof Error ? error.message : 'Unknown qualification failure').slice(0, 2000),
  };
}

module.exports = { createCommandRunner, describeQualificationFailure, COLD_BOOT_TIMEOUT_MS };
