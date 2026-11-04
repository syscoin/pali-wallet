import { readSignedRecordEvidence, retainedSignedEntries } from './signed-record-evidence.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { NativeAccountRequest } from '../src/custody/accounts.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';
import type { NativeTransferRuntime } from '../src/custody/transfers.ts';

type Check = <T>(name: string, operation: () => Promise<T>) => Promise<T>;
const IMPORTED_THIRD_ADDRESS = '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A';
const REPORT_FIELDS = Object.freeze([
  'nativeErc20Verified',
  'erc20AccountId',
  'erc20AccountIndex',
  'erc20Address',
  'erc20TransferHash',
  'erc20IntentHash',
  'erc20Signatures',
  'erc20Authorizations',
  'erc20InjectedBroadcasts',
  'erc20RestoredFromJournal',
]);
export type Erc20QualificationEvidence = Readonly<{
  nativeErc20Verified: true;
  erc20AccountId: 'hd:60:2';
  erc20AccountIndex: 2;
  erc20Address: string;
  erc20TransferHash: string;
  erc20IntentHash: string;
  erc20Signatures: number;
  erc20Authorizations: number;
  erc20InjectedBroadcasts: 1;
  erc20RestoredFromJournal: boolean;
}>;

/** Pure report checks load in the host runner without loading the native SDK. */
export function isErc20QualificationReport(
  report: Record<string, unknown>
): boolean {
  if (report.status === 'failed')
    return REPORT_FIELDS.every((field) => !Object.hasOwn(report, field));
  if (
    report.status !== 'passed' ||
    !['create', 'restart'].includes(report.phase as string) ||
    !['import', 'generate'].includes(report.scenario as string)
  )
    return false;
  return (
    report.nativeErc20Verified === true &&
    report.networkCalls === 0 &&
    report.erc20AccountId === 'hd:60:2' &&
    report.erc20AccountIndex === 2 &&
    typeof report.erc20Address === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(report.erc20Address) &&
    report.erc20Address !== report.address &&
    (report.scenario !== 'import' ||
      report.erc20Address === IMPORTED_THIRD_ADDRESS) &&
    typeof report.erc20TransferHash === 'string' &&
    /^0x[0-9a-f]{64}$/.test(report.erc20TransferHash) &&
    report.erc20TransferHash !== report.transferHash &&
    report.erc20TransferHash !== report.firstTransferHash &&
    typeof report.erc20IntentHash === 'string' &&
    /^0x[0-9a-f]{64}$/.test(report.erc20IntentHash) &&
    report.erc20Signatures === (report.phase === 'create' ? 1 : 0) &&
    report.erc20Authorizations === (report.phase === 'create' ? 0 : 1) &&
    report.erc20InjectedBroadcasts === 1 &&
    report.erc20RestoredFromJournal === (report.phase === 'restart')
  );
}

export function matchesErc20RestartEvidence(
  created: Record<string, unknown>,
  restored: Record<string, unknown>
): boolean {
  return (
    created.status === 'passed' &&
    restored.status === 'passed' &&
    created.phase === 'create' &&
    restored.phase === 'restart' &&
    created.scenario === restored.scenario &&
    isErc20QualificationReport(created) &&
    isErc20QualificationReport(restored) &&
    typeof created.fingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(created.fingerprint) &&
    [
      'fingerprint',
      'erc20Address',
      'erc20AccountId',
      'erc20AccountIndex',
      'erc20TransferHash',
      'erc20IntentHash',
    ].every((field) => created[field] === restored[field])
  );
}

function expect(value: unknown): asserts value {
  if (!value) throw Error('QUALIFICATION_ERC20_ASSERTION_FAILED');
}

