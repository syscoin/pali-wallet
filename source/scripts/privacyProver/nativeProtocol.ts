import { validatePrivacyProofInput } from '../../utils/privacy/proverCore';

import type {
  IPrivacyProofInput,
  IPrivacyProofProgress,
  IPrivacyProofResult,
} from '../../utils/privacy/proverTypes';

export const PRIVATE_PROOF_MESSAGE_LIMIT = 8192;
export { PRIVATE_PROOF_JOB } from './nativeJobId.ts';
import { PRIVATE_PROOF_JOB } from './nativeJobId.ts';
const inputKeys = [
  'fee',
  'nullifier',
  'nullifierHash',
  'pathElements',
  'pathIndices',
  'recipient',
  'refund',
  'relayer',
  'root',
  'secret',
];
const failed = () => new Error('privacy_proof_failed');
const parse = (json: string) => {
  try {
    return JSON.parse(json);
  } catch {
    throw failed();
  }
};

export function captureNativeProofInput(json: string): IPrivacyProofInput {
  if (typeof json !== 'string' || json.length > PRIVATE_PROOF_MESSAGE_LIMIT)
    throw failed();
  const input = parse(json);
  if (
    !input ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== inputKeys.join(',')
  )
    throw failed();
  validatePrivacyProofInput(input);
  return {
    ...input,
    pathElements: [...input.pathElements],
    pathIndices: [...input.pathIndices],
  };
}

export type NativeProofMessage =
  | { id: string; type: 'ready' | 'error' | 'disposed'; version: 1 }
  | {
      id: string;
      progress: IPrivacyProofProgress;
      type: 'progress';
      version: 1;
    }
  | { id: string; result: IPrivacyProofResult; type: 'success'; version: 1 };

/** Project only the fixed protocol. Raw worker/native errors never leave the host. */
export function readNativeProofMessage(
  json: string,
  id: string,
  expected?: readonly string[]
): NativeProofMessage {
  if (
    !PRIVATE_PROOF_JOB.test(id) ||
    typeof json !== 'string' ||
    json.length > PRIVATE_PROOF_MESSAGE_LIMIT
  )
    throw failed();
  const value = parse(json);
  if (!value || Array.isArray(value) || value.version !== 1 || value.id !== id)
    throw failed();
  const keys = Object.keys(value).sort().join(',');
  if (
    ['ready', 'error', 'disposed'].includes(value.type) &&
    keys === 'id,type,version'
  )
    return value;
  if (value.type === 'progress' && keys === 'id,progress,type,version') {
    const progress = value.progress;
    if (
      !progress ||
      Array.isArray(progress) ||
      !['artifacts', 'witness', 'proving', 'verifying'].includes(
        progress.stage
      ) ||
      Object.keys(progress).some(
        (key) => !['stage', 'completed', 'total'].includes(key)
      ) ||
      ['completed', 'total'].some(
        (key) =>
          progress[key] !== undefined &&
          (!Number.isSafeInteger(progress[key]) ||
            progress[key] < 0 ||
            progress[key] > 14522256)
      )
    )
      throw failed();
    return { version: 1, id, type: 'progress', progress: { ...progress } };
  }
  if (
    value.type === 'success' &&
    keys === 'id,result,type,version' &&
    expected?.length === 6
  ) {
    const result = value.result;
    if (
      !result ||
      Object.keys(result).sort().join(',') !== 'proof,publicSignals' ||
      typeof result.proof !== 'string' ||
      !/^0x[0-9a-f]{512}$/i.test(result.proof) ||
      !Array.isArray(result.publicSignals) ||
      result.publicSignals.length !== 6 ||
      result.publicSignals.some(
        (signal: unknown, index: number) => signal !== expected[index]
      )
    )
      throw failed();
    return {
      version: 1,
      id,
      type: 'success',
      result: { proof: result.proof, publicSignals: [...result.publicSignals] },
    };
  }
  throw failed();
}
