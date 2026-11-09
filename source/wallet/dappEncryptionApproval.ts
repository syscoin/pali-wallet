import {
  supportsDappEncryptionAccount,
  type DappEncryptionAccount,
  type DappEncryptionRequest,
} from '../shared/dappEncryptionRequest.ts';
import { assertSynchronousEvmFeeGuard } from '../shared/evmFeeGuard.ts';

import {
  dappSigningApprovalExpired,
  type createDappSigningApproval,
} from './dappSigningApproval.ts';

export type DappEncryptionSdk = Readonly<{
  decryptMessage(params: [string, string]): string;
  getEncryptedPubKey(): string;
}>;

/** Prepared private operation. No plaintext is retained in observable state. */
export function prepareDappEncryptionApproval(ports: {
  account: DappEncryptionAccount;
  approval: ReturnType<typeof createDappSigningApproval>;
  assertCurrent(): void;
  checkDocument(): Promise<void>;
  deliver(
    value: string,
    assertCurrent: () => void,
    onDispatch: () => void
  ): Promise<void>;
  request: DappEncryptionRequest;
  sdk: DappEncryptionSdk;
}) {
  if (!supportsDappEncryptionAccount(ports.account))
    throw Object.assign(new Error('Unsupported method'), { code: 4200 });
  let busy = false;
  let handedOff = false;
  let retired = false;
  const check = () => {
    if (retired || handedOff) throw dappSigningApprovalExpired();
    try {
      assertSynchronousEvmFeeGuard(() => ports.approval.assertCurrent());
      assertSynchronousEvmFeeGuard(() => ports.assertCurrent());
    } catch (error) {
      retired = true;
      throw error;
    }
  };
  const document = async () => {
    check();
    try {
      await ports.checkDocument();
    } catch (error) {
      retired = true;
      throw error;
    } finally {
      check();
    }
  };
  const execute = () => {
    check();
    let result: unknown;
    try {
      result =
        ports.request.method === 'eth_decrypt'
          ? ports.sdk.decryptMessage([
              ports.request.ciphertext,
              ports.request.address,
            ])
          : ports.sdk.getEncryptedPubKey();
    } finally {
      check();
    }
    if (typeof result !== 'string') {
      if (result && typeof result === 'object')
        void Promise.resolve(result).catch(() => undefined);
      throw new Error(
        'Encryption SDK operation must return a string synchronously'
      );
    }
    return result;
  };
  const run = async (approve: boolean): Promise<string | void> => {
    check();
    if (busy) throw new Error('Approval is busy');
    if (!approve && ports.request.method !== 'eth_decrypt')
      throw new Error('Preview is unavailable');
    busy = true;
    try {
      await document();
      const value = execute();
      await document();
      if (!approve) return value;
      await ports.deliver(value, check, () => {
        check();
        handedOff = true;
      });
      retired = true;
    } catch (error) {
      if (handedOff || !ports.approval.isCurrent()) retired = true;
      throw error;
    } finally {
      busy = false;
    }
  };
  return {
    preview: () => run(false) as Promise<string>,
    approve: () => run(true) as Promise<void>,
    assertCurrent: check,
    retire() {
      retired = true;
    },
    get handedOff() {
      return handedOff;
    },
  };
}
