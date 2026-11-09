import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';

/** Adopt only the worker admitted by the existing one-shot Trezor transfer. */
export function createOwnedKeyringTransfer<
  Ring extends object,
  Session extends object
>(
  ports: Readonly<{
    initial: Ring;
    current(): Ring;
    worker(): Ring | undefined;
    session(): Session | undefined;
    assertOwner(): void;
  }>
) {
  let expected = ports.initial;
  const check = () => assertSynchronousEvmFeeGuard(ports.assertOwner);
  check();
  return Object.freeze({
    current() {
      check();
      return expected;
    },
    matches() {
      return ports.current() === expected;
    },
    transferred(source: Ring, target: Ring, session: Session) {
      check();
      if (
        source !== expected ||
        target === source ||
        ports.current() !== target ||
        ports.worker() !== target ||
        ports.session() !== session
      )
        throw new Error('CANCELLED');
      expected = target;
      check();
    },
  });
}
