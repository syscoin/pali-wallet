import type { TrezorKeyring } from '@sidhujag/sysweb3-keyring/cjs/trezor/index.js';
import { computeAddress } from 'ethers/transaction';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import { assertEcdsaOwnerSignature } from '../../../../source/utils/smartAccount/authenticatorDispatch.ts';
import type { SmartAccountOwnerAuthority } from '../../../../source/utils/smartAccount/ownerSigning.ts';

/** Existing SDK derivation and typed signing inside the native session owner's lifecycle. */
export async function signNativeSmartTrezorOwner(ports: Readonly<{
  worker: Pick<TrezorKeyring, 'init' | 'getPublicKey' | 'signTypedData'>;
  expected: Readonly<{ index: number; address: string; publicKey: string }>;
  request: Parameters<TrezorKeyring['signTypedData']>[0];
  actionHash: string;
  authority: SmartAccountOwnerAuthority;
  beforeSignature(): void;
}>): Promise<string> {
  const expected = Object.freeze({ ...ports.expected });
  const check = () => {
    assertSynchronousEvmFeeGuard(ports.authority.assertCurrent);
    if (ports.authority.signal.aborted) throw new Error('CANCELLED');
  };
  check();
  if (ports.request.index !== expected.index || ports.request.address.toLowerCase() !== expected.address.toLowerCase())
    throw new Error('Smart account Trezor owner changed');
  if (!(await ports.worker.init(check))) throw new Error('Smart account Trezor initialization failed');
  check();
  const identity = await ports.worker.getPublicKey({ coin: 'eth', slip44: 60, index: expected.index }); check();
  if (!identity || !('publicKey' in identity) || typeof identity.publicKey !== 'string' ||
      identity.publicKey.toLowerCase() !== expected.publicKey.toLowerCase() || computeAddress(identity.publicKey).toLowerCase() !== expected.address.toLowerCase())
    throw new Error('Smart account Trezor public key changed');
  const signature = await ports.worker.signTypedData(ports.request, ports.authority); check();
  assertEcdsaOwnerSignature(ports.actionHash, expected.address, signature); check();
  // The raw Suite callback is not a usable signature until the SDK and shared
  // proof check accept it. Retire continuation before releasing those bytes.
  ports.beforeSignature(); check();
  return signature;
}
