import { TypedDataEncoder } from 'ethers/hash';
import { recoverAddress } from 'ethers/transaction';
import { Wallet } from 'ethers/wallet';
import http from 'http';
import https from 'https';
import { createRequire } from 'module';

import {
  buildSmartAccountUserOperation,
  encodeEcdsaValidatorInitData,
} from './account';
import { signSmartAccountActionHash } from './authenticatorDispatch';
import {
  buildPaliErc7739PersonalSigningIntent,
  buildPaliErc7739TypedDataRequest,
} from './erc7739';
import { signSmartAccountOwnerIntent } from './ownerSigning';
import { buildSmartAccountUserOpSigningIntent } from './userOperationHash';
import type { ISmartAccountMetadata } from '../../types/network';

const sdkRequire = createRequire(
  require.resolve('@sidhujag/sysweb3-keyring/package.json')
);
const { EthereumTransactions } = sdkRequire('./cjs/transactions/ethereum');
const { LedgerKeyring } = sdkRequire('./cjs/ledger/index');
const { TrezorKeyring } = sdkRequire('./cjs/trezor/index');
const { createTrezorConnection } = sdkRequire('./cjs/trezor/connect');
const { TREZOR_METHODS } = sdkRequire('./cjs/trezor/host-types');
const owner = new Wallet('0x' + '31'.repeat(32)),
  SMART = '0x' + '41'.repeat(20),
  VALIDATOR = '0x' + '51'.repeat(20);
