import React, { useCallback, useState } from 'react';
import type { NativePrivateAuthenticationScope } from '../../src/custody/privateAuthentication';
import { NativeNoteImport } from '../../src/screens/NativeNoteImport';
import { Button, Screen, Text } from '../../src/ui';

const query = new URLSearchParams(window.location.search);
// Public sample only. No real vault, public service or signer is available here.
export function NativeNoteImportFixture() {
  const [closed, setClosed] = useState(false);
  const open = useCallback(async (check: () => void, _authentication: NativePrivateAuthenticationScope) => {
    check();
    return {
      async importNote() {
        await new Promise((resolve) => setTimeout(resolve, 60));
        check();
        if (query.has('not-found')) throw new Error('privacy_note_not_found');
        return {
          amount: '1',
          phase: query.has('spent')
            ? ('spent' as const)
            : ('verified' as const),
        };
      },
      async dispose() {},
    };
  }, []);
  return closed ? (
    <Screen>
      <Text accessibilityRole="header">Private notes</Text>
      <Button title="Import one note" onPress={() => setClosed(false)} />
    </Screen>
  ) : (
    <NativeNoteImport openImport={open} onBack={() => setClosed(true)} />
  );
}
