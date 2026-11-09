import type { RunSentryCrypto, SentryCryptoJob, SentryCryptoResult } from '../../../source/wallet/sentryCryptoJobs.ts';
import { SENTRY_ISOLATED_STEPS, type SentryIsolatedStep, type SentryIsolatedPhase } from './sentry-isolated-diagnostics.ts';
import type {
  SentryAuthorityKey,
  SentryOperationResponse,
  SentryOperationReview,
  SentryManagementResponse,
  SentryManagementReview,
} from '@sidhujag/sysweb3-sentry';

export const SENTRY_ISOLATED_CHECK =
  'native isolated Sentry SHAKE service and owner authorization vectors';
const SECRET = '37'.repeat(48) + 'df7468cb62f0ff4e6ec27cbe18019216';
const PUBLIC = '37'.repeat(16) + 'df7468cb62f0ff4e6ec27cbe18019216';

/** Uses the installed execution port, never an alternate signer or private-key encoder. */
export async function qualifyNativeSentryIsolated(
  signal: AbortSignal,
  providedExecute: RunSentryCrypto,
  observe: (step: SentryIsolatedStep, phase: SentryIsolatedPhase) => void
): Promise<RunSentryCrypto> {
  if (typeof observe !== 'function') throw new Error('SENTRY_ISOLATED_DIAGNOSTIC_REQUIRED');
  let nextStep = 0;
  const execute: RunSentryCrypto = async <T extends SentryCryptoResult>(job: SentryCryptoJob, assertJobCurrent: () => void): Promise<T> => {
    const step = SENTRY_ISOLATED_STEPS[nextStep++];
    if (!step) throw new Error('SENTRY_ISOLATED_DIAGNOSTIC_INVALID');
    observe(step, 'started');
    const result = await providedExecute<T>(job, assertJobCurrent);
    observe(step, 'completed');
    return result;
  };
  const check = () => {
    if (signal.aborted) throw new Error('CANCELLED');
  };
  check();
  const {
    buildSentryServiceUpdate,
    buildSentryRegistrarUpdate,
    decodeSentryTransaction,
  } = await import('@sidhujag/sysweb3-sentry');
  const { SENTRY_NETWORKS } = await import(
    '../../../source/shared/sentryNetworks.ts'
  );
  check();
  const operator = await execute<SentryAuthorityKey>(
    {
      type: 'import',
      role: 'operator',
      scheme: 'slh-dsa-shake-128s',
      secretKey: SECRET,
    },
    check
  );
  let owner: SentryAuthorityKey | undefined;
  try {
    if (operator.publicKey !== PUBLIC)
      throw new Error('QUALIFICATION_SENTRY_SHAKE_PUBLIC_KEY_FAILED');
    const chain = {
      genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
      era: 'pq-v4' as const,
    };
    const funding =
      '010000000101010101010101010101010101010101010101010101010101010101010101010000000000ffffffff01a086010000000000015100000000';
    const node = {
      proTxHash: 'a1'.repeat(32),
      operatorPublicKey: PUBLIC,
      globalKeyVersion: 1,
      service: '127.0.0.1:8369',
      operatorPayoutScript: '51',
      nevmAddress: '',
      ownerKeyId: '11'.repeat(20),
      votingKeyId: '22'.repeat(20),
      payoutScript: '76a914' + '11'.repeat(20) + '88ac',
      pqRecord: {
        version: 1,
        profile: 1,
        keyVersion: 1,
        publicKey: PUBLIC,
        activatedHeight: 100,
        childKeyCommitmentHex:
          '01000100eb0010000100000000000000' +
          '11'.repeat(32) +
          '22'.repeat(32),
      },
      pqOwnerRecord: { publicKey: PUBLIC, keyVersion: 1, activatedHeight: 100 },
    };
    const context = {
      chain,
      node,
      network: SENTRY_NETWORKS.mainnet.encoding,
      previousTransactions: [funding],
      maxFeeSatoshis: '10000',
    };
    const inputs = {
      inputs: [{ txid: decodeSentryTransaction(funding).txid, vout: 0 }],
      outputs: [{ valueSatoshis: '99000', scriptHex: '51' }],
    };
    const request = buildSentryServiceUpdate({
      chain,
      node,
      service: '127.0.0.2:8369',
      ...inputs,
    });
    const signed = await execute<SentryOperationResponse>(
      { type: 'sign', request, context, key: operator },
      check
    );
    if (
      signed.authorizationHash !==
      '96e0f5421662fd61a94c2a0e536414af869e7cfad53b891099cdbafdcc4493f7'
    )
      throw new Error('QUALIFICATION_SENTRY_SHAKE_SERVICE_FAILED');
    const verified = await execute<SentryOperationReview>(
      {
        type: 'verifyFee',
        request: { ...request, transactionHex: signed.transactionHex },
        context,
      },
      check
    );
    if (verified.authorizationHash !== signed.authorizationHash)
      throw new Error('QUALIFICATION_SENTRY_SHAKE_SERVICE_FAILED');
    owner = { ...operator, role: 'owner' };
    const management = buildSentryRegistrarUpdate({
      chain,
      node,
      payoutScript: '76a914' + '33'.repeat(20) + '88ac',
      ...inputs,
    });
    const managed = await execute<SentryManagementResponse>(
      {
        type: 'signManagement',
        request: management,
        context,
        key: owner,
        authorizationId: 'owner',
      },
      check
    );
    const ownerReview = await execute<SentryManagementReview>(
      {
        type: 'verifyFee',
        request: { ...management, transactionHex: managed.transactionHex },
        context,
      },
      check
    );
    if (
      !managed.complete ||
      ownerReview.authorizations.length !== 1 ||
      !ownerReview.authorizations[0]?.signed ||
      ownerReview.authorizations[0].digest !==
        '6e426ddc8f04063ef3ca629cb4a62d4e289e57099e6c74e1a719803cad133dc1'
    )
      throw new Error('QUALIFICATION_SENTRY_SHAKE_OWNER_FAILED');
    check();
    return providedExecute;
  } finally {
    operator.secretKey = '';
    if (owner) owner.secretKey = '';
  }
}
