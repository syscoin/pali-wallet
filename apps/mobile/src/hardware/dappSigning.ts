import { Transaction } from 'ethers/transaction';
import { signLedgerEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/ledger-signing.js';
import { signTrezorEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/trezor-signing.js';
import { captureHardwareTransactionAuthority } from '@sidhujag/sysweb3-keyring/cjs/hardware-transaction-authority.js';
import type { HardwareTransactionAuthority } from '@sidhujag/sysweb3-keyring/cjs/hardware-transaction-authority.js';
import type { EthereumTransactions } from '@sidhujag/sysweb3-keyring/cjs/transactions/ethereum.js';
import type { LedgerKeyring } from '@sidhujag/sysweb3-keyring/cjs/ledger/index.js';
import type { TrezorKeyring } from '@sidhujag/sysweb3-keyring/cjs/trezor/index.js';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import {
  readDappMessageRequest,
  type DappMessageRequest,
} from '../../../../source/shared/dappMessageRequest.ts';
import { DAPP_REQUEST_LIMITS } from '../../../../source/utils/requestPayloadBudget.ts';
import { parseNativeAccountId } from '../custody/accountIdentity.ts';
import {
  snapshotNativeNetwork,
  type NativeNetworkRegistration,
} from '../custody/networkContext.ts';

export type NativeHardwareDappAccount = Readonly<{
  address: string;
  id: string;
  index: number;
  type: 'Ledger' | 'Trezor';
}>;
type Messages = Pick<
  EthereumTransactions,
  | 'signPersonalMessage'
  | 'signTypedData'
  | 'verifyPersonalMessage'
  | 'verifyTypedSignature'
>;
export type NativeHardwareDappSession = Readonly<{ transactions: Messages }> &
  (
    | Readonly<{ kind: 'Ledger'; signer: Pick<LedgerKeyring, 'evm'> }>
    | Readonly<{
        kind: 'Trezor';
        signer: Pick<TrezorKeyring, 'signEthTransaction'>;
      }>
  );
type Ports = Readonly<{
  account: NativeHardwareDappAccount;
  network: NativeNetworkRegistration;
  signal: AbortSignal;
  assertCurrent(): void;
  /** Own admission, exact SDK ring and acknowledged device/session retirement. */
  withSession<T>(
    account: NativeHardwareDappAccount,
    check: () => void,
    operation: (session: NativeHardwareDappSession) => Promise<T>
  ): Promise<T>;
}>;

/** Typed dapp adapter around the SDK's existing hardware methods and verification. */
export function createNativeHardwareDappSigning(ports: Ports) {
  const account = Object.freeze({ ...ports.account });
  const network = snapshotNativeNetwork(ports.network);
  const identity = parseNativeAccountId(account.id);
  if (
    identity.type !== account.type ||
    identity.index !== account.index ||
    identity.slip44 !== 60 ||
    !['Ledger', 'Trezor'].includes(account.type) ||
    !/^0x[0-9a-f]{40}$/i.test(account.address)
  )
    throw new Error('INVALID_INPUT');
  const check = () => {
    assertSynchronousEvmFeeGuard(ports.assertCurrent);
    if (ports.signal.aborted) throw new Error('CANCELLED');
  };
  check();
  const withSession = async <T>(
    guard: () => void,
    operation: (session: NativeHardwareDappSession) => Promise<T>
  ): Promise<T> => {
    guard();
    const result = await ports.withSession(account, guard, async (session) => {
      guard();
      if (session.kind !== account.type) throw new Error('CANCELLED');
      const result = await operation(session);
      guard();
      return result;
    });
    guard();
    return result;
  };
  return Object.freeze({
    async signMessage(input: DappMessageRequest): Promise<string> {
      check();
      const request = readDappMessageRequest(
        input?.method,
        input?.method === 'personal_sign'
          ? [input.message, input.address]
          : [input?.address, input?.typedData],
        account.address
      );
      if (
        !request ||
        (request.method !== 'personal_sign' &&
          (input.method === 'personal_sign' ||
            request.version !== input.version ||
            request.version === 'V1'))
      )
        throw new Error('INVALID_INPUT');
      return withSession(check, async ({ transactions }) => {
        const signature =
          request.method === 'personal_sign'
            ? await transactions.signPersonalMessage([
                request.address,
                request.message,
              ])
            : await transactions.signTypedData(
                request.address,
                request.typedData as Parameters<Messages['signTypedData']>[1],
                request.version as Parameters<Messages['signTypedData']>[2]
              );
        check();
        if (
          typeof signature !== 'string' ||
          !/^0x[0-9a-f]{130}$/i.test(signature)
        )
          throw new Error('OPERATION_FAILED');
        const recovered =
          request.method === 'personal_sign'
            ? transactions.verifyPersonalMessage(request.message, signature)
            : transactions.verifyTypedSignature(
                request.typedData as Parameters<
                  Messages['verifyTypedSignature']
                >[0],
                signature,
                request.version as Parameters<
                  Messages['verifyTypedSignature']
                >[2]
              );
        check();
        if (recovered.toLowerCase() !== account.address.toLowerCase())
          throw new Error('OPERATION_FAILED');
        return signature;
      });
    },
    async signTransaction(
      unsignedTransaction: string,
      authority: HardwareTransactionAuthority
    ) {
      check();
      const owner = captureHardwareTransactionAuthority(authority);
      const guard = () => {
        check();
        assertSynchronousEvmFeeGuard(owner.assertCurrent);
        if (owner.signal.aborted) throw new Error('CANCELLED');
      };
      guard();
      if (
        typeof unsignedTransaction !== 'string' ||
        unsignedTransaction.length > DAPP_REQUEST_LIMITS.signingBytes * 2 + 2
      )
        throw new Error('INVALID_INPUT');
      const transaction = Transaction.from(unsignedTransaction);
      if (transaction.chainId !== BigInt(network.chainId))
        throw new Error('INVALID_INPUT');
      return withSession(guard, (session) =>
        session.kind === 'Ledger'
          ? signLedgerEvmTransaction(
              session.signer,
              {
                accountIndex: account.index,
                expectedAddress: account.address,
                unsignedTransaction,
              },
              { signal: owner.signal, assertCurrent: guard }
            )
          : signTrezorEvmTransaction(
              session.signer,
              {
                accountIndex: account.index,
                expectedAddress: account.address,
                coin: 'eth',
                slip44: network.slip44,
                unsignedTransaction,
              },
              { signal: owner.signal, assertCurrent: guard }
            )
      );
    },
  });
}

export type NativeHardwareDappSigning = ReturnType<
  typeof createNativeHardwareDappSigning
>;
