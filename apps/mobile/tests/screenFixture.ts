import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import ts from 'typescript';

export type ScreenElement = { type: unknown; props: Record<string, any>; children: unknown[] };
type Cell = { value?: any; deps?: readonly unknown[]; cleanup?: () => void; setter?: (next: unknown) => void };
export function screenElements(value: unknown): ScreenElement[] {
  if (Array.isArray(value)) return value.flatMap(screenElements);
  if (!value || typeof value !== 'object' || !('type' in value)) return [];
  const element = value as ScreenElement;
  return [element, ...element.children.flatMap(screenElements), ...screenElements(element.props.footer)];
}

/** Execute actual screen handlers/effects with public DTOs and explicit native ports. */
export function screenFixture(file: URL, exported: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const cells: Cell[] = [], effects: (() => void)[] = [];
  let cursor = 0;
  const cell = () => cells[cursor++] ?? (cells[cursor - 1] = {});
  const react = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): ScreenElement => ({ type, props: props ?? {}, children }),
    useState(initial: unknown) {
      const c = cell();
      if (!Object.hasOwn(c, 'value')) c.value = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      c.setter ??= next => { c.value = typeof next === 'function' ? (next as (before: unknown) => unknown)(c.value) : next; };
      return [c.value, c.setter];
    },
    useRef(initial: unknown) { const c = cell(); c.value ??= { current: initial }; return c.value; },
    useMemo<T>(create: () => T, deps: readonly unknown[]) {
      const c = cell();
      if (!c.deps || deps.length !== c.deps.length || deps.some((d, i) => !Object.is(d, c.deps![i]))) { c.value = create(); c.deps = deps; }
      return c.value as T;
    },
    useCallback<T>(callback: T, deps: readonly unknown[]) { return react.useMemo(() => callback, deps); },
    useSyncExternalStore<T>(_subscribe: unknown, getSnapshot: () => T) { return getSnapshot(); },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const c = cell();
      if (deps && c.deps && deps.length === c.deps.length && deps.every((d, i) => Object.is(d, c.deps![i]))) return;
      c.deps = deps; effects.push(() => { c.cleanup?.(); c.cleanup = callback() || undefined; });
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) { react.useLayoutEffect(callback, deps); },
  };
  const module = { exports: {} as Record<string, (props: any) => ScreenElement> };
  const code = ts.transpileModule(readFileSync(new NodeURL(file.href), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Error, Date, setTimeout, clearTimeout, ...globals,
    require(name: string) { if (name === 'react') return react; assert(Object.hasOwn(imports, name), `Missing screen port: ${name}`); return imports[name]; } });
  return {
    render(props: any) { cursor = 0; const tree = module.exports[exported]!(props); effects.splice(0).forEach(run => run()); return tree; },
    close() { cells.forEach(c => c.cleanup?.()); },
  };
}
