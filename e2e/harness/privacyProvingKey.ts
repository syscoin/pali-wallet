import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  PRIVACY_PROVING_KEY_BYTES,
  PRIVACY_PROVING_KEY_SHA256,
  PRIVACY_PROVING_KEY_URL,
} from '../../source/utils/privacy/proverArtifacts';

import type { Page, Worker } from '@playwright/test';

const verify = (bytes: Buffer) => {
  if (
    bytes.byteLength !== PRIVACY_PROVING_KEY_BYTES ||
    createHash('sha256').update(bytes).digest('hex') !==
      PRIVACY_PROVING_KEY_SHA256
  )
    throw new Error('Invalid public privacy proving-key fixture');
  return bytes;
};

async function readVerified(file: string): Promise<Buffer> {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size !== PRIVACY_PROVING_KEY_BYTES)
    throw new Error('Invalid public privacy proving-key fixture size');
  return verify(await fs.promises.readFile(file));
}

/** Public numeric protocol data only; never a remote script or a wallet secret. */
export async function loadPrivacyProvingKey(): Promise<Buffer> {
  if (process.env.PALI_PRIVACY_PROVING_KEY_FILE)
    return readVerified(process.env.PALI_PRIVACY_PROVING_KEY_FILE);
  const cache = path.join(
    os.tmpdir(),
    `pali-public-proving-key-${PRIVACY_PROVING_KEY_SHA256}.bin`
  );
  try {
    return await readVerified(cache);
  } catch {
    // A missing or damaged public cache never substitutes for the hash pin.
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 30000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(PRIVACY_PROVING_KEY_URL, {
      redirect: 'error',
      signal: abort.signal,
    });
    const declared = response.headers.get('content-length');
    if (
      response.status !== 200 ||
      response.redirected ||
      response.url !== PRIVACY_PROVING_KEY_URL ||
      !response.body ||
      (declared !== null &&
        (!/^\d+$/.test(declared) ||
          Number(declared) !== PRIVACY_PROVING_KEY_BYTES))
    )
      throw new Error('Invalid public privacy proving-key response');
    reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > PRIVACY_PROVING_KEY_BYTES)
        throw new Error('Oversized public privacy proving-key response');
      chunks.push(Buffer.from(next.value));
    }
    const bytes = verify(Buffer.concat(chunks, size));
    const staging = `${cache}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(staging, bytes, { flag: 'wx' });
    await fs.promises.rename(staging, cache);
    return bytes;
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => undefined);
  }
}

/** The production loader rehashes this public cache before using it. */
export async function seedPrivacyProvingKey(
  target: Page | Worker,
  key: Buffer
): Promise<void> {
  verify(key);
  await target.evaluate(
    async ({ encoded, hash }) => {
      const decoded = atob(encoded);
      const bytes = Uint8Array.from(decoded, (character) =>
        character.charCodeAt(0)
      );
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pali-privacy-prover-v1', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('artifacts');
        open.onerror = () => reject(open.error);
        open.onblocked = () =>
          reject(new Error('Public proving-key cache blocked'));
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('artifacts', 'readwrite');
          tx.objectStore('artifacts').put(bytes.buffer, hash);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    },
    { encoded: key.toString('base64'), hash: PRIVACY_PROVING_KEY_SHA256 }
  );
}
