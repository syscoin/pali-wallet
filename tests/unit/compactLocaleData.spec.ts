import fs from 'fs';
import { createInstance } from 'i18next';
import path from 'path';

import compactLocaleJson from '../../source/config/loaders/compactLocaleJson';
import localeStructure from '../../source/config/loaders/localeStructure';
import {
  LocaleResource,
  LocaleStructure,
  restoreLocale,
} from '../../source/utils/restoreLocale';

const languages = ['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'];
const resourcePath = (lng: string) =>
  path.resolve(__dirname, '../../source/assets/locales', `${lng}.json`);
const source = (lng: string) => fs.readFileSync(resourcePath(lng), 'utf8');
const execute = (
  generated: string,
  requireDependency: (name: string) => unknown
) => {
  const module = { exports: undefined as unknown };
  // Locally authored build output only; no eval/Function is shipped in the runtime.
  new Function('module', 'require', generated)(module, requireDependency);
  return module.exports;
};
const schema = (scope = '') =>
  execute(
    localeStructure.call(
      { resourceQuery: scope ? `?${scope}Structure` : '' },
      source('en')
    ),
    () => {
      throw Error('Structure must not import anything');
    }
  ) as LocaleStructure;
const compile = (lng: string, scope = '') => {
  const dependencies: string[] = [];
  const generated = compactLocaleJson.call(
    {
      resourcePath: resourcePath(lng),
      resourceQuery: scope ? `?${scope}Messages` : '',
      addDependency: (name: string) => dependencies.push(name),
    },
    source(lng)
  );
  expect(dependencies).toEqual([resourcePath('en')]);
  const packed = execute(generated, (name) => {
    if (name === 'utils/restoreLocale') return { restoreLocale };
    if (
      name ===
      `assets/locales/en.json?${
        scope ? scope + 'Structure' : 'localeStructure'
      }`
    )
      return schema(scope);
    throw Error(`Unexpected locale dependency: ${name}`);
  }) as Record<string, LocaleResource>;
  return { packed, generated };
};
const expectExact = (
  expected: any,
  actual: any,
  references = new Set<object>()
) => {
  if (typeof expected === 'string') {
    expect(actual).toBe(expected);
    return;
  }
  expect(Object.getPrototypeOf(actual)).toBe(Object.getPrototypeOf(expected));
  expect(Reflect.ownKeys(actual)).toEqual(Reflect.ownKeys(expected));
  expect(references.has(actual)).toBe(false);
  references.add(actual);
  for (const key of Reflect.ownKeys(expected)) {
    const before = Object.getOwnPropertyDescriptor(expected, key)!;
    const after = Object.getOwnPropertyDescriptor(actual, key)!;
    expect({ ...after, value: undefined }).toEqual({
      ...before,
      value: undefined,
    });
    expectExact(before.value, after.value, references);
  }
};
const leafKeys = (node: any, prefix = ''): string[] =>
  Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [prefix + key]
      : leafKeys(value, prefix + key + '.')
  );

it.each(languages)(
  '%s preserves every translation, key, order, object property and independent mutation',
  (lng) => {
    const original = JSON.parse(source(lng));
    const { packed, generated } = compile(lng);
    expect(JSON.stringify(packed)).toBe(JSON.stringify(original));
    expectExact(original, packed);
    expect(generated).not.toContain('function');
    expect(generated).not.toContain('eval(');
    const fresh = compile(lng).packed;
    (packed.buttons as any).cancel = 'local test mutation';
    (packed.buttons as any).extra = 'extra';
    expect(JSON.stringify(fresh)).toBe(JSON.stringify(original));
    expect(JSON.stringify(JSON.parse(source(lng)))).toBe(
      JSON.stringify(original)
    );
  }
);

it.each(languages)(
  '%s preserves i18next interpolation, all resource keys and locale-specific plural selection',
  async (lng) => {
    const original = JSON.parse(source(lng));
    const packed = compile(lng).packed;
    const before = createInstance(),
      after = createInstance();
    const options = {
      lng,
      fallbackLng: false as const,
      initImmediate: false,
      interpolation: { escapeValue: true },
    };
    await before.init({
      ...options,
      resources: { [lng]: { translation: original } },
    });
    await after.init({
      ...options,
      resources: { [lng]: { translation: packed } },
    });
    for (const key of leafKeys(original)) {
      const value = key
        .split('.')
        .reduce((node: any, field) => node[field], original);
      const fields = [...value.matchAll(/{{(.*?)}}/g)].map(
        (match: RegExpMatchArray) => match[1]
      );
      const data = Object.fromEntries(
        fields.map((field: string) => [
          field,
          field === 'count' ? 2 : 'A&B <fixture> {{raw}}',
        ])
      );
      expect(after.t(key, data)).toBe(before.t(key, data));
    }
    for (const count of [0, 1, 2, 5, 21])
      expect(after.t('settings.connectedSiteCount', { count })).toBe(
        before.t('settings.connectedSiteCount', { count })
      );
  }
);

it('fails the build for key/order/type drift rather than shifting translations', () => {
  const context = {
    resourcePath: resourcePath('en'),
    addDependency: jest.fn(),
  };
  const original = JSON.parse(source('en'));
  delete original.buttons.cancel;
  expect(() =>
    compactLocaleJson.call(context, JSON.stringify(original))
  ).toThrow('structure/order differs');
  expect(() =>
    compactLocaleJson.call(context, '{"different":"value"}')
  ).toThrow('structure/order differs');
  for (const invalid of [
    '{"bad":null}',
    '{"bad":1}',
    '{"bad":true}',
    '{"bad":[]}',
  ])
    expect(() => localeStructure(invalid)).toThrow('only objects and text');
});

