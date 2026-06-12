import { test } from '@playwright/test';

import { PaliWallet } from '../harness/pali';

import type { CDPSession, Page } from '@playwright/test';

// Finds a working recipe for moving a WebAuthn credential between popup
// virtual authenticators: credentials re-added via WebAuthn.addCredential
// show up in getCredentials but are rejected at assertion time, so this
// iterates seeding/assertion variants to isolate the failing condition.
test('webauthn re-seed variants', async () => {
  test.setTimeout(300_000);
  const wallet = await PaliWallet.launch('debug-webauthn');
  try {
    const arm = async (page: Page) => {
      const cdp = await wallet.context.newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      const { authenticatorId } = (await cdp.send(
        'WebAuthn.addVirtualAuthenticator',
        {
          options: {
            automaticPresenceSimulation: true,
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            protocol: 'ctap2',
            transport: 'internal',
          },
        }
      )) as { authenticatorId: string };
      return { authenticatorId, cdp };
    };

    const createIn = async (page: Page) =>
      page.evaluate(async () => {
        const credential = (await navigator.credentials.create({
          publicKey: {
            attestation: 'none',
            authenticatorSelection: {
              requireResidentKey: true,
              residentKey: 'required',
              userVerification: 'required',
            },
            challenge: new Uint8Array(32),
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
            rp: { name: 'Debug' },
            timeout: 120000,
            user: {
              displayName: 'debug',
              id: crypto.getRandomValues(new Uint8Array(32)),
              name: 'debug',
            },
          },
        })) as PublicKeyCredential;
        return btoa(String.fromCharCode(...new Uint8Array(credential.rawId)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      });

    const assertIn = async (
      page: Page,
      label: string,
      credentialId: string | null,
      userVerification: 'discouraged' | 'preferred' | 'required' = 'required'
    ) => {
      const result = await page.evaluate(
        async ({ id, uv }) => {
          let allow: { id: ArrayBuffer; type: 'public-key' }[] | undefined;
          if (id) {
            const pad =
              id.length % 4 ? id + '='.repeat(4 - (id.length % 4)) : id;
            const raw = Uint8Array.from(
              atob(pad.replace(/-/g, '+').replace(/_/g, '/')),
              (c) => c.charCodeAt(0)
            );
            allow = [{ id: raw.buffer, type: 'public-key' }];
          }
          try {
            const credential = (await navigator.credentials.get({
              publicKey: {
                ...(allow ? { allowCredentials: allow } : {}),
                challenge: new Uint8Array(32),
                timeout: 60000,
                userVerification: uv,
              },
            })) as PublicKeyCredential | null;
            return credential ? 'ok' : 'null';
          } catch (error) {
            return `error: ${(error as Error).name}`;
          }
        },
        { id: credentialId, uv: userVerification }
      );
      console.log(`[dw] ${label}: ${result}`);
      return result;
    };

    // Source credential on page A.
    const pageA = wallet.page;
    const a = await arm(pageA);
    const credentialId = await createIn(pageA);
    const { credentials } = (await a.cdp.send('WebAuthn.getCredentials', {
      authenticatorId: a.authenticatorId,
    })) as { credentials: any[] };
    const harvested = credentials[0];
    console.log(
      `[dw] harvested rpId=${harvested.rpId} signCount=${harvested.signCount} backupEligibility=${harvested.backupEligibility} backupState=${harvested.backupState} isResident=${harvested.isResidentCredential}`
    );

    const seed = async (
      cdp: CDPSession,
      authenticatorId: string,
      credential: any
    ) => {
      await cdp.send('WebAuthn.addCredential', {
        authenticatorId,
        credential,
      });
    };

    // Variant 1: as-is reseed into page B.
    const pageB = await wallet.context.newPage();
    await pageB.goto(pageA.url());
    const b1 = await arm(pageB);
    await seed(b1.cdp, b1.authenticatorId, harvested);
    await assertIn(pageB, 'B as-is, uv=required', credentialId);
    await assertIn(
      pageB,
      'B as-is, uv=discouraged',
      credentialId,
      'discouraged'
    );
    await assertIn(pageB, 'B as-is, discoverable', null);
    await b1.cdp.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: b1.authenticatorId,
    });

    // Variant 2: strip the metadata extras down to the core fields.
    const b2 = await arm(pageB);
    await seed(b2.cdp, b2.authenticatorId, {
      credentialId: harvested.credentialId,
      isResidentCredential: harvested.isResidentCredential,
      privateKey: harvested.privateKey,
      rpId: harvested.rpId,
      signCount: harvested.signCount,
      userHandle: harvested.userHandle,
    });
    await assertIn(pageB, 'B stripped, uv=required', credentialId);
    await b2.cdp.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: b2.authenticatorId,
    });

    // Variant 3: same page A, second authenticator, original removed.
    await a.cdp.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: a.authenticatorId,
    });
    const a2 = await arm(pageA);
    await seed(a2.cdp, a2.authenticatorId, harvested);
    await assertIn(pageA, 'A2 same-page reseed, uv=required', credentialId);

    // Variant 4: non-resident reseed (isResidentCredential=false).
    const b4 = await arm(pageB);
    await seed(b4.cdp, b4.authenticatorId, {
      credentialId: harvested.credentialId,
      isResidentCredential: false,
      privateKey: harvested.privateKey,
      rpId: harvested.rpId,
      signCount: harvested.signCount,
    });
    await assertIn(pageB, 'B non-resident, uv=required', credentialId);
  } finally {
    await wallet.context.close();
  }
});
