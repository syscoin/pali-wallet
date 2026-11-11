import {
  MAX_WALLET_RELEASE_FEED_BYTES,
  MAX_WALLET_RELEASES,
  WALLET_RELEASE_FEED_URL,
  isWalletReleaseIdentity,
  parseWalletReleaseFeed,
  parseWalletReleaseFeedText,
  readWalletReleaseFeed,
  selectWalletRelease,
} from './walletRelease.ts';

const now = Date.parse('2026-11-12T00:00:00Z');
const release = (patch: Record<string, unknown> = {}) => ({
  platform: 'chrome',
  version: '4.1.0',
  severity: 'routine',
  title: 'Pali update available',
  summary: 'Improved transaction review and reliability.',
  publishedAt: '2026-11-11T00:00:00Z',
  releaseNotesUrl: 'https://github.com/syscoin/pali-wallet/releases/tag/v4.1.0',
  availability: { status: 'published' },
  ...patch,
});
const feed = (...releases: ReturnType<typeof release>[]) => ({
  version: 1,
  releases,
});
const admitted = (...releases: ReturnType<typeof release>[]) => {
  const value = parseWalletReleaseFeed(feed(...releases));
  expect(value).not.toBeNull();
  return value!;
};
function response(text: string, patch: Partial<Response> = {}): Response {
  return {
    ok: true,
    redirected: false,
    url: WALLET_RELEASE_FEED_URL,
    body: null,
    headers: { get: () => null },
    text: async () => text,
    ...patch,
  } as Response;
}

