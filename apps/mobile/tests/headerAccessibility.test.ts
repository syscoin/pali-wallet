import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { languageMessages } from './localizationFixture.ts';
import { screenElements, screenFixture } from './screenFixture.ts';

test('the shared Back control follows the chosen language and keeps its action', async () => {
  const i18n = createInstance();
  await i18n.init({ initImmediate: false, lng: 'en', fallbackLng: 'en',
    resources: { en: { translation: languageMessages('en') }, fr: { translation: languageMessages('fr') } } });
  const f = screenFixture(new URL('../src/ui.tsx', import.meta.url), 'Header', {
    './platform/localization': { useNativeTranslation: () => ({ t: i18n.t.bind(i18n) }) },
    './screens/IdleActivityBoundary': { IdlePressable: 'Pressable' },
    './screens/useWelcomeBackdropMotion': {},
    '../../../source/shared/assetIconIdentity': {},
    './portfolio/assetIconCache': {},
    'react-native': { View: 'View', StyleSheet: { create: (value: unknown) => value } },
    'react-native-svg': {},
  });
  let backs = 0;
  const props = { title: 'Security', onBack() { backs++; } };
  const control = () => screenElements(f.render(props)).find(node => node.type === 'Pressable')!;
  try {
    assert.equal(control().props.accessibilityLabel, 'Back');
    await i18n.changeLanguage('fr');
    assert.equal(control().props.accessibilityLabel, i18n.t('buttons.back'));
    assert.notEqual(control().props.accessibilityLabel, 'Back');
    control().props.onPress();
    assert.equal(backs, 1);
  } finally { f.close(); }
});
