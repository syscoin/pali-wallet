import React from 'react';

import { AppLoadingSkeleton } from 'components/Loader/AppLoadingSkeleton';
import { usePrivacyLocale } from 'utils/privacyLocale';

import Privacy from './Privacy';

export default function PrivacyEntry() {
  const ready = usePrivacyLocale();
  return ready ? <Privacy /> : <AppLoadingSkeleton />;
}
