import { isAssetIconMimeType } from './assetIconIdentity.ts';
import {
  abortable,
  cancelResponseBody,
  checkAborted,
  ResponseSizeLimitError,
} from './boundedHttp.ts';

export const MAX_PUBLIC_IMAGE_BYTES = 256 * 1024;

/** Browser DNS remains browser-owned. Metadata may name only a public HTTPS domain. */
export function publicImageUrl(value: string): string {
  const url = new URL(value);
  if (
    value.length > 2048 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !url.hostname.includes('.') ||
    /^[\d.]+$/.test(url.hostname) ||
    url.hostname.includes(':') ||
    /(?:^|\.)(?:localhost|local|internal|home)$/.test(url.hostname) ||
    url.hostname
      .split('.')
      .some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error('Invalid public image URL');
  return url.href;
}

/** Stop image bodies at the byte ceiling, before constructing a Blob or data URL. */
export async function fetchPublicImage(
  fetcher: typeof fetch,
  value: string
): Promise<Blob> {
  const url = publicImageUrl(value);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const { signal } = controller;
  try {
    const response = await abortable(
      fetcher(url, {
        signal,
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      }).then((received) => {
        if (signal.aborted) {
          cancelResponseBody(received);
          checkAborted(signal);
        }
        return received;
      }),
      signal
    );
    const mime = response.headers
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase();
    if (
      !response.ok ||
      response.redirected ||
      (response.url && response.url !== url) ||
      !isAssetIconMimeType(mime)
    ) {
      cancelResponseBody(response);
      throw new Error('Image unavailable');
    }
    const length = response.headers.get('content-length');
    if (
      length !== null &&
      (!/^\d+$/.test(length) || Number(length) > MAX_PUBLIC_IMAGE_BYTES)
    ) {
      cancelResponseBody(response);
      throw new ResponseSizeLimitError();
    }
    if (!response.body?.getReader) {
      cancelResponseBody(response);
      throw new Error('Image stream unavailable');
    }
    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await abortable(reader.read(), signal);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_PUBLIC_IMAGE_BYTES) throw new ResponseSizeLimitError();
        chunks.push(new Uint8Array(chunk.value));
      }
      checkAborted(signal);
      return new Blob(chunks, { type: mime });
    } finally {
      try {
        void reader.cancel().catch(() => undefined);
      } catch {
        /* Preserve the read outcome. */
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
