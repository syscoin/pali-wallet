import { inspectQualificationEoaEnvelope } from './authorized-transfer.ts';
import { sameJsonRpcParameters } from './rpc-parameters.ts';
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
  'zksysReplacementHash',
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
  zksysReplacementHash?: string;
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
    (Object.hasOwn(report, 'zksysReplacementHash')
      ? report.phase === 'restart' &&
        typeof report.zksysReplacementHash === 'string' &&
        /^0x[0-9a-f]{64}$/.test(report.zksysReplacementHash) &&
        !hashes.includes(report.zksysReplacementHash) &&
        report.zksysSignatures === 1 &&
        report.zksysAuthorizations === 0 &&
        report.zksysFeeEstimates === 3
      : report.zksysSignatures === (report.phase === 'create' ? 1 : 0) &&
        report.zksysAuthorizations === (report.phase === 'create' ? 0 : 1) &&
        report.zksysFeeEstimates === (report.phase === 'create' ? 3 : 0)) &&
    report.zksysInjectedBroadcasts === 1 &&
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
      expectedFifthAddress?: string;
    check: Check;
  }>
): Promise<ZksysQualificationEvidence> {
  const { phase, authority, runtime, storage, check } = options;
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
      manage({ kind: 'create', label: 'Qualification zkSYS account',})
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
  , () => {});
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
  const verifyEnvelope = (tx: InstanceType<typeof Transaction>, replacement: boolean) => {
    expect(tx.type === 2 && tx.to === recipient && tx.chainId === 57057n &&
      tx.nonce === 0 && tx.value === 789n && tx.data === '0x' &&
      tx.accessList?.length === 0 && tx.gasLimit === 36000n);
    expect(replacement
      ? tx.maxFeePerGas === 30n && tx.maxPriorityFeePerGas === 1n
      : tx.maxFeePerGas === 25n && tx.maxPriorityFeePerGas === 0n);
  };
  const readSaved = async (hash: string, expectedPhase: 'signed' | 'submitted', raw?: string) => {
    const row = await readSignedRecordEvidence(storage); guard();
    const retained = row.entries.find(item => item.from === address.toLowerCase() && item.hash === hash);
    expect(row.version === 1 && retained?.phase === expectedPhase && retained.chainId === '57057' &&
      retained.signer.type === 'HDAccount' && retained.signer.id === 4 &&
      retained.metadata?.intent === undefined && retained.payloadKind === 'unsigned-eoa' &&
      (!raw || !row.raw?.includes(raw)));
    expect((await storage.getWalletFingerprint()) === fingerprint);
    guard();
  };
  let signatures = 0,
    broadcasts = 0,
    estimates = 0,
    requests = 0;
  let originalHash: string | undefined, replacementHash: string | undefined;
  const wrapped: NativeTransferRuntime = {
    isAuthenticationRefusal: (error) => transfer.isAuthenticationRefusal(error),
    releaseReplacement: () => transfer.releaseReplacement(),
    authorizeOperation: (...args) => transfer.authorizeOperation(...args),
    releaseOperationAuthorization: (...args) => transfer.releaseOperationAuthorization(...args),
    replacementOriginal: transfer.replacementOriginal?.bind(transfer),
      submit: (...args) => transfer.submit(...args),
    journal: (checkCurrent) => transfer.journal(checkCurrent),
    async sign(transaction, checkCurrent, intent, replacement) {
      expect(++signatures === 1 && intent === undefined &&
        (phase === 'create' ? replacement === undefined : replacement?.original.hash === originalHash));
      return transfer.sign(transaction, checkCurrent, intent, replacement);
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
          !init.body.includes('Pali#1:') &&
          ++requests <= 100
      );
      const payload: unknown = JSON.parse(init.body);
      const respond = async (body: {
        jsonrpc: string;
        id: number;
        method: string;
        params: unknown[];
      }): Promise<Response> => {
      expect(
        body.jsonrpc === '2.0' &&
          Number.isSafeInteger(body.id) &&
          body.id > 0 &&
          Array.isArray(body.params)
      );
      const params = body.params;
      const same = (expected: unknown[]) =>
        expect(sameJsonRpcParameters(params, expected));
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
            ['pending', 'latest', '0x64', '0x5a'].includes(params[1] as string)
        );
        result = '0x0';
      } else if (body.method === 'eth_getBalance') {
        expect(params.length === 2 && params[0] === address &&
          ['pending', 'latest', '0x64'].includes(params[1] as string));
        result = '0xde0b6b3a7640000';
      } else if (body.method === 'eth_gasPrice') { same([]); result = '0xa';
      } else if (body.method === 'eth_feeHistory') {
        same(['0x1', 'latest', []]);
        result = { oldestBlock: '0x64', baseFeePerGas: ['0xa', '0xa'] };
      } else if (body.method === 'eth_maxPriorityFeePerGas') {
        same([]);
        result = phase === 'restart' || estimates === 0 ? '0x0' : '0x9';
      } else if (body.method === 'eth_estimateGas') {
        // Review, pre-sign refresh, and post-storage admission each estimate exact bytes.
        expect(++estimates <= 3);
        same([
          {
            from: address,
            to: recipient,
            value: '0x315',
            data: '0x',
            type: '0x2',
            chainId: '0xdee1',
            nonce: '0x0',
            accessList: [],
            maxFeePerGas: phase === 'create' ? '0x19' : '0x1e',
            maxPriorityFeePerGas: phase === 'create' ? '0x0' : '0x1',
          },
          phase === 'create' ? 'pending' : '0x64',
        ]);
        result = '0x7530';
      } else if (body.method === 'eth_getTransactionReceipt' || body.method === 'eth_getTransactionByHash') {
        expect(phase === 'restart' && originalHash);
        same([originalHash]);
        result = null;
      } else if (body.method === 'eth_sendRawTransaction') {
        const [raw] = params;
        expect(params.length === 1 && typeof raw === 'string' && ++broadcasts === 1);
        const tx = Transaction.from(raw);
        expect(tx.from === address && tx.hash && tx.isSigned() && tx.serialized === raw);
        verifyEnvelope(tx, phase === 'restart');
        await readSaved(tx.hash, 'signed', raw);
        if (phase === 'create') {
          originalHash = tx.hash;
          throw Error('QUALIFICATION_ZKSYS_LOST_RESPONSE');
        }
        expect(originalHash && tx.hash !== originalHash);
        replacementHash = tx.hash;
        result = tx.hash;
      } else throw Error('QUALIFICATION_ZKSYS_RPC_FORBIDDEN');
      const text = JSON.stringify({ jsonrpc: '2.0', id: body.id, result });
      expect(text.length < 4096);
      guard();
      return {
        ok: true,
        status: 200,
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
      };
      if (Array.isArray(payload)) {
        expect(payload.length > 0 && payload.length <= 40);
        expect(payload.every(request => request && typeof request === 'object' &&
          request.method !== 'eth_sendRawTransaction'));
        const values = await Promise.all(payload.map(async request => {
          const response = await respond(request);
          return JSON.parse(await response.text());
        }));
        guard();
        const text = JSON.stringify(values);
        return {
          ok: true,
          status: 200,
          headers: { get: (name: string) => name === 'content-type'
            ? 'application/json' : name === 'content-length' ? String(text.length) : null },
          text: async () => text,
        } as unknown as Response;
      }
      return respond(payload as Parameters<typeof respond>[0]);
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
              review.context.chainId === '57057' &&
              review.totalUnits === '900789'
          );
          await controller.confirm(review.id, { method: 'device' });
          guard();
          expect(controller.getSnapshot().phase === 'unknown');
        }
      );
    else
      await check(
        'native zkSYS reviewed Speed Up after cold restart',
        async () => {
          const entry = await (await transfer.journal(guard)).load();
          expect(entry?.phase === 'signed' && entry.inspectionOnly &&
            entry.rawTransaction === undefined && entry.scope.chainId === '57057' &&
            entry.scope.walletFingerprint === fingerprint);
          originalHash = entry.hash;
          await readSaved(originalHash, 'signed');
          verifyEnvelope(await inspectQualificationEoaEnvelope(transfer, entry, address, guard), false);
          await controller.prepareSpeedUp(originalHash);
          guard();
          const review = controller.getSnapshot().review;
          expect(review?.replacement?.originalHash === originalHash &&
            review.context.chainId === '57057' && review.gasLimit === '36000' &&
            review.recipient === recipient && review.amountUnits === '789' &&
            BigInt(review.maximumFeeUnits) > 900000n && signatures === 0 && broadcasts === 0);
          await controller.confirm(review.id, { method: 'device' });
          guard();
          expect(controller.getSnapshot().phase === 'pending' && controller.getSnapshot().hash === replacementHash);
        }
      );
    expect(originalHash && signatures === 1 && broadcasts === 1 && estimates === 3);
    await readSaved(originalHash, 'signed');
    if (phase === 'restart') {
      expect(replacementHash);
      await readSaved(replacementHash, 'submitted');
    }
    expect(retainedSignedEntries((await readSignedRecordEvidence(storage)).entries, olderAddresses) === olderRows);
    expect((await storage.getWalletFingerprint()) === fingerprint);
    guard();
    const evidence: ZksysQualificationEvidence = Object.freeze({
      nativeZksysVerified: true,
      zksysAccountId: 'hd:60:4',
      zksysAccountIndex: 4,
      zksysAddress: address,
      zksysTransferHash: originalHash,
      ...(replacementHash ? { zksysReplacementHash: replacementHash } : {}),
      zksysChainId: '57057',
      zksysJournalContainerVersion: 1,
      zksysSignatures: signatures,
      zksysAuthorizations: 0,
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
      , () => {});
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
