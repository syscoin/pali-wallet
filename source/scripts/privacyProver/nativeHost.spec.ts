import fixture from '../../utils/privacy/prover.fixture.json';
import {
  encodePrivacyProof,
  privacyPublicSignals,
} from '../../utils/privacy/proverCore';

import { createNativeProofPage } from './nativeHost';
import {
  captureNativeProofInput,
  readNativeProofMessage,
} from './nativeProtocol';

const id = '00000000-0000-4000-8000-000000000001';
const input = () => structuredClone(fixture.input);
const result = () => encodePrivacyProof(fixture.proof, fixture.publicSignals);
const envelope = (value: object) =>
  JSON.stringify({ version: 1, id, ...value });

function setup() {
  const workers: any[] = [];
  const channels: any[] = [];
  const send = jest.fn();
  const page = createNativeProofPage(
    id,
    send,
    () => {
      const worker = {
        postMessage: jest.fn(),
        terminate: jest.fn(),
        onmessage: undefined,
        onerror: undefined,
      };
      workers.push(worker);
      return worker as any;
    },
    () => {
      const channel = {
        port1: { close: jest.fn() },
        port2: { close: jest.fn() },
      };
      channels.push(channel);
      return channel as any;
    }
  );
  return { workers, channels, send, page };
}

it('binds one job to the bundled policy and retires all workers before its public result', () => {
  const host = setup();
  host.page.start(id, JSON.stringify(input()));
  expect(host.workers).toHaveLength(3);
  expect(host.workers[0].postMessage.mock.calls[0][0].policy).toBe('bundled');
  expect(host.workers[0].postMessage.mock.calls[0][0].input.secret).toBe('');
  host.send.mockImplementation(() => {
    host.workers.forEach((worker) =>
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    );
    host.channels.forEach((channel) => {
      expect(channel.port1.close).toHaveBeenCalledTimes(1);
      expect(channel.port2.close).toHaveBeenCalledTimes(1);
    });
  });
  host.workers[0].onmessage({
    data: { id, type: 'success', result: result() },
  });
  expect(JSON.parse(host.send.mock.calls[0][0])).toEqual({
    version: 1,
    id,
    type: 'success',
    result: result(),
  });
  host.page.start(id, JSON.stringify(input()));
  host.workers[0].onmessage({
    data: { id, type: 'success', result: result() },
  });
  expect(host.workers).toHaveLength(3);
  expect(host.send).toHaveBeenCalledTimes(1);
});

const sentryJob = () => ({
  type: 'import' as const,
  role: 'voting' as const,
  scheme: 'secp256k1' as const,
  secretKey: '02'.padStart(64, '0'),
});
const sentryResult = () => ({
  role: 'voting',
  scheme: 'secp256k1',
  secretKey: '02'.padStart(64, '0'),
  publicKey:
    '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
});
const sentryInput = () =>
  JSON.stringify({ version: 1, kind: 'sentry', job: sentryJob() });

it('uses one fixed SDK worker and retires it before returning a domain-bound result', () => {
  const host = setup();
  host.page.startSentry(id, sentryInput());
  expect(host.workers).toHaveLength(1);
  expect(host.channels).toHaveLength(0);
  expect(host.workers[0].postMessage.mock.calls[0][0].job.secretKey).toBe('');
  const key = sentryResult();
  host.send.mockImplementation(() =>
    expect(host.workers[0].terminate).toHaveBeenCalledTimes(1)
  );
  host.workers[0].onmessage({
    data: { version: 1, kind: 'sentry', id, type: 'success', result: key },
  });
  expect(JSON.parse(host.send.mock.calls[0][0])).toEqual({
    version: 1,
    kind: 'sentry',
    id,
    type: 'success',
    result: key,
  });
  host.page.start(id, JSON.stringify(input()));
  host.page.startSentry(id, sentryInput());
  expect(host.workers).toHaveLength(1);
});

it.each([
  'wrong-domain',
  'private-error',
  'wrong-result',
  'termination-failure',
])(
  'refuses Sentry %s without a success or false disposal acknowledgement',
  (kind) => {
    const host = setup();
    host.page.startSentry(id, sentryInput());
    if (kind === 'termination-failure') {
      host.workers[0].terminate.mockImplementation(() => {
        throw new Error('private');
      });
      host.page.cancel(id);
      expect(host.send).not.toHaveBeenCalled();
      return;
    }
    const key = sentryResult();
    host.workers[0].onmessage({
      data:
        kind === 'wrong-domain'
          ? { version: 1, id, type: 'success', result: key }
          : kind === 'private-error'
          ? { version: 1, kind: 'sentry', id, type: 'error', error: 'private' }
          : {
              version: 1,
              kind: 'sentry',
              id,
              type: 'success',
              result: { ...key, scheme: 'slh-dsa-shake-128s' },
            },
    });
    expect(host.send).toHaveBeenCalledWith(
      envelope({ kind: 'sentry', type: 'error' })
    );
  }
);

