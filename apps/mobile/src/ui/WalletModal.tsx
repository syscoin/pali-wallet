import React, { createContext, useContext, useId, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { Animated, AppState, BackHandler, Modal, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { WalletModalState, type WalletModalEntry } from './walletModalState';
import { registerWalletModalHost } from './WalletBackHandler';

const Host = createContext<WalletModalState<React.ReactNode> | null>(null);
const Parent = createContext<string | null>(null);
type Props = Readonly<{
  children: React.ReactNode;
  visible?: boolean;
  transparent?: boolean;
  animationType?: 'none' | 'slide' | 'fade';
  onRequestClose(): void;
}>;

function Layer({ entry, top }: { entry: WalletModalEntry<React.ReactNode>; top: boolean }) {
  const [progress] = useState(() => new Animated.Value(entry.animation === 'none' ? 1 : 0));
  const { height } = useWindowDimensions();
  useLayoutEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration: 200, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [progress]);
  return <View style={s.layer} pointerEvents={top ? 'auto' : 'none'} accessibilityElementsHidden={!top}
    importantForAccessibility={top ? 'auto' : 'no-hide-descendants'}>
    <Animated.View accessibilityViewIsModal style={[s.layer, !entry.transparent && s.opaque,
      entry.animation === 'slide' ? { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] }
        : entry.animation === 'fade' ? { opacity: progress } : undefined]}>
      <Parent.Provider value={entry.id}>{entry.content}</Parent.Provider>
    </Animated.View>
  </View>;
}

function Frame({ state, children }: { state: WalletModalState<React.ReactNode>; children: React.ReactNode }) {
  const entries = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot);
  useLayoutEffect(() => {
    if (!entries.length) return;
    const back = BackHandler.addEventListener('hardwareBackPress', state.requestClose);
    const activity = AppState.addEventListener('change', value => { if (value === 'background') state.dismissAll(); });
    return () => { back.remove(); activity.remove(); };
  }, [state, entries]);
  const covered = entries.length > 0;
  return <View style={s.root}>
    <View style={s.root} pointerEvents={covered ? 'none' : 'auto'} accessibilityElementsHidden={covered}
      importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}>{children}</View>
    {entries.map((entry, index) => <Layer key={entry.id} entry={entry} top={index === entries.length - 1} />)}
  </View>;
}

/** Android sheets share the app window, so opening one never causes app blur. */
export function WalletModalHost({ children }: { children: React.ReactNode }) {
  const [state] = useState(() => new WalletModalState<React.ReactNode>());
  useLayoutEffect(() => {
    if (Platform.OS !== 'android') return;
    return registerWalletModalHost(state);
  }, [state]);
  if (Platform.OS !== 'android') return <>{children}</>;
  return <Host.Provider value={state}><Frame state={state}>{children}</Frame></Host.Provider>;
}

export function WalletModal({ visible = true, transparent = false, animationType = 'none', onRequestClose, children }: Props) {
  const state = useContext(Host), parent = useContext(Parent), id = useId();
  useLayoutEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!state) throw new Error('WalletModal requires WalletModalHost');
    if (visible) state.set({ id, parent, content: children, close: onRequestClose, transparent, animation: animationType });
    else state.remove(id);
  }, [state, id, parent, visible, children, onRequestClose, transparent, animationType]);
  useLayoutEffect(() => () => { state?.remove(id); }, [state, id]);
  if (Platform.OS === 'android') return null;
  return <Modal visible={visible} transparent={transparent} animationType={animationType} onRequestClose={onRequestClose}>{children}</Modal>;
}

const s = StyleSheet.create({ root: { flex: 1 }, layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, opaque: { backgroundColor: '#07121f' } });
