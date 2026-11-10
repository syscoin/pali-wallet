/** Local extension unlock only. These DTOs never configure an on-chain signer. */
export type LocalPasskeyRequest = Readonly<{
  challenge: string;
  credentialId?: string;
  kind: 'create' | 'get';
  origin: string;
  prfSalt: string;
  userHandle?: string;
}>;
export type LocalPasskeyPrompt = LocalPasskeyRequest &
  Readonly<{
    ceremonyId: string;
    expiresAt: number;
    operationId: string;
  }>;
export type LocalPasskeyResponse = Readonly<{
  attestationObject?: string;
  authenticatorData?: string;
  clientDataJSON: string;
  kind: 'create' | 'get';
  prfEnabled?: boolean;
  prfOutput?: string;
  rawId: string;
  signature?: string;
}>;
export type LocalPasskeyStep =
  | LocalPasskeyPrompt
  | Readonly<{
      kind: 'complete';
      operationId: string;
      success: boolean;
    }>;
export type LocalPasskeyStatus = Readonly<{ enabled: boolean }>;
export type LocalPasskeyController = Readonly<{
  beginEnrollment(password: string): Promise<LocalPasskeyStep>;
  beginUnlock(): Promise<LocalPasskeyStep>;
  cancel(operationId?: string): Promise<void>;
  complete(
    operationId: string,
    ceremonyId: string,
    response: LocalPasskeyResponse
  ): Promise<LocalPasskeyStep>;
  disable(password: string): Promise<void>;
  dispose(): Promise<void>;
  status(): Promise<LocalPasskeyStatus>;
}>;
export type LocalPasskeyCeremonyPort = Readonly<{
  request(
    request: LocalPasskeyRequest,
    assertCurrent: () => void
  ): Promise<LocalPasskeyResponse>;
}>;

export const localPasskeyError = () => new Error('LOCAL_PASSKEY_UNAVAILABLE');
export function checkLocalPasskeyOwner(check: () => void): void {
  const result: unknown = check();
  if (result === undefined) return;
  void Promise.resolve(result).catch(() => undefined);
  throw localPasskeyError();
}
export function localPasskeyField(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw localPasskeyError();
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (field && !('value' in field)) throw localPasskeyError();
  return field?.value;
}
export function localPasskeyFields(
  value: unknown,
  allowed: readonly string[]
): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || !allowed.includes(key)
    )
  )
    throw localPasskeyError();
}
export function localPasskeyOrigin(origin: unknown): string {
  if (
    typeof origin !== 'string' ||
    !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)
  )
    throw localPasskeyError();
  return origin;
}
/** Strict, bounded canonical base64url; all returned bytes are caller-owned. */
export function localPasskeyBytes(
  value: unknown,
  min: number,
  max = min
): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil((max * 4) / 3) ||
    !/^[A-Za-z0-9_-]+$/.test(value) ||
    value.length % 4 === 1
  )
    throw localPasskeyError();
  let binary: string;
  try {
    binary = atob(
      value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(value.length / 4) * 4, '=')
    );
  } catch {
    throw localPasskeyError();
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (
    bytes.length < min ||
    bytes.length > max ||
    localPasskeyBase64(bytes) !== value
  ) {
    bytes.fill(0);
    throw localPasskeyError();
  }
  return bytes;
}
export function localPasskeyBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '');
}
/** Snapshot transport data before any async work; accessors and extra fields are refused. */
export function captureLocalPasskeyResponse(
  value: unknown
): LocalPasskeyResponse {
  localPasskeyFields(value, [
    'kind',
    'rawId',
    'clientDataJSON',
    'attestationObject',
    'authenticatorData',
    'signature',
    'prfEnabled',
    'prfOutput',
  ]);
  const kind = localPasskeyField(value, 'kind');
  if (kind !== 'create' && kind !== 'get') throw localPasskeyError();
  const result: Record<string, unknown> = { kind };
  for (const [key, min, max] of [
    ['rawId', 1, 1023],
    ['clientDataJSON', 1, 4096],
    ...(kind === 'create'
      ? [['attestationObject', 1, 16384]]
      : [
          ['authenticatorData', 37, 4096],
          ['signature', 1, 1024],
          ['prfOutput', 32, 32],
        ]),
  ] as [string, number, number][]) {
    const field = localPasskeyField(value, key),
      bytes = localPasskeyBytes(field, min, max);
    bytes.fill(0);
    result[key] = field;
  }
  if (kind === 'create') {
    if (
      localPasskeyField(value, 'prfEnabled') !== true ||
      localPasskeyField(value, 'authenticatorData') !== undefined ||
      localPasskeyField(value, 'signature') !== undefined
    )
      throw localPasskeyError();
    result.prfEnabled = true;
    const output = localPasskeyField(value, 'prfOutput');
    if (output !== undefined) {
      const bytes = localPasskeyBytes(output, 32);
      bytes.fill(0);
    }
    // Registration output is deliberately discarded: enrollment always requires get().
  } else if (
    localPasskeyField(value, 'attestationObject') !== undefined ||
    (localPasskeyField(value, 'prfEnabled') !== undefined &&
      localPasskeyField(value, 'prfEnabled') !== true)
  )
    throw localPasskeyError();
  return Object.freeze(result) as LocalPasskeyResponse;
}
