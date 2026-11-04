import { utils as syscoinUtils } from 'syscoinjs-lib';

const PUBLIC_EXTENDED_VERSIONS = new Map([
  ['xpub', 0x0488b21e],
  ['tpub', 0x043587cf],
  ['ypub', 0x049d7cb2],
  ['zpub', 0x04b24746],
  ['Ypub', 0x0295b43f],
  ['Zpub', 0x02aa7ed3],
  ['upub', 0x044a5262],
  ['vpub', 0x045f1cf6],
  ['Upub', 0x024289ef],
  ['Vpub', 0x02575483],
]);
/** Existing extension parser for a public-only extended key. */
export const isPublicExtendedKey = (value: string): boolean => {
  if (!/^[1-9A-HJ-NP-Za-km-z]{100,112}$/.test(value)) return false;
  const version = PUBLIC_EXTENDED_VERSIONS.get(value.slice(0, 4));
  if (version === undefined) return false;
  try {
    // Reuse the background's initialized BIP32 parser: it validates Base58Check,
    // version, payload size and public curve point before constructing a node.
    const node = syscoinUtils.bitcoinjs.bip32.fromBase58(value, {
      ...syscoinUtils.bitcoinjs.networks.bitcoin,
      bip32: { public: version, private: 0x0488ade4 },
    });
    return node.isNeutered();
  } catch {
    return false;
  }
};
