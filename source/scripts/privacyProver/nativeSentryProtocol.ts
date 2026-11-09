import { assertJsonTextBudget } from '../../shared/jsonTextBudget.ts';
import {
  isAllowedSentryKeyRoleScheme,
  isSentryAuthorityKey,
} from '../../wallet/sentryKeyVault.ts';

import { PRIVATE_PROOF_JOB } from './nativeJobId.ts';
import type {
  SentryCryptoJob,
  SentryCryptoResult,
} from '../../wallet/sentryCryptoJobs.ts';

export const NATIVE_SENTRY_MESSAGE_LIMIT = 4 * 1024 * 1024;
const failed = () => new Error('SENTRY_EXECUTION_FAILED');
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const exact = (value: unknown, required: string[], optional: string[] = []) =>
  object(value) &&
  required.every((key) => Object.hasOwn(value, key)) &&
  Object.keys(value).every((key) => [...required, ...optional].includes(key));
const hex = (value: unknown, bytes?: number): value is string =>
  typeof value === 'string' &&
  (bytes === undefined
    ? /^(?:[0-9a-f]{2})+$/.test(value)
    : new RegExp(`^[0-9a-f]{${bytes * 2}}$`).test(value));
const authIds = ['collateral', 'owner', 'operator', 'newOwner', 'newOperator'];
const operations = [
  'register',
  'updateRegistrar',
  'revoke',
  'registerOperator',
  'rotateOperator',
];
function parse(json: string): any {
  if (typeof json !== 'string' || json.length > NATIVE_SENTRY_MESSAGE_LIMIT)
    throw failed();
  try {
    assertJsonTextBudget(json, {
      depth: 24,
      nodes: 32_000,
      tokenCharacters: NATIVE_SENTRY_MESSAGE_LIMIT,
      whitespace: true,
    });
    return JSON.parse(json);
  } catch {
    throw failed();
  }
}

/** This domain accepts the fixed SDK job union, never code, a URL or a worker name. */
export function captureNativeSentryInput(json: string): SentryCryptoJob {
  const envelope = parse(json);
  if (
    !exact(envelope, ['version', 'kind', 'job']) ||
    envelope.version !== 1 ||
    envelope.kind !== 'sentry'
  )
    throw failed();
  const job = envelope.job;
  if (!object(job)) throw failed();
  const fields: Record<SentryCryptoJob['type'], string[]> = {
    verifyFee: ['type', 'context', 'request'],
    reviewOperation: ['type', 'context', 'request'],
    validateVote: ['type', 'request'],
    reviewVote: ['type', 'request', 'context'],
    votingIdentities: ['type', 'publicKeys'],
    import: ['type', 'role', 'scheme', 'secretKey'],
    sign: ['type', 'context', 'request', 'key'],
    signManagement: ['type', 'context', 'request', 'key', 'authorizationId'],
    signVote: ['type', 'context', 'request', 'key', 'proTxHash'],
  };
  if (
    !Object.hasOwn(fields, job.type) ||
    !exact(job, fields[job.type as SentryCryptoJob['type']])
  )
    throw failed();
  if ('context' in job && (!object(job.context) || !object(job.context.chain)))
    throw failed();
  if ('request' in job && job.type !== 'validateVote' && !object(job.request))
    throw failed();
  if (
    'key' in job &&
    (!exact(job.key, ['publicKey', 'role', 'scheme', 'secretKey']) ||
      !isSentryAuthorityKey(job.key))
  )
    throw failed();
  if (
    job.type === 'import' &&
    (!isAllowedSentryKeyRoleScheme(job.role, job.scheme) ||
      !hex(job.secretKey, job.scheme === 'slh-dsa-shake-128s' ? 64 : 32))
  )
    throw failed();
  if (job.type === 'signManagement' && !authIds.includes(job.authorizationId))
    throw failed();
  if (job.type === 'signVote' && !hex(job.proTxHash, 32)) throw failed();
  if (
    job.type === 'votingIdentities' &&
    (!Array.isArray(job.publicKeys) ||
      job.publicKeys.length > 100 ||
      !job.publicKeys.every((key: unknown) => hex(key, 33)))
  )
    throw failed();
  return job as SentryCryptoJob;
}

export function eraseNativeSentryInput(job: SentryCryptoJob | undefined) {
  if (
    job &&
    typeof job === 'object' &&
    'key' in job &&
    job.key &&
    typeof job.key === 'object'
  )
    job.key.secretKey = '';
  if (job?.type === 'import') job.secretKey = '';
}

