jest.unmock('syscoinjs-lib');

import { utils } from 'syscoinjs-lib';

import {
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
