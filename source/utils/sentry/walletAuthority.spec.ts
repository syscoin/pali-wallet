jest.unmock('syscoinjs-lib');

import { utils } from 'syscoinjs-lib';

import {
  canDeferSentryWifMatch,
  deriveSentryWalletAuthority,
  findSentryWalletPath,
} from './walletAuthority';

const bjs = utils.bitcoinjs;
const network = utils.syscoinNetworks.testnet;
const root = bjs.bip32
  .fromSeed(Buffer.alloc(32, 7), network)
  .derivePath("m/84'/1'/2'");
const key = root.derive(0).derive(21);
const address = bjs.payments.p2pkh({ pubkey: key.publicKey, network }).address;
const scope = {
  account: { xpub: root.neutered().toBase58(), address },
  accountId: 2,
  imported: false,
  slip44: 1,
  network,
};

it('derives the authority only when a wallet path matches the actual address key', () => {
  expect(findSentryWalletPath(address, ["m/84'/1'/2'/0/21"], scope)).toBe(
    '0/21'
  );
  expect(
    deriveSentryWalletAuthority(address, '0/21', root.toBase58(), scope)
  ).toEqual({
    scheme: 'ecdsa',
    secretKey: Buffer.from(key.privateKey).toString('hex'),
  });
});

it('authenticates a Taproot WIF against both its selected address and compressed Sentry identity', () => {
  const pair = bjs.ECPair.fromPrivateKey(Buffer.alloc(32, 9), { network });
  const taproot = bjs.payments.p2tr({
    internalPubkey: pair.publicKey.slice(1),
    network,
  }).address;
  const owner = bjs.payments.p2pkh({ pubkey: pair.publicKey, network }).address;
  const imported = {
    ...scope,
    imported: true,
    account: { xpub: taproot, address: taproot },
  };
  expect(findSentryWalletPath(owner, [], imported)).toBeUndefined();
  expect(canDeferSentryWifMatch(owner, imported)).toBe(true);
  expect(findSentryWalletPath(taproot, [], imported)).toBeNull();
  expect(
    deriveSentryWalletAuthority(owner, null, pair.toWIF(), imported).secretKey
  ).toBe('09'.repeat(32));
  expect(
    deriveSentryWalletAuthority(taproot, null, pair.toWIF(), imported).secretKey
  ).toBe('09'.repeat(32));
  const other = bjs.ECPair.fromPrivateKey(Buffer.alloc(32, 10), { network });
  const otherOwner = bjs.payments.p2pkh({
    pubkey: other.publicKey,
    network,
  }).address;
  expect(() =>
    deriveSentryWalletAuthority(otherOwner, null, pair.toWIF(), imported)
  ).toThrow('does not own');
  expect(() =>
    deriveSentryWalletAuthority(otherOwner, null, other.toWIF(), imported)
  ).toThrow('does not match the selected account');
  expect(canDeferSentryWifMatch(owner, scope)).toBe(false);
  expect(canDeferSentryWifMatch(taproot, imported)).toBe(false);
  expect(
    canDeferSentryWifMatch(
      bjs.payments.p2pkh({
        pubkey: pair.publicKey,
        network: utils.syscoinNetworks.mainnet,
      }).address,
      imported
    )
  ).toBe(false);
});

it('discovers a derived Taproot collateral address from the actual public key', () => {
  const taproot = bjs.payments.p2tr({
    internalPubkey: key.publicKey.slice(1),
    network,
  }).address;
  expect(findSentryWalletPath(taproot, ["m/84'/1'/2'/0/21"], scope)).toBe(
    '0/21'
  );
});

it('checks uncompressed WIF account encoding without changing the compressed authority identity', () => {
  const pair = bjs.ECPair.fromPrivateKey(Buffer.alloc(32, 11), {
    network,
    compressed: false,
  });
  const taproot = bjs.payments.p2tr({
    internalPubkey: bjs.ECPair.fromPrivateKey(pair.privateKey).publicKey.slice(
      1
    ),
    network,
  }).address;
  const compressedOwner = bjs.payments.p2pkh({
    pubkey: bjs.ECPair.fromPrivateKey(pair.privateKey).publicKey,
    network,
  }).address;
  const imported = {
    ...scope,
    imported: true,
    account: { xpub: taproot, address: taproot },
  };
  expect(
    deriveSentryWalletAuthority(compressedOwner, null, pair.toWIF(), imported)
      .secretKey
  ).toBe('0b'.repeat(32));
  const uncompressedOwner = bjs.payments.p2pkh({
    pubkey: pair.publicKey,
    network,
  }).address;
  const uncompressedAccount = {
    ...imported,
    account: { xpub: uncompressedOwner, address: uncompressedOwner },
  };
  expect(canDeferSentryWifMatch(compressedOwner, uncompressedAccount)).toBe(
    true
  );
  expect(
    deriveSentryWalletAuthority(
      compressedOwner,
      null,
      pair.toWIF(),
      uncompressedAccount
    ).secretKey
  ).toBe('0b'.repeat(32));
  expect(() =>
    deriveSentryWalletAuthority(
      uncompressedOwner,
      null,
      pair.toWIF(),
      uncompressedAccount
    )
  ).toThrow('does not own');
});

it('does not trust a supplied label, address, account index, or derivation path', () => {
  expect(
    findSentryWalletPath(address, ["m/84'/1'/3'/0/21"], scope)
  ).toBeUndefined();
  expect(
    findSentryWalletPath(address, ["m/84'/1'/2'/0/2147483648"], scope)
  ).toBeUndefined();
  expect(() =>
    deriveSentryWalletAuthority(address, '0/20', root.toBase58(), scope)
  ).toThrow('does not own');
  const other = bjs.bip32
    .fromSeed(Buffer.alloc(32, 8), network)
    .derivePath("m/84'/1'/2'");
  expect(() =>
    deriveSentryWalletAuthority(address, '0/21', other.toBase58(), scope)
  ).toThrow('does not match');
});

it('checks an imported WIF against its selected single address', () => {
  const pair = bjs.ECPair.fromPrivateKey(Buffer.alloc(32, 3), { network });
  const single = bjs.payments.p2wpkh({
    pubkey: pair.publicKey,
    network,
  }).address;
  const imported = {
    ...scope,
    imported: true,
    account: { xpub: single, address: single },
  };
  expect(findSentryWalletPath(single, [], imported)).toBeNull();
  const ownerAddress = bjs.payments.p2pkh({
    pubkey: pair.publicKey,
    network,
  }).address;
  expect(findSentryWalletPath(ownerAddress, [], imported)).toBeNull();
  expect(
    deriveSentryWalletAuthority(ownerAddress, null, pair.toWIF(), imported)
      .secretKey
  ).toBe('03'.repeat(32));
  expect(
    deriveSentryWalletAuthority(single, null, pair.toWIF(), imported).secretKey
  ).toBe('03'.repeat(32));
  expect(() =>
    deriveSentryWalletAuthority(address, null, pair.toWIF(), imported)
  ).toThrow('does not own');
});

it('rejects other-chain addresses and hardened/path traversal hints', () => {
  const mainAddress = bjs.payments.p2wpkh({
    pubkey: key.publicKey,
    network: utils.syscoinNetworks.mainnet,
  }).address;
  expect(() => findSentryWalletPath(mainAddress, [], scope)).toThrow();
  expect(
    findSentryWalletPath(address, ["0/21'/0", "m/84'/1'/2'/../0/21"], scope)
  ).toBeUndefined();
});
