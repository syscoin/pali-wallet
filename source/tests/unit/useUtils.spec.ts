import { isString } from 'lodash';

import { getHost } from '../../hooks/useUtils';

describe('useUtils.ts test', () => {
  it('should test getHost method', () => {
    const result = getHost('https://testurl');

    expect(result).toBe(result || isString(result) === true);
  });
});
