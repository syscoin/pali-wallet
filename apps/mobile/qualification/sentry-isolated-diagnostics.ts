import { readNativeExecutionCode, readNativeExecutionTiming, type NativeExecutionCode, type NativeExecutionTiming } from '../../../source/scripts/privacyProver/nativeExecutionDiagnostic.ts';

export const SENTRY_ISOLATED_STEPS = Object.freeze([
  'operator-import', 'service-sign', 'service-verify', 'owner-sign', 'owner-verify',
] as const);
export type SentryIsolatedStep = (typeof SENTRY_ISOLATED_STEPS)[number];
export type SentryIsolatedPhase = 'started' | 'completed';
const CODES = Object.freeze([
  'SENTRY_EXECUTION_FAILED',
  'QUALIFICATION_SENTRY_SHAKE_PUBLIC_KEY_FAILED',
  'QUALIFICATION_SENTRY_SHAKE_SERVICE_FAILED',
  'QUALIFICATION_SENTRY_SHAKE_OWNER_FAILED',
  'PRIVATE_PROOF_QUALIFICATION_INACTIVE',
  'unrecognized',
] as const);
type Code = (typeof CODES)[number];
export type SentryIsolatedDiagnostic = Readonly<{
  step: SentryIsolatedStep;
  phase: SentryIsolatedPhase;
  elapsedMs: number;
  code: Code;
  nativeExecutionCode?: NativeExecutionCode;
  nativeExecutionTiming?: NativeExecutionTiming;
}>;
const invalid = () => new Error('SENTRY_ISOLATED_DIAGNOSTIC_INVALID');

/** Only fixed public labels and a bounded duration may enter failure evidence. */
export function readSentryIsolatedDiagnostic(value: unknown): SentryIsolatedDiagnostic {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const keys = Reflect.ownKeys(value).sort().join(',');
    if (!['code,elapsedMs,phase,step', 'code,elapsedMs,nativeExecutionCode,phase,step',
      'code,elapsedMs,nativeExecutionTiming,phase,step', 'code,elapsedMs,nativeExecutionCode,nativeExecutionTiming,phase,step'].includes(keys)) throw invalid();
    const own = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw invalid();
      return descriptor.value;
    };
    const step = own('step'), phase = own('phase'), elapsedMs = own('elapsedMs'), code = own('code');
    const nativeExecutionCode = readNativeExecutionCode(value);
    let nativeExecutionTiming: NativeExecutionTiming | undefined;
    if (keys.includes('nativeExecutionTiming')) {
      const timing = own('nativeExecutionTiming');
      if (!timing || typeof timing !== 'object' || Reflect.ownKeys(timing).sort().join(',') !== 'elapsedMs,sdkStartedAfterMs') throw invalid();
      const elapsed = Object.getOwnPropertyDescriptor(timing, 'elapsedMs'), sdk = Object.getOwnPropertyDescriptor(timing, 'sdkStartedAfterMs');
      if (!elapsed || !('value' in elapsed) || !sdk || !('value' in sdk)) throw invalid();
      const elapsedMs = elapsed.value, sdkStartedAfterMs = sdk.value;
      if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 300000 ||
          sdkStartedAfterMs !== null && (!Number.isSafeInteger(sdkStartedAfterMs) || sdkStartedAfterMs < 0 || sdkStartedAfterMs > elapsedMs)) throw invalid();
      nativeExecutionTiming = Object.freeze({ elapsedMs, sdkStartedAfterMs });
    }
    if (!SENTRY_ISOLATED_STEPS.includes(step as SentryIsolatedStep) ||
        (phase !== 'started' && phase !== 'completed') ||
        typeof elapsedMs !== 'number' || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 300000 ||
        !CODES.includes(code as Code) || (keys.includes('nativeExecutionCode') && !nativeExecutionCode)) throw invalid();
    return Object.freeze({ step: step as SentryIsolatedStep, phase, elapsedMs, code: code as Code,
      ...(nativeExecutionCode ? { nativeExecutionCode } : {}), ...(nativeExecutionTiming ? { nativeExecutionTiming } : {}) });
  } catch { throw invalid(); }
}

export function createSentryIsolatedDiagnostic(now: () => number) {
  let current: Readonly<{ step: SentryIsolatedStep; phase: SentryIsolatedPhase; started: number }> | undefined;
  let failure: SentryIsolatedDiagnostic | undefined;
  let sealed = false;
  return Object.freeze({
    observe(step: SentryIsolatedStep, phase: SentryIsolatedPhase) {
      readSentryIsolatedDiagnostic({ step, phase, elapsedMs: 0, code: 'unrecognized' });
      if (sealed) return;
      if (phase === 'completed' && (!current || current.step !== step || current.phase !== 'started')) throw invalid();
      current = Object.freeze({ step, phase, started: phase === 'started' ? now() : current!.started });
    },
    capture(error: unknown) {
      if (sealed) return;
      sealed = true;
      let code: Code = 'unrecognized';
      try {
        if (error instanceof Error) {
          const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
          const message: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
          if (CODES.includes(message as Code)) code = message as Code;
        }
      } catch { /* Diagnostics never replace the original failure. */ }
      if (!current) return;
      let elapsedMs = 0;
      try {
        const elapsed = now() - current.started;
        if (Number.isFinite(elapsed)) elapsedMs = Math.min(300000, Math.max(0, Math.floor(elapsed)));
      } catch { /* The duration remains bounded even if the clock fails. */ }
      const nativeExecutionCode = readNativeExecutionCode(error);
      const nativeExecutionTiming = readNativeExecutionTiming(error);
      failure = readSentryIsolatedDiagnostic({ step: current.step, phase: current.phase, elapsedMs, code,
        ...(nativeExecutionCode ? { nativeExecutionCode } : {}), ...(nativeExecutionTiming ? { nativeExecutionTiming } : {}) });
    },
    report: () => failure,
  });
}
