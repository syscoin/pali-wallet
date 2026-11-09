import { N } from 'ethers/constants';
import { Signature } from 'ethers/crypto';
import { hashMessage } from 'ethers/hash';
import { recoverAddress } from 'ethers/transaction';
import { getBytes } from 'ethers/utils';
import { Wallet } from 'ethers/wallet';
import { createRequire } from 'module';

import { defaultAbiCoder } from '../ethersV6Compat';

import { encodeEcdsaValidatorInitData } from './account';
import {
  canSignSmartAccountActionHash,
  signSmartAccountActionHash,
  SmartAccountExternalSignatureRequired,
  type SmartAccountLocalEcdsaSigner,
} from './authenticatorDispatch';
import { signAndSubmitSmartAccountExecutions } from './execution';
import type { ISmartAccountMetadata } from '../../types/network';

const sdkRequire = createRequire(
  require.resolve('@sidhujag/sysweb3-keyring/package.json')
);
const { EthereumTransactions } = sdkRequire('./cjs/transactions/ethereum');
const { LedgerKeyring } = sdkRequire('./cjs/ledger/index');
const HASH = '0x' + '12'.repeat(32),
  OTHER_HASH = '0x' + '13'.repeat(32);
const wallets = [
  new Wallet('0x' + '21'.repeat(32)),
  new Wallet('0x' + '22'.repeat(32)),
];
const VALIDATOR = '0x' + '31'.repeat(20),
  SMART = '0x' + '41'.repeat(20);
const owners = wallets.map((wallet, id) => ({
  address: wallet.address,
  id,
  type: 'HDAccount',
}));
const raw = (id = 0, hash = HASH) =>
  wallets[id].signingKey.sign(hash).serialized;

function metadata(threshold = 1): ISmartAccountMetadata {
  const addresses = owners.map((owner) => owner.address);
  const data = encodeEcdsaValidatorInitData(addresses, threshold);
  return {
    chainId: 1,
    isDeployed: true,
    auth: { module: 'ecdsa', validator: VALIDATOR, data },
    installedModules: [
      {
        id: 'ecdsa',
        type: 'validator',
        address: VALIDATOR,
        data,
        config: { owners: addresses, threshold },
      },
    ],
  } as ISmartAccountMetadata;
}

function request(
  signActionHash: SmartAccountLocalEcdsaSigner = jest.fn(
    async ({ owner }: any) => raw(owner.id)
  ),
  inventory = owners,
  threshold = 1
) {
  return {
    smartAccount: metadata(threshold),
    actionHash: HASH,
    assertBeforeAuthentication: jest.fn(async () => undefined),
    ports: {
      ecdsa: { localOwners: inventory, signActionHash },
      p256WebAuthn: null,
      slhDsa: null,
    },
  };
}

it('preserves valid external/software proof bytes and threshold owner order', async () => {
  const one = await signSmartAccountActionHash(request());
  expect(one.signature).toBe(raw());
  const sign = jest.fn(async ({ owner }: any) => raw(owner.id));
  const two = request(sign, owners, 2);
  const result = await signSmartAccountActionHash(two);
  expect(result.signature).toBe(
    defaultAbiCoder.encode(['bytes[]'], [[raw(0), raw(1)]])
  );
  expect(sign.mock.calls.map(([value]) => value.owner.id)).toEqual([0, 1]);
});

it.each([
  ['wrong hash', () => raw(0, OTHER_HASH)],
  ['different configured owner', () => raw(1)],
  ['missing proof', () => undefined],
  ['non-hex proof', () => '0x' + 'zz'.repeat(65)],
  ['64-byte proof', () => raw().slice(0, -2)],
  ['trailing data', () => raw() + '00'],
  ['zero proof', () => '0x' + '00'.repeat(65)],
  ['noncanonical v', () => raw().slice(0, -2) + '1d'],
] as const)(
  'refuses %s before returning an aggregate or trying another owner',
  async (_label, value) => {
    const sign = jest.fn(async () => value() as string);
    await expect(
      signSmartAccountActionHash(request(sign, owners, 2))
    ).rejects.toThrow('owner signature is invalid');
    expect(sign).toHaveBeenCalledTimes(1);
  }
);

