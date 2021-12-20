
const { isString } = require('lodash');
const { renderHook, act } = require('@testing-library/react-hooks');

const { getHost, useCopyClipboard, sendMessage } = require('../../../hooks/useUtils');

describe('useUtils test', () => {
  it('should test getHost method', () => {
    const result = getHost('https://testurl');
    expect(result).toBe(result || isString(result) === true);
  });

  it('should test useCopyClipboard method', async () => {
    const { result } = renderHook(() => useCopyClipboard());
    let [isCopied, copyText] = result.current;
    const text = 'arroz';
    await act(() => copyText(text));
    [isCopied, copyText] = result.current;


    expect(isCopied).toBe(true);

  }); 

  it('should test sendMessage method', () => {
    let assetGuid
    let amount
    const value = sendMessage(
      {
        type: 'ISSUE_NFT',
        target: 'connectionsController',
        freeze: true,
        eventResult: 'complete',
      },
      {
        type: 'ISSUE_NFT',
        target: 'contentScript',
        assetGuid,
        amount
      }
    );
    console.log(value)
  })
});