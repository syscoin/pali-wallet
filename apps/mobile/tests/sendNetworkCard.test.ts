import assert from 'node:assert/strict';
import test from 'node:test';
import { screenElements, screenFixture } from './screenFixture.ts';
import { getNativeSendContext } from '../src/custody/networkContext.ts';

test('shared send network card renders the exact network and only a supplied Change action', () => {
  const view = screenFixture(new URL('../src/screens/SendNetworkCard.tsx', import.meta.url), 'SendNetworkCard', {
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value } },
    '../ui': { Button: 'Button', Card: 'Card', Coin: 'Coin', Text: 'Text', colors: {}, styles: {} },
  });
  const context = getNativeSendContext('ethereum');
  const plain = screenElements(view.render({ context, disabled: false }));
  assert.equal(plain.find(node => node.type === 'Coin')!.props.id, context.networkId);
  assert(plain.some(node => node.children.includes(context.name)));
  assert.equal(plain.some(node => node.type === 'Button'), false);
  let changes = 0;
  const button = screenElements(view.render({ context, disabled: true, onChange() { changes++; } })).find(node => node.type === 'Button')!;
  assert.equal(button.props.title, 'Change'); assert.equal(button.props.disabled, true);
  assert.equal(button.props.size, 'compact'); assert.equal(changes, 0);
  view.close();
});
