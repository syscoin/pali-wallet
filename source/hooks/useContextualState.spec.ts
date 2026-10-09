import React from 'react';

import { useContextualState } from './useContextualState';
import { useIncrementalList } from './useIncrementalList';

describe('local state across account/network changes', () => {
  let stored: any;
  beforeEach(() => {
    stored = undefined;
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      stored ??= initial;
      return [
        stored,
        (value: any) => {
          stored = typeof value === 'function' ? value(stored) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useMemo').mockImplementation((factory) => factory());
  });
  afterEach(() => jest.restoreAllMocks());

  it('hides old account pages during render, before cleanup effects can run', () => {
    const [, setRows] = useContextualState<string[]>('account-a:chain-1', []);
    setRows(['old-account-transaction']);
    expect(useContextualState('account-a:chain-1', [])[0]).toEqual([
      'old-account-transaction',
    ]);
    expect(useContextualState('account-b:chain-1', [])[0]).toEqual([]);
  });

  it('appends fresh results without mixing a prior account snapshot', () => {
    const [, setRows] = useContextualState<string[]>('account-a:chain-1', []);
    setRows(['old']);
    const [, setFreshRows] = useContextualState<string[]>(
      'account-b:chain-1',
      []
    );
    setFreshRows((rows) => [...rows, 'new']);
    expect(useContextualState('account-b:chain-1', [])[0]).toEqual(['new']);
  });

  it('expands a 1000-row result in bounded increments and resets on a new search', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    let list = useIncrementalList(rows, 'account-a:search-all');
    expect(list.visibleItems).toHaveLength(50);
    list.showMore();
    list = useIncrementalList(rows, 'account-a:search-all');
    expect(list.visibleItems).toHaveLength(100);
    list = useIncrementalList(rows, 'account-a:new-search');
    expect(list.visibleItems).toHaveLength(50);
    expect(
      useIncrementalList([999], 'account-a:search-999').visibleItems
    ).toEqual([999]);
  });
});
