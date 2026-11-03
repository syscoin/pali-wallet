import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BackHandler,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import {
  Button,
  Card,
  Coin,
  Icon,
  Notice,
  PaliMark,
  Text,
  colors,
} from '../ui';
import {
  families,
  featureCoverage,
  getScreen,
  reviewStates,
  screens,
  type DesignRow,
  type FamilyId,
  type ReviewState,
  type ScreenSpec,
} from './catalog';

type AccountKind = 'personal' | 'watch' | 'hardware' | 'smart';
const accountKinds: {
  id: AccountKind;
  title: string;
  icon: string;
  detail: string;
}[] = [
  {
    id: 'personal',
    title: 'Personal',
    icon: 'wallet',
    detail: 'Wallet password or configured device unlock',
  },
  {
    id: 'watch',
    title: 'Watch-only',
    icon: 'eye',
    detail: 'Public account. Signing and sending unavailable.',
  },
  {
    id: 'hardware',
    title: 'Hardware',
    icon: 'shield',
    detail: 'Verify and approve on the connected device',
  },
  {
    id: 'smart',
    title: 'Smart account',
    icon: 'shield',
    detail: 'Use this account’s configured signing policy',
  },
];
const sampleWords = Array.from(
  { length: 12 },
  (_, i) => `word${String(i + 1).padStart(2, '0')}`
);
const QR_VALUE = 'PALI-DESIGN-NOT-PAYMENT';
const rootTabs = [
  { title: 'Wallet', icon: 'wallet', to: 'wallet.home', family: 'wallet' },
  {
    title: 'Activity',
    icon: 'activity',
    to: 'activity.list',
    family: 'activity',
  },
  { title: 'Tools', icon: 'plus', to: 'wallet.tools', family: 'tools' },
  {
    title: 'Settings',
    icon: 'settings',
    to: 'settings.home',
    family: 'settings',
  },
];
const blockedStates: Partial<
  Record<
    ReviewState,
    {
      title: string;
      body: string;
      icon: string;
      action: string;
      target: string;
    }
  >
> = {
  locked: {
    title: 'Your wallet is locked',
    body: 'Unlock Pali before viewing protected information or authorizing this request.',
    icon: 'lock',
    action: 'View unlock screen',
    target: 'onboarding.unlock',
  },
  changed: {
    title: 'Review the updated request',
    body: 'The account or network changed. Your previous review no longer applies. Check every detail again.',
    icon: 'refresh',
    action: 'Return to review',
    target: 'transfer.review',
  },
  expired: {
    title: 'This review has expired',
    body: 'The fee quote or request is no longer current. Get a fresh review before you continue.',
    icon: 'activity',
    action: 'Review again',
    target: 'transfer.details',
  },
  unavailable: {
    title: 'Not available here',
    body: 'This account, network or device does not support this action. Your existing records stay protected.',
    icon: 'shield',
    action: 'View account options',
    target: 'accounts.list',
  },
};

function networkFor(spec: ScreenSpec) {
  if (spec.family === 'privacy')
    return {
      name: 'Ethereum',
      detail: 'Private pools · Mainnet',
      coin: 'ethereum',
    };
  const networkField = spec.fields?.find((field) =>
    /^(network|asset & network|pool & network|network family)$/i.test(
      field.label
    )
  );
  const networkRow = spec.rows?.find((row) =>
    /^(network|network \/ pool|asset & network)$/i.test(row.title)
  );
  const explicit = `${networkField?.value || ''} ${
    networkRow?.detail || networkRow?.value || ''
  } ${spec.subtitle || ''}`;
  if (/syscoin nevm/i.test(explicit))
    return {
      name: 'Syscoin NEVM',
      detail: 'EVM · Mainnet',
      coin: 'syscoin-nevm',
    };
  if (
    /bitcoin/i.test(explicit) ||
    spec.unit === 'BTC' ||
    /(?:^|[.-])(?:btc|bitcoin)(?:[.-]|$)/.test(spec.id)
  )
    return { name: 'Bitcoin', detail: 'UTXO · Mainnet', coin: 'bitcoin' };
  if (
    /ethereum/i.test(explicit) ||
    spec.unit === 'ETH' ||
    /(?:^|[.-])(?:eth|ethereum|nft)(?:[.-]|$)/.test(spec.id)
  )
    return { name: 'Ethereum', detail: 'EVM · Mainnet', coin: 'ethereum' };
  if (/syscoin utxo/i.test(explicit))
    return { name: 'Syscoin UTXO', detail: 'Mainnet', coin: 'syscoin' };
  if (spec.family === 'connections' || spec.family === 'smart')
    return { name: 'Ethereum', detail: 'EVM · Mainnet', coin: 'ethereum' };
  return { name: 'Syscoin UTXO', detail: 'Mainnet', coin: 'syscoin' };
}

function isSigningScreen(spec: ScreenSpec) {
  if (spec.requiresAccountSigner === false) return false;
  return (
    Boolean(spec.authorization) ||
    (spec.approval &&
      /sign|typed|transaction|batch|decrypt|module/.test(spec.id)) ||
    (spec.family === 'transfer' &&
      !/receive|result|submitted|unknown/.test(spec.id)) ||
    /^privacy\.(deposit|withdraw-direct)/.test(spec.id) ||
    /^sentry\.(operation|vote)$/.test(spec.id) ||
    /^smart\.(setup-review|module-consent|guardian-edit)$/.test(spec.id) ||
    spec.id === 'settings.authorize' ||
    spec.id === 'settings.private-key'
  );
}

function typeLabel(kind: AccountKind) {
  return accountKinds.find((item) => item.id === kind)?.title || 'Personal';
}

function familyLabel(id: FamilyId) {
  return families.find((family) => family.id === id)?.label || id;
}

function MiniTag({
  text,
  tone = 'blue',
}: {
  text: string;
  tone?: 'blue' | 'amber' | 'green';
}) {
  return (
    <View
      style={[
        s.tag,
        {
          borderColor:
            tone === 'amber'
              ? '#55452f'
              : tone === 'green'
              ? '#285047'
              : colors.border,
        },
      ]}
    >
      <View style={[s.tagDot, { backgroundColor: colors[tone] }]} />
      <Text style={[s.tagText, { color: colors[tone] }]}>{text}</Text>
    </View>
  );
}

function ActionIcon({
  name,
  label,
  onPress,
}: {
  name: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && s.pressed]}
    >
      <Icon name={name} size={21} />
    </Pressable>
  );
}

function StateControls({
  value,
  onChange,
  compact = false,
}: {
  value: ReviewState;
  onChange: (state: ReviewState) => void;
  compact?: boolean;
}) {
  const content = reviewStates.map((state) => (
    <Pressable
      key={state.id}
      accessibilityRole="radio"
      accessibilityLabel={state.label}
      accessibilityState={{ checked: value === state.id }}
      onPress={() => onChange(state.id)}
      style={({ pressed }) => [
        s.stateChoice,
        value === state.id && s.stateChoiceSelected,
        pressed && s.pressed,
      ]}
    >
      <Text style={[s.stateText, value === state.id && { color: colors.text }]}>
        {state.label}
      </Text>
    </Pressable>
  ));
  return compact ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.compactStates}
    >
      {content}
    </ScrollView>
  ) : (
    <View style={s.stateGrid}>{content}</View>
  );
}

