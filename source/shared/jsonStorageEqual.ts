import isEqual from 'lodash/isEqual';

const serializationImage = (value: unknown): unknown => {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : JSON.parse(serialized);
};

/** Compare JSON serialization images by value; stored strings stay opaque. */
export function jsonStorageEqual(left: unknown, right: unknown): boolean {
  return isEqual(serializationImage(left), serializationImage(right));
}
