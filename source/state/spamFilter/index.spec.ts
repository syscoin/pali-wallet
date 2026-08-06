import reducer, { recordRequest, resetDappRequests, showWarning } from '.';
import { shouldShowSpamWarning } from './selectors';

describe('spam filter popup threshold', () => {
  const host = 'example.test';

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(10_000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('warns after three unresolved popup requests in the burst window', () => {
    let state = reducer(undefined, { type: '@@INIT' });

    for (let request = 0; request < 2; request += 1) {
      state = reducer(state, recordRequest({ host, method: 'personal_sign' }));
    }

    expect(shouldShowSpamWarning({ spamFilter: state }, host)).toBe(false);

    state = reducer(
      state,
      recordRequest({ host, method: 'eth_sendTransaction' })
    );

    expect(shouldShowSpamWarning({ spamFilter: state }, host)).toBe(true);
  });

  it('suppresses duplicate warnings and resets an allowed burst', () => {
    let state = reducer(undefined, { type: '@@INIT' });

    for (let request = 0; request < 3; request += 1) {
      state = reducer(state, recordRequest({ host, method: 'personal_sign' }));
    }

    state = reducer(state, showWarning({ host }));
    expect(shouldShowSpamWarning({ spamFilter: state }, host)).toBe(false);

    (Date.now as jest.Mock).mockReturnValue(12_000);
    state = reducer(state, resetDappRequests({ host }));

    expect(state.dapps[host]).toMatchObject({
      lastResetTime: 12_000,
      requests: [],
      warningShown: false,
    });
    expect(shouldShowSpamWarning({ spamFilter: state }, host)).toBe(false);
  });
});