it('rejects ethers-normalized recovery ids on the original wire bytes', async () => {
  const signature =
    raw().slice(0, -2) + (Signature.from(raw()).yParity ? '01' : '00');
  expect(recoverAddress(HASH, signature)).toBe(wallets[0].address);
  await expect(
    signSmartAccountActionHash(request(jest.fn(async () => signature)))
  ).rejects.toThrow('owner signature is invalid');
});

it('rejects a 65-byte high-s malleation using the existing ethers canonical parser', async () => {
  const valid = Signature.from(raw());
  const signature =
    valid.r +
    (N - BigInt(valid.s)).toString(16).padStart(64, '0') +
    (valid.v === 27 ? '1c' : '1b');
  expect(signature).toHaveLength(132);
  await expect(
    signSmartAccountActionHash(request(jest.fn(async () => signature)))
  ).rejects.toThrow('owner signature is invalid');
});

it('does not return a valid prefix of a threshold proof after a later owner fails', async () => {
  const sign = jest.fn(async ({ owner }) =>
    owner.id === 0 ? raw(0) : raw(1, OTHER_HASH)
  );
  await expect(
    signSmartAccountActionHash(request(sign, owners, 2))
  ).rejects.toThrow('owner signature is invalid');
  expect(sign.mock.calls.map(([value]) => value.owner.id)).toEqual([0, 1]);
});

it('counts each canonical owner address once and keeps the first alias without fallback', async () => {
  const aliases = [
    owners[0],
    {
      ...owners[0],
      address: owners[0].address.toLowerCase(),
      id: 17,
      type: 'Ledger',
    },
    owners[1],
  ];
  const sign = jest.fn(async ({ owner }) => raw(owner.id));
  await signSmartAccountActionHash(request(sign, aliases, 2));
  expect(sign.mock.calls.map(([value]) => value.owner.id)).toEqual([0, 1]);
  const missing = request(sign, aliases.slice(0, 2), 2);
  expect(
    canSignSmartAccountActionHash(missing.smartAccount, {
      ecdsa: missing.ports.ecdsa.localOwners,
      p256WebAuthn: false,
      slhDsa: false,
    })
  ).toBe(false);
  sign.mockClear();
  await expect(signSmartAccountActionHash(missing)).rejects.toBeInstanceOf(
    SmartAccountExternalSignatureRequired
  );
  expect(sign).not.toHaveBeenCalled();
  const failure = new Error('User rejected first alias');
  const rejected = jest.fn(async () => {
    throw failure;
  });
  await expect(
    signSmartAccountActionHash(request(rejected, aliases))
  ).rejects.toBe(failure);
  expect(rejected).toHaveBeenCalledTimes(1);
});

it('captures the selected owner before a signer can mutate the caller inventory', async () => {
  const inventory = owners.map((owner) => ({ ...owner }));
  const sign = jest.fn(async ({ owner }) => {
    expect(owner).not.toBe(inventory[0]);
    expect(Object.isFrozen(owner)).toBe(true);
    inventory[0].address = wallets[1].address;
    return raw(1);
  });
  await expect(
    signSmartAccountActionHash(request(sign, inventory))
  ).rejects.toThrow('owner signature is invalid');
});

