import { IdlePressable } from './screens/IdleActivityBoundary';
import React, { useLayoutEffect, useRef } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text as NativeText,
  TextProps,
  View,
  ViewProps,
  StyleProp,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Mask, Path, Pattern, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

export const colors = {
  bg: '#07152a',
  surface: '#111e33',
  raised: '#162742',
  border: '#263950',
  controlBorder: '#657d9b',
  text: '#f5f7fb',
  muted: '#9caec5',
  pink: '#ff3e91',
  blue: '#75c8ed',
  green: '#74d5b1',
  red: '#ff8a9a',
  amber: '#edc58c',
} as const;

/** Static native vector decoration; no images, requests or animation work. */
export function WelcomeBackdrop() {
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
    <Svg width="100%" height="100%" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <RadialGradient id="welcome-glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#8c5f9c" stopOpacity="0.25" />
          <Stop offset="0.5" stopColor="#6b5f91" stopOpacity="0.18" />
          <Stop offset="1" stopColor="#6b5f91" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="welcome-blue-glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#4f91bd" stopOpacity="0.09" />
          <Stop offset="0.5" stopColor="#4f91bd" stopOpacity="0.045" />
          <Stop offset="1" stopColor="#4f91bd" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="welcome-dot-fade" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="white" stopOpacity="0.55" />
          <Stop offset="0.5" stopColor="white" stopOpacity="0.25" />
          <Stop offset="1" stopColor="white" stopOpacity="0" />
        </RadialGradient>
        <Pattern id="welcome-dots" width="18.7" height="18.7" patternUnits="userSpaceOnUse">
          <Circle cx="9.35" cy="9.35" r="0.9" fill={colors.blue} />
        </Pattern>
        <Mask id="welcome-mask" x="0" y="0" width="390" height="844" maskUnits="userSpaceOnUse">
          <Ellipse cx="195" cy="336" rx="143" ry="205" fill="url(#welcome-dot-fade)" />
        </Mask>
      </Defs>
      <Ellipse cx="195" cy="340" rx="140" ry="260" fill="url(#welcome-glow)" />
      <Ellipse cx="195" cy="340" rx="85" ry="230" fill="url(#welcome-blue-glow)" />
      <Rect width="390" height="844" fill="url(#welcome-dots)" mask="url(#welcome-mask)" />
    </Svg>
  </View>;
}

export function Text({ style, ...props }: TextProps) {
  return (
    <NativeText allowFontScaling {...props} style={[styles.text, style]} />
  );
}

type IconProps = { name: string; size?: number; color?: string };

