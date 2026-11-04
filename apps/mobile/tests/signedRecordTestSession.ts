// Public deterministic fixture only; production always receives the captured SDK session.
import { SoftwareKeyring } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import type { EvmSignedRecordSession } from '../../../source/wallet/evmSignedRecords.ts';
export function signedRecordTestSession(assertCurrent: () => void = () => undefined): EvmSignedRecordSession {
  const keyring = Object.create(SoftwareKeyring.prototype);
  keyring.sessionPassword = { isCleared: () => false };
  keyring.sessionMnemonic = { isCleared: () => false };
  keyring.privateRecordSessionRevision = 0;
  keyring.getDecryptedMnemonic = () => 'public shared signed-record fixture';
  return { keyring, assertCurrent };
}

/** Authenticated historical fixture: bypasses new-transaction admission on purpose. */
export async function historicalSignedBundle(session: EvmSignedRecordSession, rawTransaction: string, phase: 'signed' | 'confirmed' = 'confirmed') {
  const [{ Transaction }, { getBytes }, { sha256 }] = await Promise.all([import('ethers/transaction'), import('ethers/utils'), import('ethers/crypto')]);
  const tx = Transaction.from(rawTransaction), profileId = await session.keyring.getPrivateRecordProfileId();
  const chunks = [await session.keyring.encryptPrivateRecord({ domain: 'org.syscoin.pali.evm.signed.chunk.v1', recordId: `${tx.hash}/0`, plaintext: getBytes(rawTransaction) })];
  const entries = [{hash: tx.hash, chainId: tx.chainId.toString(), from: tx.from!.toLowerCase(), nonce:tx.nonce,
    phase, createdAt:1000, signer:{id:0,type:'HDAccount'},operation:'send',chunks}];
  const root = await session.keyring.encryptPrivateRecord({domain:'org.syscoin.pali.evm.signed.root.v1',recordId:'manifest',
    plaintext:new TextEncoder().encode(JSON.stringify({version:1,revision:0,transactions:1,entriesHash:sha256(new TextEncoder().encode(JSON.stringify(entries)))}))});
  return JSON.stringify({version:1,profileId,revision:0,root,entries});
}
