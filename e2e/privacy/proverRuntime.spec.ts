import { expect, test } from '@playwright/test';
import fs from 'fs';
import http from 'http';

import fixture from '../../source/utils/privacy/prover.fixture.json';
import { PRIVACY_PROVING_KEY_URL } from '../../source/utils/privacy/proverArtifacts';
import { verifyPrivacyProof } from '../../source/utils/privacy/proverCore';
import { launchExtension } from '../harness/launch';
import {
  loadPrivacyProvingKey,
  seedPrivacyProvingKey,
} from '../harness/privacyProvingKey';

// Explicit offline qualification: supply the public, hash-pinned key artifact.
// No wallet is imported and no chain request or transaction is permitted.
test('packaged MV3 offscreen workers prove and verify a synthetic Classic withdrawal', async () => {
  test.setTimeout(120000);
  const key = await loadPrivacyProvingKey();
  const proxy = http.createServer((_request, response) => {
    response.writeHead(403);
    response.end();
  });
  proxy.on('connect', (_request, socket) => {
    socket.on('error', () => socket.destroy());
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string') throw new Error('Missing fence');
  let launched: Awaited<ReturnType<typeof launchExtension>> | undefined;
  let artifactReads = 0;
  try {
    launched = await launchExtension('privacy-prover', {
      offlineHttpProxy: `http://127.0.0.1:${address.port}`,
      recordVideo: false,
    });
    await launched.context.route('https://**/*', async (route) => {
      if (route.request().url() === PRIVACY_PROVING_KEY_URL) {
        artifactReads++;
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: key,
        });
      } else await route.abort('blockedbyclient');
    });
    const worker = launched.context.serviceWorkers()[0];
    if (!worker) throw new Error('Missing background worker');
    // Offscreen fetches are not intercepted by Playwright's page routes.
    // Seed only the public proving-key cache; the production loader must still
    // verify its exact length and hash before the real proof can be generated.
    await seedPrivacyProvingKey(worker, key);
    const expected = [
      fixture.input.root,
      fixture.input.nullifierHash,
      fixture.input.recipient,
      fixture.input.relayer,
      fixture.input.fee,
      fixture.input.refund,
    ].map((value) => BigInt(value).toString());
    for (let iteration = 0; iteration < 2; iteration++) {
      const result = await worker.evaluate(async (input) => {
        const id = crypto.randomUUID();
        const name = `pali-privacy-prover-v1:${id}`;
        return new Promise<any>(async (resolve, reject) => {
          let connected: chrome.runtime.Port | undefined;
          let requested = false;
          const timeout = setTimeout(
            () => finish(new Error('Proof timeout')),
            100000
          );
          const onConnect = (port: chrome.runtime.Port) => {
            if (port.name !== name) return;
            connected = port;
            port.onMessage.addListener((message) => {
              if (message.id !== id || message.type === 'progress') return;
              if (message.type === 'success') finish(undefined, message.result);
              else finish(new Error('Proof worker failed'));
            });
            port.onDisconnect.addListener(() =>
              finish(new Error('Disconnected'))
            );
            port.postMessage({ type: 'prove', id, input });
          };
          let settled = false;
          function finish(error?: Error, value?: unknown) {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            chrome.runtime.onConnect.removeListener(onConnect);
            chrome.runtime.onMessage.removeListener(onReady);
            connected?.disconnect();
            if (error) reject(error);
            else resolve(value);
          }
          chrome.runtime.onConnect.addListener(onConnect);
          const onReady = (
            message: any,
            sender: chrome.runtime.MessageSender,
            reply: (value: unknown) => void
          ) => {
            if (
              message?.type !== 'PALI_PRIVACY_PROVER_READY' ||
              message.version !== 1
            )
              return false;
            if (
              sender.id !== chrome.runtime.id ||
              sender.tab ||
              sender.url !== chrome.runtime.getURL('offscreen.html')
            )
              return false;
            if (!requested) {
              requested = true;
              void chrome.runtime
                .sendMessage({ type: 'PALI_PRIVACY_PROVER_CONNECT', id })
                .then((response) => {
                  if (!response?.success)
                    finish(new Error('Connection rejected'));
                })
                .catch((error) => finish(new Error(String(error))));
            }
            reply({ success: true });
            return false;
          };
          chrome.runtime.onMessage.addListener(onReady);
          try {
            const existing = await chrome.runtime.getContexts({
              contextTypes: ['OFFSCREEN_DOCUMENT' as any],
            });
            if (!existing.length)
              await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['WORKERS' as any],
                justification: 'Qualify packaged local proof workers',
              });
            await chrome.runtime
              .sendMessage({ type: 'PALI_PRIVACY_PROVER_READY_QUERY' })
              .catch((error) => {
                if (!String(error).includes('Receiving end does not exist'))
                  throw error;
              });
          } catch (error) {
            finish(new Error(`Connection failed: ${String(error)}`));
          }
        });
      }, fixture.input);
      expect(result.publicSignals).toEqual(expected);
      expect(result.proof).toMatch(/^0x[0-9a-f]{512}$/);
      const words = result.proof
        .slice(2)
        .match(/.{64}/g)!
        .map((v: string) => BigInt(`0x${v}`).toString());
      const proof = {
        pi_a: [words[0], words[1], '1'],
        pi_b: [
          [words[3], words[2]],
          [words[5], words[4]],
          ['1', '0'],
        ],
        pi_c: [words[6], words[7], '1'],
      };
      expect(verifyPrivacyProof(proof, expected)).toBe(true);
      for (let i = 0; i < expected.length; i++) {
        const changed = [...expected];
        changed[i] = (BigInt(changed[i]) + BigInt(1)).toString();
        expect(verifyPrivacyProof(proof, changed)).toBe(false);
      }
    }
    expect(artifactReads).toBe(0); // Both proofs use the rehashed public cache.
  } finally {
    await launched?.context.close();
    if (launched)
      fs.rmSync(launched.profileDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => {
      proxy.close(() => resolve());
      proxy.closeAllConnections();
    });
  }
});