const selectedSmart = {
  id: 9,
  type: 'SmartAccount' as const,
  expectedAddress: SMART,
};
const intents = [
  buildSmartAccountUserOpSigningIntent(
    buildSmartAccountUserOperation({
      sender: SMART,
      nonce: '3',
      initCode: '0x',
      callData: '0x1234',
      accountGasLimits: '0x' + '00'.repeat(32),
      preVerificationGas: '1',
      gasFees: '0x' + '00'.repeat(32),
    }),
    57057
  ),
  buildPaliErc7739PersonalSigningIntent({
    accountAddress: SMART,
    chainId: 57057,
    message: '0xe280a22000',
  }),
  buildPaliErc7739TypedDataRequest({
    accountAddress: SMART,
    chainId: 57057,
    typedData: {
      domain: {
        name: 'Original App',
        chainId: 10,
        verifyingContract: '0x' + '61'.repeat(20),
      },
      primaryType: 'Mail',
      types: { Mail: [{ name: 'text', type: 'string' }] },
      message: { text: 'Typed original' },
    },
  }).ownerSigningIntent,
];
const metadata = {
  chainId: 57057,
  isDeployed: true,
  auth: {
    module: 'ecdsa',
    validator: VALIDATOR,
    data: encodeEcdsaValidatorInitData([owner.address], 1),
  },
  installedModules: [
    {
      id: 'ecdsa',
      type: 'validator',
      address: VALIDATOR,
      config: { owners: [owner.address], threshold: 1 },
    },
  ],
} as ISmartAccountMetadata;
function digest(data: any) {
  const types = { ...data.types };
  delete types.EIP712Domain;
  return TypedDataEncoder.hash(data.domain, types, data.message);
}
function fixture() {
  const lifetime = new AbortController();
  let current = true;
  const check = () => {
    if (!current || lifetime.signal.aborted) throw new Error('Owner retired');
  };
  const authority = { signal: lifetime.signal, assertCurrent: check };
  const unavailable = jest.fn(async (): Promise<any> => {
    throw new Error('Unexpected device operation');
  });
  const ledgerTransport = jest.fn(async (request: any, auth: any) => {
    auth.assertCurrent();
    expect(auth.signal).toBe(lifetime.signal);
    expect(request.accountIndex).toBe(7);
    expect(request.expectedAddress).toBe(owner.address);
    return owner.signingKey.sign(digest(request.data)).serialized;
  });
  const ledgerHost = {
    connect: unavailable,
    disconnect: jest.fn(async () => undefined),
    retire: jest.fn(async () => () => undefined),
    getStatus: () => ({ connected: true }),
    evm: {
      getAddress: unavailable,
      signTransaction: unavailable,
      signPersonalMessage: unavailable,
      signTypedData: ledgerTransport,
    },
    utxo: {
      getXpub: unavailable,
      getAddress: unavailable,
      getAccount: unavailable,
      signMessage: unavailable,
      signPsbt: unavailable,
    },
  };
  const trezorTransport = jest.fn(async (guard: () => void, request: any) => {
    guard();
    expect(request.path).toBe("m/44'/60'/0'/0/7");
    return {
      success: true,
      payload: {
        address: owner.address,
        signature: owner.signingKey.sign(digest(request.data)).serialized,
      },
    };
  });
  const trezorHost = {
    ...Object.fromEntries(
      TREZOR_METHODS.map((method: string) => [method, unavailable])
    ),
    init: jest.fn(async (guard: () => void) => {
      guard();
    }),
    dispose: jest.fn(async (pending: Promise<unknown>[]) => {
      await Promise.allSettled(pending);
    }),
    ethereumSignTypedData: trezorTransport,
  };
  const ledger = new LedgerKeyring(undefined, ledgerHost),
    trezor = new TrezorKeyring(createTrezorConnection(trezorHost));
  const network = {
    kind: 'ethereum',
    chainId: 57057,
    slip44: 60,
    currency: 'TEST',
    url: 'http://127.0.0.1:1',
  };
  const state = {
    activeAccountId: 9,
    activeAccountType: 'SmartAccount',
    activeNetwork: network,
    accounts: {
      SmartAccount: { 9: { address: SMART } },
      HDAccount: { 7: { address: owner.address } },
      Imported: {},
      Ledger: { 7: { address: owner.address, isLedgerWallet: true } },
      Trezor: { 7: { address: owner.address, isTrezorWallet: true } },
    },
  };
  const readKey = jest.fn((target: any) => {
    check();
    expect(target).toEqual({ id: 7, type: 'HDAccount' });
    return { address: owner.address, decryptedPrivateKey: owner.privateKey };
  });
  const transactions = new EthereumTransactions(
    () => network,
    readKey,
    () => state,
    ledger,
    trezor,
    () => check,
    null
  );
  const sdk = {
    rawSign: transactions.ethSign,
    ledger: { signTypedData: ledger.evm.signTypedData },
    trezor: { signTypedData: trezor.signTypedData.bind(trezor) },
  };
  return {
    sdk,
    authority,
    lifetime,
    state,
    check,
    ledgerHost,
    ledgerTransport,
    trezorHost,
    trezorTransport,
    readKey,
    trezor,
    revoke() {
      current = false;
    },
  };
}
beforeEach(() => {
  jest.useFakeTimers();
  const deny = () => {
    throw new Error('Offline SDK vector attempted network access');
  };
  jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(http, 'get').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
  jest.spyOn(https, 'get').mockImplementation(deny);
  jest.spyOn(console, 'log').mockImplementation();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it.each(['HDAccount', 'Ledger', 'Trezor'] as const)(
  'uses actual SDK %s signatures accepted by the mandatory common exact-raw-proof check for all canonical intents',
  async (type) => {
    const f = fixture();
    try {
      for (const intent of intents) {
        const result = signSmartAccountActionHash({
          smartAccount: metadata,
          actionHash: intent.actionHash,
          async assertBeforeAuthentication() {
            f.check();
          },
          ports: {
            ecdsa: {
              localOwners: [{ address: owner.address, id: 7, type }],
              signActionHash: () =>
                signSmartAccountOwnerIntent({
                  intent,
                  selectedSmart,
                  owner: { address: owner.address, id: 7, type },
                  authority: f.authority,
                  sdk: f.sdk,
                }),
            },
            p256WebAuthn: null,
            slhDsa: null,
          },
        });
        await jest.advanceTimersByTimeAsync(2500);
        const proof = await result;
        expect(recoverAddress(intent.actionHash, proof.signature)).toBe(
          owner.address
        );
        expect(proof.signature).toBe(
          owner.signingKey.sign(intent.actionHash).serialized
        );
        expect(f.state.activeAccountType).toBe('SmartAccount');
        expect(f.state.activeAccountId).toBe(9);
      }
      expect(f.readKey).toHaveBeenCalledTimes(type === 'HDAccount' ? 3 : 0);
      expect(f.ledgerTransport).toHaveBeenCalledTimes(
        type === 'Ledger' ? 3 : 0
      );
      expect(f.trezorTransport).toHaveBeenCalledTimes(
        type === 'Trezor' ? 3 : 0
      );
    } finally {
      await f.trezor.destroy();
    }
  }
);
it('blocks a retired canonical Ledger intent after queued connect and before actual host dispatch', async () => {
  const f = fixture();
  let finish!: () => void, entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.ledgerHost.getStatus = () => ({ connected: false });
  f.ledgerHost.connect.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
        entered();
      })
  );
  const pending = signSmartAccountOwnerIntent({
    intent: intents[0],
    selectedSmart,
    owner: { address: owner.address, id: 7, type: 'Ledger' },
    authority: f.authority,
    sdk: f.sdk,
  });
  const rejected = expect(pending).rejects.toThrow();
  await started;
  f.revoke();
  finish();
  await rejected;
  expect(f.ledgerTransport).not.toHaveBeenCalled();
  await f.trezor.destroy();
});
it('blocks a retired canonical Trezor intent during the SDK popup delay without dispatch or retry', async () => {
  const f = fixture();
  const pending = signSmartAccountOwnerIntent({
    intent: intents[1],
    selectedSmart,
    owner: { address: owner.address, id: 7, type: 'Trezor' },
    authority: f.authority,
    sdk: f.sdk,
  });
  const rejected = expect(pending).rejects.toThrow();
  await jest.advanceTimersByTimeAsync(200);
  f.revoke();
  await jest.advanceTimersByTimeAsync(3000);
  await rejected;
  expect(f.trezorTransport).not.toHaveBeenCalled();
  await f.trezor.destroy();
});
