import {
  captureLocalPasskeyResponse,
  localPasskeyError,
  localPasskeyField,
  localPasskeyFields,
  type LocalPasskeyResponse,
} from '../wallet/localPasskeyTypes';

export const LOCAL_PASSKEY_PORT = 'pali-local-passkey-unlock';
export const LOCAL_PASSKEY_DEADLINE_MS = 90_000;
export type LocalPasskeyCommand =
  | { id: number; method: 'status' | 'beginUnlock'; params: [] }
  | { id: number; method: 'beginEnrollment' | 'disable'; params: [string] }
  | {
      id: number;
      method: 'complete';
      params: [string, string, LocalPasskeyResponse];
    };

/** Only the dedicated document Port accepts these commands; never general RPC. */
export function captureLocalPasskeyCommand(
  value: unknown
): LocalPasskeyCommand {
  localPasskeyFields(value, ['id', 'method', 'params']);
  const id = localPasskeyField(value, 'id');
  const method = localPasskeyField(value, 'method');
  const params = localPasskeyField(value, 'params');
  if (!Number.isSafeInteger(id) || (id as number) < 1 || !Array.isArray(params))
    throw localPasskeyError();
  if ((method === 'status' || method === 'beginUnlock') && params.length === 0)
    return { id: id as number, method, params: [] };
  if (
    (method === 'beginEnrollment' || method === 'disable') &&
    params.length === 1 &&
    typeof params[0] === 'string' &&
    params[0].length > 0 &&
    params[0].length <= 1024
  )
    return { id: id as number, method, params: [params[0]] };
  if (
    method === 'complete' &&
    params.length === 3 &&
    typeof params[0] === 'string' &&
    /^[a-f0-9]{32}$/.test(params[0]) &&
    typeof params[1] === 'string' &&
    /^[a-f0-9]{32}$/.test(params[1])
  )
    return {
      id: id as number,
      method,
      params: [params[0], params[1], captureLocalPasskeyResponse(params[2])],
    };
  throw localPasskeyError();
}
