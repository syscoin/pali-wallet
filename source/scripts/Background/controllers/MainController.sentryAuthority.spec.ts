jest.unmock('syscoinjs-lib');
jest.mock('..', () => ({ getController: jest.fn() }));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
}));

import { utils } from 'syscoinjs-lib';

import store from 'state/store';
import { KeyringAccountType } from 'types/network';

import MainController from './MainController';

const bjs = utils.bitcoinjs;
const network = utils.syscoinNetworks.testnet;
const pair = bjs.ECPair.fromPrivateKey(Buffer.alloc(32, 12), { network });
const taproot = bjs.payments.p2tr({
  internalPubkey: pair.publicKey.slice(1),
  network,
}).address;
const owner = bjs.payments.p2pkh({ pubkey: pair.publicKey, network }).address;
const other = bjs.ECPair.fromPrivateKey(Buffer.alloc(32, 13), { network });
const otherOwner = bjs.payments.p2pkh({
  pubkey: other.publicKey,
  network,
}).address;

describe('Sentry wallet authority discovery and authenticated resolution', () => {
  let wallet: any;
  let state: any;
  let identity: string;
  const scope = { identity: 'selected-vault-testnet' };

  beforeEach(() => {
    identity = scope.identity;
    state = {
      vault: {
        activeNetwork: { slip44: 1, currency: 'tsys', url: 'synthetic-rpc' },
        accounts: {
          Imported: {
            0: {
              id: 0,
              address: taproot,
              xpub: taproot,
              xprv: 'encrypted-fixture',
            },
          },
        },
      },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => state);
    wallet = Object.create(MainController.prototype);
    wallet.captureSentryWalletScope = () => ({ identity });
    wallet.captureUtxoSigningContext = () => ({
      context: {
        account: {
          ...state.vault.accounts.Imported[0],
          type: KeyringAccountType.Imported,
        },
        slip44: 1,
      },
      assertCurrent: jest.fn(),
    });
    wallet.getPrivateKeyByAccountId = jest.fn().mockResolvedValue(pair.toWIF());
  });
  afterEach(() => jest.restoreAllMocks());

  it('offers an authenticated Taproot WIF candidate without reading its secret during discovery', async () => {
    await expect(
      wallet.canSignSentryWalletAuthority(owner, scope)
    ).resolves.toBe(true);
    expect(wallet.getPrivateKeyByAccountId).not.toHaveBeenCalled();
    await expect(
      wallet.resolveSentryWalletAuthority(
        { address: owner, password: 'test-password' },
        scope
      )
    ).resolves.toEqual({
      scheme: 'ecdsa',
      secretKey: '0c'.repeat(32),
    });
    expect(wallet.getPrivateKeyByAccountId).toHaveBeenCalledWith(
      0,
      KeyringAccountType.Imported,
      'test-password'
    );
  });

  it('never converts signing eligibility into proof that a different collateral output is owned', async () => {
    const parent = new bjs.Transaction();
    parent.addInput(Buffer.alloc(32, 1), 0);
    parent.addOutput(
      bjs.address.toOutputScript(owner, network),
      BigInt(100000)
    );
    parent.addOutput(
      bjs.address.toOutputScript(taproot, network),
      BigInt(100000)
    );
    wallet.txUtils = {
      getRawTransaction: jest.fn().mockResolvedValue(parent.toHex()),
    };
    await expect(
      wallet.canSignSentryWalletAuthority(owner, scope)
    ).resolves.toBe(true);
    await expect(
      wallet.ownsSentryCollateral({ txid: parent.getId(), vout: 0 }, scope)
    ).resolves.toBe(false);
    await expect(
      wallet.ownsSentryCollateral({ txid: parent.getId(), vout: 1 }, scope)
    ).resolves.toBe(true);
    expect(wallet.getPrivateKeyByAccountId).not.toHaveBeenCalled();
  });

  it('rejects an unrelated target and a stale WIF that matches the target but not the selected account', async () => {
    await expect(
      wallet.resolveSentryWalletAuthority(
        { address: otherOwner, password: 'test-password' },
        scope
      )
    ).rejects.toThrow('does not own');
    wallet.getPrivateKeyByAccountId.mockResolvedValue(other.toWIF());
    await expect(
      wallet.resolveSentryWalletAuthority(
        { address: otherOwner, password: 'test-password' },
        scope
      )
    ).rejects.toThrow('does not match the selected account');
  });

  it('does not offer or resolve a watch-only imported address', async () => {
    state.vault.accounts.Imported[0].xprv = '';
    await expect(
      wallet.canSignSentryWalletAuthority(owner, scope)
    ).resolves.toBe(false);
    await expect(
      wallet.canSignSentryWalletAuthority(taproot, scope)
    ).resolves.toBe(false);
    await expect(
      wallet.resolveSentryWalletAuthority(
        { address: owner, password: 'test-password' },
        scope
      )
    ).rejects.toThrow('no private');
    expect(wallet.getPrivateKeyByAccountId).not.toHaveBeenCalled();
  });

  it('authenticates an uncompressed P2PKH WIF account against the SDK compressed authority', async () => {
    const uncompressed = bjs.ECPair.fromPrivateKey(pair.privateKey, {
      network,
      compressed: false,
    });
    const address = bjs.payments.p2pkh({
      pubkey: uncompressed.publicKey,
      network,
    }).address;
    state.vault.accounts.Imported[0].address = address;
    state.vault.accounts.Imported[0].xpub = address;
    wallet.getPrivateKeyByAccountId.mockResolvedValue(uncompressed.toWIF());
    await expect(
      wallet.canSignSentryWalletAuthority(owner, scope)
    ).resolves.toBe(true);
    await expect(
      wallet.resolveSentryWalletAuthority(
        { address: owner, password: 'test-password' },
        scope
      )
    ).resolves.toEqual({ scheme: 'ecdsa', secretKey: '0c'.repeat(32) });
  });

  it('preserves ordinary HD account discovery and password-gated signing', async () => {
    const root = bjs.bip32
      .fromSeed(Buffer.alloc(32, 14), network)
      .derivePath("m/84'/1'/0'");
    const child = root.derive(0).derive(21);
    const address = bjs.payments.p2pkh({
      pubkey: child.publicKey,
      network,
    }).address;
    const account = {
      id: 0,
      address,
      xpub: root.neutered().toBase58(),
      xprv: 'encrypted-fixture',
    };
    state.vault.accounts.HDAccount = { 0: account };
    wallet.captureUtxoSigningContext = () => ({
      context: {
        account: { ...account, type: KeyringAccountType.HDAccount },
        slip44: 1,
      },
      assertCurrent: jest.fn(),
    });
    jest
      .spyOn(utils, 'fetchBackendAccount')
      .mockResolvedValue({ tokens: [{ path: "m/84'/1'/0'/0/21" }] } as any);
    wallet.getPrivateKeyByAccountId.mockResolvedValue(root.toBase58());
    await expect(
      wallet.canSignSentryWalletAuthority(address, scope)
    ).resolves.toBe(true);
    expect(wallet.getPrivateKeyByAccountId).not.toHaveBeenCalled();
    await expect(
      wallet.resolveSentryWalletAuthority(
        { address, password: 'test-password' },
        scope
      )
    ).resolves.toEqual({
      scheme: 'ecdsa',
      secretKey: Buffer.from(child.privateKey).toString('hex'),
    });
  });

  it('rejects a wallet context change while authenticated key retrieval is pending', async () => {
    wallet.getPrivateKeyByAccountId.mockImplementation(async () => {
      identity = 'other-vault-or-network';
      return pair.toWIF();
    });
    await expect(
      wallet.resolveSentryWalletAuthority(
        { address: owner, password: 'test-password' },
        scope
      )
    ).rejects.toThrow('context changed');
  });
});
