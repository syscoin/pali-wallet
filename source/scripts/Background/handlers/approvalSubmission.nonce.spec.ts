import { KeyringAccountType } from '@sidhujag/sysweb3-keyring';

import {
  captureDappEvmSubmission,
  watchApprovalSubmission,
} from './approvalSubmission';

const sender = {
  id: 'pali-extension',
  documentId: 'approval',
  url: 'chrome-extension://pali-extension/external/tx/send/ethTx',
} as chrome.runtime.MessageSender;
const address = `0x${'1'.repeat(40)}`;
const review = (extra: Record<string, unknown> = {}) => ({
  context: {
    account: { address, id: 0, type: KeyringAccountType.HDAccount },
    chainId: 1,
    rpcUrl: 'https://rpc.invalid',
    sessionGeneration: 0,
    slip44: 60,
  },
  assertCurrent: jest.fn(),
  checkDocument: jest.fn(async () => undefined),
  getSignal: () => new AbortController().signal,
  ...extra,
});

beforeEach(() =>
  Object.assign(chrome.runtime, {
    id: 'pali-extension',
    getURL: (path = '') => `chrome-extension://pali-extension/${path}`,
  })
);

test('requires a background quote, binds it to the document, and consumes it', () => {
  const stop = watchApprovalSubmission('approval', jest.fn(), review());
  try {
    const approval = captureDappEvmSubmission(sender)!;
    expect(() => approval.claimNonce(1)).toThrow();
    expect(
      captureDappEvmSubmission({ ...sender, documentId: 'other' })
    ).toBeUndefined();
    approval.beginNonceRecommendation(address)(1);
    expect(() => approval.claimNonce(2)).toThrow();
    expect(approval.claimNonce(1).approval).toEqual({
      nonce: 1,
      source: 'automatic',
    });
    expect(() => approval.claimNonce(1)).toThrow();
  } finally {
    stop();
  }
});

test('preserves an original explicit zero and a separate deliberate manual zero', () => {
  let stop = watchApprovalSubmission(
    'approval',
    jest.fn(),
    review({ originalNonce: '0x0' })
  );
  try {
    expect(captureDappEvmSubmission(sender)!.claimNonce(0).approval).toEqual({
      nonce: 0,
      source: 'manual',
    });
  } finally {
    stop();
  }
  stop = watchApprovalSubmission('approval', jest.fn(), review());
  try {
    const approval = captureDappEvmSubmission(sender)!;
    approval.approveManualNonce(0);
    expect(approval.claimNonce(0).approval).toEqual({
      nonce: 0,
      source: 'manual',
    });
  } finally {
    stop();
  }
});

test('rejects ambiguous and retired documents', () => {
  const one = watchApprovalSubmission('approval', jest.fn(), review());
  const two = watchApprovalSubmission('approval', jest.fn(), review());
  try {
    expect(() => captureDappEvmSubmission(sender)).toThrow();
  } finally {
    two();
  }
  const approval = captureDappEvmSubmission(sender)!;
  one();
  expect(() => approval.approveManualNonce(0)).toThrow();
});

test('batch only advances on acknowledgement and stops after an unknown outcome', () => {
  const stop = watchApprovalSubmission(
    'approval',
    jest.fn(),
    review({
      batch: {
        host: 'test.invalid',
        id: 'id',
        reservationId: 'reservation',
        callCount: 2,
      },
    })
  );
  try {
    const approval = captureDappEvmSubmission(sender)!;
    approval.beginNonceRecommendation(address)(4);
    const first = approval.claimNonce(4);
    expect(() => approval.claimNonce(5)).toThrow();
    first.finish();
    const second = approval.claimNonce(5);
    second.finish(new Error('outcome unknown'));
    expect(() => approval.claimNonce(6)).toThrow();
  } finally {
    stop();
  }
});

