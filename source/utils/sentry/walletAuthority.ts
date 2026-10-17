import bs58check from 'bs58check';
import { utils as syscoinUtils } from 'syscoinjs-lib';

const bjs = syscoinUtils.bitcoinjs;

export interface ISentryAddressScope {
  account: { address: string; xpub: string };
  accountId: number;
  imported: boolean;
  network: any;
  slip44: number;
}

const readNode = (value: string, privateKey: boolean, network: any) => {
  const payload = Buffer.from(bs58check.decode(value));
  if (
    payload.length !== 78 ||
    (privateKey ? payload[45] !== 0 : ![2, 3].includes(payload[45]))
  )
    throw new Error('Invalid wallet account key');
  return bjs.bip32.fromBase58(value, {
    ...network,
    bip32: privateKey
      ? { public: network.bip32.public, private: payload.readUInt32BE(0) }
      : { public: payload.readUInt32BE(0), private: network.bip32.private },
  });
};

const keyMatchesAddress = (
  publicKey: Uint8Array,
  address: string,
  network: any
) => {
  // A valid P2PKH WIF may be uncompressed; unsupported encodings must not
  // prevent checking the encoding that the account actually uses.
  try {
    const output = bjs.address.toOutputScript(address, network);
    if (output.length === 25 && output[0] === 0x76)
      return (
        bjs.payments.p2pkh({ pubkey: publicKey, network }).address === address
      );
    if (output.length === 22 && output[0] === 0)
      return (
        bjs.payments.p2wpkh({ pubkey: publicKey, network }).address === address
      );
    if (output.length === 23 && output[0] === 0xa9)
      return (
        bjs.payments.p2sh({
          redeem: bjs.payments.p2wpkh({ pubkey: publicKey, network }),
          network,
        }).address === address
      );
    if (output.length === 34 && output[0] === 0x51)
      return (
        bjs.payments.p2tr({
          internalPubkey:
            publicKey.length === 33
              ? publicKey.slice(1)
              : bjs.ECPair.fromPublicKey(publicKey, {
                  compressed: true,
                }).publicKey.slice(1),
          network,
        }).address === address
      );
    return false;
  } catch {
    return false;
  }
};

const addressKeyHash = (address: string, network: any): Buffer | undefined => {
  try {
    return Buffer.from(bjs.payments.p2wpkh({ address, network }).hash);
  } catch {
    /* Try the equivalent P2PKH encoding. */
  }
  try {
    return Buffer.from(bjs.payments.p2pkh({ address, network }).hash);
  } catch {
    return undefined;
  }
};

/** Eligibility to try an authenticated WIF match, never evidence of ownership. */
export const canDeferSentryWifMatch = (
  target: string,
  scope: ISentryAddressScope
): boolean => {
  if (!scope.imported || scope.account.xpub !== scope.account.address)
    return false;
  try {
    bjs.payments.p2pkh({ address: target, network: scope.network });
    try {
      // A tweaked Taproot output hides the internal key's P2PKH identity.
      bjs.payments.p2tr({
        address: scope.account.address,
        network: scope.network,
      });
    } catch {
      // P2PKH may instead encode an uncompressed WIF key. Neither case
      // establishes ownership until both addresses match the unlocked WIF.
      bjs.payments.p2pkh({
        address: scope.account.address,
        network: scope.network,
      });
    }
    return true;
  } catch {
    return false;
  }
};

/** Blockbook paths are hints only: derive each candidate and check its actual key. */
export const findSentryWalletPath = (
  target: string,
  paths: string[],
  scope: ISentryAddressScope
): string | null | undefined => {
  // Validate network/address before looking at derivation hints.
  bjs.address.toOutputScript(target, scope.network);
  if (scope.imported && scope.account.xpub === scope.account.address) {
    const targetHash = addressKeyHash(target, scope.network);
    const accountHash = addressKeyHash(scope.account.address, scope.network);
    return target === scope.account.address ||
      (targetHash && accountHash && targetHash.equals(accountHash))
      ? null
      : undefined;
  }
  const root = readNode(scope.account.xpub, false, scope.network);
  if (root.depth !== 3)
    throw new Error('Sentry signing requires an account-level wallet key');
  const accountIndex = scope.imported
    ? root.index & 0x7fffffff
    : scope.accountId;
  const prefix = `m/84'/${scope.slip44}'/${accountIndex}'/`;
  const candidates = new Set(paths.slice(0, 10000));
  // The currently unused receive/change branches may not be included by an indexer.
  for (let index = 0; index < 20; index++) {
    candidates.add(`${prefix}0/${index}`);
    candidates.add(`${prefix}1/${index}`);
  }
  for (const path of candidates) {
    if (typeof path !== 'string') continue;
    const relative = path.startsWith(prefix)
      ? path.slice(prefix.length)
      : scope.imported && !path.startsWith('m/')
      ? path
      : '';
    if (!/^[01]\/(0|[1-9]\d*)$/.test(relative)) continue;
    const [branch, index] = relative.split('/').map(Number);
    if (!Number.isSafeInteger(index) || index >= 0x80000000) continue;
    if (
      keyMatchesAddress(
        root.derive(branch).derive(index).publicKey,
        target,
        scope.network
      )
    )
      return relative;
  }
  return undefined;
};

/** Background-only. Never return this result from a provider or UI method. */
export const deriveSentryWalletAuthority = (
  target: string,
  path: string | null,
  privateAccountKey: string,
  scope: ISentryAddressScope
): { scheme: 'ecdsa'; secretKey: string } => {
  let key: any;
  if (path === null) {
    key = bjs.ECPair.fromWIF(privateAccountKey, scope.network);
    if (
      !scope.imported ||
      scope.account.xpub !== scope.account.address ||
      !keyMatchesAddress(key.publicKey, scope.account.address, scope.network)
    )
      throw new Error('Wallet key does not match the selected account');
  } else {
    if (!/^[01]\/(0|[1-9]\d*)$/.test(path))
      throw new Error('Invalid Sentry wallet path');
    const root = readNode(privateAccountKey, true, scope.network);
    const publicRoot = readNode(scope.account.xpub, false, scope.network);
    if (
      root.depth !== publicRoot.depth ||
      root.index !== publicRoot.index ||
      root.parentFingerprint !== publicRoot.parentFingerprint ||
      !Buffer.from(root.chainCode).equals(Buffer.from(publicRoot.chainCode)) ||
      !Buffer.from(root.publicKey).equals(Buffer.from(publicRoot.publicKey))
    )
      throw new Error('Wallet key does not match the selected account');
    const [branch, index] = path.split('/').map(Number);
    key = root.derive(branch).derive(index);
  }
  if (
    !key.privateKey ||
    // The shared Sentry SDK uses compressed ECDSA identities. Verify that
    // exact identity, independently of the imported WIF's address encoding.
    !keyMatchesAddress(
      bjs.ECPair.fromPrivateKey(key.privateKey, { compressed: true }).publicKey,
      target,
      scope.network
    )
  )
    throw new Error('Wallet does not own this Sentry authority');
  return {
    scheme: 'ecdsa',
    secretKey: Buffer.from(key.privateKey).toString('hex'),
  };
};
