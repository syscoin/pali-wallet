import { readSignedRecordEvidence, retainedSignedEntries } from './signed-record-evidence.ts';
import type { NativeCustodyAuthority } from '../src/custody/authority.ts';
import type { NativeAccountRequest } from '../src/custody/accounts.ts';
import type { KeyringRuntime } from '../src/custody/keyringRuntime.ts';
import type { NativeTransferRuntime } from '../src/custody/transfers.ts';
import type { OpenWalletStorage } from '../src/storage/types.ts';

type Check = <T>(name: string, operation: () => Promise<T>) => Promise<T>;
const IMPORTED_FIFTH_ADDRESS = '0x51cA8ff9f1C0a99f88E86B8112eA3237F55374cA';
const REPORT_FIELDS = Object.freeze([
  'nativeZksysVerified',
  'zksysAccountId',
  'zksysAccountIndex',
  'zksysAddress',
  'zksysTransferHash',
  'zksysChainId',
  'zksysJournalContainerVersion',
  'zksysSignatures',
  'zksysAuthorizations',
  'zksysInjectedBroadcasts',
  'zksysFeeEstimates',
  'zksysRestoredFromJournal',
]);
export type ZksysQualificationEvidence = Readonly<{
  nativeZksysVerified: true;
  zksysAccountId: 'hd:60:4';
  zksysAccountIndex: 4;
  zksysAddress: string;
  zksysTransferHash: string;
  zksysChainId: '57057';
  zksysJournalContainerVersion: 1;
  zksysSignatures: number;
  zksysAuthorizations: number;
  zksysInjectedBroadcasts: 1;
  zksysFeeEstimates: number;
  zksysRestoredFromJournal: boolean;
}>;

/** Host checks stay independent of native crypto and the software SDK. */
export function isZksysQualificationReport(
  report: Record<string, unknown>
): boolean {
  if (report.status === 'failed')
    return REPORT_FIELDS.every((field) => !Object.hasOwn(report, field));
  const hashes = [
    report.zksysTransferHash,
    report.transferHash,
    report.firstTransferHash,
    report.erc20TransferHash,
    report.nevmTransferHash,
    report.nevmEthereumTransferHash,
  ];
  return (
    report.status === 'passed' &&
    (report.phase === 'create' || report.phase === 'restart') &&
    (report.scenario === 'import' || report.scenario === 'generate') &&
    report.networkCalls === 0 &&
    report.nativeZksysVerified === true &&
    report.zksysAccountId === 'hd:60:4' &&
    report.zksysAccountIndex === 4 &&
    typeof report.zksysAddress === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(report.zksysAddress) &&
    !/^0x0{40}$/.test(report.zksysAddress) &&
    ![report.address, report.erc20Address, report.nevmAddress].includes(
      report.zksysAddress
    ) &&
    (report.scenario !== 'import' ||
      report.zksysAddress === IMPORTED_FIFTH_ADDRESS) &&
    hashes.every(
      (value) => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)
    ) &&
    new Set(hashes).size === hashes.length &&
    report.zksysChainId === '57057' &&
    report.zksysJournalContainerVersion === 1 &&
    report.zksysSignatures === (report.phase === 'create' ? 1 : 0) &&
    report.zksysAuthorizations === (report.phase === 'create' ? 0 : 1) &&
    report.zksysInjectedBroadcasts === 1 &&
    report.zksysFeeEstimates === (report.phase === 'create' ? 2 : 0) &&
    report.zksysRestoredFromJournal === (report.phase === 'restart')
  );
}

export function matchesZksysRestartEvidence(
  created: Record<string, unknown>,
  restored: Record<string, unknown>
): boolean {
  return (
    created.status === 'passed' &&
    restored.status === 'passed' &&
    created.phase === 'create' &&
    restored.phase === 'restart' &&
    created.scenario === restored.scenario &&
    isZksysQualificationReport(created) &&
    isZksysQualificationReport(restored) &&
    typeof created.fingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(created.fingerprint) &&
    [
      'fingerprint',
      'zksysAccountId',
      'zksysAccountIndex',
      'zksysAddress',
      'zksysTransferHash',
      'zksysChainId',
      'zksysJournalContainerVersion',
    ].every((field) => created[field] === restored[field])
  );
}
function expect(value: unknown): asserts value {
  if (!value) throw Error('QUALIFICATION_ZKSYS_ASSERTION_FAILED');
}

