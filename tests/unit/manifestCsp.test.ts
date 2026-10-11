import fs from 'fs';
import path from 'path';

import { MV3_OPTIONS } from '../../source/config/consts';

const root = path.resolve(__dirname, '../..');
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);
const directives = new Map<string, string[]>(
  manifest.content_security_policy.extension_pages
    .split(';')
    .filter((directive: string) => directive.trim())
    .map((directive: string) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    })
);

describe('Trezor Suite Desktop manifest policy', () => {
  it('ships the same production policy and version as the source configuration', () => {
    expect(manifest).toEqual({ ...MV3_OPTIONS, version: packageJson.version });
    expect(MV3_OPTIONS.version).toBe(packageJson.version);
  });

  it('limits the plaintext websocket exception to the exact Suite endpoint', () => {
    expect(directives.get('connect-src')).toEqual([
      "'self'",
      'https:',
      'wss:',
      'ws://127.0.0.1:21335/connect-ws',
    ]);
  });

  it('retains the script, object, image, style and font restrictions', () => {
    expect([...directives.keys()]).toEqual([
      'script-src',
      'object-src',
      'connect-src',
      'img-src',
      'style-src',
      'font-src',
    ]);
    expect(directives.get('script-src')).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
    ]);
    expect(directives.get('object-src')).toEqual(["'self'"]);
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'https:']);
    expect(directives.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(directives.get('font-src')).toEqual(["'self'", 'data:']);
  });
});
