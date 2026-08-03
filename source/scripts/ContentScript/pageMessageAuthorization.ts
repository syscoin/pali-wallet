const PUBLIC_PROVIDER_MESSAGE_TYPES = new Set([
  'DISABLE',
  'ENABLE',
  'IS_UNLOCKED',
  'METHOD_REQUEST',
]);

/** Only provider protocol messages may cross from page JavaScript. */
export const isAllowedPageProviderMessageType = (type: string): boolean =>
  PUBLIC_PROVIDER_MESSAGE_TYPES.has(type);
