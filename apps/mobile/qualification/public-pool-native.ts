import { sha256 } from 'ethers/crypto';
import { toUtf8Bytes } from 'ethers/utils';
import { hashPair } from '../../../source/utils/privacy/merkle.ts';
import { createNativeNetwork } from '../src/custody/networkContext.ts';
import { createNativePrivacyPoolSync, type OwnedPrivacyPullTransport } from '../src/privacy/nativePrivacyPoolSync.ts';
import {
  PUBLIC_POOL_ANCHOR_READS, PUBLIC_POOL_RECHECK_READS, PUBLIC_POOL_BATCHES, PUBLIC_POOL_BLOCK, PUBLIC_POOL_ID, PUBLIC_POOL_LEAVES,
  PUBLIC_POOL_ROOT, PUBLIC_POOL_PROOF_BLOCK, PUBLIC_POOL_PROOF_BLOCK_HASH, PUBLIC_POOL_PROOF_LEAVES,
  PUBLIC_POOL_PROOF_PATH_DIGESTS, PUBLIC_POOL_PROOF_ROOT, PUBLIC_POOL_PROOF_SELECTION, PUBLIC_POOL_PROOF_RECHECK,
  publicPoolAnchorPath, type PublicPoolLaunch,
} from './public-pool-contract.ts';

type Executor = Parameters<typeof createNativePrivacyPoolSync>[0]['executeMerkleBatch'];
const check = (value: unknown) => { if (!value) throw Error('PUBLIC_POOL_QUALIFICATION_FAILED'); };

export async function qualifyNativePublicPool({
  launch, transport, executeMerkleBatch, lifetime,
}: Readonly<{ launch: PublicPoolLaunch; transport: OwnedPrivacyPullTransport; executeMerkleBatch: Executor; lifetime: AbortSignal }>) {
  const serviceOrigin = `http://127.0.0.1:${launch.snapshotPort}`;
  const rpcUrl = `https://127.0.0.1:${launch.anchorPort}${publicPoolAnchorPath(launch.token)}`;
  const network = createNativeNetwork({ id: 'qualification-ethereum', name: 'Qualification Ethereum', kind: 'evm', chainId: '1',
    slip44: 60, rpcUrl, symbol: 'ETH', decimals: 18, testnet: false });
  let gets = 0;
  let batches = 0;
  const ids = new Set<number>();
  const selectionReads = PUBLIC_POOL_PROOF_SELECTION.length;
  const anchorReads = selectionReads + PUBLIC_POOL_ANCHOR_READS.length;
  const proofRecheckStart = anchorReads + PUBLIC_POOL_RECHECK_READS.length;
  const reads = [...PUBLIC_POOL_PROOF_SELECTION, ...PUBLIC_POOL_ANCHOR_READS,
    ...PUBLIC_POOL_RECHECK_READS, ...PUBLIC_POOL_PROOF_RECHECK];
  const prepareProofCheckpoint = transport.prepareProofCheckpoint?.bind(transport);
  check(prepareProofCheckpoint);
  const sync = createNativePrivacyPoolSync({
    network, poolId: PUBLIC_POOL_ID, lifetime,
    service: { origin: serviceOrigin, assertCurrent() { check(!lifetime.aborted); } },
    transport: {
      prepareSnapshot(pool, origin, signal) {
        check(++gets === 1 && origin === serviceOrigin && pool === PUBLIC_POOL_ID && ids.size === selectionReads && batches === 0);
        return transport.prepareSnapshot(pool, origin, signal);
      },
      prepareAnchor(binding, read, id, signal) {
        const offset = ids.size;
        check(gets === 1 && !ids.has(id) && offset >= selectionReads && offset < proofRecheckStart && reads[offset] === read &&
          batches === (offset < anchorReads ? 0 : PUBLIC_POOL_BATCHES));
        ids.add(id);
        return transport.prepareAnchor(binding, read, id, signal);
      },
      prepareProofCheckpoint(binding, read, id, signal) {
        const offset = ids.size;
        const selecting = offset < selectionReads;
        check(!ids.has(id) && offset < reads.length && reads[offset] === read &&
          (selecting ? gets === 0 && batches === 0 : offset >= proofRecheckStart && gets === 1 && batches === PUBLIC_POOL_BATCHES));
        ids.add(id);
        return prepareProofCheckpoint!(binding, read, id, signal);
      },
    },
    async executeMerkleBatch(program, signal, assertCurrent) {
      check(ids.size === anchorReads && ++batches <= PUBLIC_POOL_BATCHES);
      return executeMerkleBatch(program, signal, assertCurrent);
    },
  });
  try {
    const status = await sync.refresh();
    if (status.phase !== 'ready')
      throw Error(`PUBLIC_POOL_QUALIFICATION_FAILED:${status.phase}:${status.errorCode ?? 'unknown'}`);
    check(status.blockNumber === PUBLIC_POOL_BLOCK && status.leafCount === PUBLIC_POOL_LEAVES &&
      gets === 1 && ids.size === reads.length && batches === PUBLIC_POOL_BATCHES);
    const access = await sync.readSnapshot(PUBLIC_POOL_ID);
    check(access.snapshot.root === PUBLIC_POOL_PROOF_ROOT && access.snapshot.asOfBlockNumber === PUBLIC_POOL_PROOF_BLOCK &&
      access.snapshot.asOfBlockHash === PUBLIC_POOL_PROOF_BLOCK_HASH && access.snapshot.leafCount === PUBLIC_POOL_PROOF_LEAVES);
    const pathDigests: string[] = [];
    for (const index of [0, PUBLIC_POOL_PROOF_LEAVES - 1]) {
      const { pathElements, pathIndices } = await access.getPath(index);
      check(pathElements.length === 20 && pathIndices.length === 20);
      let reconstructed = access.snapshot.leaves[index]!;
      for (const [level, sibling] of pathElements.entries()) {
        const right = Math.floor(index / 2 ** level) % 2;
        check(pathIndices[level] === right);
        reconstructed = right ? hashPair(sibling, reconstructed) : hashPair(reconstructed, sibling);
      }
      check(reconstructed === PUBLIC_POOL_PROOF_ROOT);
      pathDigests.push(sha256(toUtf8Bytes(pathElements.join(''))));
    }
    let refusedLaterLeaf = false;
    try { await access.getPath(PUBLIC_POOL_PROOF_LEAVES); } catch { refusedLaterLeaf = true; }
    check(refusedLaterLeaf);
    check(PUBLIC_POOL_PROOF_PATH_DIGESTS.every((expected, index) => expected === pathDigests[index]));
    access.assertSnapshotCurrent(access.snapshot);
    await sync.dispose();
    let revoked = false;
    try { access.assertSnapshotCurrent(access.snapshot); } catch { revoked = true; }
    check(revoked);
    return { root: PUBLIC_POOL_ROOT, block: PUBLIC_POOL_BLOCK, leaves: PUBLIC_POOL_LEAVES, batches,
      proofRoot: PUBLIC_POOL_PROOF_ROOT, proofBlock: PUBLIC_POOL_PROOF_BLOCK, proofLeaves: PUBLIC_POOL_PROOF_LEAVES,
      pathDigests, requestIds: [...ids], gets, anchorPasses: 2 as const };
  } finally { await sync.dispose(); }
}
