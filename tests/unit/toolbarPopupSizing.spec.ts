import fs from 'fs';
import path from 'path';
import vm from 'vm';

const loader = fs.readFileSync(
  path.resolve(__dirname, '../../source/assets/js/appLoader.js'),
  'utf8'
);
const html = fs.readFileSync(
  path.resolve(__dirname, '../../views/app.html'),
  'utf8'
);

describe('toolbar popup intrinsic sizing', () => {
  const classify = (
    kind: 'toolbar' | 'tab' | 'other-popup' | 'absent' | 'error'
  ) => {
    const currentWindow = { addEventListener: jest.fn() };
    const setAttribute = jest.fn();
    const getViews = jest.fn(() => {
      if (kind === 'error') throw new Error('View context unavailable');
      if (kind === 'toolbar') return [currentWindow];
      return kind === 'other-popup' ? [{}] : [];
    });
    vm.runInNewContext(loader, {
      chrome: kind === 'absent' ? undefined : { extension: { getViews } },
      document: { documentElement: { setAttribute } },
      performance: { now: () => 0 },
      setTimeout: jest.fn(() => 1),
      window: currentWindow,
    });
    return { getViews, setAttribute };
  };

  it('keeps the actual action popup intrinsically sized before bundle loading', () => {
    const { getViews, setAttribute } = classify('toolbar');
    expect(getViews).toHaveBeenCalledWith({ type: 'popup' });
    expect(setAttribute).toHaveBeenCalledWith(
      'data-pali-view',
      'toolbar-popup'
    );
  });

  it.each(['tab', 'other-popup'] as const)(
    'opts an externally sized view into short-window layout: %s',
    (kind) => {
      expect(classify(kind).setAttribute).toHaveBeenCalledWith(
        'data-pali-view',
        'standalone'
      );
    }
  );

  it.each(['absent', 'error'] as const)(
    'preserves intrinsic sizing when classification is unavailable: %s',
    (kind) => {
      expect(classify(kind).setAttribute).not.toHaveBeenCalled();
    }
  );

  it('scopes every short-window sizing override to positively identified standalone views', () => {
    const shortRules = html
      .split('@media (max-height: 619px)')[1]
      .split('</style>')[0];
    expect(shortRules).toContain(
      "html[data-pali-view='standalone'] body.h-popup"
    );
    expect(shortRules).toContain("html[data-pali-view='standalone'] #app-root");
    expect(shortRules).toContain(
      "html[data-pali-view='standalone'] #app-root .min-h-popup"
    );
    const selectors = [...shortRules.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(
      (match) =>
        match[1]
          .split(',')
          .map((selector) => selector.trim().replace(/\s+/g, ' '))
    );
    expect(selectors).toHaveLength(4);
    expect(
      selectors.every((selector) =>
        selector.startsWith("html[data-pali-view='standalone'] ")
      )
    ).toBe(true);
  });
});
