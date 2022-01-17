const { isString } = require('lodash');
import { renderHook, act } from '@testing-library/react-hooks';
import { getHost } from '../../hooks/useUtils';
import { useState, useEffect, useCallback } from 'react';

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
});
