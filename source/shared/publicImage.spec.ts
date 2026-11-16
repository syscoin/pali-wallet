import { ResponseSizeLimitError } from './boundedHttp';
import {
  fetchPublicImage,
  MAX_PUBLIC_IMAGE_BYTES,
  publicImageUrl,
} from './publicImage';

const url = 'https://icons.example/token.png';
it.each([
  'http://icons.example/a.png',
  'https://127.0.0.1/a.png',
  'https://192.168.1.2/a.png',
  'https://[::1]/a.png',
  'https://localhost/a.png',
  'https://service.local/a.png',
  'https://user:secret@icons.example/a.png',
  'https://icons.example:8443/a.png',
  'data:image/png;base64,eA==',
])(
  'refuses metadata-selected nonpublic image URL %s before HTTP',
  async (value) => {
    const fetcher = jest.fn();
    await expect(fetchPublicImage(fetcher, value)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it('accepts public HTTPS raster images with a streamed response and no credentials or redirects', async () => {
  const fetcher = jest.fn(
    async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/png' },
      })
  );
  const image = await fetchPublicImage(fetcher, url);
  expect(image.type).toBe('image/png');
  expect(image.size).toBe(3);
  expect(new Uint8Array(await image.arrayBuffer())).toEqual(
    new Uint8Array([1, 2, 3])
  );
  expect(fetcher).toHaveBeenCalledWith(
    publicImageUrl(url),
    expect.objectContaining({
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: expect.any(AbortSignal),
    })
  );
});
it('rejects an oversized declared body without consuming it', async () => {
  const cancelled = jest.fn();
  const response = new Response(new ReadableStream({ cancel: cancelled }), {
    headers: {
      'content-type': 'image/png',
      'content-length': String(MAX_PUBLIC_IMAGE_BYTES + 1),
    },
  });
  await expect(
    fetchPublicImage(
      jest.fn(async () => response),
      url
    )
  ).rejects.toBeInstanceOf(ResponseSizeLimitError);
  expect(cancelled).toHaveBeenCalledTimes(1);
});
it('stops a chunked oversized body and never creates a direct remote image fallback', async () => {
  const cancelled = jest.fn();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PUBLIC_IMAGE_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel: cancelled,
    }),
    { headers: { 'content-type': 'image/webp' } }
  );
  await expect(
    fetchPublicImage(
      jest.fn(async () => response),
      url
    )
  ).rejects.toBeInstanceOf(ResponseSizeLimitError);
  expect(cancelled).toHaveBeenCalledTimes(1);
});
it.each(['text/html', 'image/svg+xml'])(
  'rejects remote %s content before reading it',
  async (mime) => {
    const cancelled = jest.fn();
    const response = new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'content-type': mime },
    });
    await expect(
      fetchPublicImage(
        jest.fn(async () => response),
        url
      )
    ).rejects.toThrow('Image unavailable');
    expect(cancelled).toHaveBeenCalledTimes(1);
  }
);
it('cancels a stalled image body at eight seconds', async () => {
  jest.useFakeTimers();
  const cancelled = jest.fn();
  let signal!: AbortSignal;
  const fetcher = jest.fn(async (_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal;
    return new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'content-type': 'image/jpeg' },
    });
  });
  try {
    const work = fetchPublicImage(fetcher, url);
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(8000);
    await rejected;
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
it('cancels a late response arriving after the header deadline', async () => {
  jest.useFakeTimers();
  const cancelled = jest.fn();
  let release!: (response: Response) => void;
  const fetcher = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      })
  );
  try {
    const work = fetchPublicImage(fetcher, url);
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(8000);
    await rejected;
    release(
      new Response(new ReadableStream({ cancel: cancelled }), {
        headers: { 'content-type': 'image/png' },
      })
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelled).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
