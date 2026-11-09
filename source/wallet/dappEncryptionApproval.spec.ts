import { createRequire } from 'module';

import {
  readDappEncryptionRequest,
  supportsDappEncryptionAccount,
} from '../shared/dappEncryptionRequest';
import { INetworkType, KeyringAccountType } from '../types/network';

import {
  prepareDappEncryptionApproval,
  type DappEncryptionSdk,
} from './dappEncryptionApproval';
import {
  createDappSigningApproval,
  type DappSigningScope,
} from './dappSigningApproval';

const sdkRequire = createRequire(
  require.resolve('@sidhujag/sysweb3-keyring/package.json')
);
const { EthereumTransactions } = sdkRequire('./cjs/transactions/ethereum');
const { encrypt, getEncryptionPublicKey } = sdkRequire(
  '@metamask/eth-sig-util'
);
const KEY = '11'.repeat(32);
const ADDRESS = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';

function fixture(
  method: 'eth_decrypt' | 'eth_getEncryptionPublicKey' = 'eth_decrypt',
  cipher = '0x1234'
) {
  let scope: DappSigningScope = {
    grant: {
      host: 'https://app.invalid',
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chain: INetworkType.Ethereum,
      chainId: 1,
      date: 1,
    },
    account: { id: 0, type: 'HDAccount', address: ADDRESS, xpub: 'public' },
    network: {
      kind: 'ethereum',
      chainId: 1,
      url: 'https://rpc.invalid',
      slip44: 60,
    },
    isBitcoinBased: false,
    sessionGeneration: 1,
  };
  const approval = createDappSigningApproval({
    readScope: () => scope,
    subscribe: () => () => undefined,
  });
  const sdk = {
    getEncryptedPubKey: jest.fn(() => 'public-key'),
    decryptMessage: jest.fn<string, [[string, string]]>(() => '  plaintext\n'),
  };
  const received: string[] = [];
  const ports = {
    account: { type: 'HDAccount' },
    request: readDappEncryptionRequest(
      method,
      method === 'eth_decrypt' ? [cipher, ADDRESS] : [ADDRESS],
      ADDRESS
    )!,
    approval,
    sdk: sdk as DappEncryptionSdk,
    assertCurrent: jest.fn(() => undefined),
    checkDocument: jest.fn(async () => undefined),
    deliver: jest.fn(
      async (value: string, check: () => void, dispatched: () => void) => {
        check();
        dispatched();
        received.push(value);
      }
    ),
  };
  const prepared = prepareDappEncryptionApproval(ports);
  return {
    prepared,
    approval,
    sdk,
    ports,
    received,
    get scope() {
      return scope;
    },
    change(next: DappSigningScope) {
      scope = next;
    },
  };
}

describe('canonical encryption requests', () => {
  it.each(['SmartAccount', 'Ledger', 'Trezor', 'unknown'])(
    'refuses unsupported %s before private SDK work',
    (type) => {
      const f = fixture();
      expect(supportsDappEncryptionAccount({ type })).toBe(false);
      expect(() =>
        prepareDappEncryptionApproval({ ...f.ports, account: { type } })
      ).toThrow('Unsupported method');
      expect(f.sdk.decryptMessage).not.toHaveBeenCalled();
      expect(f.sdk.getEncryptedPubKey).not.toHaveBeenCalled();
    }
  );
  it.each(['HDAccount', 'Imported'])(
    'admits only the own software-key %s record',
    (type) => {
      expect(supportsDappEncryptionAccount({ type })).toBe(true);
      expect(
        supportsDappEncryptionAccount({ type, isSmartAccount: true })
      ).toBe(false);
      expect(
        supportsDappEncryptionAccount({ type, isLedgerWallet: true })
      ).toBe(false);
      expect(
        supportsDappEncryptionAccount({ type, isTrezorWallet: true })
      ).toBe(false);
    }
  );
  it.each([
    ['eth_decrypt', ['0x123', ADDRESS]],
    ['eth_decrypt', [ADDRESS, '0x1234']],
    ['eth_decrypt', ['0x', ADDRESS]],
    ['eth_decrypt', ['0xzz', ADDRESS]],
    ['eth_decrypt', ['0x12', ADDRESS, true]],
    ['eth_getEncryptionPublicKey', []],
    ['eth_getEncryptionPublicKey', [ADDRESS, ADDRESS]],
    ['eth_decrypt', ['0x12', `0x${'22'.repeat(20)}`]],
  ])('refuses malformed %s %#', (method, params) => {
    expect(readDappEncryptionRequest(method, params, ADDRESS)).toBeUndefined();
  });
  it('uses the general budget, preserves complete bytes, and captures case-insensitive receiver', () => {
    const ciphertext = `0x${'AB'.repeat(40_000)}`;
    const params = [ciphertext, ADDRESS.toLowerCase()];
    const request = readDappEncryptionRequest('eth_decrypt', params, ADDRESS);
    expect(request).toEqual({
      method: 'eth_decrypt',
      ciphertext,
      address: ADDRESS,
    });
    params[0] = '0xab';
    expect(Object.isFrozen(request)).toBe(true);
    expect(request).toHaveProperty('ciphertext', ciphertext);
    expect(
      readDappEncryptionRequest(
        'eth_decrypt',
        [`0x${'ab'.repeat(600_000)}`, ADDRESS],
        ADDRESS
      )
    ).toBeUndefined();
  });
});

