import React, { useLayoutEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import type { SeedBackupPresentation } from '../custody/seedBackup';
import { copyNativeSecret } from '../platform/secretClipboard';
import { useNativeTranslation } from '../platform/localization';
import { Button, styles, Text } from '../ui';

/** This control receives the existing words presentation, never a secret-reading capability. */
export function NativeSeedPhraseCopy({ presentation, isCurrent }: {
  presentation: SeedBackupPresentation;
  isCurrent(presentation: SeedBackupPresentation): boolean;
}) {
  const { t } = useNativeTranslation();
  const owner = useRef({ live: false, copying: false });
  const [feedback, setFeedback] = useState<{ id: string; state: 'idle' | 'copying' | 'copied' | 'failed' }>({ id: presentation.id, state: 'idle' });
  const state = feedback.id === presentation.id ? feedback.state : 'idle';
  useLayoutEffect(() => {
    const current = { live: true, copying: false };
    owner.current = current;
    const retire = () => {
      if (!current.live || owner.current !== current) return;
      current.live = false; current.copying = false;
      setFeedback({ id: presentation.id, state: 'idle' });
    };
    const change = AppState.addEventListener('change', next => { if (next !== 'active') retire(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', retire) : undefined;
    return () => { current.live = false; current.copying = false; change.remove(); blur?.remove(); };
  }, [presentation]);
  const copy = async () => {
    const current = owner.current;
    const active = () => {
      try {
        return current.live && owner.current === current &&
          AppState.currentState === 'active' && isCurrent(presentation) === true;
      } catch { return false; }
    };
    if (current.copying || !active()) return;
    current.copying = true; setFeedback({ id: presentation.id, state: 'copying' });
    try {
      await copyNativeSecret(() => presentation.words.join(' '), active);
      if (active()) setFeedback({ id: presentation.id, state: 'copied' });
    } catch {
      if (active()) setFeedback({ id: presentation.id, state: 'failed' });
    } finally {
      if (current.live && owner.current === current) {
        current.copying = false;
        setFeedback(previous => previous.id === presentation.id && previous.state === 'copying' ? { id: presentation.id, state: 'idle' } : previous);
      }
    }
  };
  return <>
    <Text style={styles.muted}>{t('secretClipboard.warning')}</Text>
    <Button title={t('secretClipboard.copyPhrase')} icon={state === 'copied' ? 'check' : 'copy'}
      variant="secondary" size="compact" disabled={state === 'copying'} onPress={copy} />
    {state === 'copied' && <Text accessibilityLiveRegion="polite">{t('components.copied')}</Text>}
    {state === 'failed' && <Text accessibilityRole="alert" accessibilityLiveRegion="polite">{t('transactions.copyFailed')}</Text>}
  </>;
}