it('rejects actual SDK Ledger personal-prefix output while preserving exact selected Smart and target Ledger context', async () => {
  const owner = wallets[0];
  const network = {
    kind: 'ethereum',
    chainId: 1,
    slip44: 60,
    currency: 'ETH',
    url: 'http://127.0.0.1:1',
  };
  const state = {
    activeAccountId: 0,
    activeAccountType: 'SmartAccount',
    activeNetwork: network,
    accounts: {
      HDAccount: {},
      Imported: {},
      Trezor: {},
      SmartAccount: { 0: { id: 0, address: SMART } },
      Ledger: { 0: { id: 0, address: owner.address, isLedgerWallet: true } },
    },
  };
  const guard = () => {
    expect(state.activeAccountType).toBe('SmartAccount');
    expect(state.accounts.SmartAccount[0].address).toBe(SMART);
  };
  const unavailable = async () => {
    throw new Error('Unexpected device or network operation');
  };
  const transport = jest.fn(async (value: any) => {
    guard();
    expect(value.expectedAddress).toBe(owner.address);
    expect(value.messageHex).toBe(HASH.slice(2));
    return owner.signMessage(getBytes('0x' + value.messageHex));
  });
  const host = {
    getStatus: () => ({ connected: true }),
    connect: unavailable,
    disconnect: unavailable,
    retire: unavailable,
    evm: {
      getAddress: unavailable,
      signTransaction: unavailable,
      signTypedData: unavailable,
      signPersonalMessage: transport,
    },
    utxo: {
      getXpub: unavailable,
      getAddress: unavailable,
      getAccount: unavailable,
      signMessage: unavailable,
      signPsbt: unavailable,
    },
  };
  const sdk = new EthereumTransactions(
    () => network,
    (target: any) => {
      guard();
      expect(target).toEqual({ id: 0, type: 'Ledger' });
      return { address: owner.address, decryptedPrivateKey: '' };
    },
    () => state,
    new LedgerKeyring(undefined, host),
    undefined,
    () => guard,
    null
  );
  let produced = '';
  const sign = jest.fn(async ({ owner: selected, actionHash }) => {
    produced = await sdk.ethSign([selected.address, actionHash], {
      selectedAccount: { id: 0, type: 'SmartAccount', expectedAddress: SMART },
      targetAccount: {
        id: selected.id,
        type: selected.type,
        expectedAddress: selected.address,
      },
      assertCurrent: guard,
    });
    return produced;
  });
  await expect(
    signSmartAccountActionHash(
      request(sign, [
        { ...owners[0], type: 'Ledger' },
        { ...owners[0], id: 17 },
      ])
    )
  ).rejects.toThrow('owner signature is invalid');
  expect(transport).toHaveBeenCalledTimes(1);
  expect(sign).toHaveBeenCalledTimes(1);
  expect(recoverAddress(hashMessage(getBytes(HASH)), produced)).toBe(
    owner.address
  );
  expect(recoverAddress(HASH, produced)).not.toBe(owner.address);
});

it.each([false, true])(
  'verifies before the real extension submission seam (valid=%s)',
  async (valid) => {
    const smartAccount = metadata();
    const beforeSubmit = jest.fn();
    const emitter = jest.fn(async ([, method]: string[], params: any[]) => {
      if (method === 'prepareSmartAccountExecutions')
        return {
          accountId: 7,
          executionContextId: 'prepared-operation',
          actionHash: HASH,
          executions: params[0],
          smartAccount,
          userOperation: { sender: SMART },
        };
      if (
        method === 'assertSmartAccountExecutionContext' ||
        method === 'assertSmartAccountPreparedNonce'
      )
        return;
      if (method === 'submitSmartAccountExecution') return params[0].signature;
      throw new Error(`Unexpected method ${method}`);
    });
    const work = signAndSubmitSmartAccountExecutions({
      accountAddress: SMART,
      accountId: 7,
      smartAccount,
      executions: [{ target: owners[0].address, value: '0x0', data: '0x' }],
      controllerEmitter: emitter,
      authenticatorContexts: {
        ecdsa: {
          localOwners: owners,
          signActionHash: async () => (valid ? raw() : raw(0, OTHER_HASH)),
        },
      },
      onBeforeSubmit: beforeSubmit,
    });
    if (valid) {
      expect(await work).toBe(raw());
      expect(beforeSubmit).toHaveBeenCalledTimes(1);
    } else {
      await expect(work).rejects.toThrow('owner signature is invalid');
      expect(beforeSubmit).not.toHaveBeenCalled();
    }
    expect(
      emitter.mock.calls.filter(
        ([[, method]]) => method === 'prepareSmartAccountExecutions'
      )
    ).toHaveLength(1);
    expect(
      emitter.mock.calls.filter(
        ([[, method]]) => method === 'submitSmartAccountExecution'
      )
    ).toHaveLength(valid ? 1 : 0);
  }
);