describe('one prepared encryption approval', () => {
  it('keeps preview optional and reruns SDK on Confirm without exposing a result to the renderer', async () => {
    const f = fixture();
    expect(await f.prepared.preview()).toBe('  plaintext\n');
    expect(f.received).toEqual([]);
    expect(await f.prepared.approve()).toBeUndefined();
    expect(f.sdk.decryptMessage).toHaveBeenCalledTimes(2);
    expect(f.received).toEqual(['  plaintext\n']);
    await expect(f.prepared.approve()).rejects.toThrow('no longer current');
    await expect(f.prepared.preview()).rejects.toThrow('no longer current');
  });
  it.each(['eth_decrypt', 'eth_getEncryptionPublicKey'] as const)(
    'confirms %s without preview',
    async (method) => {
      const f = fixture(method);
      await f.prepared.approve();
      expect(f.received).toEqual([
        method === 'eth_decrypt' ? '  plaintext\n' : 'public-key',
      ]);
    }
  );
  it('retries current SDK errors but cannot retry an uncertain response', async () => {
    const f = fixture();
    f.sdk.decryptMessage.mockImplementationOnce(() => {
      throw new Error('Bad ciphertext');
    });
    await expect(f.prepared.approve()).rejects.toThrow('Bad ciphertext');
    f.ports.deliver.mockImplementationOnce(
      async (_value, check, dispatched) => {
        check();
        dispatched();
        throw new Error('Lost ACK');
      }
    );
    await expect(f.prepared.approve()).rejects.toThrow('Lost ACK');
    await expect(f.prepared.approve()).rejects.toThrow('no longer current');
    expect(f.sdk.decryptMessage).toHaveBeenCalledTimes(2);
  });
  it.each(['grant', 'account', 'xpub', 'network', 'session'] as const)(
    'retires on %s changes during document probe',
    async (field) => {
      const f = fixture();
      f.ports.checkDocument.mockImplementationOnce(async () => {
        const before = f.scope;
        f.change(
          field === 'grant'
            ? { ...before, grant: { ...before.grant! } }
            : field === 'account'
            ? { ...before, account: { ...before.account, id: 1 } }
            : field === 'xpub'
            ? { ...before, account: { ...before.account, xpub: 'changed' } }
            : field === 'network'
            ? {
                ...before,
                network: { ...before.network, url: 'https://other.invalid' },
              }
            : { ...before, sessionGeneration: 2 }
        );
      });
      await expect(f.prepared.approve()).rejects.toThrow('no longer current');
      expect(f.sdk.decryptMessage).not.toHaveBeenCalled();
      expect(f.received).toEqual([]);
    }
  );
  it('checks document again after the SDK and never hands off stale plaintext', async () => {
    const f = fixture();
    f.ports.checkDocument
      .mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error('Document retired'));
    await expect(f.prepared.approve()).rejects.toThrow();
    expect(f.sdk.decryptMessage).toHaveBeenCalledTimes(1);
    expect(f.received).toEqual([]);
    await expect(f.prepared.preview()).rejects.toThrow('no longer current');
  });
  it.each(['resolve', 'reject'] as const)(
    'refuses async authority %s before private work',
    async (outcome) => {
      const f = fixture();
      f.ports.assertCurrent.mockImplementation((() =>
        outcome === 'resolve'
          ? Promise.resolve()
          : Promise.reject(new Error('Revoked'))) as any);
      await expect(f.prepared.preview()).rejects.toThrow('must be synchronous');
      expect(f.sdk.decryptMessage).not.toHaveBeenCalled();
    }
  );
  it('refuses an async guard introduced after a document await', async () => {
    const f = fixture();
    f.ports.checkDocument.mockImplementationOnce(async () => {
      f.ports.assertCurrent.mockImplementation((async () => undefined) as any);
    });
    await expect(f.prepared.approve()).rejects.toThrow('must be synchronous');
    expect(f.received).toEqual([]);
  });
  it('cannot release preview after explicit retirement or allow concurrent confirmation', async () => {
    const f = fixture();
    let release!: () => void;
    f.ports.checkDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const preview = f.prepared.preview();
    await expect(f.prepared.approve()).rejects.toThrow('busy');
    f.prepared.retire();
    release();
    await expect(preview).rejects.toThrow('no longer current');
    expect(f.received).toEqual([]);
  });
});

