import { descriptorChecksum } from '@sidhujag/sysweb3-keyring';
import { utils as syscoinUtils } from 'syscoinjs-lib';

import { isAddress } from './ethersV6Compat';

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
const DESCRIPTOR_ROOTS = new Set([
  'addr',
  'pkh',
  'wpkh',
  'sh',
  'wsh',
  'tr',
  'combo',
  'multi',
  'sortedmulti',
]);
const DESCRIPTOR_FUNCTIONS = new Set([
  ...DESCRIPTOR_ROOTS,
  'pk',
  'pk_k',
  'pk_h',
  'multi_a',
  'sortedmulti_a',
  'and_v',
  'and_b',
  'and_n',
  'or_b',
  'or_c',
  'or_d',
  'or_i',
  'andor',
  'thresh',
  'after',
  'older',
  'sha256',
  'hash256',
  'ripemd160',
  'hash160',
]);

const publicPoint = (value: string, xOnly = false): boolean => {
  if (!/^(?:02|03)[\da-f]{64}$|^04[\da-f]{128}$/i.test(value)) {
    if (!xOnly || !/^[\da-f]{64}$/i.test(value)) return false;
    value = `02${value}`;
  }
  try {
    syscoinUtils.bitcoinjs.ECPair.fromPublicKey(Buffer.from(value, 'hex'));
    return true;
  } catch {
    return false;
  }
};

const publicExtendedKey = (value: string): boolean => {
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

const publicAddress = (value: string): boolean => {
  if (isAddress(value)) return true;
  try {
    syscoinUtils.bitcoinjs.address.fromBase58Check(value);
    return true;
  } catch {
    try {
      const decoded = syscoinUtils.bitcoinjs.address.fromBech32(value);
      return (
        decoded.version >= 0 &&
        decoded.version <= 16 &&
        decoded.data.length >= 2 &&
        decoded.data.length <= 40 &&
        (decoded.version !== 0 || [20, 32].includes(decoded.data.length))
      );
    } catch {
      return false;
    }
  }
};

const publicKeyExpression = (value: string, xOnly: boolean): boolean => {
  value = value.replace(/^\[[\da-f]{8}(?:\/\d+[hH']?)*\]/i, '');
  const match = value.match(
    /^([^/]+)((?:\/(?:\d+[hH']?|\*[hH']?|<\d+(?:;\d+)+>))*)$/
  );
  if (!match) return false;
  return match[2]
    ? publicExtendedKey(match[1])
    : publicExtendedKey(match[1]) || publicPoint(match[1], xOnly);
};

const publicDescriptor = (value: string): boolean => {
  const parts = value.split('#');
  if (
    parts.length > 2 ||
    (parts.length === 2 && descriptorChecksum(parts[0]) !== parts[1])
  )
    return false;
  const text = parts[0].replace(/\s/g, '');
  if (!DESCRIPTOR_ROOTS.has(text.match(/^([a-z_]+)\(/)?.[1] ?? ''))
    return false;
  let offset = 0,
    nodes = 0;
  const expression = (
    parent = '',
    argument = 0,
    taproot = false,
    depth = 0
  ): boolean => {
    if (++nodes > 256 || depth > 32) return false;
    if (text[offset] === '{') {
      offset++;
      if (
        !expression(parent, argument, true, depth + 1) ||
        text[offset++] !== ','
      )
        return false;
      if (
        !expression(parent, argument, true, depth + 1) ||
        text[offset++] !== '}'
      )
        return false;
      return true;
    }
    const functionMatch = text
      .slice(offset)
      .match(/^((?:[ascdvjntul]+:)?)([a-z_]+)\(/);
    if (functionMatch) {
      const name = functionMatch[2];
      if (!DESCRIPTOR_FUNCTIONS.has(name)) return false;
      offset += functionMatch[0].length;
      let index = 0;
      do {
        if (index) offset++;
        if (!expression(name, index++, taproot || name === 'tr', depth + 1))
          return false;
      } while (text[offset] === ',');
      return text[offset++] === ')';
    }
    const start = offset;
    while (offset < text.length && !',)}'.includes(text[offset])) offset++;
    const leaf = text.slice(start, offset);
    if (parent === 'addr') return publicAddress(leaf);
    if (['sha256', 'hash256'].includes(parent))
      return /^[\da-f]{64}$/i.test(leaf);
    if (['ripemd160', 'hash160'].includes(parent))
      return /^[\da-f]{40}$/i.test(leaf);
    if (
      (['multi', 'sortedmulti', 'multi_a', 'sortedmulti_a', 'thresh'].includes(
        parent
      ) &&
        argument === 0) ||
      ['after', 'older'].includes(parent)
    )
      return /^(?:0|[1-9]\d{0,9})$/.test(leaf);
    if (leaf === '0' || leaf === '1')
      return !['pk', 'pkh', 'wpkh', 'tr', 'combo'].includes(parent);
    return publicKeyExpression(leaf, taproot);
  };
  return expression() && offset === text.length;
};

/** Reject private material before any watch-only identifier can reach a server. */
export const isPublicWatchOnlyIdentifier = (
  value: unknown
): value is string => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 16384 ||
    value.trim() !== value
  )
    return false;
  return (
    publicAddress(value) || publicExtendedKey(value) || publicDescriptor(value)
  );
};

export const assertPublicWatchOnlyIdentifier = (value: unknown): void => {
  if (!isPublicWatchOnlyIdentifier(value))
    throw new Error(
      'Watch-only import requires a valid public address, public extended key, or public-only descriptor.'
    );
};
