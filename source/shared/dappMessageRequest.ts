import {
  getPersonalSignParams,
  isValidPersonalSignMessage,
} from '../utils/personalSignReview.ts';
import {
  assertJsonWorkBudget,
  DAPP_REQUEST_LIMITS,
} from '../utils/requestPayloadBudget.ts';
import { assertTypedDataWorkBudget } from '../utils/typedDataWorkBudget.ts';

export type DappMessageMethod =
  | 'personal_sign'
  | 'eth_signTypedData'
  | 'eth_signTypedData_v3'
  | 'eth_signTypedData_v4';
export type DappMessageRequest = Readonly<
  | { address: string; message: string; method: 'personal_sign' }
  | {
      address: string;
      method: Exclude<DappMessageMethod, 'personal_sign'>;
      typedData: unknown;
      version: 'V1' | 'V3' | 'V4';
    }
>;

export function isDappMessageMethod(
  method: unknown
): method is DappMessageMethod {
  return (
    method === 'personal_sign' ||
    method === 'eth_signTypedData' ||
    method === 'eth_signTypedData_v3' ||
    method === 'eth_signTypedData_v4'
  );
}

function snapshotTypedData(data: unknown): unknown {
  assertTypedDataWorkBudget(data);
  const snapshot = JSON.parse(JSON.stringify(data));
  const pending: object[] = [snapshot];
  while (pending.length) {
    const value = pending.pop()!;
    Object.freeze(value);
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') pending.push(child);
    }
  }
  return snapshot;
}

/** Capture the same address/payload interpretation used by the approval screen. */
export function readDappMessageRequest(
  method: unknown,
  params: unknown,
  signerAddress: string
): DappMessageRequest | undefined {
  if (!isDappMessageMethod(method) || !/^0x[\da-f]{40}$/i.test(signerAddress))
    return;
  try {
    assertJsonWorkBudget(params, DAPP_REQUEST_LIMITS.signingBytes);
    if (!params || typeof params !== 'object') return;
    const values = params as { [index: number]: unknown };
    if (method === 'personal_sign') {
      const request = getPersonalSignParams(values);
      if (
        !request ||
        request.address.toLowerCase() !== signerAddress.toLowerCase() ||
        !isValidPersonalSignMessage(request.message)
      )
        return;
      return Object.freeze({ method, ...request });
    }
    const isSigner = (value: unknown) =>
      typeof value === 'string' &&
      value.toLowerCase() === signerAddress.toLowerCase();
    const payload = isSigner(values[0])
      ? values[1]
      : isSigner(values[1])
      ? values[0]
      : undefined;
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (method === 'eth_signTypedData') {
      if (
        !Array.isArray(data) ||
        data.length === 0 ||
        data.some(
          (field) =>
            !field ||
            typeof field !== 'object' ||
            Array.isArray(field) ||
            typeof field.name !== 'string' ||
            typeof field.type !== 'string' ||
            !Object.hasOwn(field, 'value')
        )
      )
        return;
    } else if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    const version: 'V1' | 'V3' | 'V4' =
      method === 'eth_signTypedData'
        ? 'V1'
        : method === 'eth_signTypedData_v3'
        ? 'V3'
        : 'V4';
    return Object.freeze({
      method,
      address: signerAddress,
      typedData: snapshotTypedData(data),
      version,
    });
  } catch {
    return;
  }
}

/** Match the exact reviewed SDK invocation without hashing or altering its data. */
export function matchesDappMessageRequest(
  request: DappMessageRequest,
  args: unknown
): boolean {
  try {
    assertJsonWorkBudget(args, DAPP_REQUEST_LIMITS.bytes);
    if (!Array.isArray(args)) return false;
    if (request.method === 'personal_sign') {
      return (
        args.length === 1 &&
        args[0]?.[0] === request.address &&
        args[0]?.[1] === request.message
      );
    }
    if (
      args.length !== 3 ||
      typeof args[0] !== 'string' ||
      args[0].toLowerCase() !== request.address.toLowerCase() ||
      args[2] !== request.version
    )
      return false;
    assertTypedDataWorkBudget(args[1]);
    return JSON.stringify(args[1]) === JSON.stringify(request.typedData);
  } catch {
    return false;
  }
}