/** Offline public fixture: actual controller, SDK and durable storage; injected RPC only. */
export async function qualifyNativeZksysTransfer(
  options: Readonly<{
    phase: 'create' | 'restart';
    authority: NativeCustodyAuthority;
    runtime: KeyringRuntime;
    storage: Pick<OpenWalletStorage, 'keyringStorage' | 'signedRecords' | 'recovery' | 'getWalletFingerprint'>;
    password: string;
    expectedFifthAddress?: string;
    check: Check;
  }>
): Promise<ZksysQualificationEvidence> {
  const { phase, authority, runtime, storage, password, check } = options;
  expect(phase === 'create' || phase === 'restart');
  if (options.expectedFifthAddress !== undefined)
    expect(
      typeof options.expectedFifthAddress === 'string' &&
        /^0x[0-9a-fA-F]{40}$/.test(options.expectedFifthAddress)
    );
  const [
    { NativeTransfers },
    { NativeTransferRpc },
    { Transaction },
    { getNativeNetwork },
  ] = await Promise.all([
    import('../src/custody/transfers.ts'),
    import('../src/custody/transferRpc.ts'),
    import('ethers/transaction'),
    import('../src/custody/networkContext.ts'),
  ]);
  const transfer = runtime.transfers;
  expect(transfer && authority.supportsAccountManagement());
  const current = () => authority.getSnapshot();
  const catalogue = () => {
    const value = authority.getCatalogue();
    expect(value);
    return value;
  };
  const manage = (request: NativeAccountRequest) =>
    authority.manageAccounts(request, current().revision, catalogue().revision);
  const second = catalogue().accounts.find(
    (account) => account.id === 'hd:60:1'
  );
  expect(
    second &&
      current().phase === 'ready' &&
      current().account?.network === 'ethereum' &&
      current().account?.address === second.address &&
      catalogue().active.accountId === second.id
  );
  const initialRevision = current().revision;
  const initialGuard = () =>
    expect(
      current().phase === 'ready' &&
        current().revision === initialRevision &&
        current().account?.network === 'ethereum' &&
        catalogue().active.accountId === second.id
    );
  const fingerprint = await storage.getWalletFingerprint();
  initialGuard();
  const olderAddresses = [0, 1, 2, 3].map(index => {
    const account = catalogue().accounts.find(item => item.id === `hd:60:${index}`); expect(account); return account.address;
  });
  const before = await readSignedRecordEvidence(storage);
  const olderRows = retainedSignedEntries(before.entries, olderAddresses);
  if (phase === 'create') {
    expect(!catalogue().accounts.some(account => account.index === 4));
    expect(!before.entries.some(entry => entry.signer.type === 'HDAccount' && entry.signer.id === 4));
    initialGuard();
    await check('native zkSYS dedicated HD4 account', () =>
      manage({ kind: 'create', label: 'Qualification zkSYS account', password })
    );
  } else
    await check('native zkSYS select retained HD4 after cold restart', () =>
      manage({ kind: 'select', id: 'hd:60:4' })
    );
  const account = catalogue().accounts.find((entry) => entry.index === 4);
  expect(
    account?.id === 'hd:60:4' &&
      catalogue().active.accountId === account.id &&
      current().account?.address === account.address
  );
  if (options.expectedFifthAddress)
    expect(account.address === options.expectedFifthAddress);
  await authority.selectNetwork(
    'zksys-testnet',
    current().revision,
    catalogue().revision
  );
  const address = account.address;
  const revision = current().revision;
  const guard = () =>
    expect(
      current().phase === 'ready' &&
        current().revision === revision &&
        current().account?.address === address &&
        current().account?.network === 'zksys-testnet' &&
        catalogue().active.accountId === account.id
    );
  guard();
  const registration = getNativeNetwork('zksys-testnet');
  const recipient = '0x1111111111111111111111111111111111111111';
  const readSaved = async (expectedPhase: 'signed' | 'submitted') => {
    const entry = await (await transfer.journal(guard)).load();
    guard();
    expect(
      entry?.phase === expectedPhase &&
        entry.intent === undefined &&
        entry.scope.chainId === '57057' &&
        entry.scope.walletFingerprint === fingerprint
    );
    const tx = Transaction.from(entry.rawTransaction);
    expect(
      tx.isSigned() &&
        tx.type === 2 &&
        tx.from === address &&
        tx.to === recipient &&
        tx.chainId === 57057n &&
        tx.nonce === 0 &&
        tx.value === 789n &&
        tx.data === '0x' &&
        tx.gasLimit === 36000n &&
        tx.maxFeePerGas === 25n &&
        tx.maxPriorityFeePerGas === 0n &&
        tx.hash === entry.hash &&
        tx.serialized === entry.rawTransaction
    );
    const row = await readSignedRecordEvidence(storage); guard();
    const retained = row.entries.filter(item => item.from === address.toLowerCase());
    expect(row.version === 1 && retained.length === 1 && retained[0]?.hash === entry.hash &&
      retained[0].phase === expectedPhase && retained[0].chainId === '57057' &&
      retained[0].signer.type === 'HDAccount' && retained[0].signer.id === 4 &&
      retained[0].metadata?.intent === undefined && !row.raw?.includes(entry.rawTransaction));
    expect((await storage.getWalletFingerprint()) === fingerprint);
    guard();
    return entry;
  };
  let signatures = 0,
    authorizations = 0,
    broadcasts = 0,
    estimates = 0,
    requests = 0;
  let expectedRaw: string | undefined, expectedHash: string | undefined;
  const wrapped: NativeTransferRuntime = {
      submit: (...args) => transfer.submit(...args),
    journal: (checkCurrent) => transfer.journal(checkCurrent),
    async sign(transaction, checkCurrent, intent) {
      expect(phase === 'create' && ++signatures === 1 && intent === undefined);
      return transfer.sign(transaction, checkCurrent, intent);
    },
    // Retain the report field: this counts unlocked-session admission, not a password check.
    assertUnlocked(checkCurrent) {
      expect(phase === 'restart' && ++authorizations === 1);
      return transfer.assertUnlocked(checkCurrent);
    },
  };
  const rpc = new NativeTransferRpc({
    networkId: 'zksys-testnet',
    fetch: async (url, init) => {
      guard();
      expect(
        url === registration.rpcUrl &&
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
      expect(
        body.jsonrpc === '2.0' &&
          Number.isSafeInteger(body.id) &&
          body.id > 0 &&
          Array.isArray(body.params)
      );
      const params = body.params;
      const same = (expected: unknown[]) =>
        expect(JSON.stringify(params) === JSON.stringify(expected));
      let result: unknown;
      if (body.method === 'eth_chainId') {
        same([]);
        result = '0xdee1';
      } else if (body.method === 'eth_getBlockByNumber') {
        expect(
          params.length === 2 &&
            ['latest', 'finalized', '0x64', '0x5a'].includes(
              params[0] as string
            ) &&
            params[1] === false
        );
        const number =
          params[0] === 'latest'
            ? '0x64'
            : params[0] === 'finalized'
            ? '0x5a'
            : params[0];
        result = {
          number,
          hash: '0x' + (number === '0x64' ? 'a' : 'b').repeat(64),
          baseFeePerGas: '0xa',
          gasLimit: '0x1000000',
        };
      } else if (body.method === 'eth_getTransactionCount') {
        expect(
          params.length === 2 &&
            params[0] === address &&
            ['pending', 'latest', '0x5a'].includes(params[1] as string)
        );
        result = '0x0';
      } else if (body.method === 'eth_getBalance') {
        expect(phase === 'create');
        same([address, 'pending']);
        result = '0xde0b6b3a7640000';
      } else if (body.method === 'eth_gasPrice') { same([]); result = '0xa';
      } else if (body.method === 'eth_feeHistory') {
        expect(phase === 'create');
        same(['0x1', 'latest', []]);
        result = { oldestBlock: '0x64', baseFeePerGas: ['0xa', '0xa'] };
      } else if (body.method === 'eth_maxPriorityFeePerGas') {
        expect(phase === 'create');
        same([]);
        result = estimates === 0 ? '0x0' : '0x9';
      } else if (body.method === 'eth_estimateGas') {
        expect(phase === 'create' && ++estimates <= 2);
        same([
          {
            from: address,
            to: recipient,
            value: '0x315',
            data: '0x',
            type: '0x2',
            chainId: '0xdee1',
            nonce: '0x0',
            maxFeePerGas: '0x19',
            maxPriorityFeePerGas: '0x0',
          },
          'pending',
        ]);
        result = '0x7530';
      } else if (body.method === 'eth_getTransactionReceipt') {
        same([expectedHash]);
        result = null;
      } else if (body.method === 'eth_sendRawTransaction') {
        const entry = await readSaved('signed');
        same([entry.rawTransaction]);
        expect(++broadcasts === 1);
        if (expectedRaw)
          expect(
            entry.rawTransaction === expectedRaw && entry.hash === expectedHash
          );
        expectedRaw = entry.rawTransaction;
        expectedHash = entry.hash;
        if (phase === 'create')
          throw Error('QUALIFICATION_ZKSYS_LOST_RESPONSE');
        result = entry.hash;
      } else throw Error('QUALIFICATION_ZKSYS_RPC_FORBIDDEN');
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
        'native zkSYS exact-fee sign persist and lost injected response',
        async () => {
          await controller.prepare(recipient, '0.000000000000000789');
          guard();
          const review = controller.getSnapshot().review;
          expect(
            review &&
              !review.retry &&
              review.context.chainId === '57057' &&
              review.totalUnits === '900789'
          );
          await controller.confirm(review.id);
          guard();
          expect(controller.getSnapshot().phase === 'unknown');
        }
      );
    else
      await check(
        'native zkSYS exact-byte retry after cold restart',
        async () => {
          const entry = await readSaved('signed');
          expectedRaw = entry.rawTransaction;
          expectedHash = entry.hash;
          await controller.recover(true);
          guard();
          const review = controller.getSnapshot().review;
          expect(
            review?.retry &&
              review.context.chainId === '57057' &&
              controller.getSnapshot().hash === entry.hash
          );
          await controller.confirm(review.id);
          guard();
          expect(controller.getSnapshot().phase === 'pending');
        }
      );
    const saved = await readSaved(
      phase === 'create' ? 'signed' : 'submitted'
    );
    expect(
      signatures === (phase === 'create' ? 1 : 0) &&
        authorizations === (phase === 'create' ? 0 : 1) &&
        broadcasts === 1 &&
        estimates === (phase === 'create' ? 2 : 0)
    );
    expect(retainedSignedEntries((await readSignedRecordEvidence(storage)).entries, olderAddresses) === olderRows);
    expect((await storage.getWalletFingerprint()) === fingerprint);
    guard();
    const evidence: ZksysQualificationEvidence = Object.freeze({
      nativeZksysVerified: true,
      zksysAccountId: 'hd:60:4',
      zksysAccountIndex: 4,
      zksysAddress: address,
      zksysTransferHash: saved.hash,
      zksysChainId: '57057',
      zksysJournalContainerVersion: 1,
      zksysSignatures: signatures,
      zksysAuthorizations: authorizations,
      zksysInjectedBroadcasts: 1,
      zksysFeeEstimates: estimates,
      zksysRestoredFromJournal: phase === 'restart',
    });
    controller.dispose();
    await check('native zkSYS restores HD1 Ethereum', async () => {
      await authority.selectNetwork(
        'ethereum',
        current().revision,
        catalogue().revision
      );
      await manage({ kind: 'select', id: second.id });
      expect(
        current().account?.address === second.address &&
          current().account?.network === 'ethereum' &&
          catalogue().active.accountId === second.id
      );
    });
    return evidence;
  } finally {
    controller.dispose();
  }
}
