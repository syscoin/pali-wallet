import React from 'react';
import type { NativeMessageReview } from '../connections/types';
import { colors, Notice, Text } from '../ui';

export function DappSiteStatus({ verification }: {
  verification: NativeMessageReview['verification'];
}) {
  if (verification.isScam)
    return <Notice title="Known security risk" body="WalletConnect flagged this website. This request is blocked." />;
  if (verification.validation === 'INVALID')
    return <Notice title="Website mismatch" body="The requesting website does not match the app’s claimed address. This request is blocked." />;
  if (verification.validation === 'UNKNOWN')
    return <Notice title="Unverified website" body="Check the website address before continuing." />;
  return <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18 }}>Website origin matched by WalletConnect</Text>;
}
