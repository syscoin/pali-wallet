/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

import { clearTokenIconCache, TokenIcon } from 'components/TokenIcon';

jest.mock('components/Tooltip/Tooltip', () => ({
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  NftFallbackSvg: () => <span>NFT fallback</span>,
}));

// Exercise the real TokenIcon effect, shared maps, fetch/Blob/FileReader path
// and native-event handler. Only external HTTP responses and clock are synthetic.
// jsdom does not decode images: fireEvent.error/load model their deferred native
// delivery, never replace the handler, cached state or method result.
const originalFetch = global.fetch;
let caseNumber = 0;
const image = (view: ReturnType<typeof render>) =>
  view.container.querySelector('img') as HTMLImageElement | null;

beforeEach(() => {
  clearTokenIconCache();
  caseNumber += 1;
});
afterEach(() => {
  cleanup();
  clearTokenIconCache();
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const recoveredPair = async (directUrl: boolean) => {
  const url = `https://icons.synthetic.invalid/shared-${caseNumber}.png`;
  const now = 1_000_000;
  const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
  let valid = false;
  global.fetch = jest.fn(async (requested) => {
    expect(requested).toBe(url);
    return {
      ok: true,
      blob: async () =>
        directUrl
          ? new Blob(['x'.repeat(256 * 1024 + 1)], { type: 'image/png' })
          : new Blob(
              [
                valid
                  ? '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
                  : '<html>image endpoint temporarily unavailable</html>',
              ],
              { type: valid ? 'image/svg+xml' : 'text/html' }
            ),
    } as Response;
  }) as typeof fetch;

  const first = render(<TokenIcon logo={url} symbol="OLD" />);
  await waitFor(() => expect(image(first)).not.toBeNull());
  const oldImage = image(first)!;
  const oldSrc = oldImage.getAttribute('src');
  expect(oldImage).toHaveAttribute('loading', 'lazy');
  expect(oldSrc).toEqual(
    directUrl ? url : expect.stringContaining('data:text/html;')
  );
  const second = render(<TokenIcon logo={url} symbol="SECOND" />);
  await waitFor(() => expect(image(second)).toHaveAttribute('src', oldSrc));
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.error(image(second)!);
  expect(image(second)).toBeNull();
  expect(second.container).toHaveTextContent('S');
  expect(oldImage.isConnected).toBe(true);
  second.unmount();

  clock.mockReturnValue(now + 5 * 60_000 + 1);
  valid = true;
  const recovered = render(<TokenIcon logo={url} symbol="RECOVERED" />);
  await waitFor(() =>
    expect(image(recovered)).toHaveAttribute(
      'src',
      directUrl ? url : expect.stringContaining('data:image/svg+xml;')
    )
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  fireEvent.load(image(recovered)!);
  expect(oldImage.isConnected).toBe(true);
  expect(oldImage).toHaveAttribute('src', oldSrc);
  return { first, oldImage, recovered, url };
};

describe.each([false, true])(
  'shared logo resource, directURL=%s',
  (directUrl) => {
    it('does not let a still-mounted old resource error poison a refreshed shared success', async () => {
      const { first, oldImage, recovered, url } = await recoveredPair(
        directUrl
      );
      const goodSrc = image(recovered)!.getAttribute('src');
      fireEvent.error(oldImage);
      // The old failing image must still get its own fallback.
      expect(image(first)).toBeNull();
      expect(first.container).toHaveTextContent('O');
      expect(image(recovered)).toHaveAttribute('src', goodSrc);
      const later = render(<TokenIcon logo={url} symbol="LATER" />);
      // A healthy refreshed shared cache must remain reusable, without a third
      // fetch or a fresh five-minute failure cooldown from the old resource.
      expect(image(later)).toHaveAttribute('src', goodSrc);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('reuses the recovered shared cache when the old resource never errors', async () => {
      const { recovered, url } = await recoveredPair(directUrl);
      const later = render(<TokenIcon logo={url} symbol="LATER" />);
      expect(image(later)).toHaveAttribute(
        'src',
        image(recovered)!.getAttribute('src')
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not transfer shared-cache ownership to an old image on presentation rerender', async () => {
      const { first, oldImage, recovered, url } = await recoveredPair(
        directUrl
      );
      first.rerender(<TokenIcon logo={url} symbol="OLD REFRESHED" size={32} />);
      expect(image(first)).toBe(oldImage);
      expect(oldImage).toHaveStyle({ width: '32px', height: '32px' });
      fireEvent.error(oldImage);
      expect(image(first)).toBeNull();
      expect(first.container).toHaveTextContent('O');
      expect(first.container.firstElementChild).toHaveStyle({
        width: '32px',
        height: '32px',
      });
      const later = render(<TokenIcon logo={url} symbol="LATER" />);
      expect(image(later)).toHaveAttribute(
        'src',
        image(recovered)!.getAttribute('src')
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not poison shared success after the old consumer unmounts', async () => {
      const { first, oldImage, recovered, url } = await recoveredPair(
        directUrl
      );
      first.unmount();
      fireEvent.error(oldImage);
      const later = render(<TokenIcon logo={url} symbol="LATER" />);
      expect(image(later)).toHaveAttribute(
        'src',
        image(recovered)!.getAttribute('src')
      );
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('still caches a native error from the current recovered resource', async () => {
      const { recovered, url } = await recoveredPair(directUrl);
      fireEvent.error(image(recovered)!);
      expect(image(recovered)).toBeNull();
      const later = render(<TokenIcon logo={url} symbol="LATER" />);
      expect(image(later)).toBeNull();
      expect(later.container).toHaveTextContent('L');
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  }
);
