import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoundedRpcFetch } from '../src/custody/boundedRpcFetch.ts';

test('aborting acquired readers rejects reads and holds physical slots through cancellation', async () => {
  let opened = 0,
    cancelled = 0;
  const releases: (() => void)[] = [];
  const lateReads: ((result: ReadableStreamReadResult<Uint8Array>) => void)[] =
    [];
  const fetch = createBoundedRpcFetch(async () => {
    opened++;
    return {
      body: {
        getReader() {
          return {
            read: () =>
              new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) =>
                lateReads.push(resolve)
              ),
            cancel: () => {
              cancelled++;
              return new Promise<void>((resolve) => releases.push(resolve));
            },
            releaseLock() {},
          };
        },
      },
    } as unknown as Response;
  });
  const owners = Array.from({ length: 4 }, () => new AbortController());
  const responses = await Promise.all(
    owners.map((owner) =>
      fetch('https://rpc.example', { signal: owner.signal })
    )
  );
  const readers = responses.map((response) => response.body!.getReader());
  const reads = Promise.allSettled(readers.map((reader) => reader.read()));
  const fifth = fetch('https://rpc.example', {
    signal: new AbortController().signal,
  });
  owners.forEach((owner) => owner.abort());
  const outcomes = await reads;
  assert(
    outcomes.every(
      (result) =>
        result.status === 'rejected' && result.reason.name === 'AbortError'
    )
  );
  assert.equal(cancelled, 4);
  assert.equal(opened, 4);
  lateReads.forEach((resolve) =>
    resolve({ done: false, value: new Uint8Array([1]) })
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    opened,
    4,
    'late read completion does not release an unfinished cancellation'
  );
  releases.splice(0).forEach((release) => release());
  const response = await fifth;
  assert.equal(opened, 5);
  const last = response.body!.getReader();
  const cleanup = last.cancel();
  releases.splice(0).forEach((release) => release());
  await cleanup;
});

test('aborting before reader acquisition cancels the response body once', async () => {
  let bodyCancels = 0,
    readerCalls = 0;
  const owner = new AbortController();
  const fetch = createBoundedRpcFetch(
    async () =>
      ({
        body: {
          async cancel() {
            bodyCancels++;
          },
          getReader() {
            readerCalls++;
            throw Error('Reader must not be acquired after cancellation');
          },
        },
      } as unknown as Response)
  );
  const response = await fetch('https://rpc.example', { signal: owner.signal });
  owner.abort();
  await assert.rejects(
    response.body!.cancel().then(() => response.body!.getReader()),
    { name: 'AbortError' }
  );
  assert.equal(bodyCancels, 1);
  assert.equal(readerCalls, 0);
});

test('a late buffered body cannot release an in-flight cancellation', async () => {
  const value = Promise.withResolvers<string>();
  const cleanup = Promise.withResolvers<void>();
  let bodyCancels = 0;
  const owner = new AbortController();
  const fetch = createBoundedRpcFetch(
    async () =>
      ({
        text: () => value.promise,
        body: {
          cancel() {
            bodyCancels++;
            return cleanup.promise;
          },
        },
      } as unknown as Response)
  );
  const response = await fetch('https://rpc.example', { signal: owner.signal });
  const reading = response.text();
  let settled = false;
  const result = reading.finally(() => {
    settled = true;
  });
  owner.abort();
  value.resolve('late body');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(bodyCancels, 1);
  cleanup.resolve();
  await assert.rejects(result, { name: 'AbortError' });
});