const iconPaths: Record<string, string[]> = {
  'arrow-left': ['M19 12H5', 'm12 5-7 7 7 7'],
  'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
  'arrow-up-right': ['M6 18 18 6', 'M6 6h12v12'],
  'arrow-down-left': ['M18 6 6 18', 'M6 6v12h12'],
  'chevron-right': ['m9 5 7 7-7 7'],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-up': ['m6 15 6-6 6 6'],
  edit: ['m16 3 5 5-12 12-6 1 1-6L16 3Z', 'm14 5 5 5'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7v5l3 2'],
  filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  plus: ['M12 5v14', 'M5 12h14'],
  wallet: [
    'M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v11H6a3 3 0 0 1-3-3V6',
    'M20 12h-5v5h5',
  ],
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  settings: [
    'm9.4 3-.7 2.1-2 .9-2-.4-1.7 3 1.5 1.7v2.3L3 14.3l1.7 3 2-.4 2 .9.7 2.2h3.4l.7-2.2 2-.9 2 .4 1.7-3-1.5-1.7v-2.3l1.5-1.7-1.7-3-2 .4-2-.9L12.8 3z',
    'M14.5 11.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  ],
  copy: [
    'M9 8H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4',
    'M10 2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z',
  ],
  share: [
    'M12 16V3',
    'm7 8 5-5 5 5',
    'M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
  ],
  check: ['m5 12 4 4L19 6'],
  lock: ['M7 10V7a5 5 0 0 1 10 0v3', 'M5 10h14v11H5z', 'M12 14v3'],
  key: ['M14 4a6 6 0 1 1-4.6 9.9L3 20v-4l3-3h3.2A6 6 0 0 1 14 4Z', 'M16 8h.01'],
  backspace: ['M9 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-7-7 7-7Z', 'm12 9 6 6', 'm18 9-6 6'],
  'face-id': ['M4 9V5a1 1 0 0 1 1-1h4', 'M15 4h4a1 1 0 0 1 1 1v4', 'M20 15v4a1 1 0 0 1-1 1h-4', 'M9 20H5a1 1 0 0 1-1-1v-4', 'M8 9v2', 'M16 9v2', 'M12 9v5h-1', 'M8 16c2 2 6 2 8 0'],
  fingerprint: ['M4 9a8 8 0 0 1 16 0', 'M7 21c2-3 2-6 2-9a3 3 0 0 1 6 0c0 4-1 7-2 10', 'M3 16c1-1 1-3 1-4', 'M6 17c1-2 0-4 0-5a6 6 0 0 1 12 0c0 3 0 5-1 8', 'M10 22c2-4 2-6 2-10', 'M21 12c0 2 0 3-1 5'],
  shield: ['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z', 'm8 12 3 3 5-6'],
  'shield-warning': ['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z', 'M12 8v5', 'M12 16h.01'],
  torch: ['M8 3h8v4l-2 3v10h-4V10L8 7V3Z', 'M8 7h8', 'M10 13h4'],
  eye: [
    'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  ],
  refresh: [
    'M20 7v5h-5',
    'M4 17v-5h5',
    'M6.1 7a7 7 0 0 1 11.5-1L20 9',
    'm4 15 2.4 3A7 7 0 0 0 17.9 17',
  ],
  globe: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    'M3 12h18',
    'M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18',
  ],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 11v6', 'M12 7h.01'],
  scan: ['M8 3H3v5', 'M16 3h5v5', 'M21 16v5h-5', 'M3 16v5h5', 'M7 8h10v8H7z'],
  help: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4',
    'M12 17h.01',
  ],
  external: [
    'M14 3h7v7',
    'M10 14 21 3',
    'M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5',
  ],
  trash: ['M3 6h18', 'M9 6V3h6v3', 'M5 6l1 15h12l1-15', 'M10 10v7', 'M14 10v7'],
};

export function Icon({ name, size = 22, color = colors.text }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <G
        stroke={color}
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {(iconPaths[name] || iconPaths.info || []).map((d, index) => (
          <Path key={index} d={d} />
        ))}
      </G>
    </Svg>
  );
}

export function PaliMark({ size = 34 }: { size?: number }) {
  return (
    <Image
      source={require('../../../source/assets/all_assets/favicon-128.png')}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessible={false}
    />
  );
}

