import { useNativeTranslation } from '../platform/localization';
import React from 'react';
import type { NativeMessageReview } from '../connections/types';
import { colors, Notice, Text } from '../ui';

export function DappSiteStatus({ verification, compact = false }: {
  verification: NativeMessageReview['verification'];
  compact?: boolean;
}) {
  const { t } = useNativeTranslation();
  if (verification.isScam)
    return <Notice title={t('mobile.generalViews.knownRisk')} body={t('mobile.generalViews.blockedSite')} />;
  if (verification.validation === 'INVALID')
    return <Notice title={t('mobile.generalViews.siteMismatch')} body={t('mobile.generalViews.mismatchBody')} />;
  if (verification.validation === 'UNKNOWN')
    return <Notice title={t('mobile.generalViews.unverifiedSite')} body={t('mobile.generalViews.checkOrigin')} compact={compact} />;
  return <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>{t('mobile.generalViews.matchedOrigin')}</Text>;
}