function AccountControls({
  value,
  onChange,
}: {
  value: AccountKind;
  onChange: (value: AccountKind) => void;
}) {
  return (
    <View style={{ gap: 7 }}>
      {accountKinds.map((kind) => (
        <Pressable
          key={kind.id}
          accessibilityRole="radio"
          accessibilityLabel={kind.title}
          accessibilityState={{ checked: kind.id === value }}
          onPress={() => onChange(kind.id)}
          style={({ pressed }) => [
            s.accountChoice,
            kind.id === value && s.accountChoiceSelected,
            pressed && s.pressed,
          ]}
        >
          <Icon
            name={kind.icon}
            size={18}
            color={kind.id === value ? colors.blue : colors.muted}
          />
          <View style={{ flex: 1 }}>
            <Text style={s.choiceTitle}>{kind.title}</Text>
            <Text style={s.choiceDetail}>{kind.detail}</Text>
          </View>
          {kind.id === value && (
            <Icon name="check" size={16} color={colors.blue} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

function Catalog({
  selected,
  family,
  onFamily,
  onSelect,
  search,
  onSearch,
}: {
  selected: string;
  family: FamilyId;
  onFamily: (id: FamilyId) => void;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
}) {
  const matches = screens
    .filter((screen) => !screen.hiddenInCatalog)
    .filter((screen) =>
      search.trim()
        ? `${screen.title} ${screen.id} ${screen.purpose}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        : screen.family === family
    );
  return (
    <>
      <View style={s.searchBox}>
        <Icon name="scan" size={16} color={colors.muted} />
        <TextInput
          accessibilityLabel="Search design screens"
          value={search}
          onChangeText={onSearch}
          placeholder="Find a screen"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          style={s.searchInput}
        />
      </View>
      <ScrollView
        style={s.scrollFill}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {!search.trim() && (
          <View style={s.familyList}>
            {families.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === family }}
                onPress={() => onFamily(item.id)}
                style={({ pressed }) => [
                  s.familyButton,
                  family === item.id && s.familySelected,
                  pressed && s.pressed,
                ]}
              >
                <Icon
                  name={item.icon}
                  size={18}
                  color={family === item.id ? colors.blue : colors.muted}
                />
                <Text
                  style={[
                    s.familyLabel,
                    family === item.id && { color: colors.text },
                  ]}
                >
                  {item.label}
                </Text>
                <Text style={s.familyCount}>
                  {
                    screens.filter(
                      (screen) =>
                        !screen.hiddenInCatalog && screen.family === item.id
                    ).length
                  }
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={s.catalogSection}>
          <Text style={s.eyebrow}>
            {search.trim() ? `${matches.length} RESULTS` : 'SCREENS'}
          </Text>
          <Text style={s.smallMuted}>
            {search.trim()
              ? 'Search across the full design.'
              : familyLabel(family)}
          </Text>
        </View>
        {matches.map((screen) => (
          <Pressable
            key={screen.id}
            testID={`design-open-${screen.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Preview ${screen.title}`}
            accessibilityState={{ selected: selected === screen.id }}
            onPress={() => onSelect(screen.id)}
            style={({ pressed }) => [
              s.screenLink,
              selected === screen.id && s.screenLinkSelected,
              pressed && s.pressed,
            ]}
          >
            <View
              style={[
                s.selectionDot,
                selected === screen.id && { backgroundColor: colors.pink },
              ]}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                style={[
                  s.screenLinkTitle,
                  selected === screen.id && { color: colors.text },
                ]}
              >
                {screen.title}
              </Text>
              <Text style={s.screenId}>{screen.id}</Text>
            </View>
            {selected === screen.id && (
              <Icon name="chevron-right" size={15} color={colors.pink} />
            )}
          </Pressable>
        ))}
        {!matches.length && (
          <Text style={{ color: colors.muted, padding: 20 }}>
            No screens match your search.
          </Text>
        )}
      </ScrollView>
    </>
  );
}

function DetailRows({
  rows,
  go,
  list = false,
}: {
  rows?: readonly DesignRow[];
  go: (id: string) => void;
  list?: boolean;
}) {
  if (!rows?.length) return null;
  return (
    <Card style={{ borderColor: '#24374d' }}>
      {rows.map((row, index) => {
        const coin = /^(SYS|BTC|ETH)$/.test(row.title)
          ? row.title === 'BTC'
            ? 'bitcoin'
            : row.title === 'ETH'
            ? 'ethereum'
            : 'syscoin'
          : null;
        const body = (
          <>
            {list && (
              <View style={s.rowGraphic}>
                {coin ? (
                  <Coin id={coin} size={38} />
                ) : (
                  <View style={s.rowGlyph}>
                    <Icon
                      name={row.icon || 'info'}
                      size={21}
                      color={row.tone ? colors[row.tone] : colors.blue}
                    />
                  </View>
                )}
              </View>
            )}
            <View style={{ flex: 1, gap: list ? 4 : 7 }}>
              <Text style={list ? s.listTitle : s.detailLabel}>
                {row.title}
              </Text>
              {row.detail && (
                <Text
                  selectable={!list}
                  style={[
                    list ? s.listDescription : s.detailValue,
                    row.tone && { color: colors[row.tone] },
                  ]}
                >
                  {row.detail}
                </Text>
              )}
            </View>
            {row.value && (
              <Text
                style={[s.rowValue, row.tone && { color: colors[row.tone] }]}
              >
                {row.value}
              </Text>
            )}
            {row.to && (
              <Icon name="chevron-right" size={17} color={colors.muted} />
            )}
          </>
        );
        const rowStyles = [
          list ? s.listRow : s.detailRow,
          index < rows.length - 1 && s.rowBorder,
        ];
        return row.to ? (
          <Pressable
            key={`${row.title}-${index}`}
            accessibilityRole="button"
            onPress={() => go(row.to!)}
            style={({ pressed }) => [
              rowStyles,
              pressed && { backgroundColor: colors.raised },
            ]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={`${row.title}-${index}`} style={rowStyles}>
            {body}
          </View>
        );
      })}
    </Card>
  );
}

function SampleFields({ spec }: { spec: ScreenSpec }) {
  return (
    <View style={{ gap: 21 }}>
      {spec.fields?.map((field, index) => (
        <View key={`${field.label}-${index}`} style={{ gap: 8 }}>
          <Text style={s.fieldLabel}>{field.label}</Text>
          <View
            style={[
              s.sampleField,
              field.multiline && { minHeight: 96, alignItems: 'flex-start' },
            ]}
          >
            <Text
              selectable={!field.secret}
              style={[s.fieldValue, field.secret && s.secretValue]}
            >
              {field.secret ? '••••  ••••  ••••  ••••' : field.value}
            </Text>
            {field.secret && (
              <Icon name="lock" size={17} color={colors.muted} />
            )}
          </View>
          {field.hint && <Text style={s.fieldHint}>{field.hint}</Text>}
        </View>
      ))}
    </View>
  );
}

function Portfolio({
  go,
  kind,
}: {
  go: (id: string) => void;
  kind: AccountKind;
}) {
  const assets = [
    {
      id: 'syscoin',
      title: 'Syscoin',
      subtitle: 'Syscoin UTXO',
      balance: '24,810.42 SYS',
      fiat: '$789.35',
      to: 'wallet.asset',
    },
    {
      id: 'bitcoin',
      title: 'Bitcoin',
      subtitle: 'Bitcoin',
      balance: '0.0842 BTC',
      fiat: '$6,589.37',
      to: 'wallet.asset-btc',
    },
    {
      id: 'ethereum',
      title: 'Ethereum',
      subtitle: 'Ethereum',
      balance: '1.82 ETH',
      fiat: '$4,461.64',
      to: 'wallet.asset-eth',
    },
    {
      id: 'usdc',
      title: 'USD Coin',
      subtitle: 'Base',
      balance: '1,000.00 USDC',
      fiat: '$1,000.00',
      to: 'wallet.token-detail',
    },
  ];
  return (
    <>
      <View style={s.portfolioHero}>
        <Text style={s.portfolioLabel}>Portfolio value</Text>
        <Text style={s.portfolioAmount}>$12,840.36</Text>
        <View style={s.balanceChange}>
          <Icon name="arrow-up-right" size={14} color={colors.green} />
          <Text style={s.changeValue}>$314.23 (2.51%)</Text>
          <Text style={s.changePeriod}>today · sample</Text>
        </View>
      </View>
      <View style={s.quickActions}>
        <Button
          title="Send"
          icon="arrow-up-right"
          disabled={kind === 'watch'}
          onPress={() => go('transfer.asset')}
          style={{ flex: 1 }}
        />
        <Button
          title="Receive"
          icon="arrow-down-left"
          variant="secondary"
          onPress={() => go('transfer.receive-network')}
          style={{ flex: 1 }}
        />
      </View>
      {kind === 'watch' && (
        <Notice
          title="You’re watching this account"
          body="You can view balances and receive. The signing wallet is required to send."
        />
      )}
      <View style={s.assetsHeader}>
        <Text style={s.sectionTitle}>Your assets</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => go('wallet.tokens')}
          style={s.textAction}
        >
          <Text style={s.textActionText}>Manage</Text>
        </Pressable>
      </View>
      <Text style={s.assetScope}>All networks · sample portfolio</Text>
      <Card>
        {assets.map((asset, index) => (
          <Pressable
            key={asset.id}
            onPress={() => go(asset.to)}
            accessibilityRole="button"
            accessibilityLabel={`${asset.title}, ${asset.balance}, ${asset.fiat}`}
            style={({ pressed }) => [
              s.assetRow,
              index < assets.length - 1 && s.rowBorder,
              pressed && { backgroundColor: colors.raised },
            ]}
          >
            <Coin id={asset.id} size={41} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.assetTitle}>{asset.title}</Text>
              <Text style={s.assetSub}>{asset.subtitle}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <Text style={s.assetFiat}>{asset.fiat}</Text>
              <Text style={s.assetSub}>{asset.balance}</Text>
            </View>
          </Pressable>
        ))}
      </Card>
      <Pressable
        accessibilityRole="button"
        onPress={() => go('wallet.tools')}
        style={({ pressed }) => [s.toolsTeaser, pressed && s.pressed]}
      >
        <View style={s.rowGlyph}>
          <Icon name="shield" color={colors.blue} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.listTitle}>Make it your wallet</Text>
          <Text style={s.listDescription}>
            Private assets, smart accounts and more
          </Text>
        </View>
        <Icon name="chevron-right" size={18} color={colors.muted} />
      </Pressable>
    </>
  );
}

function AuthContent({ kind }: { kind: AccountKind }) {
  const hardware = kind === 'hardware';
  return (
    <View style={{ gap: 22 }}>
      <View style={s.deviceIllustration}>
        <Icon
          name={hardware ? 'shield' : 'lock'}
          size={48}
          color={colors.blue}
        />
        <View style={s.deviceSmallDot} />
      </View>
      <Text style={s.bigHeadline}>
        {hardware ? 'Check your device.' : 'Follow your account’s policy.'}
      </Text>
      <Text style={s.bodyCopy}>
        {hardware
          ? 'Compare the recipient, network, amount and fee on your hardware wallet. Approve only when every detail matches.'
          : 'Your smart account uses its configured signer and recovery policy. Review the account before continuing.'}
      </Text>
      <DetailRows
        rows={
          hardware
            ? [
                {
                  title: 'Connected device',
                  detail: 'Compatible hardware wallet · sample',
                },
                { title: 'Approval', detail: 'Required on the device' },
              ]
            : [
                { title: 'Account', detail: 'Smart account · sample' },
                {
                  title: 'Signing policy',
                  detail: 'Configured owner / passkey / module',
                },
              ]
        }
        go={() => undefined}
      />
    </View>
  );
}

function ScreenContent({
  spec,
  go,
  kind,
}: {
  spec: ScreenSpec;
  go: (id: string) => void;
  kind: AccountKind;
}) {
  const auth =
    Boolean(spec.authorization) ||
    spec.id === 'transfer.authorize' ||
    /^transfer\..*-authorize$/.test(spec.id) ||
    spec.id === 'settings.authorize';
  if (
    auth &&
    isSigningScreen(spec) &&
    (kind === 'hardware' || kind === 'smart')
  )
    return (
      <View style={{ gap: 22 }}>
        <DetailRows rows={spec.rows} go={go} />
        <AuthContent kind={kind} />
      </View>
    );
  if (spec.layout === 'portfolio') return <Portfolio go={go} kind={kind} />;
  return (
    <View style={{ gap: 22 }}>
      {spec.layout === 'welcome' && (
        <View style={s.welcomeVisual}>
          <View style={s.welcomeHalo} />
          <View style={s.welcomePlate}>
            <PaliMark size={110} />
          </View>
          <View style={s.welcomeAccent} />
        </View>
      )}
      {spec.layout === 'success' && (
        <View style={s.successGraphic}>
          <Icon name="check" size={43} color={colors.green} />
        </View>
      )}
      {spec.headline && (
        <Text
          accessibilityRole="header"
          style={[
            s.bigHeadline,
            spec.layout === 'welcome' && s.welcomeHeadline,
          ]}
        >
          {spec.headline}
        </Text>
      )}
      {spec.amount && (
        <View style={s.amountBlock}>
          <Coin
            id={
              spec.unit === 'ETH'
                ? 'ethereum'
                : spec.unit === 'BTC'
                ? 'bitcoin'
                : 'syscoin'
            }
            size={42}
          />
          <View style={{ flex: 1 }}>
            <Text style={s.amountValue}>
              {spec.amount}
              <Text style={s.amountUnit}> {spec.unit}</Text>
            </Text>
            <Text style={s.smallMuted}>Sample amount</Text>
          </View>
        </View>
      )}
      {spec.description && <Text style={s.bodyCopy}>{spec.description}</Text>}
      {spec.layout === 'form' && <SampleFields spec={spec} />}
      {spec.layout === 'phrase' &&
        (spec.id === 'settings.key-reveal' ||
        spec.id === 'privacy.backup-review' ||
        spec.id === 'privacy.deposit-note' ||
        spec.id === 'privacy.reveal-1' ? (
          <View style={s.keyPlaceholder}>
            <Icon name="lock" size={26} color={colors.blue} />
            <Text style={s.keyText}>
              {spec.id.startsWith('privacy.')
                ? 'PRIVATE-NOTE-PLACEHOLDER'
                : 'PRIVATE-KEY-PLACEHOLDER'}
            </Text>
            <Text style={s.fieldHint}>
              No usable secret is present in this design.
            </Text>
          </View>
        ) : (
          <>
            <View style={s.phraseGrid}>
              {sampleWords.map((word, index) => (
                <View key={word} style={s.wordCell}>
                  <Text style={s.wordIndex}>{index + 1}</Text>
                  <Text style={s.wordText}>{word}</Text>
                </View>
              ))}
            </View>
            <Text style={s.fieldHint}>
              These are non-BIP39 placeholders, not a recovery phrase.
            </Text>
          </>
        ))}
      {spec.layout === 'verify' && (
        <>
          <View style={s.verifySelections}>
            {[3, 7, 11].map((number) => (
              <View key={number} style={s.verifySlot}>
                <Text style={s.wordIndex}>{number}</Text>
                <Text style={s.wordText}>
                  word{String(number).padStart(2, '0')}
                </Text>
                <Icon name="check" size={16} color={colors.green} />
              </View>
            ))}
          </View>
          <View style={s.verifyWords}>
            {['word07', 'word11', 'word03'].map((word) => (
              <Pressable
                key={word}
                disabled
                accessibilityRole="button"
                accessibilityState={{ disabled: true, selected: true }}
                style={s.verifyWord}
              >
                <Text style={s.wordText}>{word}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.fieldHint}>
            Selected placeholder words. No secret is entered or checked.
          </Text>
        </>
      )}
      {spec.layout === 'receive' && (
        <View style={s.receiveContent}>
          <View style={s.qrPlate}>
            <QRCode
              value={QR_VALUE}
              size={174}
              backgroundColor="#ffffff"
              color="#071325"
              quietZone={9}
            />
          </View>
          <Text style={s.receiveLabel}>Design QR · not a payment address</Text>
          <View style={s.addressPlate}>
            <Text selectable style={s.designAddress}>
              {QR_VALUE}
            </Text>
          </View>
        </View>
      )}
      {spec.layout === 'scan' && (
        <View style={s.scanArea}>
          <View style={[s.scanCorner, s.topLeft]} />
          <View style={[s.scanCorner, s.topRight]} />
          <View style={[s.scanCorner, s.bottomLeft]} />
          <View style={[s.scanCorner, s.bottomRight]} />
          <Icon name="scan" size={66} color={colors.border} />
          <Text style={s.scanTitle}>Camera preview</Text>
          <Text style={s.scanNote}>No camera is opened in the design.</Text>
        </View>
      )}
      {spec.rows && (
        <DetailRows
          rows={spec.rows}
          go={go}
          list={spec.layout === 'list' || spec.layout === 'hub'}
        />
      )}
      {spec.notice && <Notice {...spec.notice} />}
      {spec.layout === 'success' && (
        <MiniTag text="Sample state · nothing broadcast" tone="green" />
      )}
      {spec.layout === 'welcome' && (
        <View style={s.welcomePromise}>
          <Icon name="shield" size={19} color={colors.blue} />
          <Text style={s.welcomePromiseText}>
            Your accounts. Your choices. Your keys.
          </Text>
        </View>
      )}
    </View>
  );
}

function LoadingContent() {
  return (
    <View
      accessibilityLabel="Loading design state"
      style={{ gap: 22, paddingTop: 13 }}
    >
      <View style={[s.skeleton, { width: '40%', height: 13 }]} />
      <View style={[s.skeleton, { width: '82%', height: 42 }]} />
      <View style={[s.skeleton, { width: '55%', height: 13 }]} />
      <View style={{ height: 14 }} />
      {[0, 1, 2].map((item) => (
        <View key={item} style={s.skeletonRow}>
          <View
            style={[s.skeleton, { width: 42, height: 42, borderRadius: 21 }]}
          />
          <View style={{ flex: 1, gap: 10 }}>
            <View style={[s.skeleton, { width: '68%', height: 13 }]} />
            <View style={[s.skeleton, { width: '42%', height: 11 }]} />
          </View>
        </View>
      ))}
      <Text style={s.smallMuted}>Loading…</Text>
    </View>
  );
}

function Inspector({
  spec,
  state,
  setState,
  kind,
  setKind,
  go,
}: {
  spec: ScreenSpec;
  state: ReviewState;
  setState: (value: ReviewState) => void;
  kind: AccountKind;
  setKind: (value: AccountKind) => void;
  go: (id: string) => void;
}) {
  return (
    <ScrollView
      style={s.scrollFill}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.inspectorContent}
    >
      <View style={s.inspectorSection}>
        <Text style={s.eyebrow}>SCENARIO</Text>
        <StateControls value={state} onChange={setState} />
      </View>
      <View style={s.inspectorSection}>
        <Text style={s.eyebrow}>ACCOUNT KIND</Text>
        <AccountControls value={kind} onChange={setKind} />
      </View>
      <View style={s.inspectorRule} />
      <View style={s.inspectorSection}>
        <Text style={s.eyebrow}>SCOPE</Text>
        <Text style={s.inspectorBody}>
          {spec.scope === 'shared-enhancement'
            ? 'Proposed shared enhancement · extension + mobile'
            : 'Extension-equivalence design target'}
        </Text>
        <Text style={s.smallMuted}>
          {Object.entries(featureCoverage)
            .filter(([, ids]) => ids.includes(spec.id))
            .map(([id]) => id)
            .join(' · ') ||
            (spec.scope === 'shared-enhancement'
              ? 'B01 · New encrypted note-vault backup'
              : 'Supporting flow')}
        </Text>
      </View>
      <View style={s.inspectorSection}>
        <Text style={s.eyebrow}>DESIGN INTENT</Text>
        <Text style={s.inspectorBody}>{spec.purpose}</Text>
      </View>
      <View style={s.inspectorSection}>
        <Text style={s.eyebrow}>SOURCE REFERENCE</Text>
        <Text selectable style={s.sourceText}>
          {spec.source}
        </Text>
      </View>
      {(spec.primary || spec.secondary) && (
        <View style={s.inspectorSection}>
          <Text style={s.eyebrow}>NEXT SCREENS</Text>
          {[spec.primary, spec.secondary].filter(Boolean).map(
            (action, index) =>
              action && (
                <Pressable
                  key={`${action.to}-${index}`}
                  accessibilityRole="button"
                  onPress={() => go(action.to)}
                  style={({ pressed }) => [s.flowLink, pressed && s.pressed]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.flowTitle}>{action.label}</Text>
                    <Text style={s.screenId}>{action.to}</Text>
                  </View>
                  <Icon name="arrow-right" size={17} color={colors.blue} />
                </Pressable>
              )
          )}
        </View>
      )}
      <View style={s.inspectorSection}>
        <Text style={s.eyebrow}>SAFETY BOUNDARY</Text>
        <Text style={s.inspectorBody}>
          Every screen is a local design. Buttons move between examples. No
          keys, account access, permissions, signatures or transactions are
          created.
        </Text>
      </View>
    </ScrollView>
  );
}

export function DesignStudio({ onExit }: { onExit: () => void }) {
  const { width, height } = useWindowDimensions();
  const desktop = width > 1000;
  const [selectedId, setSelectedId] = useState('wallet.home');
  const [family, setFamily] = useState<FamilyId>('wallet');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<ReviewState>('ready');
  const [kind, setKind] = useState<AccountKind>('personal');
  const [history, setHistory] = useState<string[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const spec = useMemo(() => getScreen(selectedId), [selectedId]);
  const reviewTarget =
    (spec.authorization ||
      spec.id === 'transfer.authorize' ||
      /^transfer\..*-authorize$/.test(spec.id)) &&
    spec.secondary
      ? spec.secondary.to
      : selectedId;
  const network = networkFor(spec);
  const blocked = blockedStates[state];
  const keyExportBlocked =
    kind !== 'personal' &&
    ['settings.private-key', 'settings.key-reveal'].includes(spec.id);
  const watchBlocked =
    keyExportBlocked || (kind === 'watch' && isSigningScreen(spec));
  const tabVisible =
    !spec.approval &&
    !['onboarding', 'transfer'].includes(spec.family) &&
    !/authorize|password|phrase|key-reveal|private-key|remove|backup-review|setup-review|module-consent|guardian-edit/.test(
      spec.id
    );
  const contextVisible = Boolean(
    spec.accountContext ||
      [
        'wallet',
        'activity',
        'connections',
        'smart',
        'privacy',
        'sentry',
      ].includes(spec.family)
  );
  const phoneHeight = Math.min(850, Math.max(520, height - 132));

  const go = (id: string) => {
    const target = screens.find((screen) => screen.id === id);
    if (!target) {
      setFeedback('This design destination is being prepared.');
      return;
    }
    if (id === selectedId) {
      setFeedback('Design only. No live action was performed.');
      return;
    }
    setHistory((previous) => [...previous, selectedId]);
    setSelectedId(id);
    setFamily(target.family);
    setState('ready');
    setFeedback(null);
    setShowCatalog(false);
  };
  const back = useCallback(() => {
    const previous = history[history.length - 1];
    if (previous) {
      setHistory((entries) => entries.slice(0, -1));
      setSelectedId(previous);
      setFamily(getScreen(previous).family);
      setState('ready');
      setFeedback(null);
    } else onExit();
  }, [history, onExit]);
  const handleBack = useCallback(() => {
    if (showInspector) setShowInspector(false);
    else if (showCatalog) setShowCatalog(false);
    else back();
    return true;
  }, [back, showCatalog, showInspector]);
  useEffect(() => {
    if (Platform.OS !== 'web') {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        handleBack
      );
      return () => subscription.remove();
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        handleBack();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
    };
  }, [handleBack]);
  const pickFamily = (id: FamilyId) => {
    setFamily(id);
    if (!showCatalog) {
      const entry = families.find((item) => item.id === id)?.entry;
      if (entry) go(entry);
    }
  };
  const runAction = (action: { label: string; to: string }) => {
    if (spec.layout === 'receive') {
      setFeedback(
        /share/i.test(action.label)
          ? 'Design only. No address was shared.'
          : 'Design only. No address was copied.'
      );
      return;
    }
    if (
      /explorer|save backup/i.test(action.label) &&
      action.to === selectedId
    ) {
      setFeedback('Design only. No external service or file was opened.');
      return;
    }
    go(action.to);
  };
  const catalogueProps = {
    selected: selectedId,
    family,
    onFamily: pickFamily,
    onSelect: go,
    search,
    onSearch: setSearch,
  };
  const inspectorProps = {
    spec,
    state,
    setState,
    kind,
    setKind: (next: AccountKind) => {
      if (
        next !== kind &&
        (spec.layout === 'review' ||
          isSigningScreen(spec) ||
          spec.authorization)
      )
        setState('changed');
      setKind(next);
    },
    go: (id: string) => {
      go(id);
      setShowInspector(false);
    },
  };
  const showPrimary = spec.primary && spec.layout !== 'portfolio';
  const disabledAction = Boolean(
    blocked ||
      watchBlocked ||
      state === 'loading' ||
      (state === 'offline' && isSigningScreen(spec))
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={s.studio}>
      <View style={[s.studioHeader, !desktop && s.studioHeaderCompact]}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            flex: 1,
          }}
        >
          <PaliMark size={desktop ? 35 : 27} />
          <View style={{ flex: 1 }}>
            <Text style={desktop ? s.studioTitle : s.studioTitleCompact}>
              Pali mobile <Text style={s.studioTitleMuted}>/ Design</Text>
            </Text>
            <Text style={s.studioSubtitle}>
              {screens.filter((screen) => !screen.hiddenInCatalog).length}{' '}
              design views · Extension feature-equivalence target
            </Text>
          </View>
        </View>
        {desktop && <MiniTag text="No live wallet actions" tone="amber" />}
        <ActionIcon name="close" label="Exit design studio" onPress={onExit} />
      </View>
      {!desktop && (
        <>
          <View style={s.mobileChooser}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose design screen"
              onPress={() => setShowCatalog(true)}
              style={({ pressed }) => [
                s.mobileChooserButton,
                pressed && s.pressed,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.mobileFamily}>{familyLabel(spec.family)}</Text>
                <Text numberOfLines={1} style={s.mobileCurrent}>
                  {spec.title}
                </Text>
              </View>
              <Icon name="chevron-down" size={17} color={colors.blue} />
            </Pressable>
            <ActionIcon
              name="info"
              label="Design notes and account scenario"
              onPress={() => setShowInspector(true)}
            />
          </View>
          <View style={s.mobileStateBar}>
            <StateControls compact value={state} onChange={setState} />
          </View>
        </>
      )}
      <View style={[s.workspace, !desktop && s.workspaceCompact]}>
        {desktop && (
          <View style={s.catalogRail}>
            <Catalog {...catalogueProps} />
          </View>
        )}
        <View style={[s.centerColumn, !desktop && { padding: 0 }]}>
          {desktop && (
            <View style={s.phoneCaption}>
              <Text style={s.captionTitle}>{spec.title}</Text>
              <Text style={s.captionId}>{spec.id}</Text>
            </View>
          )}
          <View
            testID="design-phone"
            style={[
              s.phoneFrame,
              desktop
                ? {
                    height: phoneHeight,
                    maxHeight: '100%',
                    width: Math.min(420, width - 580),
                  }
                : s.phoneFrameCompact,
            ]}
          >
            {desktop && (
              <View style={s.mockStatus}>
                <Text style={s.mockTime}>9:41</Text>
                <View style={s.mockIsland} />
                <View
                  style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}
                >
                  <View style={s.signalDot} />
                  <View style={s.mockBattery}>
                    <View style={s.mockBatteryFill} />
                  </View>
                </View>
              </View>
            )}
            <View style={s.sampleBanner}>
              <View style={s.sampleDot} />
              <Text style={s.sampleText}>DESIGN ONLY · SAMPLE DATA</Text>
            </View>
            <View style={s.productHeader}>
              {spec.layout === 'portfolio' ? (
                <View
                  style={{
                    flexDirection: 'row',
                    gap: 10,
                    alignItems: 'center',
                    flex: 1,
                  }}
                >
                  <PaliMark size={28} />
                  <Text style={s.productBrand}>Pali</Text>
                </View>
              ) : (
                <>
                  <ActionIcon
                    name="arrow-left"
                    label="Back in design flow"
                    onPress={back}
                  />
                  <Text accessibilityRole="header" style={s.productTitle}>
                    {spec.title}
                  </Text>
                </>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Account scenario: ${typeLabel(
                  kind
                )}. Change account scenario.`}
                onPress={() => setShowInspector(true)}
                style={({ pressed }) => [s.kindPill, pressed && s.pressed]}
              >
                <Icon
                  name={
                    accountKinds.find((item) => item.id === kind)?.icon ||
                    'wallet'
                  }
                  size={14}
                  color={colors.blue}
                />
                <Text style={s.kindLabel}>{typeLabel(kind)}</Text>
              </Pressable>
            </View>
            {contextVisible && (
              <View style={s.contextBar}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Network: ${network.name}. View network design.`}
                  onPress={() => go('settings.networks')}
                  style={s.networkContext}
                >
                  <Coin id={network.coin} size={19} />
                  <Text style={s.networkName}>{network.name}</Text>
                  <Icon name="chevron-down" size={13} color={colors.muted} />
                </Pressable>
                <Text style={s.networkDetail}>{network.detail}</Text>
              </View>
            )}
            <View style={s.contentRegion}>
              <ScrollView
                key={`${spec.id}-${state}-${kind}`}
                style={s.scrollFill}
                contentContainerStyle={[
                  s.productContent,
                  Boolean(blocked || watchBlocked) && { flexGrow: 1 },
                ]}
                showsVerticalScrollIndicator={false}
              >
                {state === 'offline' && (
                  <Notice
                    title="You’re offline"
                    body="Showing cached sample information. Reconnect before submitting a new request."
                    tone="amber"
                  />
                )}
                {blocked ? (
                  <View style={s.blockedPanel}>
                    <View style={s.blockedGraphic}>
                      <Icon name={blocked.icon} size={35} color={colors.blue} />
                    </View>
                    <Text style={s.blockedTitle}>{blocked.title}</Text>
                    <Text style={s.blockedBody}>{blocked.body}</Text>
                    <Button
                      title={blocked.action}
                      onPress={() => {
                        setState('ready');
                        go(
                          state === 'changed' || state === 'expired'
                            ? reviewTarget
                            : blocked.target
                        );
                      }}
                      variant="secondary"
                      style={{ alignSelf: 'stretch', marginTop: 8 }}
                    />
                  </View>
                ) : watchBlocked ? (
                  <View style={s.blockedPanel}>
                    <View style={s.blockedGraphic}>
                      <Icon name="eye" size={35} color={colors.blue} />
                    </View>
                    <Text style={s.blockedTitle}>
                      {keyExportBlocked
                        ? 'This account has no exportable private key'
                        : 'This account is watch-only'}
                    </Text>
                    <Text style={s.blockedBody}>
                      {keyExportBlocked
                        ? 'View this account’s public identifier or use its own recovery method. Pali cannot export its external signer’s private key.'
                        : 'You can view its balance and receive assets. To sign or send, choose an account with an available signer.'}
                    </Text>
                    <Button
                      title="View account options"
                      onPress={() => go('accounts.list')}
                      variant="secondary"
                      style={{ alignSelf: 'stretch', marginTop: 8 }}
                    />
                  </View>
                ) : state === 'loading' ? (
                  <LoadingContent />
                ) : (
                  <ScreenContent spec={spec} go={go} kind={kind} />
                )}
                {feedback && (
                  <View accessibilityLiveRegion="polite" style={s.feedback}>
                    <Icon name="info" size={16} color={colors.blue} />
                    <Text style={s.feedbackText}>{feedback}</Text>
                  </View>
                )}
              </ScrollView>
            </View>
            {(showPrimary ||
              (spec.secondary && spec.layout !== 'portfolio')) && (
              <View style={s.productFooter}>
                {showPrimary && spec.primary && (
                  <Button
                    title={spec.primary.label}
                    onPress={() => runAction(spec.primary!)}
                    disabled={disabledAction}
                    testID="design-primary-action"
                  />
                )}
                {spec.secondary && (
                  <Button
                    title={spec.secondary.label}
                    onPress={() => runAction(spec.secondary!)}
                    variant="quiet"
                    style={{ minHeight: 48, paddingVertical: 11 }}
                  />
                )}
              </View>
            )}
            {tabVisible && (
              <View style={s.productTabs}>
                {rootTabs.map((tab) => {
                  const active =
                    tab.to === spec.id ||
                    (tab.family === spec.family &&
                      spec.id !== 'wallet.tools') ||
                    (tab.family === 'tools' &&
                      (spec.id === 'wallet.tools' ||
                        ['connections', 'privacy', 'smart', 'sentry'].includes(
                          spec.family
                        )));
                  return (
                    <Pressable
                      key={tab.to}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      onPress={() => go(tab.to)}
                      style={({ pressed }) => [
                        s.productTab,
                        pressed && s.pressed,
                      ]}
                    >
                      <Icon
                        name={tab.icon}
                        size={21}
                        color={active ? colors.pink : colors.muted}
                      />
                      <Text
                        style={[
                          s.productTabText,
                          active && { color: colors.pink },
                        ]}
                      >
                        {tab.title}
                      </Text>
                      <View
                        style={[
                          s.activeTabDot,
                          {
                            backgroundColor: active
                              ? colors.pink
                              : 'transparent',
                          },
                        ]}
                      />
                    </Pressable>
                  );
                })}
              </View>
            )}
            {desktop && (
              <View style={s.mockHome}>
                <View style={s.mockHomeLine} />
              </View>
            )}
          </View>
        </View>
        {desktop && (
          <View style={s.inspectorRail}>
            <Inspector {...inspectorProps} />
          </View>
        )}
      </View>
      <Modal
        visible={showCatalog && !desktop}
        animationType="none"
        onRequestClose={() => setShowCatalog(false)}
      >
        <SafeAreaView style={s.modalSurface}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Design screens</Text>
            <ActionIcon
              name="close"
              label="Close screen chooser"
              onPress={() => setShowCatalog(false)}
            />
          </View>
          <View style={s.modalCatalog}>
            <Catalog {...catalogueProps} />
          </View>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={showInspector}
        animationType="none"
        transparent={desktop}
        onRequestClose={() => setShowInspector(false)}
      >
        <View style={[s.modalBackdrop, !desktop && { padding: 0 }]}>
          <SafeAreaView style={[s.modalSurface, desktop && s.inspectorModal]}>
            <View style={s.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.modalTitle}>Design notes</Text>
                <Text style={s.smallMuted}>{spec.title}</Text>
              </View>
              <ActionIcon
                name="close"
                label="Close design notes"
                onPress={() => setShowInspector(false)}
              />
            </View>
            <Inspector {...inspectorProps} />
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  studio: { flex: 1, minHeight: 0, backgroundColor: '#09101c' },
  studioHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    minHeight: 82,
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1b2a3c',
  },
  studioHeaderCompact: {
    minHeight: 66,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  studioTitle: {
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  studioTitleCompact: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  studioTitleMuted: { color: colors.muted, fontWeight: '400' },
  studioSubtitle: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 3,
  },
  iconButton: {
    width: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
  },
  pressed: { opacity: 0.65 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: '#111d2c',
  },
  tagDot: { width: 5, height: 5, borderRadius: 3 },
  tagText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  workspace: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 24,
  },
  workspaceCompact: { paddingHorizontal: 0, gap: 0 },
  catalogRail: { width: 216, minHeight: 0, paddingTop: 22, paddingRight: 3 },
  scrollFill: { flex: 1, minHeight: 0 },
  searchBox: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    paddingVertical: 12,
    fontSize: 13,
    minWidth: 0,
  },
  familyList: { gap: 2 },
  familyButton: {
    minHeight: 48,
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
  },
  familySelected: { backgroundColor: '#142339' },
  familyLabel: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    fontWeight: '500',
  },
  familyCount: { color: '#8295ae', fontSize: 10, lineHeight: 15 },
  catalogSection: {
    paddingTop: 22,
    paddingBottom: 10,
    paddingHorizontal: 10,
    gap: 4,
  },
  eyebrow: {
    color: '#8195ae',
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  smallMuted: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  screenLink: {
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  screenLinkSelected: { backgroundColor: '#281c31' },
  selectionDot: {
    width: 4,
    height: 22,
    backgroundColor: 'transparent',
    borderRadius: 2,
  },
  screenLinkTitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  screenId: { color: '#71869f', fontSize: 9, lineHeight: 15 },
  centerColumn: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 18,
  },
  phoneCaption: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    minHeight: 31,
  },
  captionTitle: { fontSize: 11, lineHeight: 17, color: colors.muted },
  captionId: { fontSize: 9, lineHeight: 15, color: '#61758f' },
  phoneFrame: {
    maxWidth: 420,
    backgroundColor: colors.bg,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: '#354157',
    overflow: 'hidden',
    minHeight: 0,
  },
  phoneFrameCompact: {
    flex: 1,
    width: '100%',
    maxWidth: 650,
    borderRadius: 0,
    borderWidth: 0,
  },
  mockStatus: {
    height: 34,
    paddingHorizontal: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mockTime: { fontSize: 11, lineHeight: 16, fontWeight: '600' },
  mockIsland: {
    width: 88,
    height: 17,
    borderRadius: 10,
    backgroundColor: '#02070e',
  },
  signalDot: {
    height: 5,
    width: 5,
    borderRadius: 3,
    backgroundColor: colors.text,
  },
  mockBattery: {
    width: 18,
    height: 9,
    borderWidth: 1,
    borderColor: colors.muted,
    padding: 1,
    borderRadius: 2,
  },
  mockBatteryFill: { backgroundColor: colors.text, flex: 1, borderRadius: 1 },
  sampleBanner: {
    minHeight: 25,
    backgroundColor: '#1c2130',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#2d3446',
  },
  sampleDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.amber,
  },
  sampleText: {
    color: colors.amber,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 1.1,
  },
  productHeader: {
    minHeight: 62,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  productBrand: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  productTitle: {
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    letterSpacing: -0.45,
    paddingVertical: 9,
  },
  kindPill: {
    minHeight: 48,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 132,
  },
  kindLabel: {
    color: colors.muted,
    fontSize: 9,
    lineHeight: 14,
    flexShrink: 1,
  },
  contextBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 22,
    minHeight: 48,
    borderBottomWidth: 1,
    borderBottomColor: '#14243a',
  },
  networkContext: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 1,
  },
  networkName: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '500',
    flexShrink: 1,
  },
  networkDetail: {
    color: '#7d93ae',
    fontSize: 8,
    lineHeight: 13,
    flexShrink: 1,
  },
  contentRegion: { flex: 1, minHeight: 0 },
  productContent: { padding: 22, paddingTop: 23, gap: 18 },
  productFooter: {
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#1c2b40',
    gap: 3,
    backgroundColor: colors.bg,
  },
  productTabs: {
    minHeight: 67,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderTopColor: '#1b2a3c',
    paddingHorizontal: 9,
    paddingTop: 5,
  },
  productTab: {
    minHeight: 57,
    flex: 1,
    gap: 3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 5,
  },
  productTabText: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
  },
  activeTabDot: { height: 3, width: 14, borderRadius: 2, marginTop: 2 },
  mockHome: {
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  mockHomeLine: {
    height: 4,
    width: 105,
    borderRadius: 3,
    backgroundColor: '#8b98ac',
  },
  portfolioHero: {
    alignItems: 'center',
    paddingTop: 5,
    paddingBottom: 7,
    gap: 9,
  },
  portfolioLabel: { fontSize: 12, lineHeight: 18, color: colors.muted },
  portfolioAmount: {
    fontSize: 42,
    lineHeight: 50,
    fontWeight: '600',
    letterSpacing: -1.7,
  },
  balanceChange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  changeValue: {
    color: colors.green,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '500',
  },
  changePeriod: {
    color: '#8296ad',
    fontSize: 9,
    lineHeight: 15,
    marginLeft: 3,
  },
  quickActions: { flexDirection: 'row', gap: 11 },
  assetsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: -14,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
    letterSpacing: -0.25,
  },
  textAction: { minHeight: 48, justifyContent: 'center', paddingLeft: 14 },
  textActionText: { fontSize: 11, lineHeight: 17, color: colors.blue },
  assetScope: {
    color: '#7d92ad',
    fontSize: 10,
    lineHeight: 15,
    marginBottom: -7,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 16,
    gap: 11,
    minHeight: 80,
  },
  assetTitle: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  assetSub: { fontSize: 9, lineHeight: 15, color: '#8ea3bb' },
  assetFiat: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  toolsTeaser: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 15,
  },
  rowGraphic: { flexShrink: 0 },
  rowGlyph: {
    width: 38,
    height: 38,
    backgroundColor: colors.raised,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 17,
    minHeight: 76,
    gap: 11,
  },
  listTitle: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  listDescription: { fontSize: 11, lineHeight: 17, color: colors.muted },
  detailRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    paddingHorizontal: 17,
    paddingVertical: 16,
    minHeight: 67,
  },
  detailLabel: { fontSize: 11, lineHeight: 17, color: colors.muted },
  detailValue: { fontSize: 13, lineHeight: 20, color: colors.text },
  rowValue: {
    maxWidth: '44%',
    fontSize: 12,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'right',
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bigHeadline: {
    fontSize: 29,
    lineHeight: 36,
    fontWeight: '600',
    letterSpacing: -1,
  },
  bodyCopy: { color: colors.muted, fontSize: 14, lineHeight: 23 },
  amountBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
  },
  amountValue: {
    fontSize: 31,
    lineHeight: 39,
    fontWeight: '600',
    letterSpacing: -0.7,
  },
  amountUnit: {
    color: colors.muted,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '400',
  },
  fieldLabel: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  sampleField: {
    minHeight: 57,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 15,
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fieldValue: { flex: 1, fontSize: 13, lineHeight: 21, color: '#ced9e9' },
  secretValue: { letterSpacing: 1.2, color: '#7f94ad' },
  fieldHint: { fontSize: 11, lineHeight: 18, color: colors.muted },
  phraseGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  wordCell: {
    flexBasis: '30%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 51,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 9,
  },
  wordIndex: { color: '#71879e', fontSize: 9, lineHeight: 15 },
  wordText: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.text,
    fontWeight: '500',
  },
  verifySelections: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  verifySlot: {
    flex: 1,
    minWidth: 85,
    minHeight: 57,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: '#315048',
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 5,
  },
  verifyWords: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 18,
  },
  verifyWord: {
    minWidth: 86,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.raised,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.55,
  },
  keyPlaceholder: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 24,
    gap: 19,
    alignItems: 'center',
  },
  keyText: {
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    color: '#c2cfe1',
  },
  receiveContent: { alignItems: 'center', gap: 17, paddingTop: 3 },
  qrPlate: { backgroundColor: '#ffffff', padding: 14, borderRadius: 23 },
  receiveLabel: {
    fontSize: 10,
    lineHeight: 17,
    color: colors.amber,
    textAlign: 'center',
  },
  addressPlate: {
    alignSelf: 'stretch',
    padding: 17,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 15,
    backgroundColor: colors.surface,
  },
  designAddress: {
    fontSize: 11,
    lineHeight: 20,
    letterSpacing: 0.25,
    textAlign: 'center',
    color: '#c5d4e6',
  },
  scanArea: {
    height: 246,
    marginHorizontal: 12,
    marginVertical: 5,
    borderRadius: 22,
    backgroundColor: '#0b192b',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 13,
  },
  scanCorner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: colors.blue,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 17,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 17,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 17,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 17,
  },
  scanTitle: { color: '#8298b4', fontSize: 13, lineHeight: 20 },
  scanNote: {
    color: '#637a94',
    fontSize: 10,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 18,
  },
  successGraphic: {
    width: 86,
    height: 86,
    borderRadius: 30,
    backgroundColor: '#13332e',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 15,
    marginBottom: 3,
  },
  welcomeVisual: {
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeHalo: {
    position: 'absolute',
    width: 188,
    height: 188,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#24384f',
  },
  welcomePlate: {
    height: 136,
    width: 136,
    backgroundColor: colors.surface,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  welcomeAccent: {
    position: 'absolute',
    height: 9,
    width: 9,
    borderRadius: 5,
    right: 66,
    top: 23,
    backgroundColor: colors.blue,
  },
  welcomeHeadline: { fontSize: 37, lineHeight: 44, letterSpacing: -1.4 },
  welcomePromise: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingTop: 5,
  },
  welcomePromiseText: { color: colors.muted, fontSize: 11, lineHeight: 18 },
  deviceIllustration: {
    alignSelf: 'center',
    width: 104,
    height: 139,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 8,
  },
  deviceSmallDot: {
    position: 'absolute',
    bottom: 13,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.blue,
  },
  skeleton: { borderRadius: 7, backgroundColor: '#1b2d43' },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1b2d43',
  },
  blockedPanel: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 17,
    paddingVertical: 26,
  },
  blockedGraphic: {
    width: 80,
    height: 80,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  blockedTitle: {
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: -0.7,
  },
  blockedBody: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: 3,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.surface,
  },
  feedbackText: { flex: 1, color: colors.blue, fontSize: 11, lineHeight: 18 },
  inspectorRail: { width: 252, minHeight: 0, paddingTop: 22 },
  inspectorContent: { gap: 25, paddingBottom: 30 },
  inspectorSection: { gap: 11 },
  inspectorRule: { height: 1, backgroundColor: '#243044' },
  inspectorBody: { fontSize: 12, lineHeight: 20, color: colors.muted },
  sourceText: { fontSize: 10, lineHeight: 18, color: '#91a5bf' },
  stateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stateChoice: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#253248',
    backgroundColor: '#0c1726',
  },
  stateChoiceSelected: { borderColor: '#59718e', backgroundColor: '#1c2e43' },
  stateText: {
    color: '#8ca0b8',
    fontSize: 10,
    lineHeight: 16,
    fontWeight: '500',
  },
  accountChoice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 59,
    padding: 11,
    borderWidth: 1,
    borderColor: '#233146',
    borderRadius: 12,
  },
  accountChoiceSelected: { borderColor: '#4b6a88', backgroundColor: '#132439' },
  choiceTitle: { fontSize: 11, lineHeight: 18, fontWeight: '600' },
  choiceDetail: { fontSize: 9, lineHeight: 15, color: colors.muted },
  flowLink: {
    minHeight: 51,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  flowTitle: { fontSize: 11, lineHeight: 18, color: colors.blue },
  mobileChooser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#1b2a3c',
  },
  mobileChooserButton: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  mobileFamily: { fontSize: 9, lineHeight: 14, color: '#8195ae' },
  mobileCurrent: { fontSize: 12, lineHeight: 19, fontWeight: '600' },
  mobileStateBar: {
    height: 50,
    borderBottomWidth: 1,
    borderBottomColor: '#1b2a3c',
  },
  compactStates: { paddingHorizontal: 15, gap: 6, alignItems: 'center' },
  modalSurface: { flex: 1, backgroundColor: '#0b1524' },
  modalHeader: {
    minHeight: 75,
    paddingHorizontal: 22,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.45,
  },
  modalCatalog: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 20,
    paddingTop: 18,
  },
  modalBackdrop: {
    flex: 1,
    padding: 40,
    backgroundColor: '#000000b3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inspectorModal: {
    width: 380,
    height: '90%',
    borderRadius: 24,
    overflow: 'hidden',
    flex: 0,
    paddingHorizontal: 20,
    paddingBottom: 15,
  },
});