export function Coin({ id, size = 42, fallbackSymbol }: { id: string; size?: number; fallbackSymbol?: string }) {
  const token = id.toLowerCase();
  if (['syscoin', 'syscoin-nevm', 'syscoin-nevm-testnet', 'sys', 'tsys', 'nevm'].includes(token)) {
    return (
      <Image
        source={require('../assets/syscoin.png')}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        resizeMode="contain"
        accessible={false}
      />
    );
  }
  // Reuse the extension's bundled vector artwork; no remote icon requests.
  if (token === 'rollux') return <Svg width={size} height={size} viewBox="0 0 40 40" accessible={false}>
    <Circle cx="20" cy="20" r="20" fill="#000000" />
    <Polygon points="10.59 10.59 11.34 10.59 29.28 27.03 29.28 29.28 10.59 29.28 10.59 10.59" fill="#dbef88" />
    <Path d="m24.74,21.44c0.51-1.01,0.81-2.16,0.81-3.38,0-4.13-3.35-7.48-7.48-7.48-1.45,0-2.8,0.41-3.95,1.12l10.62,9.73Z" fill="#dbef88" />
  </Svg>;
  if (token === 'zksys-testnet') return <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
    <Circle cx="24" cy="24" r="24" fill="#292117" />
    <G transform="translate(5 15.16) scale(0.04292)">
      <Path d="M0.580331 338.968L336.527 77.7306H0.531929V0H472.984V206.282L763.356 0H882.479L644.548 170.814L885.38 411.066H778.951L584.032 214.503L502.022 273.617H395.254V131.501L134.113 333.335H369.65H395.254H472.984V411.066H2.12219e-05L0.580331 338.968Z" fill="#F7931A" />
    </G>
  </Svg>;
  let graphic: React.ReactNode;
  if (token === 'bitcoin' || token === 'btc') {
    graphic = (
      <>
        <Circle cx="24" cy="24" r="24" fill="#f7931a" />
        <G
          transform="rotate(12 24 24)"
          stroke="white"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        >
          <Path d="M18 12v24m5-27v6m5-6v6m-5 20v5m5-5v5M14 15h13c9 0 9 10 0 10H18m-4 0h14c10 0 10 11 0 11H14" />
        </G>
      </>
    );
  } else if (token === 'ethereum' || token === 'eth') {
    graphic = (
      <>
        <Circle cx="24" cy="24" r="24" fill="#2b3457" />
        <Polygon points="24,6 13,24 24,30 35,24" fill="#d7dcff" />
        <Polygon points="24,6 24,30 35,24" fill="#8d9dcb" />
        <Polygon points="13,27 24,43 35,27 24,33" fill="#d7dcff" />
        <Polygon points="24,33 24,43 35,27" fill="#8d9dcb" />
      </>
    );
  } else if (token === 'base') {
    graphic = (
      <>
        <Circle cx="24" cy="24" r="24" fill="#0052ff" />
        <Circle cx="24" cy="24" r="14" fill="white" />
        <Path d="M8 24h24" stroke="#0052ff" strokeWidth={3.8} />
      </>
    );
  } else if (token === 'arbitrum' || token === 'arb') {
    graphic = (
      <>
        <Circle cx="24" cy="24" r="24" fill="#173246" />
        <Path
          d="m24 6 15 9v18l-15 9-15-9V15Z"
          fill="#213147"
          stroke="#a8d8ec"
          strokeWidth={1.7}
        />
        <Path d="m23 15 13 20-6 3-10-16Z" fill="#28a0f0" />
        <Path d="m26 11 11 17v-9l-7-10Z" fill="#7bc7fa" />
        <Path d="m22 15-11 19 6 4 9-16Z" fill="white" />
      </>
    );
  } else if (token === 'usdc') {
    graphic = (
      <>
        <Circle cx="24" cy="24" r="24" fill="#2775ca" />
        <G fill="none" stroke="white" strokeWidth={1.8} strokeLinecap="round">
          <Path d="M13 12a16 16 0 0 0 0 24M35 12a16 16 0 0 1 0 24M30 17c-1-2-4-3-6-3-8 0-8 9 0 10s8 10 0 10c-3 0-6-2-6-4M24 10v4m0 20v4" />
        </G>
      </>
    );
  } else if (fallbackSymbol) {
    return <View accessible={false} style={{ width: size, height: size, borderRadius: size / 2,
      backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: colors.muted, fontSize: size * 0.24, fontWeight: '700' }}>{fallbackSymbol.slice(0, 5)}</Text>
    </View>;
  } else {
    graphic = (
      <>
        <Circle cx="24" cy="24" r="24" fill={colors.raised} />
        <Path
          d="M19 18a5 5 0 0 1 10 0c0 4-5 4-5 8m0 6h.01"
          fill="none"
          stroke={colors.muted}
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessible={false}>
      {graphic}
    </Svg>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void | Promise<void>;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  disabled?: boolean;
  expanded?: boolean;
  icon?: string | React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  size?: 'regular' | 'compact';
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  expanded,
  icon,
  style,
  testID,
  size = 'regular',
}: ButtonProps) {
  const foreground =
    variant === 'primary'
      ? colors.bg
      : variant === 'danger'
      ? colors.red
      : variant === 'quiet'
      ? colors.blue
      : colors.text;
  return (
    <IdlePressable
      accessibilityRole="button"
      accessibilityState={{ disabled, expanded }}
      aria-expanded={expanded}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        size === 'compact' && styles.compactButton,
        variant === 'primary' && { backgroundColor: colors.pink },
        variant === 'secondary' && {
          backgroundColor: colors.raised,
          borderWidth: 1,
          borderColor: colors.controlBorder,
        },
        variant === 'quiet' && [styles.compactButton, { backgroundColor: 'transparent' }],
        variant === 'danger' && {
          backgroundColor: '#302032',
          borderWidth: 1,
          borderColor: '#633447',
        },
        disabled && { opacity: 0.42 },
        pressed && !disabled && { opacity: 0.72, transform: [{ scale: 0.99 }] },
        style,
      ]}
    >
      {typeof icon === 'string' ? (
        <Icon name={icon} size={20} color={foreground} />
      ) : (
        icon
      )}
      <Text
        style={{
          color: foreground,
          fontWeight: '700',
          fontSize: 15,
          lineHeight: 22,
          textAlign: 'center',
          flexShrink: 1,
          minWidth: 0,
        }}
      >
        {title}
      </Text>
    </IdlePressable>
  );
}