it('cancels the Sentry worker, acknowledges its own domain and ignores a late result', () => {
  const host = setup();
  host.page.startSentry(id, sentryInput());
  host.page.cancel(id);
  expect(host.send).toHaveBeenCalledWith(
    envelope({ kind: 'sentry', type: 'disposed' })
  );
  host.workers[0].onmessage({
    data: { version: 1, kind: 'sentry', id, type: 'error' },
  });
  expect(host.send).toHaveBeenCalledTimes(1);
});

it('acknowledges Sentry cancellation before its queued start without starting crypto', () => {
  const host = setup();
  host.page.cancelSentry(id);
  expect(host.send).toHaveBeenCalledWith(
    envelope({ kind: 'sentry', type: 'disposed' })
  );
  host.page.startSentry(id, sentryInput());
  host.page.start(id, JSON.stringify(input()));
  expect(host.workers).toHaveLength(0);
  expect(host.send).toHaveBeenCalledTimes(1);
});

it('cancels every worker and port before acknowledging disposal and ignores late responses', () => {
  const host = setup();
  host.page.start(id, JSON.stringify(input()));
  host.page.cancel(id);
  host.workers.forEach((worker) =>
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  );
  expect(host.send).toHaveBeenCalledWith(envelope({ type: 'disposed' }));
  host.workers[0].onmessage({
    data: { id, type: 'success', result: result() },
  });
  host.page.cancel(id);
  expect(host.send).toHaveBeenCalledTimes(1);
});

it('withholds retirement acknowledgement if any termination fails while attempting all cleanup', () => {
  const host = setup();
  host.page.start(id, JSON.stringify(input()));
  host.workers[0].terminate.mockImplementation(() => {
    throw new Error('private');
  });
  host.page.cancel(id);
  host.workers.forEach((worker) =>
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  );
  host.channels.forEach((channel) =>
    expect(channel.port2.close).toHaveBeenCalledTimes(1)
  );
  expect(host.send).not.toHaveBeenCalled();
});

it('refuses a mismatched public result and terminates on a malformed progress message', () => {
  const host = setup();
  host.page.start(id, JSON.stringify(input()));
  host.workers[0].onmessage({
    data: {
      id,
      type: 'progress',
      progress: { stage: 'private', secret: 'hidden' },
    },
  });
  expect(host.send).toHaveBeenCalledWith(envelope({ type: 'error' }));
  host.workers.forEach((worker) =>
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  );
  host.workers[0].onmessage({
    data: { id, type: 'success', result: result() },
  });
  expect(host.send).toHaveBeenCalledTimes(1);
});

it('does not admit another job ID or input-controlled artifact policy', () => {
  const host = setup();
  host.page.start(
    '00000000-0000-4000-8000-000000000002',
    JSON.stringify(input())
  );
  expect(host.workers).toHaveLength(0);
  host.page.start(
    id,
    JSON.stringify({ ...input(), policy: 'extension-public' })
  );
  expect(host.workers).toHaveLength(0);
  expect(host.send).toHaveBeenCalledWith(envelope({ type: 'error' }));
});

it.each([
  'secret-text',
  JSON.stringify({ ...input(), extra: 1 }),
  JSON.stringify({ ...input(), pathIndices: [1] }),
  ' '.repeat(8193),
  JSON.stringify({ ...input(), secret: '-1' }),
])('rejects malformed native input without exposing its contents', (json) => {
  expect(() => captureNativeProofInput(json)).toThrow(
    /^privacy_proof_(failed|invalid_input)$/
  );
});

it.each([
  { version: 1.5, type: 'error' },
  { version: true, type: 'error' },
  { type: 'error', error: 'private' },
  { type: 'progress', progress: { stage: 'witness', completed: Infinity } },
  {
    type: 'success',
    result: {
      ...result(),
      publicSignals: ['0', ...fixture.publicSignals.slice(1)],
    },
  },
  { type: 'success', result: { ...result(), privateInput: input() } },
])('projects only the bound public protocol %#', (message) => {
  expect(() =>
    readNativeProofMessage(envelope(message), id, privacyPublicSignals(input()))
  ).toThrow('privacy_proof_failed');
});
