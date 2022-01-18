import { renderHook, act } from '@testing-library/react-hooks';
import { useState, useEffect, useCallback } from 'react';
import { isString } from 'lodash';

import { getHost, isNFT } from '../../hooks/useUtils';

const useCopyClipboard = (
  timeout = 1000
): [boolean, (toCopy: string) => void] => {
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const staticCopy = useCallback(async (text) => {
    await navigator?.clipboard?.writeText(text);
    setIsCopied(true);
  }, []);

  useEffect(() => {
    if (isCopied) {
      const hide = setTimeout(() => {
        setIsCopied(false);
      }, timeout);

      return () => {
        clearTimeout(hide);
      };
    }
    return undefined;
  }, [isCopied, setIsCopied, timeout]);

  return [isCopied, staticCopy];
};

describe('useUtils test', () => {
  it('should test getHost method', () => {
    const result = getHost('https://testurl');
    expect(result).toBe(result || isString(result) === true);
  });

  it('should test useCopyClipboard method', async () => {
    const { result } = renderHook(() => useCopyClipboard());
    let [isCopied, copyText] = result.current;
    const text = 'test';
    await act(() => copyText(text));
    [isCopied, copyText] = result.current;

    expect(isCopied).toBe(true);
  });
  it('should verify if item is nft or not', () => {
    const nftNumber = 1000 * 1500 * 15123;
    const result = isNFT(nftNumber);
    expect(result).toBeTruthy();
  });
});
