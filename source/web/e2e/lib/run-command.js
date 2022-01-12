const spawn = require('cross-spawn');

async function runCommand(command, args) {
  const output = [];
  let mostRecentError;
  let errorSignal;
  let errorCode;
  const internalError = new Error('Internal');
  try {
    await new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, { encoding: 'utf8' });
      childProcess.stdout.setEncoding('utf8');
      childProcess.stderr.setEncoding('utf8');

      childProcess.on('error', (error) => {
        mostRecentError = error;
      });

      childProcess.stdout.on('data', (message) => {
        const nonEmptyLines = message.split('\n').filter((line) => line !== '');
        output.push(...nonEmptyLines);
      });

      childProcess.stderr.on('data', (message) => {
        mostRecentError = new Error(message.trim());
      });

      childProcess.once('exit', (code, signal) => {
        if (code === 0) {
          return resolve();
        }
        errorCode = code;
        errorSignal = signal;
        return reject(internalError);
      });
    });
  } catch (error) {
    if (error === internalError) {
      let errorMessage;
      if (errorCode !== null && errorSignal !== null) {
        errorMessage = `Terminated by signal '${errorSignal}'; exited with code '${errorCode}'`;
      } else if (errorSignal !== null) {
        errorMessage = `Terminaled by signal '${errorSignal}'`;
      } else if (errorCode === null) {
        errorMessage = 'Exited with no code or signal';
      } else {
        errorMessage = `Exited with code '${errorCode}'`;
      }
      const improvedError = new Error(errorMessage);
      if (mostRecentError) {
        improvedError.cause = mostRecentError;
      }
      throw improvedError;
    }
  }
  return output;
}

async function runInShell(command, args) {
  let errorSignal;
  let errorCode;
  const internalError = new Error('Internal');
  try {
    await new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        encoding: 'utf8',
        stdio: 'inherit',
      });

      childProcess.once('exit', (code, signal) => {
        if (code === 0) {
          return resolve();
        }
        errorCode = code;
        errorSignal = signal;
        return reject(internalError);
      });
    });
  } catch (error) {
    if (error === internalError) {
      let errorMessage;
      if (errorCode !== null && errorSignal !== null) {
        errorMessage = `Terminated by signal '${errorSignal}'; exited with code '${errorCode}'`;
      } else if (errorSignal !== null) {
        errorMessage = `Terminaled by signal '${errorSignal}'`;
      } else if (errorCode === null) {
        errorMessage = 'Exited with no code or signal';
      } else {
        errorMessage = `Exited with code '${errorCode}'`;
      }
      const improvedError = new Error(errorMessage);
      throw improvedError;
    }
  }
}

module.exports = { runCommand, runInShell };
