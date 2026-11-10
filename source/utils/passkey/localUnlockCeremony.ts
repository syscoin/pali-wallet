import {
  captureLocalPasskeyResponse,
  checkLocalPasskeyOwner,
  localPasskeyBase64,
  localPasskeyBytes,
  localPasskeyError,
  localPasskeyOrigin,
  type LocalPasskeyPrompt,
  type LocalPasskeyResponse,
} from '../../wallet/localPasskeyTypes';

type PrfOutputs = {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
};
export type LocalPasskeySupport = 'supported' | 'unknown' | 'unsupported';

/** A capability hint only; the background still verifies every PRF ceremony. */
export async function localPasskeySupport(): Promise<LocalPasskeySupport> {
  if (
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    !navigator.credentials ||
    typeof PublicKeyCredential === 'undefined'
  )
    return 'unsupported';
  try {
    localPasskeyOrigin(window.location.origin);
    const api = PublicKeyCredential as typeof PublicKeyCredential & {
      getClientCapabilities?(): Promise<Record<string, boolean>>;
    };
    if (!api.getClientCapabilities) return 'unknown';
    const capabilities = await api.getClientCapabilities();
    return capabilities['extension:prf'] === true ? 'supported' : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Direct browser ceremony. This module receives no password or wallet key. */
export async function runLocalPasskeyCeremony(
  prompt: LocalPasskeyPrompt,
  signal: AbortSignal,
  assertCurrent: () => void
): Promise<LocalPasskeyResponse> {
  const owner = window,
    document = owner.document;
  const origin = localPasskeyOrigin(prompt.origin);
  const remaining = prompt.expiresAt - Date.now(),
    started = performance.now();
  if (
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    remaining > 90_000 ||
    !Number.isFinite(started)
  )
    throw localPasskeyError();
  const check = () => {
    const now = performance.now();
    if (
      signal.aborted ||
      window !== owner ||
      owner.document !== document ||
      owner.location.origin !== origin ||
      !owner.isSecureContext ||
      document.visibilityState === 'hidden' ||
      !Number.isFinite(now) ||
      now < started ||
      now - started >= remaining
    )
      throw localPasskeyError();
    checkLocalPasskeyOwner(assertCurrent);
    if (signal.aborted) throw localPasskeyError();
  };
  check();
  const buffers: Uint8Array[] = [];
  const bytes = (value: unknown, min: number, max = min) => {
    const decoded = localPasskeyBytes(value, min, max);
    buffers.push(decoded);
    return decoded;
  };
  try {
    const challenge = bytes(prompt.challenge, 32),
      salt = bytes(prompt.prfSalt, 32);
    const extensions = {
      prf: { eval: { first: salt } },
    } as AuthenticationExtensionsClientInputs;
    const rpId = new URL(origin).hostname;
    let response: LocalPasskeyResponse;
    if (prompt.kind === 'create') {
      const credential = await navigator.credentials.create({
        signal,
        publicKey: {
          rp: { name: 'Pali Wallet', id: rpId },
          challenge,
          user: {
            id: bytes(prompt.userHandle, 32),
            name: 'Pali local unlock',
            displayName: 'Pali local unlock',
          },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          attestation: 'none',
          authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'required',
          },
          timeout: remaining,
          extensions,
        },
      });
      check();
      if (
        !(credential instanceof PublicKeyCredential) ||
        credential.type !== 'public-key'
      )
        throw localPasskeyError();
      const data = credential.response as AuthenticatorAttestationResponse;
      const prf = credential.getClientExtensionResults() as PrfOutputs;
      response = {
        kind: 'create',
        rawId: localPasskeyBase64(new Uint8Array(credential.rawId)),
        clientDataJSON: localPasskeyBase64(new Uint8Array(data.clientDataJSON)),
        attestationObject: localPasskeyBase64(
          new Uint8Array(data.attestationObject)
        ),
        prfEnabled: prf.prf?.enabled,
      };
    } else if (prompt.kind === 'get') {
      const credential = await navigator.credentials.get({
        signal,
        publicKey: {
          challenge,
          rpId,
          allowCredentials: [
            { type: 'public-key', id: bytes(prompt.credentialId, 1, 1023) },
          ],
          userVerification: 'required',
          timeout: remaining,
          extensions,
        },
      });
      check();
      if (
        !(credential instanceof PublicKeyCredential) ||
        credential.type !== 'public-key'
      )
        throw localPasskeyError();
      const data = credential.response as AuthenticatorAssertionResponse;
      const output = (credential.getClientExtensionResults() as PrfOutputs).prf
        ?.results?.first;
      if (!(output instanceof ArrayBuffer) || output.byteLength !== 32)
        throw localPasskeyError();
      const secret = new Uint8Array(output);
      buffers.push(secret);
      response = {
        kind: 'get',
        rawId: localPasskeyBase64(new Uint8Array(credential.rawId)),
        clientDataJSON: localPasskeyBase64(new Uint8Array(data.clientDataJSON)),
        authenticatorData: localPasskeyBase64(
          new Uint8Array(data.authenticatorData)
        ),
        signature: localPasskeyBase64(new Uint8Array(data.signature)),
        prfOutput: localPasskeyBase64(secret),
      };
    } else throw localPasskeyError();
    check();
    return captureLocalPasskeyResponse(response);
  } finally {
    for (const buffer of buffers) buffer.fill(0);
  }
}
