import * as crypto from 'crypto';

const hashString = (input: string): string =>
  crypto.createHash('sha256').update(input).digest('hex');

const canonicalize = (obj: any): any => {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }

  return Object.keys(obj)
    .sort()
    .reduce((result: any, key: string) => {
      result[key] = canonicalize(obj[key]);
      return result;
    }, {});
};

export const compareObjects = (obj1: object, obj2: object): boolean => {
  const str1 = JSON.stringify(canonicalize(obj1));
  const str2 = JSON.stringify(canonicalize(obj2));

  const hash1 = hashString(str1);
  const hash2 = hashString(str2);

  return hash1 === hash2;
};
