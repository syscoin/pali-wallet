import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedResponseText,
  ResponseSizeLimitError,
} from '../src/platformRpc.ts';

const signal = () => new AbortController().signal;
const nativeText = (text: string, length?: string) =>
  ({
    headers: new Headers(
      length === undefined ? {} : { 'content-length': length }
    ),
    body: null,
    text: async () => text,
  } as Response);

test('bounded reader retains the 16 KiB default across streaming, declared and native text bodies', async () => {
  for (const response of [
    new Response('x'.repeat(16385)),
    nativeText('x'.repeat(16385)),
    nativeText('é'.repeat(8193)),
    new Response('small', { headers: { 'content-length': '16385' } }),
    new Response('small', { headers: { 'content-length': '9'.repeat(100) } }),
    new Response('x'.repeat(16385), { headers: { 'content-length': '2' } }),
  ])
    await assert.rejects(
      boundedResponseText(response, signal()),
      ResponseSizeLimitError
    );
  assert.equal(
    (await boundedResponseText(new Response('x'.repeat(16384)), signal()))
      .length,
    16384
  );
});

test('bounded reader permits only explicit bounded larger responses and rejects invalid limits', async () => {
  assert.equal(
    (
      await boundedResponseText(
        new Response('x'.repeat(17000)),
        signal(),
        512 * 1024
      )
    ).length,
    17000
  );
  for (const max of [0, -1, NaN, Infinity, 1.5, 2 * 1024 * 1024 + 1])
    await assert.rejects(
      boundedResponseText(new Response('x'), signal(), max),
      (error: unknown) =>
        error instanceof Error && !(error instanceof ResponseSizeLimitError)
    );
});

test('malformed content lengths and invalid UTF-8 are not classified as size overflows', async () => {
  for (const length of ['', '-1', '1.5', 'wat']) {
    await assert.rejects(
      boundedResponseText(nativeText('x', length), signal()),
      (error: unknown) =>
        error instanceof Error && !(error instanceof ResponseSizeLimitError)
    );
  }
  await assert.rejects(
    boundedResponseText(new Response(new Uint8Array([0xff])), signal()),
    (error: unknown) =>
      error instanceof Error && !(error instanceof ResponseSizeLimitError)
  );
});

test('stream overflow stops consuming immediately and cancellation preserves the size error', async () => {
  let reads = 0,
    cancellations = 0;
  const response = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        async read() {
          reads++;
          return { done: false, value: new Uint8Array(9000) };
        },
        cancel() {
          cancellations++;
          throw Error('cancel failed');
        },
      }),
    },
  } as unknown as Response;
  await assert.rejects(
    boundedResponseText(response, signal()),
    ResponseSizeLimitError
  );
  assert.equal(reads, 2);
  assert.equal(cancellations, 1);
});

test('declared overflow cancels an unread stream without replacing the typed error', async () => {
  let cancellations = 0,
    reads = 0;
  const response = {
    headers: new Headers({ 'content-length': '17000' }),
    body: {
      cancel() {
        cancellations++;
        throw Error('cancel failed');
      },
      getReader() {
        reads++;
        throw Error('must not read');
      },
    },
  } as unknown as Response;
  await assert.rejects(
    boundedResponseText(response, signal()),
    ResponseSizeLimitError
  );
  assert.equal(cancellations, 1);
  assert.equal(reads, 0);
});

test('cancelled bounded reads are never classified as size overflows', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    boundedResponseText(new Response('x'.repeat(17000)), controller.signal),
    { name: 'AbortError' }
  );
  let cancel!: () => void;
  const entered = new Promise<void>((resolve) => {
    cancel = resolve;
  });
  const waiting = new AbortController();
  const response = {
    headers: new Headers(),
    body: {
      getReader: () => ({
        read() {
          cancel();
          return new Promise(() => undefined);
        },
        async cancel() {},
      }),
    },
  } as unknown as Response;
  const pending = boundedResponseText(response, waiting.signal);
  await entered;
  waiting.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
