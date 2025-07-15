/**
 * Returns error without stack trace for better UI display
 *
 * @param {Error} err - error
 * @returns {Error} Error with clean stack trace.
 */
export default function cleanErrorStack(err: Error) {
  // eslint-disable-next-line
  let { name, message, stack } = err;
  name = name === undefined ? 'Error' : String(name);

  let msg = err.message;
  msg = msg === undefined ? '' : String(msg);

  if (name === '') {
    err.stack = err.message;
  } else if (msg === '') {
    err.stack = err.name;
  } else if (!err.stack) {
    err.stack = `${err.name}: ${err.message}`;
  }

  // Create a new Error object with preserved properties
  const cleanedError = new Error(message);
  cleanedError.name = name;
  cleanedError.stack = stack;

  // Preserve error code for RPC errors
  const code = (err as any).code;
  if (code !== undefined) {
    (cleanedError as any).code = code;
  }

  return cleanedError;
}
