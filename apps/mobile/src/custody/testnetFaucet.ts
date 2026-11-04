import { getNativeNetwork, NATIVE_NETWORKS, type NativeNetworkRegistration } from './networkContext.ts';

const faucet = Object.freeze({ url: 'https://faucet-zk.tanenbaum.io/' });

export class TestnetFaucetError extends Error {
  readonly code: 'INVALID_CONTEXT' | 'UNSUPPORTED_NETWORK' | 'OPEN_FAILED';
  constructor(code: TestnetFaucetError['code']) {
    super(code);
    this.name = 'TestnetFaucetError';
    this.code = code;
  }
}

/** Public handoff metadata is deliberately separate from signing registrations. */
export function getTestnetFaucet(registration: NativeNetworkRegistration): Readonly<{ url: string }> | null {
  if (!NATIVE_NETWORKS.includes(registration)) throw new TestnetFaucetError('INVALID_CONTEXT');
  return registration === getNativeNetwork('zksys-testnet') && registration.chainId === '57057' && registration.testnet
    ? faucet : null;
}

/** Open only a fixed public URL; no account address or faucet request crosses this boundary. */
export async function openTestnetFaucet(
  registration: NativeNetworkRegistration,
  openURL: (url: string) => Promise<unknown>,
  assertCurrent: () => void
): Promise<void> {
  const selected = getTestnetFaucet(registration);
  if (!selected) throw new TestnetFaucetError('UNSUPPORTED_NETWORK');
  assertCurrent();
  try { await openURL(selected.url); }
  catch { assertCurrent(); throw new TestnetFaucetError('OPEN_FAILED'); }
  assertCurrent();
}
