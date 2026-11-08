// Public deterministic fixture only; production always receives the captured SDK session.
import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { captureEvmSubmission, submitSignedEvmTransaction } from '@sidhujag/sysweb3-keyring/cjs/transactions/evm-submission.js';
import { Transaction } from 'ethers/transaction';
import { createEvmSignedRecordLifecycle, type EvmSignedRecords, type EvmSignedRecordSession } from '../../../source/wallet/evmSignedRecords.ts';
import type { NativeTransferRuntime } from '../src/custody/transfers.ts';
import { createNativeAutomaticNoncePlanner } from '../src/custody/sharedSignedRecords.ts';
import { unsignedTransferBytes } from '../src/custody/evmFeeContracts.ts';
import { getNativeNetwork } from '../src/custody/networkContext.ts';
export function signedRecordTestSession(assertCurrent: () => void = () => undefined): EvmSignedRecordSession {
  const keyring = Object.create(SoftwareKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () => 'public shared signed-record fixture';
  return { keyring, assertCurrent };
}

export function submitFixtureEvmTransaction(records: EvmSignedRecords): NativeTransferRuntime['submit'] {
  return async (raw, hash, guard, transport, intent, approved, replacement, verifyAutomaticNonce) => {
    const tx = Transaction.from(raw);
    if (!tx.from || tx.hash !== hash || intent?.kind === 'nft-transfer') throw Error('Invalid EVM fixture submission');
    const session = signedRecordTestSession(guard);
    const endpoint = getNativeNetwork('ethereum').rpcUrl;
    const from = tx.from;
    const chainId = tx.chainId.toString();
    const context = {
      account: { id: 0, type: 'HDAccount' as const, address: from },
      network: { kind: 'ethereum' as const, chainId: Number(chainId), slip44: 60, url: endpoint },
      operation: replacement?.mode ?? (intent ? 'erc20' : 'send') as 'erc20' | 'send',
      ...(replacement ? { originalHash: replacement.original.hash } : {}),
    };
    const boundary = captureEvmSubmission(context, guard, () => createEvmSignedRecordLifecycle(records, session, { retirementReadForChain: null,
      metadata: intent && { intent },
      replacement: replacement?.binding,
      automaticNonceEndpoint: replacement ? undefined : endpoint,
      preflight: verifyAutomaticNonce ? (_record, assertCurrent, snapshot) =>
        verifyAutomaticNonce(createNativeAutomaticNoncePlanner(records, session, chainId, from, endpoint, snapshot), assertCurrent) : undefined,
    }));
    await submitSignedEvmTransaction(raw, transport.broadcast, boundary, undefined, unsignedTransferBytes(approved));
  };
}

/** Authenticated historical fixture: bypasses new-transaction admission on purpose. */
export async function historicalSignedBundle(session: EvmSignedRecordSession, input: string | readonly string[], phase: 'signed' | 'confirmed' = 'confirmed') {
  const [{ Transaction }, { getBytes }, { sha256 }] = await Promise.all([import('ethers/transaction'), import('ethers/utils'), import('ethers/crypto')]);
  const profileId = await session.keyring.getPrivateRecordProfileId();
  const entries = await Promise.all((typeof input === 'string' ? [input] : input).map(async (rawTransaction) => {
    const tx = Transaction.from(rawTransaction);
    const chunks = [await session.keyring.encryptPrivateRecord({ domain: 'org.syscoin.pali.evm.signed.chunk.v1', recordId: `${tx.hash}/0`, plaintext: getBytes(rawTransaction) })];
    return {hash: tx.hash, chainId: tx.chainId.toString(), from: tx.from!.toLowerCase(), nonce:tx.nonce,
      phase, createdAt:1000, signer:{id:0,type:'HDAccount'},operation:'send',chunks};
  }));
  const root = await session.keyring.encryptPrivateRecord({domain:'org.syscoin.pali.evm.signed.root.v1',recordId:'manifest',
    plaintext:new TextEncoder().encode(JSON.stringify({version:1,revision:0,transactions:entries.length,entriesHash:sha256(new TextEncoder().encode(JSON.stringify(entries)))}))});
  return JSON.stringify({version:1,profileId,revision:0,root,entries});
}
