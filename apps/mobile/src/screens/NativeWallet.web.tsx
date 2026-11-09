import React from 'react';
import { Button, Header, Notice, Screen } from '../ui';
import { useNativeTranslation } from '../platform/localization';

import type { NativeWalletProps } from './NativeWallet.native';

export function NativeWalletScreen({ onExit }: NativeWalletProps) {
  const { t } = useNativeTranslation();
  return <Screen><Header title={t('mobile.setup.wallet')} />
    <Notice title={t('mobile.setup.nativeOnly')} body={t('mobile.setup.nativeOnlyDescription')} />
    <Button title={t('buttons.back')} onPress={onExit} />
  </Screen>;
}
