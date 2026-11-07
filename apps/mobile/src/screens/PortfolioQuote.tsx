import React from 'react';
import { StyleSheet } from 'react-native';
import { styles, Text } from '../ui';

/** Keep actions below the optional quote stable as its text becomes available. */
export function PortfolioQuote({ supported, quote, testID }: Readonly<{
  supported: boolean;
  quote: string | null;
  testID: string;
}>) {
  if (!supported) return null;
  return <Text style={[styles.muted, s.line]} numberOfLines={1}
    aria-hidden={!quote} accessibilityElementsHidden={!quote}
    importantForAccessibility={quote ? 'auto' : 'no-hide-descendants'}
    accessibilityLabel={quote ?? undefined} testID={quote ? testID : undefined}>
    {quote ?? '\u00a0'}
  </Text>;
}

const s = StyleSheet.create({ line: { alignSelf: 'stretch', textAlign: 'center' } });
