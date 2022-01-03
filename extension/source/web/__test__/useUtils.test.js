
const { isString } = require('lodash');
const { renderHook, act } = require('@testing-library/react-hooks');

const { getHost, useCopyClipboard, sendMessage } = require('../../hooks/useUtils');

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

  // it('should test sendMessage method', async () => {
  //   let assetGuid
  //   let amount
  //   const value = await sendMessage(
  //     {
  //       type: 'test',
  //       target: 'connectionsController',
  //       freeze: true,
  //       eventResult: 'complete',
  //     },
  //     {
  //       type: 'test',
  //       target: 'contentScript',
  //       assetGuid,
  //       amount
  //     }
  //   );
  //   console.log(value)
  // })
});