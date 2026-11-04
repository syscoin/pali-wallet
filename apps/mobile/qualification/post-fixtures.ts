/** Public synthetic transport fixtures only. No signed transaction or wallet key. */
export const POST_ADDRESS = '0x1111111111111111111111111111111111111111';
export const POST_QUANTITY = '0x20000000000001';
export const POST_UNITS = '9007199254740993';
export const POST_RETRY_PAYLOAD = '0x00010203feff';
// Literal expectations are independent of the production JSON.stringify call.
export const POST_CHAIN_BODY = '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}';
export const POST_BALANCE_BODY = '{"jsonrpc":"2.0","id":2,"method":"eth_getBalance","params":["0x1111111111111111111111111111111111111111","latest"]}';
export const POST_RETRY_BODY = '{"jsonrpc":"2.0","id":47,"method":"pali_qualificationEcho","params":["0x00010203feff"]}';
export const POST_BODIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'post-balance': Object.freeze([POST_CHAIN_BODY, POST_BALANCE_BODY]),
  'post-zero': Object.freeze([POST_CHAIN_BODY, POST_BALANCE_BODY]),
  'post-id': Object.freeze([POST_CHAIN_BODY]),
  'post-error': Object.freeze([POST_CHAIN_BODY]),
  'post-malformed': Object.freeze([POST_CHAIN_BODY]),
  'post-type': Object.freeze([POST_CHAIN_BODY]),
  'post-declared': Object.freeze([POST_CHAIN_BODY]),
  'post-stream': Object.freeze([POST_CHAIN_BODY]),
  'post-abort': Object.freeze([POST_CHAIN_BODY]),
  'post-healthy': Object.freeze([POST_CHAIN_BODY, POST_BALANCE_BODY]),
  'post-lost': Object.freeze([POST_RETRY_BODY, POST_RETRY_BODY]),
});
export const POST_CONTROLS = Object.freeze(['post-ready', 'post-closed']);
export const POST_ROUTES = Object.freeze([...Object.keys(POST_BODIES), ...POST_CONTROLS]);
export const POST_REQUEST_LIMIT = 8192;
