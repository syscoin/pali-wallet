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

  return { error: { name, message, stack }, data: { name, message, stack } };
}