/** A mutually exclusive view filter, kept together even on narrow screens. */
export function SegmentedControl<T extends string>({
  label, value, options, onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange(value: T): void;
}) {
  return <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.segments}>
    {options.map((option) => <IdlePressable key={option.value} accessibilityRole="tab"
      accessibilityLabel={option.label} accessibilityState={{ selected: value === option.value }}
      aria-selected={value === option.value} onPress={() => onChange(option.value)}
      style={({ pressed }) => [styles.segment, value === option.value && styles.segmentSelected, pressed && { opacity: 0.75 }]}>
      <Text style={[styles.segmentLabel, value === option.value && { color: colors.bg }]}>{option.label}</Text>
    </IdlePressable>)}
  </View>;
}

export function IconButton({ label, icon, onPress, disabled = false, selected = false, testID }: {
  label: string; icon: string; onPress(): void | Promise<void>; disabled?: boolean; selected?: boolean; testID?: string;
}) {
  return <IdlePressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} testID={testID}
    style={({ pressed }) => [styles.iconButton, selected && { backgroundColor: colors.raised }, (pressed || disabled) && { opacity: disabled ? 0.42 : 0.7 }]}>
    <Icon name={icon} color={selected ? colors.blue : colors.muted} size={21} />
  </IdlePressable>;
}

export function Card({ children, style, ...props }: ViewProps) {
  return (
    <View {...props} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function Screen({
  children,
  footer,
  footerScrollable = false,
  gap = 22,
  scrollResetKey,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  footerScrollable?: boolean;
  gap?: number;
  scrollResetKey?: string;
}) {
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useLayoutEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [scrollResetKey]);
  const { width } = useWindowDimensions();
  const gutter = width < 370 ? 16 : 20;
  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingTop: 10,
          paddingBottom: 26,
          gap,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? (
        footerScrollable ? (
          <ScrollView
            style={{ flexGrow: 0, maxHeight: '60%' }}
            contentContainerStyle={[styles.footer, { paddingHorizontal: gutter }]}
            keyboardShouldPersistTaps="handled"
          >
            {footer}
          </ScrollView>
        ) : <View style={[styles.footer, { paddingHorizontal: gutter }]}>{footer}</View>
      ) : null}
    </View>
  );
}

