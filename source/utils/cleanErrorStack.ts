/**
 * Returns error without stack trace for better UI display
 *
 * @param {Error} err - error
 * @returns {Error} Error with clean stack trace.
 */
export default function cleanErrorStack(err: Error) {
  // Extract and validate error properties
  let { name, message } = err;
  name = name === undefined ? 'Error' : String(name);
  message = message === undefined ? '' : String(message);

  // Compute a clean stack trace for UI display
  let cleanStack: string;
  if (name === '') {
    cleanStack = message;
  } else if (message === '') {
    cleanStack = name;
  } else {
    cleanStack = `${name}: ${message}`;
  }

  // Create a new Error object with clean properties
  const cleanedError = new Error(message);
  cleanedError.name = name;
  cleanedError.stack = cleanStack;

  // Preserve error code for RPC errors
  const code = (err as any).code;
  if (code !== undefined) {
    (cleanedError as any).code = code;
  }

  return cleanedError;
}