it.each(languages)(
  '%s base and lazy Privacy projections reconstruct the original exactly',
  (lng) => {
    const original = JSON.parse(source(lng));
    const base = compile(lng, 'base').packed as any;
    const privacy = compile(lng, 'privacy').packed as any;
    expect(base.privacy).toEqual({ title: original.privacy.title });
    expect(Object.keys(privacy)).toEqual(['privacy']);
    expect(privacy.privacy.title).toBeUndefined();
    const merged = {
      ...base,
      privacy: { ...base.privacy, ...privacy.privacy },
    };
    expect(JSON.stringify(merged)).toBe(JSON.stringify(original));
    expectExact(original, merged);
    expect(compile(lng, 'base').generated).not.toContain(
      original.privacy.noteSecret
    );
    expect(compile(lng, 'privacy').generated).toContain(
      original.privacy.noteSecret
    );
  }
);

it.each(['base', 'privacy'])(
  'validates omitted fields before the %s projection',
  (scope) => {
    const context = {
      resourcePath: resourcePath('en'),
      resourceQuery: `?${scope}Messages`,
      addDependency: jest.fn(),
    };
    const original = JSON.parse(source('en'));
    delete original.privacy.title;
    expect(() =>
      compactLocaleJson.call(context, JSON.stringify(original))
    ).toThrow('structure/order differs');
    const invalid = JSON.parse(source('en'));
    invalid.buttons.cancel = null;
    expect(() =>
      compactLocaleJson.call(context, JSON.stringify(invalid))
    ).toThrow('only objects and text');
  }
);

it('reconstructs literal prototype-named keys and refuses truncated/extra value arrays', () => {
  const shape = execute(
    localeStructure('{"__proto__":"one","constructor":{"value":"two"}}'),
    () => {
      throw Error('No dependencies');
    }
  ) as LocaleStructure;
  const restored = restoreLocale(shape, ['A&B {{raw}}', 'line\n雪']) as any;
  expect(Object.getPrototypeOf(restored)).toBe(Object.prototype);
  expect(Object.keys(restored)).toEqual(['__proto__', 'constructor']);
  expect(Object.getOwnPropertyDescriptor(restored, '__proto__')!.value).toBe(
    'A&B {{raw}}'
  );
  expect(restored.constructor.value).toBe('line\n雪');
  expect(() => restoreLocale(shape, ['one'])).toThrow('Missing locale value');
  expect(() => restoreLocale(shape, ['one', 'two', 'extra'])).toThrow(
    'Unexpected locale values'
  );
});

it('shares repeated English base values only when the full generated expression is smaller', () => {
  const original = JSON.parse(source('en'));
  const base = { ...original, privacy: { title: original.privacy.title } };
  const flatten = (node: any): string[] =>
    typeof node === 'string' ? [node] : Object.values(node).flatMap(flatten);
  const oldGenerated =
    'module.exports=require("utils/restoreLocale").restoreLocale(require("assets/locales/en.json?baseStructure"),' +
    JSON.stringify(flatten(base)) +
    ');';
  const { packed, generated } = compile('en', 'base');
  expectExact(base, packed);
  expect(generated).toContain('const p0=');
  expect(Buffer.byteLength(generated)).toBeLessThan(
    Buffer.byteLength(oldGenerated)
  );
});

it.each(languages)(
  '%s never grows the complete generated locale module in any projection',
  (lng) => {
    const original = JSON.parse(source(lng));
    const flatten = (node: any): string[] =>
      typeof node === 'string' ? [node] : Object.values(node).flatMap(flatten);
    for (const scope of ['', 'base', 'privacy']) {
      const projection =
        scope === 'base'
          ? { ...original, privacy: { title: original.privacy.title } }
          : scope === 'privacy'
          ? {
              privacy: Object.fromEntries(
                Object.entries(original.privacy).filter(
                  ([key]) => key !== 'title'
                )
              ),
            }
          : original;
      const structureName = scope ? `${scope}Structure` : 'localeStructure';
      const before =
        `module.exports=require("utils/restoreLocale").restoreLocale(require("assets/locales/en.json?${structureName}"),` +
        JSON.stringify(flatten(projection)) +
        ');';
      const { packed, generated } = compile(lng, scope);
      expectExact(projection, packed);
      expect(Buffer.byteLength(generated)).toBeLessThanOrEqual(
        Buffer.byteLength(before)
      );
    }
  }
);

it.each(['unique', 'repeated'] as const)(
  'preserves escaped synthetic strings in the %s-value encoding',
  (mode) => {
    const original = JSON.parse(source('en'));
    let index = 0;
    const escaped =
      'quote " slash \\ newline\n separator\u2028 snow 雪 </script>';
    const replaceLeaves = (node: any): any =>
      typeof node === 'string'
        ? mode === 'unique'
          ? `${escaped} ${index++}`
          : escaped
        : Object.fromEntries(
            Object.entries(node).map(([key, value]) => [
              key,
              replaceLeaves(value),
            ])
          );
    const fixture = replaceLeaves(original);
    const generated = compactLocaleJson.call(
      { resourcePath: resourcePath('en'), addDependency: jest.fn() },
      JSON.stringify(fixture)
    );
    const packed = execute(generated, (name) => {
      if (name === 'utils/restoreLocale') return { restoreLocale };
      if (name === 'assets/locales/en.json?localeStructure') return schema();
      throw Error(`Unexpected locale dependency: ${name}`);
    });
    expectExact(fixture, packed);
    expect(generated.startsWith('const p0=')).toBe(mode === 'repeated');
  }
);