test('a definite single failure requires a fresh quote while an unknown one stays consumed', () => {
  const stop = watchApprovalSubmission('approval', jest.fn(), review());
  try {
    const approval = captureDappEvmSubmission(sender)!;
    approval.beginNonceRecommendation(address)(1);
    approval
      .claimNonce(1)
      .finish(
        Object.assign(new Error('not sent'), { transactionNotBroadcast: true })
      );
    expect(() => approval.claimNonce(1)).toThrow();
    approval.beginNonceRecommendation(address)(2);
    approval.claimNonce(2).finish(new Error('unknown'));
    approval.beginNonceRecommendation(address)(3);
    expect(() => approval.claimNonce(3)).toThrow();
  } finally {
    stop();
  }
});

test('a definite batch failure requires a fresh quote and cannot rebase behind the acknowledged prefix', () => {
  const stop = watchApprovalSubmission(
    'approval',
    jest.fn(),
    review({
      batch: {
        host: 'test.invalid',
        id: 'id',
        reservationId: 'reservation',
        callCount: 2,
      },
    })
  );
  try {
    const approval = captureDappEvmSubmission(sender)!;
    approval.beginNonceRecommendation(address)(4);
    approval.claimNonce(4).finish();
    approval
      .claimNonce(5)
      .finish(
        Object.assign(new Error('not sent'), { transactionNotBroadcast: true })
      );
    expect(() => approval.claimNonce(5)).toThrow();
    approval.beginNonceRecommendation(address)(4);
    expect(() => approval.claimNonce(4)).toThrow();
    approval.beginNonceRecommendation(address)(6);
    expect(approval.claimNonce(6).approval).toEqual({
      nonce: 6,
      source: 'automatic',
    });
  } finally {
    stop();
  }
});

test('a later quote invalidates an out-of-order older response', () => {
  const stop = watchApprovalSubmission('approval', jest.fn(), review());
  try {
    const approval = captureDappEvmSubmission(sender)!;
    const older = approval.beginNonceRecommendation(address);
    const newer = approval.beginNonceRecommendation(address);
    newer(2);
    expect(() => older(1)).toThrow();
    expect(approval.claimNonce(2).approval.nonce).toBe(2);
  } finally {
    stop();
  }
});

test('a failed explicit dapp nonce cannot become an automatic nonce', () => {
  const stop = watchApprovalSubmission(
    'approval',
    jest.fn(),
    review({ originalNonce: '0x0' })
  );
  try {
    const approval = captureDappEvmSubmission(sender)!;
    approval
      .claimNonce(0)
      .finish(
        Object.assign(new Error('not sent'), { transactionNotBroadcast: true })
      );
    approval.beginNonceRecommendation(address)(1);
    expect(() => approval.claimNonce(1)).toThrow();
    approval.approveManualNonce(0);
    expect(approval.claimNonce(0).approval).toEqual({
      nonce: 0,
      source: 'manual',
    });
  } finally {
    stop();
  }
});

test('rejects a content script and an expired quote', () => {
  const stop = watchApprovalSubmission('approval', jest.fn(), review());
  const now = jest.spyOn(performance, 'now');
  try {
    now.mockReturnValue(1);
    expect(
      captureDappEvmSubmission({ ...sender, url: 'https://dapp.invalid/' })
    ).toBeUndefined();
    const approval = captureDappEvmSubmission(sender)!;
    approval.beginNonceRecommendation(address)(1);
    now.mockReturnValue(300_001);
    expect(() => approval.claimNonce(1)).toThrow();
  } finally {
    now.mockRestore();
    stop();
  }
});

test('invalidates a pre-claim quote and refuses new quotes while a batch item is active', () => {
  const stop = watchApprovalSubmission(
    'approval',
    jest.fn(),
    review({
      batch: {
        host: 'test.invalid',
        id: 'id',
        reservationId: 'reservation',
        callCount: 2,
      },
    })
  );
  try {
    const approval = captureDappEvmSubmission(sender)!;
    approval.beginNonceRecommendation(address)(4);
    approval.claimNonce(4).finish();
    const older = approval.beginNonceRecommendation(address);
    const current = approval.claimNonce(5);
    expect(() => older(6)).toThrow();
    expect(() => approval.beginNonceRecommendation(address)).toThrow();
    current.finish();
  } finally {
    stop();
  }
});