function assertResult(
  result: unknown,
  job: SentryCryptoJob
): asserts result is SentryCryptoResult {
  if (job.type === 'import') {
    if (
      !exact(result, ['publicKey', 'role', 'scheme', 'secretKey']) ||
      !isSentryAuthorityKey(result) ||
      result.role !== job.role ||
      result.scheme !== job.scheme
    )
      throw failed();
    return;
  }
  const publicTree = (value: unknown, depth = 0): void => {
    if (depth > 24) throw failed();
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'secretKey')) throw failed();
    for (const item of Object.values(value)) publicTree(item, depth + 1);
  };
  publicTree(result);
  if (job.type === 'votingIdentities') {
    if (
      !Array.isArray(result) ||
      result.length !== job.publicKeys.length ||
      !result.every(
        (item, index) =>
          exact(item, ['publicKey', 'compressed', 'uncompressed']) &&
          item.publicKey === job.publicKeys[index] &&
          hex(item.compressed, 20) &&
          hex(item.uncompressed, 20)
      )
    )
      throw failed();
    return;
  }
  if (!object(result)) throw failed();
  if (job.type === 'sign') {
    if (
      !exact(result, [
        'version',
        'operation',
        'transactionHex',
        'operatorPublicKey',
        'authorizationHash',
      ]) ||
      result.version !== 1 ||
      result.operation !== 'updateService' ||
      !hex(result.transactionHex) ||
      result.operatorPublicKey !== job.key.publicKey ||
      !hex(result.authorizationHash, 32)
    )
      throw failed();
  } else if (job.type === 'signManagement') {
    if (
      !exact(result, [
        'version',
        'operation',
        'transactionHex',
        'signedAuthorization',
        'complete',
      ]) ||
      result.version !== 1 ||
      result.operation !== job.request.operation ||
      !hex(result.transactionHex) ||
      result.signedAuthorization !== job.authorizationId ||
      typeof result.complete !== 'boolean'
    )
      throw failed();
  } else if (job.type === 'signVote') {
    const node = job.request.nodes.find(
      (item) => item.proTxHash === job.proTxHash
    );
    if (
      !exact(result, [
        'proTxHash',
        'collateralOutpoint',
        'voteSig',
        'signatureHash',
        'voteHash',
      ]) ||
      result.proTxHash !== job.proTxHash ||
      !node ||
      !exact(result.collateralOutpoint, ['txid', 'vout']) ||
      result.collateralOutpoint.txid !== node.collateralOutpoint.txid ||
      result.collateralOutpoint.vout !== node.collateralOutpoint.vout ||
      typeof result.voteSig !== 'string' ||
      !/^[A-Za-z0-9+/]{87}=$/.test(result.voteSig) ||
      !hex(result.signatureHash, 32) ||
      !hex(result.voteHash, 32)
    )
      throw failed();
  } else if (job.type === 'validateVote') {
    if (
      !exact(result, [
        'version',
        'chain',
        'proposalHash',
        'signal',
        'outcome',
        'timestamp',
        'nodes',
      ]) ||
      result.version !== 1 ||
      !object(result.chain) ||
      result.chain.era !== 'legacy-v3' ||
      !hex(result.chain.genesisHash, 32) ||
      !hex(result.proposalHash, 32) ||
      result.signal !== 'funding' ||
      !['yes', 'no', 'abstain'].includes(result.outcome) ||
      !Number.isSafeInteger(result.timestamp) ||
      !Array.isArray(result.nodes) ||
      result.nodes.length < 1 ||
      result.nodes.length > 20
    )
      throw failed();
  } else if (job.type === 'reviewVote') {
    if (
      !exact(result, ['request', 'nodes'], ['proposal']) ||
      !object(result.request) ||
      !Array.isArray(result.nodes) ||
      result.request.proposalHash !== job.request.proposalHash ||
      result.nodes.length !== job.request.nodes.length
    )
      throw failed();
  } else if (job.request.operation === 'updateService') {
    if (
      !exact(result, [
        'operation',
        'scheme',
        'chain',
        'proTxHash',
        'changes',
        'feeSatoshis',
        'inputCount',
        'outputs',
        'authorizationHash',
      ]) ||
      result.operation !== 'updateService' ||
      !['bls-basic', 'slh-dsa-shake-128s'].includes(result.scheme) ||
      !hex(result.authorizationHash, 32)
    )
      throw failed();
  } else if (
    !exact(
      result,
      [
        'operation',
        'chain',
        'feeSatoshis',
        'outputs',
        'fields',
        'authorizations',
      ],
      ['proTxHash']
    ) ||
    !operations.includes(result.operation) ||
    result.operation !== job.request.operation ||
    !Array.isArray(result.authorizations)
  )
    throw failed();
}

export type NativeSentryMessage = { id: string; kind: 'sentry'; version: 1 } & (
  | { type: 'error' | 'disposed' | 'sdk-start' }
  | { result: SentryCryptoResult; type: 'success' }
);

/** The input job fixes the only accepted result shape; raw worker errors reject. */
export function readNativeSentryMessage(
  json: string,
  id: string,
  job: SentryCryptoJob
): NativeSentryMessage {
  if (!PRIVATE_PROOF_JOB.test(id)) throw failed();
  const value = parse(json);
  if (
    !object(value) ||
    value.version !== 1 ||
    value.kind !== 'sentry' ||
    value.id !== id
  )
    throw failed();
  if (
    (value.type === 'error' ||
      value.type === 'disposed' ||
      value.type === 'sdk-start') &&
    exact(value, ['version', 'kind', 'id', 'type'])
  )
    return value as NativeSentryMessage;
  if (
    value.type !== 'success' ||
    !exact(value, ['version', 'kind', 'id', 'type', 'result'])
  )
    throw failed();
  assertResult(value.result, job);
  return value as NativeSentryMessage;
}
