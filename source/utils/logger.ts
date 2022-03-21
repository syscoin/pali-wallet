import { capitalizeFirstLetter } from './format';

const environment = process.env.NODE_ENV;
const isProd = environment === 'production';

function logFormatter(message: string, prefix?: string): string {
  let formattedString = '';

  //* format prefix
  if (prefix) {
    prefix = capitalizeFirstLetter(prefix);
    formattedString = formattedString.concat(`[${prefix}]: `);
  }

  //* format message
  message = capitalizeFirstLetter(message);
  formattedString = formattedString.concat(message);

  return formattedString;
}

export function log(
  message: string,
  prefix?: string,
  object?: any,
  alwaysShowObject = false
) {
  //* log
  console.log(logFormatter(message, prefix));

  //* display object
  if (!object) return;
  if (!isProd || alwaysShowObject) console.dir(object);
}

type ErrorType = '' | 'User' | 'UI' | 'Connection' | 'Transaction' | 'Trezor';

export function logError(
  message: string,
  type: ErrorType = '',
  object?: any,
  alwaysShowObject = false
) {
  //* format type
  let typeString = '';
  if (type !== '') typeString = `${type} `;
  typeString = typeString.concat('Error');

  //* format message
  const finalMessage = logFormatter(message, typeString);

  //* log
  console.error(finalMessage);

  //* display object
  if (!object) return;
  if (!isProd || alwaysShowObject) console.dir(object);
}
