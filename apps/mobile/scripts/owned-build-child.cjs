const { spawn } = require('node:child_process');

function interruptedError(signal, preserveLock = false) {
  return Object.assign(new Error(preserveLock
    ? 'Native build interrupted; child-tree shutdown could not be confirmed.'
    : `Native build interrupted (${signal}).`), {
    code: 'NATIVE_BUILD_INTERRUPTED', signal, preserveLock,
    exitCode: signal === 'SIGINT' ? 130 : 143,
  });
}

/** Only the new child's process group is signalled; never the caller's terminal group. */
async function runOwnedBuildChild(command, args, { cwd, env, signal }) {
  if (signal.aborted) throw interruptedError(signal.reason);
  const grouped = process.platform !== 'win32';
  const child = spawn(command, args, { cwd, env, stdio: 'inherit', detached: grouped });
  let spawnError, forceTimer, timeoutTimer, signallingError, closed = false, rejectClose;
  let deadline, retiring = false;
  const send = value => {
    if (!child.pid) return;
    try {
      if (grouped) process.kill(-child.pid, value);
      else child.kill(value);
    } catch (error) {
      if (error.code !== 'ESRCH') signallingError = error;
    }
  };
  const retire = value => {
    if (retiring) return;
    retiring = true;
    deadline = Date.now() + 10000;
    send(value);
    // Give the owned build a chance to stop cleanly, then bound an ignored signal.
    forceTimer = setTimeout(() => send('SIGKILL'), 5000);
    forceTimer.unref();
    timeoutTimer = setTimeout(() => {
      if (!closed) {
        child.unref();
        rejectClose(interruptedError(signal.reason, true));
      }
    }, 10000);
  };
  const abort = () => retire(signal.reason);
  const suspend = () => { send('SIGSTOP'); process.kill(process.pid, 'SIGSTOP'); };
  const resume = () => send('SIGCONT');
  signal.addEventListener('abort', abort, { once: true });
  if (grouped) {
    process.on('SIGTSTP', suspend);
    process.on('SIGCONT', resume);
  }
  if (signal.aborted) abort();
  try {
    const result = await new Promise((resolve, reject) => {
      rejectClose = reject;
      child.once('error', error => { spawnError = error; });
      // close, unlike error/exit, also waits for the child's stdio to close.
      child.once('close', (code, exitSignal) => { closed = true; resolve({ code, signal: exitSignal }); });
    });
    let abandoned = false;
    if (grouped && child.pid) {
      for (;;) {
        try { process.kill(-child.pid, 0); }
        catch (error) {
          if (error.code === 'ESRCH') break;
          throw Object.assign(new Error('Native child-tree shutdown could not be confirmed.'), { preserveLock: true });
        }
        // A direct child exit is not proof that its descendants stopped. Retire
        // abandoned work even on exit zero; it must not overlap the next phase.
        abandoned = true;
        retire('SIGTERM');
        if (signallingError || Date.now() >= deadline)
          throw Object.assign(new Error('Native child-tree shutdown could not be confirmed.'), { preserveLock: true });
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    if (signal.aborted) {
      // Windows cannot prove descendant exit through POSIX process-group probes.
      throw interruptedError(signal.reason, !grouped && !!child.pid);
    }
    if (spawnError) throw spawnError;
    if (abandoned) throw new Error('Native build child exited while its descendants were still running; abandoned work was stopped.');
    return result;
  } finally {
    clearTimeout(forceTimer);
    clearTimeout(timeoutTimer);
    signal.removeEventListener('abort', abort);
    if (grouped) {
      process.removeListener('SIGTSTP', suspend);
      process.removeListener('SIGCONT', resume);
    }
  }
}

module.exports = { runOwnedBuildChild, interruptedError };
