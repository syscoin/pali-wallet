import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { RealTab, ShellLeafNavigation } from './RealAppShell';
import { TabDeparture } from '../navigation/tabDeparture';

export function useRealShell(scope: string | null, currentScope: () => string | null, exit: () => void) {
  const [view, setView] = useState<{ scope: string | null; tab: RealTab; immersive: boolean }>({ scope, tab: 'wallet', immersive: false });
  if (view.scope !== scope) setView({ scope, tab: 'wallet', immersive: false });
  const { tab, immersive } = view;
  const selected = useRef(tab);
  const [gate] = useState(() => new TabDeparture());
  const back = useRef<(() => boolean) | null>(null);
  const leave = useRef<((navigate: () => void) => void) | null>(null);
  const current = useRef(currentScope), onExit = useRef(exit);
  useLayoutEffect(() => { current.current = currentScope; onExit.current = exit; selected.current = tab; });
  useLayoutEffect(() => { gate.invalidate(); }, [gate, scope]);
  useLayoutEffect(() => () => gate.invalidate(), [gate]);
  const navigate = useCallback((next: RealTab, savePosition: boolean) => {
    if (selected.current === next) { gate.invalidate(); return; }
    const captured = current.current();
    if (!captured || AppState.currentState !== 'active') return;
    gate.request(captured, () => AppState.currentState === 'active' ? current.current() : null, savePosition ? leave.current : null, () => {
      selected.current = next; back.current = null; leave.current = null; setView((previous) => ({ ...previous, immersive: false, tab: next }));
    });
  }, [gate]);
  const select = useCallback((next: RealTab) => navigate(next, true), [navigate]);
  const finishLeave = useCallback((next: RealTab) => navigate(next, false), [navigate]);
  // Only the session owner uses this after checking its captured flow context.
  const restoreRoot = useCallback((next: RealTab, identity: string) => {
    if (AppState.currentState !== 'active') return;
    gate.invalidate(); selected.current = next; back.current = null; leave.current = null;
    setView({ scope: identity, tab: next, immersive: false });
  }, [gate]);
  const registerBack = useCallback((handler: () => boolean) => { back.current = handler; return () => { if (back.current === handler) back.current = null; }; }, []);
  const registerLeave = useCallback((handler: (navigate: () => void) => void) => { leave.current = handler; return () => { if (leave.current === handler) leave.current = null; }; }, []);
  const setImmersive = useCallback((value: boolean) => { setView((previous) => previous.immersive === value ? previous : { ...previous, immersive: value }); }, []);
  const navigation = useMemo<ShellLeafNavigation>(() => ({ registerBack, registerLeave, setImmersive }), [registerBack, registerLeave, setImmersive]);
  const goBack = () => {
    if (back.current?.()) return;
    if (current.current() && tab !== 'wallet') select('wallet'); else onExit.current();
  };
  return { tab, select, finishLeave, restoreRoot, immersive, navigation, goBack };
}
