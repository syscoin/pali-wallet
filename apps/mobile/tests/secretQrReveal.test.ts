import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';

test('secret QR needs an explicit toggle on a current reveal and has a public accessibility label', () => {
  const app = { currentState: 'active' };
  const screen = screenFixture(new URL('../src/screens/SecretQr.tsx', import.meta.url), 'SecretQrReveal', {
    'react-native': { AppState: app, StyleSheet: { create: (style: unknown) => style }, View: 'View', useWindowDimensions: () => ({ width: 360 }) },
    'react-native-qrcode-svg': 'QRCode',
    '../../../../source/utils/secretQr': {},
    '../ui': { Button: 'Button' },
    './QrScanner': {},
  });
  let current = true;
  const value = 'synthetic test value';
  const render = () => screenElements(screen.render({ value, children: 'text', isCurrent: () => current }));
  const toggle = () => render().find(node => node.type === 'Button')!.props.onPress();
  assert.equal(render().some(node => node.type === 'QRCode'), false);
  current = false;
  toggle();
  assert.equal(render().some(node => node.type === 'QRCode'), false);
  current = true;
  toggle();
  assert.equal(render().find(node => node.type === 'QRCode')?.props.value, value);
  assert(render().every(node => !String(node.props.accessibilityLabel).includes(value)));
  toggle();
  assert.equal(render().some(node => node.type === 'QRCode'), false);
  toggle();
  app.currentState = 'background';
  assert.equal(render().length, 0);
  app.currentState = 'active';
  current = false;
  assert.equal(render().length, 0);
  screen.close();
});