/** Public fixture only. Uses real custody/SQLCipher/SDK with an injected, bounded RPC. */
export async function qualifyNativeErc20Transfer(
  options: Readonly<{
    phase: 'create' | 'restart';
    authority: NativeCustodyAuthority;
    runtime: KeyringRuntime;
    storage: Pick<OpenWalletStorage, 'keyringStorage' | 'signedRecords' | 'recovery' | 'getWalletFingerprint'>;
    password: string;
    expectedThirdAddress?: string;
    check: Check;
  }>
): Promise<Erc20QualificationEvidence> {
  const { phase, authority, runtime, storage, password, check } = options;
  // Keep imports after the caller's native cryptography/storage admission.
  const [
    { NativeTransfers },
    { NativeTransferRpc },
    { Transaction },
    { keccak256 },
    { toUtf8Bytes },
    { encodeErc20Transfer },
    { equalTransferIntent },
    { RPC_ENDPOINTS },
  ] = await Promise.all([
    import('../src/custody/transfers.ts'),
    import('../src/custody/transferRpc.ts'),
    import('ethers/transaction'),
    import('ethers/crypto'),
    import('ethers/utils'),
    import('../../../source/shared/erc20.ts'),
    import('../src/custody/transferIntent.ts'),
    import('../src/platformRpc.ts'),
  ]);
  const transfer = runtime.transfers;
  const tokens = runtime.tokens;
  expect(transfer?.token && tokens && authority.supportsAccountManagement());
  const catalogue = () => {
    const current = authority.getCatalogue();
    expect(current);
    return current;
  };
  const current = () => authority.getSnapshot();
  expect(
    current().phase === 'ready' &&
      current().account?.network === 'ethereum' &&
      catalogue().active.accountId === 'hd:60:1'
  );
  const originalAddresses = catalogue().accounts.filter(account => [0, 1].includes(account.index)).map(account => account.address);
  const nativeRows = retainedSignedEntries((await readSignedRecordEvidence(storage)).entries, originalAddresses);
  const fingerprint = await storage.getWalletFingerprint();
  const manage = (request: NativeAccountRequest) =>
    authority.manageAccounts(request, current().revision, catalogue().revision);
  if (phase === 'create') {
    expect(
      typeof options.expectedThirdAddress === 'string' &&
        /^0x[0-9a-fA-F]{40}$/.test(options.expectedThirdAddress)
    );
    await check('native ERC20 dedicated HD2 account', async () => {
      expect(!catalogue().accounts.some((account) => account.index === 2));
      await manage({
        kind: 'create',
        label: 'Qualification ERC20 account',
        password,
      });
    });
  } else
    await check('native ERC20 select retained HD2 after cold restart', () =>
      manage({ kind: 'select', id: 'hd:60:2' })
    );
  const account = catalogue().accounts.find((entry) => entry.index === 2);
  expect(
    account?.id === 'hd:60:2' &&
      catalogue().active.accountId === account.id &&
      current().account?.address === account.address
  );
  if (options.expectedThirdAddress)
    expect(account.address === options.expectedThirdAddress);
  const address = account.address;
  const revision = current().revision;
  const guard = () =>
    expect(
      current().phase === 'ready' &&
        current().revision === revision &&
        current().account?.address === address &&
        current().account?.network === 'ethereum' &&
        catalogue().active.accountId === 'hd:60:2'
    );
  const token = Object.freeze({
    contractAddress: '0x3333333333333333333333333333333333333333',
    name: 'Pali native qualification token',
    symbol: 'PALI-QA',
    decimals: 6,
  });
  const recipient = '0x1111111111111111111111111111111111111111';
  const amountUnits = '1234567';
  const calldata = encodeErc20Transfer(recipient, amountUnits);
  const expectedIntent = Object.freeze({
    kind: 'erc20-transfer' as const,
    chainId: '1',
    token,
    recipient,
    amountUnits,
  });
  if (phase === 'create')
    await check('native ERC20 registry import on HD2', async () => {
      const inventory = await tokens.load(guard);
      guard();
      expect(inventory.items.length === 0);
      const added = await tokens.add(inventory.revision, token, guard);
      guard();
      expect(
        added.items.length === 1 &&
          added.items[0]?.contractAddress === token.contractAddress
      );
    });
  let signatures = 0,
    authorizations = 0,
    broadcasts = 0,
    requests = 0,
    tokenLookups = 0;
  let expectedHash: string | undefined;
  let expectedRaw: string | undefined;
  const word = (value: bigint | number) =>
    `0x${BigInt(value).toString(16).padStart(64, '0')}`;
  const unsigned = Object.freeze({
    from: address,
    to: token.contractAddress,
    value: '0x0',
    data: calldata,
  });
  const readSaved = async (expectedPhase: 'signed' | 'submitted') => {
    const journal = await transfer.journal(guard);
    const saved = await journal.load();
    guard();
    expect(
      saved?.phase === expectedPhase &&
        equalTransferIntent(saved.intent, expectedIntent)
    );
    const tx = Transaction.from(saved.rawTransaction);
    expect(
      tx.isSigned() &&
        tx.from === address &&
        tx.to === token.contractAddress &&
        tx.chainId === 1n &&
        tx.value === 0n &&
        tx.nonce === 0 &&
        tx.data === calldata &&
        tx.gasLimit === 60000n &&
        tx.maxFeePerGas === 3n &&
        tx.maxPriorityFeePerGas === 1n &&
        tx.hash === saved.hash
    );
    const raw = await readSignedRecordEvidence(storage);
    const retained = raw.entries.filter(entry => entry.from === address.toLowerCase());
    expect(raw.version === 1 && retained.length === 1 && retained[0]?.hash === saved.hash &&
      retained[0].phase === expectedPhase && retained[0].signer.id === 2 && retained[0].signer.type === 'HDAccount' &&
      equalTransferIntent(retained[0].metadata?.intent, expectedIntent) && !raw.raw?.includes(saved.rawTransaction));
    expect((await storage.getWalletFingerprint()) === fingerprint);
    guard();
    return saved;
  };
  const wrapped: NativeTransferRuntime = {
      submit: (...args) => transfer.submit(...args),
    token: (contract, assertCurrent) => {
      tokenLookups++;
      expect(phase === 'create');
      return transfer.token!(contract, assertCurrent);
    },
    journal: (assertCurrent) => transfer.journal(assertCurrent),
    async sign(transaction, assertCurrent, intent) {
      signatures++;
      expect(
        signatures <= 1 &&
          phase === 'create' &&
          equalTransferIntent(intent, expectedIntent)
      );
      return transfer.sign(transaction, assertCurrent, intent);
    },
    // Retain the report field: this counts unlocked-session admission, not a password check.
    assertUnlocked(assertCurrent) {
      authorizations++;
      expect(authorizations === 1 && phase === 'restart');
      return transfer.assertUnlocked(assertCurrent);
    },
  };
  const rpc = new NativeTransferRpc({ networkId: 'ethereum',
    fetch: async (url, init) => {
      guard();
      expect(
        url === RPC_ENDPOINTS.ethereum &&
          init.method === 'POST' &&
          init.credentials === 'omit' &&
          init.redirect === 'error'
      );
      expect(
        typeof init.body === 'string' &&
          init.body.length < 5000 &&
          !init.body.includes(password) &&
          ++requests <= 64
      );
      const body = JSON.parse(init.body) as {
        jsonrpc: string;
        id: number;
        method: string;
        params: unknown[];
      };
      // Transfer and receipt readers each own a request-ID sequence. Echo the
      // initiating ID; uniqueness across these separate clients is not required.
      expect(
        body.jsonrpc === '2.0' &&
          Number.isSafeInteger(body.id) &&
          body.id > 0 &&
          Array.isArray(body.params)
      );
      const params = body.params;
      let result: unknown;
      const same = (expected: unknown[]) =>
        expect(JSON.stringify(params) === JSON.stringify(expected));
      if (body.method === 'eth_chainId') {
        same([]);
        result = '0x1';
      } else if (body.method === 'eth_getBlockByNumber') {
        expect(
          params.length === 2 &&
            ['latest', 'finalized', '0x123'].includes(params[0] as string) &&
            params[1] === false
        );
        result = { number: '0x123', hash: '0x' + 'a'.repeat(64), baseFeePerGas: '0x1', gasLimit: '0x1c9c380' };
      } else if (body.method === 'eth_getCode') {
        same([token.contractAddress, '0x123']);
        result = '0x6000';
      } else if (body.method === 'eth_getTransactionCount') {
        expect(
          params.length === 2 &&
            params[0] === address &&
            ['pending', 'latest', '0x123'].includes(params[1] as string)
        );
        result = '0x0';
      } else if (body.method === 'eth_getBalance') {
        same([address, 'pending']);
        result = '0xde0b6b3a7640000';
      } else if (body.method === 'eth_gasPrice') { same([]); result = '0x2';
      } else if (body.method === 'eth_feeHistory') {
        same(['0x1', 'latest', []]);
        result = { oldestBlock: '0x123', baseFeePerGas: ['0x1', '0x1'] };
      } else if (body.method === 'eth_maxPriorityFeePerGas') {
        same([]);
        result = '0x1';
      } else if (body.method === 'eth_estimateGas') {
        same([{ ...unsigned, type: '0x2', chainId: '0x1', nonce: '0x0', maxFeePerGas: '0x3', maxPriorityFeePerGas: '0x1' }, 'pending']);
        result = '0xc350';
      } else if (body.method === 'eth_call') {
        if (
          JSON.stringify(params) ===
          JSON.stringify([
            { to: token.contractAddress, data: '0x313ce567' },
            '0x123',
          ])
        )
          result = word(6);
        else if (
          JSON.stringify(params) ===
          JSON.stringify([
            {
              to: token.contractAddress,
              data: `0x70a08231${address
                .slice(2)
                .toLowerCase()
                .padStart(64, '0')}`,
            },
            '0x123',
          ])
        )
          result = word(123456789);
        else {
          same([unsigned, '0x123']);
          result = word(1);
        }
      } else if (body.method === 'eth_getTransactionReceipt') {
        same([expectedHash]);
        result = null;
      } else if (body.method === 'eth_sendRawTransaction') {
        const saved = await readSaved('signed');
        guard();
        same([saved.rawTransaction]);
        broadcasts++;
        expect(broadcasts === 1);
        if (expectedHash)
          expect(
            saved.hash === expectedHash && saved.rawTransaction === expectedRaw
          );
        expectedHash = saved.hash;
        expectedRaw = saved.rawTransaction;
        if (phase === 'create')
          throw Error('QUALIFICATION_ERC20_LOST_RESPONSE');
        result = saved.hash;
      } else throw Error('QUALIFICATION_ERC20_RPC_FORBIDDEN');
      const text = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
      expect(text.length < 4096);
      guard();
      return {
        ok: true,
        headers: {
          get: (name: string) =>
            name === 'content-type'
              ? 'application/json'
              : name === 'content-length'
              ? String(text.length)
              : null,
        },
        text: async () => text,
      } as unknown as Response;
    },
  });
  const controller = new NativeTransfers(authority, () => wrapped, { rpc });
  try {
    if (phase === 'create')
      await check(
        'native ERC20 sign persist and lost injected response',
        async () => {
          await controller.prepareToken(
            token.contractAddress,
            recipient,
            '1.234567'
          );
          guard();
          const review = controller.getSnapshot().review;
          expect(
            review &&
              !review.retry &&
              review.recipient === recipient &&
              review.amountUnits === amountUnits &&
              review.totalUnits === '180000' &&
              equalTransferIntent(review.intent, expectedIntent)
          );
          await controller.confirm(review.id);
          guard();
          expect(
            controller.getSnapshot().phase === 'unknown' &&
              controller.getSnapshot().hash === expectedHash
          );
          expect(
            signatures === 1 &&
              authorizations === 0 &&
              broadcasts === 1 &&
              tokenLookups === 1
          );
          await readSaved('signed');
        }
      );
    else
      await check(
        'native ERC20 cold restart intent and exact-byte authorized retry',
        async () => {
          const saved = await readSaved('signed');
          expectedHash = saved.hash;
          expectedRaw = saved.rawTransaction;
          await controller.recover(true);
          guard();
          const review = controller.getSnapshot().review;
          expect(
            review?.retry &&
              review.recipient === recipient &&
              review.amountUnits === amountUnits &&
              equalTransferIntent(review.intent, expectedIntent)
          );
          await controller.confirm(review.id);
          guard();
          expect(
            controller.getSnapshot().phase === 'pending' &&
              controller.getSnapshot().hash === expectedHash
          );
          expect(
            signatures === 0 &&
              authorizations === 1 &&
              broadcasts === 1 &&
              tokenLookups === 0
          );
          await readSaved('submitted');
        }
      );
    expect(expectedHash && expectedRaw);
    const intentHash = keccak256(
      toUtf8Bytes(JSON.stringify([fingerprint, address, '1', expectedIntent]))
    );
    await check(
      'native ERC20 leaves original HD journals and selection intact',
      async () => {
        expect(retainedSignedEntries((await readSignedRecordEvidence(storage)).entries, originalAddresses) === nativeRows);
        await manage({ kind: 'select', id: 'hd:60:1' });
        expect(
          catalogue().active.accountId === 'hd:60:1' &&
            current().account?.address ===
              catalogue().accounts.find((entry) => entry.index === 1)?.address
        );
        expect((await storage.getWalletFingerprint()) === fingerprint);
      }
    );
    return Object.freeze({
      nativeErc20Verified: true,
      erc20AccountId: 'hd:60:2',
      erc20AccountIndex: 2,
      erc20Address: address,
      erc20TransferHash: expectedHash,
      erc20IntentHash: intentHash,
      erc20Signatures: signatures,
      erc20Authorizations: authorizations,
      erc20InjectedBroadcasts: 1,
      erc20RestoredFromJournal: phase === 'restart',
    });
  } finally {
    controller.dispose();
  }
}
