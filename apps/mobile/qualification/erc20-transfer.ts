import { sameJsonRpcParameters } from './rpc-parameters.ts';
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
  'erc20ReplacementHash',
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
  erc20ReplacementHash: string | null;
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
    (report.phase === 'create'
      ? report.erc20ReplacementHash === null
      : typeof report.erc20ReplacementHash === 'string' &&
        /^0x[0-9a-f]{64}$/.test(report.erc20ReplacementHash) &&
        ![report.erc20TransferHash, report.transferHash, report.firstTransferHash].includes(report.erc20ReplacementHash)) &&
    typeof report.erc20IntentHash === 'string' &&
    /^0x[0-9a-f]{64}$/.test(report.erc20IntentHash) &&
    report.erc20Signatures === 1 &&
    report.erc20Authorizations === 1 &&
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
      expectedThirdAddress?: string;
    check: Check;
  }>
): Promise<Erc20QualificationEvidence> {
  const { phase, authority, runtime, storage, check } = options;
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
  expect(transfer?.token && transfer.replacementOriginal && tokens && authority.supportsAccountManagement());
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
  let originalHash: string | undefined;
  let replacementHash: string | null = null;
  let signed: Awaited<ReturnType<NativeTransferRuntime['sign']>> | undefined;
  const replacing = phase === 'restart';
  const feeCap = replacing ? 4n : 3n;
  const feeTip = replacing ? 2n : 1n;
  const maximumFee = (60000n * feeCap).toString();
  const feeFields = {
    maxFeePerGas: `0x${feeCap.toString(16)}`,
    maxPriorityFeePerGas: `0x${feeTip.toString(16)}`,
  };
  const word = (value: bigint | number) =>
    `0x${BigInt(value).toString(16).padStart(64, '0')}`;
  const unsigned = Object.freeze({
    from: address,
    to: token.contractAddress,
    value: '0x0',
    data: calldata,
  });
  const readSaved = async (
    expectedPhase: 'signed' | 'submitted',
    hash?: string,
    predecessor?: string
  ) => {
    const journal = await transfer.journal(guard);
    const saved = await journal.load(hash);
    guard();
    expect(
      saved?.phase === expectedPhase &&
        equalTransferIntent(saved.intent, expectedIntent) &&
        saved.rawTransaction === undefined && saved.nonce === 0
    );
    const raw = await readSignedRecordEvidence(storage);
    const retained = raw.entries.filter(entry => entry.from === address.toLowerCase());
    const entry = retained.find(entry => entry.hash === saved.hash);
    expect(raw.version === 1 && retained.length === (predecessor ? 2 : 1) &&
      entry?.phase === expectedPhase && entry.signer.id === 2 && entry.signer.type === 'HDAccount' &&
      entry.payloadKind === 'unsigned-eoa' && entry.originalHash === predecessor &&
      entry.operation === (predecessor ? 'speed-up' : 'erc20') &&
      equalTransferIntent(entry.metadata?.intent, expectedIntent) &&
      (!signed || !raw.raw?.includes(signed.rawTransaction)));
    expect((await storage.getWalletFingerprint()) === fingerprint);
    guard();
    return saved;
  };
  const verifyEnvelope = (rawTransaction: string, hash: string) => {
    const tx = Transaction.from(rawTransaction);
    expect(
      tx.isSigned() &&
        tx.from === address &&
        tx.to === token.contractAddress &&
        tx.chainId === 1n &&
        tx.value === 0n &&
        tx.nonce === 0 &&
        tx.data === calldata &&
        tx.gasLimit === 60000n &&
        tx.type === 2 && tx.accessList?.length === 0 &&
        tx.maxFeePerGas === feeCap &&
        tx.maxPriorityFeePerGas === feeTip &&
        tx.hash === hash
    );
  };
  const wrapped: NativeTransferRuntime = {
    isAuthenticationRefusal: (error) => transfer.isAuthenticationRefusal(error),
    releaseReplacement: () => transfer.releaseReplacement(),
    authenticateOperation() { throw Error('QUALIFICATION_ERC20_REPLAY_FORBIDDEN'); },
    authorizeOperation(...args) {
      expect(++authorizations === 1 && args[0].method === 'device');
      return transfer.authorizeOperation(...args);
    },
    releaseOperationAuthorization: (...args) => transfer.releaseOperationAuthorization(...args),
    replay: (...args) => transfer.replay(...args),
      submit: (...args) => transfer.submit(...args),
    token: (contract, assertCurrent) => {
      tokenLookups++;
      expect(phase === 'create');
      return transfer.token!(contract, assertCurrent);
    },
    journal: (assertCurrent) => transfer.journal(assertCurrent),
    async replacementOriginal(...args) {
      expect(replacing && args[0] === originalHash && args[1] === 'speed-up');
      const retained = await transfer.replacementOriginal!(...args);
      expect(retained?.rawTransaction === undefined && retained?.unsignedTransaction !== undefined);
      const tx = Transaction.from(retained.unsignedTransaction);
      expect(!tx.isSigned() && tx.to === token.contractAddress && tx.data === calldata &&
        tx.nonce === 0 && tx.gasLimit === 60000n && tx.maxFeePerGas === 3n && tx.maxPriorityFeePerGas === 1n &&
        equalTransferIntent(retained.intent, expectedIntent));
      return retained;
    },
    async sign(transaction, assertCurrent, intent, replacement) {
      signatures++;
      expect(intent?.kind !== 'nft-transfer');
      expect(
        signatures === 1 && authorizations === 1 &&
          equalTransferIntent(intent, expectedIntent) &&
          (replacing
            ? replacement?.mode === 'speed-up' && replacement.original.hash === originalHash &&
              replacement.original.unsignedSpeedUp === true
            : replacement === undefined)
      );
      signed = await transfer.sign(transaction, assertCurrent, intent, replacement);
      verifyEnvelope(signed.rawTransaction, signed.hash);
      return signed;
    },
    assertUnlocked() { throw Error('QUALIFICATION_ERC20_REPLAY_FORBIDDEN'); },
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
          !init.body.includes('Pali#1:') &&
          ++requests <= 64
      );
      const payload: unknown = JSON.parse(init.body);
      const respond = async (body: {
        jsonrpc: string;
        id: number;
        method: string;
        params: unknown[];
      }): Promise<Response> => {
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
        expect(sameJsonRpcParameters(params, expected));
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
        expect(params.length === 2 && params[0] === address &&
          ['pending', 'latest', '0x123'].includes(params[1] as string));
        result = '0xde0b6b3a7640000';
      } else if (body.method === 'eth_gasPrice') { same([]); result = '0x2';
      } else if (body.method === 'eth_feeHistory') {
        same(['0x1', 'latest', []]);
        result = { oldestBlock: '0x123', baseFeePerGas: ['0x1', '0x1'] };
      } else if (body.method === 'eth_maxPriorityFeePerGas') {
        same([]);
        result = '0x1';
      } else if (body.method === 'eth_estimateGas') {
        same([{ ...unsigned, type: '0x2', chainId: '0x1', nonce: '0x0', accessList: [], ...feeFields }, replacing ? '0x123' : 'pending']);
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
          same([{
            ...unsigned,
            gas: '0xea60',
            nonce: '0x0',
            type: '0x2',
            ...feeFields,
          }, '0x123']);
          result = word(1);
        }
      } else if (body.method === 'eth_getTransactionReceipt' || body.method === 'eth_getTransactionByHash') {
        expect(replacing);
        same([originalHash]);
        result = null;
      } else if (body.method === 'eth_sendRawTransaction') {
        expect(signed);
        const saved = await readSaved('signed', signed.hash, replacing ? originalHash : undefined);
        guard();
        same([signed.rawTransaction]);
        broadcasts++;
        expect(broadcasts === 1);
        if (!replacing) {
          originalHash = saved.hash;
          throw Error('QUALIFICATION_ERC20_LOST_RESPONSE');
        }
        expect(originalHash && saved.hash !== originalHash);
        replacementHash = saved.hash;
        result = saved.hash;
      } else throw Error('QUALIFICATION_ERC20_RPC_FORBIDDEN');
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
              review.totalUnits === maximumFee &&
              equalTransferIntent(review.intent, expectedIntent)
          );
          await controller.confirm(review.id, { method: 'device' });
          guard();
          expect(
            controller.getSnapshot().phase === 'unknown' &&
              controller.getSnapshot().hash === originalHash
          );
          expect(
            signatures === 1 &&
              authorizations === 1 &&
              broadcasts === 1 &&
              tokenLookups === 1
          );
          await readSaved('signed');
        }
      );
    else
      await check(
        'native ERC20 cold restart unsigned intent and authorized Speed Up',
        async () => {
          const saved = await readSaved('signed');
          originalHash = saved.hash;
          await controller.prepareSpeedUp(originalHash);
          guard();
          const review = controller.getSnapshot().review;
          expect(
            review && !review.retry &&
              review.replacement?.mode === 'speed-up' &&
              review.replacement.originalHash === originalHash &&
              review.replacement.originalMaximumFeeUnits === '180000' &&
              review.recipient === recipient &&
              review.amountUnits === amountUnits &&
              review.nonce === '0' && review.totalUnits === maximumFee &&
              equalTransferIntent(review.intent, expectedIntent)
          );
          expect([broadcasts, signatures, authorizations].every((count) => count === 0));
          await controller.confirm(review.id, { method: 'device' });
          guard();
          expect(
            controller.getSnapshot().phase === 'pending' &&
              replacementHash && controller.getSnapshot().hash === replacementHash
          );
          expect(
            signatures === 1 &&
              authorizations === 1 &&
              broadcasts === 1 &&
              tokenLookups === 0
          );
          await readSaved('submitted', replacementHash, originalHash);
        }
      );
    expect(originalHash && signed);
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
      erc20TransferHash: originalHash,
      erc20ReplacementHash: replacementHash,
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
