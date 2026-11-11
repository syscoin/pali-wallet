import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform } from 'react-native';

/** Visual feedback only. No credentials or authentication callbacks enter this hook. */
export function usePinErrorFeedback(error: string | undefined, busy: boolean, attemptKey: string | number) {
  const [offset] = useState(() => new Animated.Value(0));
  const [shaking, setShaking] = useState(false);
  const control = useRef<{
    update(error: string | undefined, busy: boolean, attemptKey: string | number): void;
    clear(): void;
  } | null>(null);
  useLayoutEffect(() => {
    let live = true, focused = true, reduced: boolean | undefined, preferenceRevision = 0;
    let appState = AppState.currentState;
    let pending = false, animation: Animated.CompositeAnimation | undefined;
    let previous: { error: string | undefined; busy: boolean; attemptKey: string | number } | undefined;
    const clear = () => {
      pending = false;
      const current = animation; animation = undefined;
      current?.stop(); offset.setValue(0);
      if (live) setShaking(false);
    };
    const start = () => {
      if (!live || !pending || reduced !== false || !focused || appState !== 'active') return;
      pending = false;
      const timing = (toValue: number, duration: number) => Animated.timing(offset, {
        toValue, duration, useNativeDriver: true, isInteraction: false,
      });
      const current = Animated.sequence([timing(-6, 45), timing(6, 60), timing(-4, 60), timing(3, 60), timing(0, 75)]);
      animation = current; setShaking(true);
      current.start(() => {
        if (!live || animation !== current) return;
        animation = undefined; offset.setValue(0); setShaking(false);
      });
    };
    const owner = {
      clear,
      update(nextError: string | undefined, nextBusy: boolean, nextAttempt: string | number) {
        const changedAttempt = previous?.attemptKey !== nextAttempt;
        const failure = !!nextError && !nextBusy &&
          (!previous || previous.busy || previous.error !== nextError || changedAttempt);
        previous = { error: nextError, busy: nextBusy, attemptKey: nextAttempt };
        clear();
        if (failure && reduced !== true && focused && appState === 'active') { pending = true; start(); }
      },
    };
    control.current = owner;
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      preferenceRevision++; reduced = value;
      if (value) clear(); else start();
    });
    const observedRevision = preferenceRevision;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!live || preferenceRevision !== observedRevision) return;
      reduced = value;
      if (value) clear(); else start();
    }).catch(() => { if (live) { reduced = true; clear(); } });
    const state = AppState.addEventListener('change', value => {
      appState = value;
      if (value !== 'active') clear();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { focused = false; clear(); }) : undefined;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => { focused = true; }) : undefined;
    return () => {
      live = false; clear();
      if (control.current === owner) control.current = null;
      preference.remove(); state.remove(); blur?.remove(); focus?.remove();
    };
  }, [offset]);
  useLayoutEffect(() => { control.current?.update(error, busy, attemptKey); }, [error, busy, attemptKey]);
  const clear = useCallback(() => control.current?.clear(), []);
  const style = useMemo(() => ({ transform: [{ translateX: offset }] }), [offset]);
  return { style, shaking, clear };
}
