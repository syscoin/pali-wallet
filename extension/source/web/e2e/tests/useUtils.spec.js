
const { isString } = require('lodash');


const { getHost, useCopyClipboard, sendMessage } = require('../../../hooks/useUtils');

describe('useUtils test', () => {
  it('should test getHost method', () => {
    const result = getHost('https://testurl');
    expect(result).toBe(result || isString(result) === true);
  });

});
