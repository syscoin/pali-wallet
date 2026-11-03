export function nativeCryptoInstallDiagnostic(): undefined { return undefined; }
export function nativeCryptoCheckpoint(): 'unchecked' { return 'unchecked'; }
export function nativeCryptoStatus(): 'unavailable' { return 'unavailable'; }
export async function ensureNativeCryptoReady(): Promise<Crypto> {
  throw new Error('Native custody is unavailable on web');
}
