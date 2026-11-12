import { useNativeTranslation } from '../platform/localization';
import React, { useLayoutEffect, useRef } from 'react';
import { AppState, Platform, Switch } from 'react-native';
import { reloadBalancePrivacy, saveBalancePrivacy, useBalancePrivacy } from '../platform/balancePrivacy';
import { isNativeCredentialPromptActive } from '../platform/credential';
import { Button, colors, Row, Text } from '../ui';

/** The same device-wide display preference for wallet and watch sessions. */
export function BalancePrivacySetting() {
  const { t } = useNativeTranslation();
  const privacy = useBalancePrivacy();
  const lifetime = useRef<{ mounted: boolean; request: AbortController | null }>({ mounted: true, request: null });
  useLayoutEffect(() => {
    const owner = lifetime.current; owner.mounted = true;
    const cancelUnlessOwned = () => {
      if (owner.request && !isNativeCredentialPromptActive(owner.request.signal)) owner.request.abort();
    };
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') cancelUnlessOwned();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', cancelUnlessOwned) : null;
    return () => { owner.mounted = false; owner.request?.abort(); listener.remove(); blur?.remove(); };
  }, []);
  const save = async (hidden: boolean) => {
    const owner = lifetime.current;
    if (!owner.mounted || owner.request || privacy.status !== 'ready' || AppState.currentState !== 'active') return;
    const request = new AbortController(); owner.request = request;
    const check = () => {
      if (!owner.mounted || owner.request !== request || request.signal.aborted ||
          AppState.currentState !== 'active' && !isNativeCredentialPromptActive(request.signal)) throw Error('CANCELLED');
    };
    try { await saveBalancePrivacy(hidden, request.signal, check); }
    finally { request.abort(); if (owner.request === request) owner.request = null; }
  };
  return <>
    <Row title={t('mobile.generalViews.privacyMode')} subtitle={t('mobile.generalViews.hideBalances')} icon="eye" right={<Switch
      accessibilityLabel={t('mobile.generalViews.hideBalances')} value={privacy.hidden}
      disabled={privacy.status !== 'ready'} trackColor={{ true: colors.pink }}
      onValueChange={hidden => { void save(hidden); }} />} />
    {privacy.status === 'unavailable' && <>
      <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 14, lineHeight: 21 }}>{t('mobile.generalViews.privacyUnavailable')}</Text>
      <Button icon="refresh" title={t('mobile.generalViews.retryPrivacy')} variant="secondary" onPress={() => void reloadBalancePrivacy()} />
    </>}
  </>;
}
