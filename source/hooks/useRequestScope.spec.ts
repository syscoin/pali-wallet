import React from 'react';

import { useRequestScope } from './useRequestScope';

describe('account/network request scopes', () => {
  let ref: any;
  let cleanup: () => void;
  beforeEach(() => {
    ref = undefined;
    jest.spyOn(React, 'useRef').mockImplementation((initial) => {
      ref ??= { current: initial };
      return ref;
    });
    jest.spyOn(React, 'useEffect').mockImplementation((effect) => {
      cleanup = effect() as () => void;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['account-b:chain-a', 'account-a:chain-b'])(
    'drops a page response after switching to %s',
    (nextContext) => {
      const begin = useRequestScope('account-a:chain-a');
      const mayApplyOldResponse = begin();
      useRequestScope(nextContext);
      expect(mayApplyOldResponse()).toBe(false);
    }
  );

  it('keeps a fresh response eligible and rejects an older duplicate request', () => {
    const begin = useRequestScope('account-a:chain-a');
    const first = begin();
    const second = begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it('drops replies after the activity panel is unmounted', () => {
    const begin = useRequestScope('account-a:chain-a');
    const mayApplyResponse = begin();
    cleanup();
    expect(mayApplyResponse()).toBe(false);
  });
});
