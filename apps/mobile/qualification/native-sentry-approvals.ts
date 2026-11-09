import type { RunSentryCrypto } from '../../../source/wallet/sentryCryptoJobs.ts';
import type {
  SentryAuthorityKey,
  SentryGovernanceVoteResponse,
  SentryOperationResponse,
} from '@sidhujag/sysweb3-sentry';

export const SENTRY_APPROVAL_CHECK =
  'native Sentry BLS service and secp256k1 governance signature vectors';

/** Separate signing qualification; import-only vectors confer no signing result. */
export async function qualifyNativeSentryApprovals(
  signal: AbortSignal,
  execute: RunSentryCrypto
): Promise<RunSentryCrypto> {
  const check = () => {
    if (signal.aborted) throw new Error('CANCELLED');
  };
  check();
  const { buildSentryServiceUpdate, decodeSentryTransaction, sentryKeyId } =
    await import('@sidhujag/sysweb3-sentry');
  const { SENTRY_NETWORKS } = await import(
    '../../../source/shared/sentryNetworks.ts'
  );
  check();
  const chain = {
    genesisHash: SENTRY_NETWORKS.mainnet.genesisHash,
    era: 'legacy-v3' as const,
  };
  const voting = await execute<SentryAuthorityKey>(
    {
      type: 'import',
      role: 'voting',
      scheme: 'secp256k1',
      secretKey: '02'.padStart(64, '0'),
    },
    check
  );
  let operator: SentryAuthorityKey | undefined;
  try {
    operator = await execute<SentryAuthorityKey>(
      {
        type: 'import',
        role: 'operator',
        scheme: 'bls-basic',
        secretKey: '01'.padStart(64, '0'),
      },
      check
    );
    const proTxHash = 'a1'.repeat(32),
      collateralOutpoint = { txid: 'b1'.repeat(32), vout: 1 };
    const voteRequest = {
      version: 1 as const,
      chain,
      proposalHash: '9a'.repeat(32),
      signal: 'funding' as const,
      outcome: 'yes' as const,
      timestamp: 1_800_000_000,
      nodes: [{ proTxHash, collateralOutpoint }],
    };
    const vote = await execute<SentryGovernanceVoteResponse>(
      {
        type: 'signVote',
        request: voteRequest,
        proTxHash,
        key: voting,
        context: {
          chain,
          proposalHash: voteRequest.proposalHash,
          now: voteRequest.timestamp,
          nodes: [
            {
              proTxHash,
              collateralOutpoint,
              votingKeyId: sentryKeyId(voting.publicKey),
              valid: true,
            },
          ],
        },
      },
      check
    );
    if (
      vote.voteSig !==
        'ILPn32mF4Mr3w/VMs4gayiPp3fdoU3ZRXqLqLzm4NbBLcNF7sdJiA9omw7RpzxWMR/VcRZ1tetlBfb9gLqNgKLU=' ||
      vote.voteHash !==
        'f41b6d6b249ca2335b5421b18690ab3c4d5c385cb8f28adc29babde2fcd99cd4'
    )
      throw new Error('QUALIFICATION_SENTRY_VOTE_VECTOR_FAILED');
    const funding =
      '010000000101010101010101010101010101010101010101010101010101010101010101010000000000ffffffff01a086010000000000015100000000';
    const node = {
      proTxHash,
      operatorPublicKey: operator.publicKey,
      service: '127.0.0.1:8369',
      operatorPayoutScript: '51',
      nevmAddress: '',
      ownerKeyId: sentryKeyId(voting.publicKey),
      votingKeyId: sentryKeyId(voting.publicKey),
      payoutScript: '51',
    };
    const request = buildSentryServiceUpdate({
      chain,
      node,
      service: '127.0.0.2:8369',
      inputs: [{ txid: decodeSentryTransaction(funding).txid, vout: 0 }],
      outputs: [{ valueSatoshis: '99000', scriptHex: '51' }],
    });
    const context = {
      chain,
      node,
      previousTransactions: [funding],
      maxFeeSatoshis: '10000',
    };
    const signed = await execute<SentryOperationResponse>(
      { type: 'sign', request, context, key: operator },
      check
    );
    if (
      signed.authorizationHash !==
        '9658f774c4c12ceec4be9fe45132e86f7e1dbf4dc5ed1fcba68c0b7b3a0b0aba' ||
      !signed.transactionHex.endsWith(
        '864aecfba8b11244851fa72b0c85fcce3876db8a257fb3e9a55808b5279baf51d3a467b8653ca6e48fa21bea634f789606c9becc4c4a0ad47829b4948f59abf7d8433a868876fbe36f1bf8ffef0f2527d5d980e8a2aba2a4f4a14d6a30cf8bf60000000000'
      )
    )
      throw new Error('QUALIFICATION_SENTRY_BLS_VECTOR_FAILED');
    await execute(
      {
        type: 'verifyFee',
        request: { ...request, transactionHex: signed.transactionHex },
        context: { ...context, network: SENTRY_NETWORKS.mainnet.encoding },
      },
      check
    );
    check();
    return execute;
  } finally {
    voting.secretKey = '';
    if (operator) operator.secretKey = '';
  }
}
