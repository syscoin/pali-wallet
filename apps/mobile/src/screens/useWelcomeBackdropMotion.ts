import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, Platform } from 'react-native';

/** Decorative only: retain the centered static artwork until motion is permitted. */
export function useWelcomeBackdropMotion() {
  const [progress] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    let live = true, reduced = true, focused = true, preferenceRevision = 0;
    let state = AppState.currentState;
    let animation: Animated.CompositeAnimation | undefined;
    const stop = () => {
      animation?.stop(); animation = undefined;
      progress.setValue(0.5);
    };
    const update = () => {
      if (!live || reduced || !focused || state !== 'active') { stop(); return; }
      if (animation) return;
      const timing = (toValue: number) => Animated.timing(progress, {
        toValue, duration: 8000, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false,
      });
      animation = Animated.loop(Animated.sequence([timing(1), timing(0)]));
      animation.start();
    };
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      preferenceRevision++; reduced = value; update();
    });
    const observedRevision = preferenceRevision;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!live || preferenceRevision !== observedRevision) return;
      reduced = value; update();
    }).catch(() => { /* Keep the static artwork if the preference is unavailable. */ });
    const app = AppState.addEventListener('change', value => { state = value; update(); });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => { focused = false; update(); }) : undefined;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => { focused = true; update(); }) : undefined;
    return () => { live = false; stop(); preference.remove(); app.remove(); blur?.remove(); focus?.remove(); };
  }, [progress]);
  return useMemo(() => ({
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-2, 2] }) }],
  }), [progress]);
}
