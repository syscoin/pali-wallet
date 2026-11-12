import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL as NodeURL } from 'node:url';
import ts from 'typescript';
import type { SetStringOptions } from 'expo-clipboard';
import { SECRET_CLIPBOARD_LIFETIME_MS } from '../../../../source/shared/secretClipboard.ts';

export function nativeSecretClipboardFixture(write: (value: string, options: SetStringOptions) => Promise<boolean>) {
  const module = { exports: {} as { copyNativeSecret(read: () => string, isCurrent: () => boolean): Promise<void> } };
  const source = readFileSync(new NodeURL('../../src/platform/secretClipboard.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, { module, exports: module.exports, Date, Error, require(name: string) {
    if (name === 'expo-clipboard') return { setStringAsync: write, StringFormat: { PLAIN_TEXT: 'plainText' } };
    if (name === '../../../../source/shared/secretClipboard') return { SECRET_CLIPBOARD_LIFETIME_MS };
    throw Error(`Unexpected clipboard fixture dependency: ${name}`);
  } });
  return module.exports;
}