describe('published SDK 2.1.9 encryption primitive', () => {
  it('preserves an empty SDK result in the seam while the pinned real primitive refuses empty ciphertext plaintext', async () => {
    const f = fixture();
    f.sdk.decryptMessage.mockReturnValue('');
    expect(await f.prepared.preview()).toBe('');
    await f.prepared.approve();
    expect(f.received).toEqual(['']);
    const encrypted = encrypt({
      publicKey: getEncryptionPublicKey(KEY),
      data: '',
      version: 'x25519-xsalsa20-poly1305',
    });
    const actual = new EthereumTransactions(
      () => f.scope.network,
      () => ({ address: ADDRESS, decryptedPrivateKey: KEY }),
      () => ({
        activeAccountType: 'HDAccount',
        activeAccountId: 0,
        accounts: { HDAccount: { 0: { address: ADDRESS } } },
      }),
      {},
      {},
      () => () => undefined,
      null
    );
    expect(() =>
      actual.decryptMessage([
        '0x' + Buffer.from(JSON.stringify(encrypted)).toString('hex'),
        ADDRESS,
      ])
    ).toThrow('Decryption failed');
  });
  it.each([' \t\n ', 'Unicode plaintext: ☃ 👋'])(
    'preserves exact plaintext %# and reruns the actual SDK',
    async (plaintext) => {
      const ciphertext =
        '0x' +
        Buffer.from(
          JSON.stringify(
            encrypt({
              publicKey: getEncryptionPublicKey(KEY),
              data: plaintext,
              version: 'x25519-xsalsa20-poly1305',
            })
          )
        ).toString('hex');
      const f = fixture('eth_decrypt', ciphertext);
      const sdk = new EthereumTransactions(
        () => f.scope.network,
        () => ({ address: ADDRESS, decryptedPrivateKey: KEY }),
        () => ({
          activeAccountType: 'HDAccount',
          activeAccountId: 0,
          accounts: { HDAccount: { 0: { address: ADDRESS } } },
        }),
        {},
        {},
        () => () => undefined,
        null
      );
      f.sdk.decryptMessage.mockImplementation((params: [string, string]) =>
        sdk.decryptMessage(params)
      );
      expect(await f.prepared.preview()).toBe(plaintext);
      await f.prepared.approve();
      expect(f.received).toEqual([plaintext]);
      expect(f.ports.sdk.decryptMessage).toHaveBeenCalledTimes(2);
      expect(sdk.getEncryptedPubKey()).toBe(getEncryptionPublicKey(KEY));
    }
  );
});
