import { utils as syscoinUtils } from 'syscoinjs-lib';
import {
  canDeferSentryWifMatch,
  deriveSentryWalletAuthority,
  findSentryWalletPath,
} from '../../../../source/utils/sentry/walletAuthority.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { UtxoNetwork } from '../core/utxoNetworks.ts';

type Ports = Readonly<{
  account: Readonly<{ address: string; xpub: string }>;
  accountId: number;
  assertCurrent(): void;
  hasPrivateMaterial: boolean;
  imported: boolean;
  network: UtxoNetwork;
  readJson(url: string, limit: number, check: () => void): Promise<unknown>;
}>;

/** Selected-account adapter for the same public-path and authenticated-key checks. */
export function createNativeSentryWalletAuthority(ports: Ports) {
  const account = Object.freeze({ ...ports.account });
  const addressScope = Object.freeze({
    account,
    accountId: ports.accountId,
    imported: ports.imported,
    network: ports.network.addressNetwork,
    slip44: ports.network.slip44,
  });
  const check = () => assertSynchronousEvmFeeGuard(ports.assertCurrent);
  const endpoint = ports.network.endpoint.replace(/\/$/, '');
  async function find(address: string) {
    check();
    if (!ports.hasPrivateMaterial) return undefined;
    const single = ports.imported && account.xpub === account.address;
    const response = single
      ? undefined
      : await ports.readJson(
          `${endpoint}/api/v2/xpub/${encodeURIComponent(
            account.xpub
          )}?tokens=derived&details=tokens`,
          2 * 1024 * 1024,
          check
        );
    check();
    const tokens = (response as { tokens?: unknown } | undefined)?.tokens;
    if (!single && (!Array.isArray(tokens) || tokens.length > 10_000))
      throw new Error('Cannot verify the wallet address paths');
    return {
      path: findSentryWalletPath(
        address,
        Array.isArray(tokens) ? tokens.map((token) => token?.path) : [],
        addressScope
      ),
    };
  }
  return Object.freeze({
    async has(address: string) {
      const found = await find(address);
      check();
      return (
        !!found &&
        (found.path !== undefined ||
          canDeferSentryWifMatch(address, addressScope))
      );
    },
    async prepare(
      address: string,
      purpose: 'management' | 'voting'
    ) {
      const found = await find(address);
      check();
      if (
        !found ||
        (found.path === undefined &&
          !canDeferSentryWifMatch(address, addressScope))
      )
        return undefined;
      return (privateKey: string) => {
        check();
        const result = deriveSentryWalletAuthority(
          address,
          found.path ?? null,
          privateKey,
          addressScope,
          purpose
        );
        check();
        return result;
      };
    },
    async owns(outpoint: { txid: string; vout: number }) {
      check();
      const raw = await ports.readJson(
        `${endpoint}/api/v2/tx/${outpoint.txid}`,
        2 * 1024 * 1024,
        check
      );
      check();
      const hex = (raw as { hex?: unknown })?.hex;
      if (typeof hex !== 'string')
        throw new Error('Cannot verify registered collateral transaction');
      const transaction = syscoinUtils.bitcoinjs.Transaction.fromHex(hex);
      if (
        transaction.getId() !== outpoint.txid ||
        !transaction.outs[outpoint.vout]
      )
        throw new Error('Cannot verify registered collateral transaction');
      let address: string;
      try {
        address = syscoinUtils.bitcoinjs.address.fromOutputScript(
          transaction.outs[outpoint.vout]!.script,
          addressScope.network
        );
      } catch {
        return false;
      }
      const found = await find(address);
      check();
      return !!found && found.path !== undefined;
    },
  });
}

export type NativeSentryWalletAuthority = ReturnType<
  typeof createNativeSentryWalletAuthority
>;
