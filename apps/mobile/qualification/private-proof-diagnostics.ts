import {
  PRIVATE_PROOF_CASES,
  type PrivateProofCase,
} from './private-proof-contract.ts';
import {
  readNativeExecutionCode,
  type NativeExecutionCode,
} from '../../../source/scripts/privacyProver/nativeExecutionDiagnostic.ts';

export const PRIVATE_PROOF_CHECK = 'native private proof public vectors';
export const PRIVATE_PROOF_BOUNDARIES = Object.freeze([
  'start', 'artifacts', 'witness', 'proving', 'verifying',
  'result-check', 'case-complete', 'report-check', 'report-write',
] as const);
export type PrivateProofBoundary = (typeof PRIVATE_PROOF_BOUNDARIES)[number];
const CODES = Object.freeze([
  'privacy_proof_failed', 'privacy_proof_busy', 'privacy_proof_unavailable',
  'privacy_proof_cancelled', 'privacy_verification_pending',
  'privacy_proof_artifact_invalid', 'privacy_proof_invalid_input',
  'privacy_proof_verification_failed', 'PRIVATE_PROOF_QUALIFICATION_INACTIVE',
  'PRIVATE_PROOF_RESULT_INVALID', 'PRIVATE_PROOF_MUTATION_ACCEPTED',
  'PRIVATE_PROOF_CANCELLATION_NOT_OBSERVED', 'PRIVATE_PROOF_REPORT_INVALID',
  'PRIVATE_PROOF_DIAGNOSTIC_REQUIRED', 'PRIVATE_PROOF_DIAGNOSTIC_INVALID',
  'unrecognized',
] as const);
type PrivateProofCode = (typeof CODES)[number];
export type PrivateProofDiagnostic = Readonly<{
  case: PrivateProofCase;
  boundary: PrivateProofBoundary;
  code: PrivateProofCode;
  nativeExecutionCode?: NativeExecutionCode;
}>;
const invalid = () => new Error('PRIVATE_PROOF_DIAGNOSTIC_INVALID');

/** Only fixed public labels cross the qualification report boundary. */
export function readPrivateProofDiagnostic(value: unknown): PrivateProofDiagnostic {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const keys = Reflect.ownKeys(value).sort().join(',');
    if (keys !== 'boundary,case,code' && keys !== 'boundary,case,code,nativeExecutionCode') throw invalid();
    const own = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw invalid();
      return descriptor.value;
    };
    const caseName = own('case'), boundary = own('boundary'), code = own('code');
    if (!PRIVATE_PROOF_CASES.includes(caseName as PrivateProofCase) ||
        !PRIVATE_PROOF_BOUNDARIES.includes(boundary as PrivateProofBoundary) ||
        !CODES.includes(code as PrivateProofCode)) throw invalid();
    const nativeExecutionCode = readNativeExecutionCode(value);
    if (keys === 'boundary,case,code,nativeExecutionCode' && !nativeExecutionCode) throw invalid();
    return Object.freeze({ case: caseName as PrivateProofCase,
      boundary: boundary as PrivateProofBoundary, code: code as PrivateProofCode,
      ...(nativeExecutionCode ? { nativeExecutionCode } : {}) });
  } catch {
    throw invalid();
  }
}

/** Never retain exception objects, arbitrary messages, inputs, or proof results. */
export function createPrivateProofDiagnostic() {
  let current: Readonly<{ case: PrivateProofCase; boundary: PrivateProofBoundary }> | undefined;
  let failure: PrivateProofDiagnostic | undefined;
  let sealed = false;
  return Object.freeze({
    observe(caseName: PrivateProofCase, boundary: PrivateProofBoundary) {
      const checked = readPrivateProofDiagnostic({ case: caseName, boundary, code: 'unrecognized' });
      if (!sealed) current = Object.freeze({ case: checked.case, boundary: checked.boundary });
    },
    capture(error: unknown) {
      if (sealed) return;
      sealed = true;
      let code: PrivateProofCode = 'unrecognized';
      try {
        if (error instanceof Error) {
          const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
          const message: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
          if (CODES.includes(message as PrivateProofCode)) code = message as PrivateProofCode;
        }
      } catch { /* Hostile exceptions must not replace the qualification failure. */ }
      const nativeExecutionCode = readNativeExecutionCode(error);
      if (current) failure = readPrivateProofDiagnostic({ ...current, code,
        ...(nativeExecutionCode ? { nativeExecutionCode } : {}) });
    },
    report: () => failure,
  });
}
