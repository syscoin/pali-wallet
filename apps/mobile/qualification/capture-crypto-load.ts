import type { CryptoLoadDiagnostic } from '../src/crypto/diagnostics.ts';
import { loadQuickCrypto } from '../src/crypto/quickCryptoLoad.ts';

const MAX_ERROR_BYTES = 64 * 1024;

function errorField(error: unknown, field: 'name' | 'message' | 'stack', limit: number): string {
  try {
    const value: unknown = error !== null && (typeof error === 'object' || typeof error === 'function')
      ? (error as Record<string, unknown>)[field] : undefined;
    return typeof value === 'string' ? value.slice(0, limit) : '';
  } catch { return ''; }
}

/** CI entry only: exact load errors before SDK/session creation. Never imported by production. */
export async function captureQualificationModuleLoad<T>(
  stage: 'quick-crypto-load' | 'software-sdk-load',
  load: () => T,
  write: (text: string) => Promise<void>,
  observe: (diagnostic: CryptoLoadDiagnostic) => void
): Promise<T> {
  if (!['quick-crypto-load', 'software-sdk-load'].includes(stage)) throw Error('QUALIFICATION_CAPTURE_STAGE_INVALID');
  let diagnostic: CryptoLoadDiagnostic | undefined;
  try {
    return loadQuickCrypto(load, (value) => { diagnostic = value; observe(value); });
  } catch (error) {
    const detail = { name: errorField(error, 'name', 128), message: errorField(error, 'message', 8192), stack: errorField(error, 'stack', 32768) };
    let text = JSON.stringify({ version: 1, stage, diagnostic, error: detail });
    const encoder = new TextEncoder();
    while (encoder.encode(text).byteLength > MAX_ERROR_BYTES) {
      if (detail.stack.length) detail.stack = detail.stack.slice(0, Math.floor(detail.stack.length / 2));
      else detail.message = detail.message.slice(0, Math.floor(detail.message.length / 2));
      text = JSON.stringify({ version: 1, stage, diagnostic, error: detail });
    }
    try { await write(text); } catch { /* Evidence failure cannot permit wallet creation. */ }
    throw error;
  }
}

export async function captureQualificationCryptoLoad(
  load: () => unknown,
  write: (text: string) => Promise<void>,
  observe: (diagnostic: CryptoLoadDiagnostic) => void
): Promise<void> {
  await captureQualificationModuleLoad('quick-crypto-load', load, write, observe);
}
