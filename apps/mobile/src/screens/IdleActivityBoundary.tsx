import React, { useRef } from 'react';
import { View, TextInput, Pressable, type PressableProps, type TextInputProps } from 'react-native';
import { beginIdleInteraction, captureIdleInteraction, recordIdleActivity } from '../platform/security';
/** Capture before leaf actions; expired input cannot extend or use the retired session. */
export function IdleActivityBoundary({ children }: { children: React.ReactNode }) {
  const capture = (event: { stopPropagation(): void }) => { if (!beginIdleInteraction()) event.stopPropagation(); };
  const keyboard = typeof document === 'undefined' ? {} : { onKeyDownCapture: capture };
  return <View {...keyboard} style={{ flex: 1 }} onPointerDownCapture={capture} onTouchStartCapture={capture}>{children}</View>;
}
export const IdleTextInput = React.forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps>(function IdleTextInput(props, ref) {
  return <TextInput {...props} ref={ref} onChangeText={(value) => { if (recordIdleActivity()) props.onChangeText?.(value); }}
    onKeyPress={(event) => { if (beginIdleInteraction()) props.onKeyPress?.(event); }} />;
});

/** Press/keyboard/accessibility activation shares the same pre-action gate. */
export const IdlePressable = React.forwardRef<React.ComponentRef<typeof Pressable>, PressableProps>(function IdlePressable(props, ref) {
  const pending = useRef<(() => boolean) | null>(null);
  return <Pressable {...props} ref={ref} onPressIn={(event) => {
    const current = captureIdleInteraction(); pending.current = current;
    if (current()) props.onPressIn?.(event);
  }} onLongPress={props.onLongPress ? (event) => {
    const current = pending.current ?? captureIdleInteraction();
    if (current()) props.onLongPress?.(event);
  } : undefined} onPress={(event) => {
    // RN Pressability and RN Web deliver virtual clicks without press-in.
    // They are fresh activations, independent of any canceled pointer gesture.
    const native = event.nativeEvent as unknown as Record<string, unknown>;
    // Android's native accessibility click carries an empty event map; native
    // responder releases carry touch fields even when the event type is absent.
    const responder = 'identifier' in native || 'touches' in native || 'changedTouches' in native;
    const virtual = !native.pointerType && !responder &&
      (native.type === undefined || native.type === 'click' && (native.detail ?? 0) === 0);
    const current = virtual ? captureIdleInteraction() : pending.current ?? captureIdleInteraction();
    pending.current = null;
    if (current()) props.onPress?.(event);
  }} />;
});