describe('wallet release metadata', () => {
  it('admits immutable data and an empty feed', () => {
    const value = admitted(release());
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.releases)).toBe(true);
    expect(Object.isFrozen(value.releases[0])).toBe(true);
    expect(Object.isFrozen(value.releases[0]!.availability)).toBe(true);
    expect(parseWalletReleaseFeedText('{"version":1,"releases":[]}')).toEqual(
      feed()
    );
  });

  it.each([
    null,
    [],
    {},
    { version: 2, releases: [] },
    { version: 1, releases: {}, downloadUrl: 'https://example.com' },
    { version: 1, releases: [], forceLock: true },
    { version: 1, releases: new Array(1) },
  ])('fails closed for malformed feed %p', (value) => {
    expect(parseWalletReleaseFeed(value)).toBeNull();
  });

  it.each([
    { platform: 'firefox' },
    { platform: { toString: () => 'chrome' } },
    { version: '4.1.0-beta.1' },
    { version: '4.01.0' },
    { version: '0.0.0' },
    { version: '65536.0' },
    { version: '1.2.3.4.5' },
    { version: 5 },
    { build: 1 },
    { severity: 'urgent' },
    { severity: { toString: () => 'critical' } },
    { title: '<b>Update</b>' },
    { title: ' Update' },
    { title: 'x'.repeat(81) },
    { summary: 'x'.repeat(601) },
    { summary: 'Read [the notice](https://example.com)' },
    { summary: 'Visit https://example.com' },
    { summary: 'Line one\nLine two' },
    { summary: '\u202eMisleading' },
    { summary: '\ud800' },
    { publishedAt: '2026-02-30T00:00:00Z' },
    { publishedAt: '2026-01-01' },
    { availability: { status: 'preview' } },
    { availability: { status: 'published', storeUrl: 'https://example.com' } },
    { downloadUrl: 'https://example.com/update.zip' },
    { updateUrl: 'https://example.com' },
  ])('rejects invalid or executable-looking entry metadata %p', (patch) => {
    expect(parseWalletReleaseFeed(feed(release(patch)))).toBeNull();
  });

  it.each([
    'http://github.com/syscoin/pali-wallet/releases/tag/v5',
    'https://github.com.evil.test/syscoin/pali-wallet/releases/tag/v5',
    'https://github.com@evil.test/syscoin/pali-wallet/releases/tag/v5',
    'https://github.com/syscoin/pali-wallet/releases/download/v5/update.zip',
    'https://github.com/syscoin/pali-wallet/releases/tag/v5?download=1',
    'https://github.com/syscoin/pali-wallet/releases/tag/v5#readme',
    'https://github.com/syscoin/pali-wallet/releases/tag/%2e%2e',
    'https://github.com/syscoin/pali-wallet/releases/tag/v5/../../other',
  ])('rejects untrusted notes URL %s', (releaseNotesUrl) => {
    expect(
      parseWalletReleaseFeed(feed(release({ releaseNotesUrl })))
    ).toBeNull();
  });

  it('requires platform-appropriate stable versions and builds', () => {
    expect(
      isWalletReleaseIdentity({ platform: 'chrome', version: '1.2.3.65535' })
    ).toBe(true);
    expect(
      isWalletReleaseIdentity({
        platform: 'android',
        version: '5.0',
        build: 10,
      })
    ).toBe(true);
    expect(isWalletReleaseIdentity({ platform: 'ios', version: '5.0.0' })).toBe(
      true
    );
    expect(isWalletReleaseIdentity({ platform: 'ios', version: '5.0' })).toBe(
      false
    );
    for (const build of [undefined, 0, -1, 1.5, '10', 2147483648])
      expect(
        parseWalletReleaseFeed(
          feed(release({ platform: 'android', version: '5.0.0', build }))
        )
      ).toBeNull();
  });

  it('enforces entry, byte, duplicate and plain-object bounds', () => {
    const releases = Array.from({ length: MAX_WALLET_RELEASES }, (_, i) =>
      release({ version: `5.${i}` })
    );
    expect(parseWalletReleaseFeed(feed(...releases))).not.toBeNull();
    expect(
      parseWalletReleaseFeed(feed(...releases, release({ version: '6' })))
    ).toBeNull();
    expect(
      parseWalletReleaseFeed(
        feed(release({ version: '5' }), release({ version: '5.0' }))
      )
    ).toBeNull();
    expect(
      parseWalletReleaseFeedText(' '.repeat(MAX_WALLET_RELEASE_FEED_BYTES + 1))
    ).toBeNull();
    const getter = jest.fn(() => 1);
    expect(
      parseWalletReleaseFeed(
        Object.defineProperty({ releases: [] }, 'version', { get: getter })
      )
    ).toBeNull();
    expect(getter).not.toHaveBeenCalled();
    expect(
      parseWalletReleaseFeed(
        Object.assign(Object.create({ version: 1 }), { releases: [] })
      )
    ).toBeNull();
  });

  it('selects the numeric maximum and retains outstanding publisher urgency', () => {
    const value = admitted(
      release({ version: '4.9', severity: 'critical' }),
      release({ version: '4.10', severity: 'routine' }),
      release({ platform: 'android', version: '8.0.0', build: 20 }),
      release({ platform: 'ios', version: '8.0.0', build: 20 })
    );
    const selected = selectWalletRelease(
      value,
      { platform: 'chrome', version: '4.8.1' },
      now
    );
    expect(selected?.version).toBe('4.10');
    expect(selected?.severity).toBe('critical');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(value.releases[1]!.severity).toBe('routine');
    expect(
      selectWalletRelease(value, { platform: 'chrome', version: '4.10.0' }, now)
    ).toBeNull();
    expect(
      selectWalletRelease(value, { platform: 'chrome', version: '9' }, now)
    ).toBeNull();
    expect(
      selectWalletRelease(value, { platform: 'chrome', version: 'broken' }, now)
    ).toBeNull();
  });

  it.each(['chrome', 'android', 'ios'] as const)(
    'carries only unapplied %s urgency to the latest installation target',
    (platform) => {
      const identity = (version: string, build: number) => ({
        platform,
        version,
        ...(platform === 'chrome' ? {} : { build }),
      });
      const value = admitted(
        release({ ...identity('5.0.1', 2), severity: 'critical' }),
        release({ ...identity('5.0.2', 3), title: 'Latest improvements' }),
        release({
          ...identity('5.0.3', 4),
          severity: 'critical',
          publishedAt: '2050-01-01T00:00:00Z',
        })
      );
      expect(
        selectWalletRelease(value, identity('5.0.0', 1), now)
      ).toMatchObject({
        version: '5.0.2',
        severity: 'critical',
        title: 'Latest improvements',
      });
      expect(
        selectWalletRelease(
          { ...value, releases: [...value.releases].reverse() },
          identity('5.0.0', 1),
          now
        )
      ).toEqual(selectWalletRelease(value, identity('5.0.0', 1), now));
      expect(
        selectWalletRelease(value, identity('5.0.1', 2), now)
      ).toMatchObject({
        version: '5.0.2',
        severity: 'routine',
      });
      expect(selectWalletRelease(value, identity('5.0.2', 3), now)).toBeNull();
    }
  );

  it('excludes other platforms and ineligible Android builds from outstanding urgency', () => {
    const value = admitted(
      release({ platform: 'ios', version: '5.0.1', severity: 'critical' }),
      release({
        platform: 'android',
        version: '4.9.0',
        build: 90,
        severity: 'critical',
      }),
      release({
        platform: 'android',
        version: '5.0.1',
        build: 1,
        severity: 'critical',
      }),
      release({
        platform: 'android',
        version: '5.0.1',
        build: 2,
        severity: 'important',
      }),
      release({ platform: 'android', version: '5.0.2', build: 3 })
    );
    expect(
      selectWalletRelease(
        value,
        { platform: 'android', version: '5.0.0', build: 1 },
        now
      )
    ).toMatchObject({ version: '5.0.2', build: 3, severity: 'important' });
    expect(
      selectWalletRelease(
        value,
        { platform: 'android', version: '5.0.1', build: 2 },
        now
      )
    ).toMatchObject({ version: '5.0.2', build: 3, severity: 'routine' });
  });

  it('requires a newer Android install build and rejects marketing-version downgrades', () => {
    const current = {
      platform: 'android' as const,
      version: '5.0.0',
      build: 50,
    };
    expect(
      selectWalletRelease(
        admitted(release({ platform: 'android', version: '6.0.0', build: 49 })),
        current,
        now
      )
    ).toBeNull();
    expect(
      selectWalletRelease(
        admitted(release({ platform: 'android', version: '4.9.0', build: 99 })),
        current,
        now
      )
    ).toBeNull();
    const value = admitted(
      release({ platform: 'android', version: '5.2.0', build: 51 }),
      release({ platform: 'android', version: '5.1.0', build: 52 })
    );
    expect(selectWalletRelease(value, current, now)?.build).toBe(52);
    expect(
      selectWalletRelease(
        admitted(release({ platform: 'android', version: '5.0.0', build: 51 })),
        current,
        now
      )?.build
    ).toBe(51);
  });

  it('uses iOS builds only when both are known and ignores future publications', () => {
    const value = admitted(
      release({ platform: 'ios', version: '5.0.0', build: 12 })
    );
    expect(
      selectWalletRelease(
        value,
        { platform: 'ios', version: '5.0.0', build: 11 },
        now
      )?.build
    ).toBe(12);
    expect(
      selectWalletRelease(value, { platform: 'ios', version: '5.0.0' }, now)
    ).toBeNull();
    expect(
      selectWalletRelease(value, { platform: 'ios', version: '4.0.0' }, now)
        ?.version
    ).toBe('5.0.0');
    expect(
      selectWalletRelease(
        admitted(release({ publishedAt: '2050-01-01T00:00:00Z' })),
        { platform: 'chrome', version: '4' },
        now
      )
    ).toBeNull();
  });

  it('does not inherit same-version iOS urgency without a known newer build', () => {
    const value = admitted(
      release({
        platform: 'ios',
        version: '5.0.0',
        build: 12,
        severity: 'critical',
      }),
      release({ platform: 'ios', version: '5.0.1' })
    );
    expect(
      selectWalletRelease(value, { platform: 'ios', version: '5.0.0' }, now)
    ).toMatchObject({ version: '5.0.1', severity: 'routine' });
    expect(
      selectWalletRelease(
        value,
        { platform: 'ios', version: '5.0.0', build: 12 },
        now
      )
    ).toMatchObject({ version: '5.0.1', severity: 'routine' });
    expect(
      selectWalletRelease(
        value,
        { platform: 'ios', version: '5.0.0', build: 11 },
        now
      )
    ).toMatchObject({ version: '5.0.1', severity: 'critical' });
  });

  it('uses only the fixed bounded HTTPS source and omits ambient credentials', async () => {
    const fetcher = jest.fn(async () =>
      response(JSON.stringify(feed(release())))
    );
    const controller = new AbortController();
    expect(
      await readWalletReleaseFeed(fetcher, controller.signal)
    ).not.toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      WALLET_RELEASE_FEED_URL,
      expect.objectContaining({
        signal: controller.signal,
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
      })
    );
    controller.abort();
    expect(await readWalletReleaseFeed(fetcher, controller.signal)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation even when the host fetch ignores its signal', async () => {
    const controller = new AbortController();
    const check = readWalletReleaseFeed(
      () => new Promise<Response>(() => undefined),
      controller.signal
    );
    controller.abort();
    await expect(check).resolves.toBeNull();
  });

  it('cancels the body of a response delivered after an aborted check', async () => {
    const controller = new AbortController();
    let deliver!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      deliver = resolve;
    });
    const cancel = jest.fn(async () => undefined);
    const check = readWalletReleaseFeed(() => pending, controller.signal);
    controller.abort();
    await expect(check).resolves.toBeNull();
    deliver(
      response('{}', {
        body: { cancel } as unknown as NonNullable<Response['body']>,
      })
    );
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    response('{}', { ok: false }),
    response('{}', { redirected: true }),
    response('{}', { url: 'https://example.com' }),
    response(' '.repeat(MAX_WALLET_RELEASE_FEED_BYTES + 1)),
    response('{}', {
      headers: {
        get: () => String(MAX_WALLET_RELEASE_FEED_BYTES + 1),
      } as unknown as Headers,
    }),
  ])('fails closed for transport/status/response bounds', async (value) => {
    expect(
      await readWalletReleaseFeed(
        async () => value,
        new AbortController().signal
      )
    ).toBeNull();
  });
});
