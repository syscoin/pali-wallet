export const MAX_RESPONSE_BYTES = 16 * 1024;
const ABSOLUTE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CATALOGUE_RESPONSE_BYTES = 8 * 1024 * 1024;

/** A byte budget was exceeded; the response content and outcome remain unknown. */
export class ResponseSizeLimitError extends Error {
  constructor() {
    super('Response exceeded the size limit');
    this.name = 'ResponseSizeLimitError';
  }
}

export function cancelResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best effort and must not replace the primary failure.
  }
}
function abortError(): Error {
  const error = new Error('Balance request was cancelled or timed out');
  error.name = 'AbortError';
  return error;
}

export function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return length;
}

/** consumeBytes is a synchronous shared budget hook; it receives counts only. */
export function boundedResponseText(
  response: Response,
  signal: AbortSignal,
  maxBytes = MAX_RESPONSE_BYTES,
  consumeBytes?: (bytes: number) => void
): Promise<string> {
  return readResponseText(
    response,
    signal,
    maxBytes,
    ABSOLUTE_MAX_RESPONSE_BYTES,
    consumeBytes
  );
}

/** Require incremental UTF-8 reads within the ordinary RPC response ceiling. */
export function boundedStreamingResponseText(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
  consumeBytes?: (bytes: number) => void
): Promise<string> {
  return readResponseText(
    response,
    signal,
    maxBytes,
    ABSOLUTE_MAX_RESPONSE_BYTES,
    consumeBytes,
    'Response requires a readable UTF-8 stream'
  );
}

/** Bound decoded public metadata admission without changing the RPC fallback. */
export function boundedCatalogueResponseText(
  response: Response,
  signal: AbortSignal
): Promise<string> {
  return readResponseText(
    response,
    signal,
    CATALOGUE_RESPONSE_BYTES,
    CATALOGUE_RESPONSE_BYTES,
    undefined,
    'Catalogue response requires a readable UTF-8 stream'
  );
}

async function readResponseText(
  response: Response,
  signal: AbortSignal,
  maxBytes: number,
  limit: number,
  consumeBytes?: (bytes: number) => void,
  requiredStreamError?: string
): Promise<string> {
  checkAborted(signal);
  if (consumeBytes !== undefined && typeof consumeBytes !== 'function')
    throw new Error('Invalid byte budget');
  const charge = (bytes: number) => {
    if (!consumeBytes) return;
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error('Invalid byte count');
    const returned: unknown = consumeBytes(bytes);
    if (returned !== undefined) {
      if (
        returned &&
        (typeof returned === 'object' || typeof returned === 'function')
      )
        void Promise.resolve(returned).catch(() => undefined);
      throw new Error('Byte budget must return synchronously');
    }
    checkAborted(signal);
  };
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > limit)
    throw new Error('Invalid response size limit');
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader !== null) {
    if (!/^\d+$/.test(lengthHeader)) {
      cancelResponseBody(response);
      throw new Error('Invalid response content length');
    }
    if (Number(lengthHeader) > maxBytes) {
      cancelResponseBody(response);
      throw new ResponseSizeLimitError();
    }
  }
  // Streaming fetch implementations can stop reading immediately at the limit.
  // Native fetch may buffer the HTTP body; the parsed response is still bounded.
  if (response.body?.getReader && typeof TextDecoder !== 'undefined') {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const reader = response.body.getReader();
    let bytes = 0;
    let result = '';
    try {
      while (true) {
        const chunk = await abortable(reader.read(), signal);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) throw new ResponseSizeLimitError();
        charge(chunk.value.byteLength);
        result += decoder.decode(chunk.value, { stream: true });
      }
      result += decoder.decode();
      return result;
    } finally {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        // Preserve the read/decode/size failure if cancellation itself fails.
      }
    }
  }
  if (requiredStreamError) {
    cancelResponseBody(response);
    throw new Error(requiredStreamError);
  }
  const text = await abortable(response.text(), signal);
  if (text.length > maxBytes || utf8ByteLength(text) > maxBytes) {
    throw new ResponseSizeLimitError();
  }
  charge(utf8ByteLength(text));
  return text;
}