export function Header({
  title,
  onBack,
  right,
  subtitle,
  brand = false,
}: {
  title: string;
  onBack?: () => void;
  right?: React.ReactNode;
  subtitle?: string;
  brand?: boolean;
}) {
  return (
    <View style={styles.header}>
      {brand && <PaliMark size={32} />}
      {onBack ? (
        <IdlePressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={6}
          style={({ pressed }) => [
            styles.iconButton,
            { marginLeft: -10, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <Icon name="arrow-left" />
        </IdlePressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text
          accessibilityRole="header"
          style={{
            fontSize: onBack || brand ? 21 : 28,
            lineHeight: onBack || brand ? 28 : 34,
            fontWeight: '700',
            letterSpacing: -0.7,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  icon,
  right,
  onPress,
  last = false,
  dense = false,
}: {
  title: string;
  subtitle?: string;
  icon?: string | React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  dense?: boolean;
}) {
  const content = (
    <>
      {icon ? (
        <View style={styles.rowIcon}>
          {typeof icon === 'string' ? (
            <Icon name={icon} size={21} color={colors.blue} />
          ) : (
            icon
          )}
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={{ fontSize: 15, lineHeight: 22, fontWeight: '500' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: 13, lineHeight: 19, color: colors.muted }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && !right ? (
        <Icon name="chevron-right" size={18} color={colors.muted} />
      ) : null}
    </>
  );
  const rowStyle = [
    styles.row,
    dense && { minHeight: 58, paddingVertical: 10 },
    !last && styles.rowBorder,
  ];
  if (onPress)
    return (
      <IdlePressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          rowStyle,
          pressed && { backgroundColor: colors.raised },
        ]}
      >
        {content}
      </IdlePressable>
    );
  return <View style={rowStyle}>{content}</View>;
}

export function Notice({
  title,
  body,
  tone = 'blue',
}: {
  title: string;
  body?: string;
  tone?: 'blue' | 'amber' | 'red';
}) {
  const accent = colors[tone];
  return (
    <View
      style={[
        styles.notice,
        {
          borderColor:
            tone === 'red'
              ? '#633447'
              : tone === 'amber'
              ? '#4a4136'
              : colors.border,
        },
      ]}
    >
      <Icon
        name={tone === 'red' ? 'shield' : 'info'}
        color={accent}
        size={19}
      />
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          style={{
            color: accent,
            fontSize: 13,
            lineHeight: 19,
            fontWeight: '600',
          }}
        >
          {title}
        </Text>
        {body ? (
          <Text style={{ fontSize: 12, lineHeight: 19, color: colors.muted }}>
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionHeading}>{children}</Text>;
}

export const styles = StyleSheet.create({
  text: { color: colors.text, fontSize: 15, lineHeight: 22 },
  walletBalanceLong: { fontSize: 24, lineHeight: 34, letterSpacing: -0.4 },
  walletBalancePrecise: { fontSize: 19, lineHeight: 29, letterSpacing: -0.2 },
  screen: { flex: 1, backgroundColor: colors.bg },
  button: {
    minHeight: 52,
    paddingHorizontal: 19,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  compactButton: { minHeight: 48, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  segments: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: 16, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  segment: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 6, paddingVertical: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  segmentSelected: { backgroundColor: colors.blue },
  segmentLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    gap: 10,
  },
  header: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 18,
    paddingVertical: 16,
    minHeight: 72,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row',
    gap: 11,
    padding: 16,
    borderRadius: 17,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  input: {
    minHeight: 56,
    backgroundColor: colors.surface,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    lineHeight: 24,
  },
  sectionHeading: {
    fontSize: 12,
    lineHeight: 19,
    fontWeight: '600',
    letterSpacing: 1.2,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  split: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  muted: { color: colors.muted },
  h1: { fontSize: 32, lineHeight: 40, fontWeight: '700', letterSpacing: -1.1 },
});
