import React from 'react';
import { View, TextInput, Pressable, type PressableProps, type TextInputProps } from 'react-native';
import { beginIdleInteraction, recordIdleActivity } from '../platform/security';
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
  return <Pressable {...props} ref={ref} onPressIn={(event) => { if (beginIdleInteraction()) props.onPressIn?.(event); }}
    onPress={(event) => { if (recordIdleActivity()) props.onPress?.(event); }} />;
});
