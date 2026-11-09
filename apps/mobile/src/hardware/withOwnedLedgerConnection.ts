import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { NativeLedgerTransport } from './ownedLedgerTransport.ts';

/** Bind one signing operation to its selected device and drain only that device on abort. */
export async function withOwnedLedgerConnection<T>(ports: Readonly<{
  signal: AbortSignal;
  assertCurrent(): void;
  connected(): boolean;
  current(): NativeLedgerTransport | undefined;
  retire(): Promise<void> | void;
}>, operation: (check: () => void) => Promise<T>): Promise<T> {
  assertSynchronousEvmFeeGuard(ports.assertCurrent);
  const transport = ports.current();
  if (!transport || !ports.connected() || ports.signal.aborted) throw new Error('NOT_READY');
  const check = () => {
    assertSynchronousEvmFeeGuard(ports.assertCurrent);
    if (ports.signal.aborted || ports.current() !== transport || !ports.connected()) throw new Error('CANCELLED');
  };
  let retirement: Promise<void> | undefined;
  const retire = () => {
    retirement ??= ports.current() === transport ? Promise.resolve(ports.retire()) : transport.dispose();
    void retirement.catch(() => undefined);
  };
  ports.signal.addEventListener('abort', retire, { once: true });
  try {
    check();
    const result = await operation(check);
    check();
    return result;
  } finally {
    ports.signal.removeEventListener('abort', retire);
    await retirement;
  }
}
