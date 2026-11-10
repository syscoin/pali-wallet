import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import appConfiguration from '../../app.json';
import {
  Button,
  Card,
  colors,
  Header,
  Icon,
  Label,
  Notice,
  Row,
  Screen,
  Text,
} from '../ui';

type SettingsProps = {
  preview: boolean;
  hideBalances: boolean;
  onHideBalances: (hidden: boolean) => void;
  onNavigate: (screen: string) => void;
  onExit: () => void;
  onWallet?: () => void;
};

type InformationProps = {
  screen: string;
  preview: boolean;
  onBack: () => void;
};

export function SettingsScreen({
  preview,
  hideBalances,
  onHideBalances,
  onNavigate,
  onExit,
  onWallet,
}: SettingsProps) {
  return (
    <Screen>
      <Header title="Settings" subtitle="A little more personal." />

      <Card style={localStyles.identityCard}>
        <View style={localStyles.identityIcon}>
          <Icon name="eye" size={24} color={colors.blue} />
        </View>
        <View style={localStyles.flex}>
          <Text style={localStyles.identityTitle}>
            {preview ? 'Explore Pali' : 'Watch-only account'}
          </Text>
          <Text style={localStyles.body}>
            {preview
              ? 'Sample data. Your settings stay in this preview.'
              : 'This account uses only a public address. It cannot sign.'}
          </Text>
        </View>
      </Card>

      <Label>Wallet</Label>
      <Card>
        {onWallet && <Row title="Open wallet" subtitle="Create, restore or unlock" icon="wallet" onPress={onWallet} />}
        <Row
          title="Security"
          subtitle="Understand what this app can access"
          icon="shield"
          onPress={() => onNavigate('security')}
        />
        <Row
          title="Recovery guide"
          subtitle="Keep your wallet backup safe"
          icon="wallet"
          onPress={() => onNavigate('backup')}
        />
        <Row
          title="Connected apps"
          subtitle="No active connections"
          icon="globe"
          onPress={() => onNavigate('connections')}
          last
        />
      </Card>

      <Label>Preferences</Label>
      <Card>
        <View style={localStyles.preferenceRow}>
          <View style={localStyles.preferenceIcon}>
            <Icon name="eye" size={20} color={colors.blue} />
          </View>
          <View style={localStyles.flex}>
            <Text style={localStyles.rowTitle}>Hide balances</Text>
            <Text style={localStyles.body}>A little privacy at a glance</Text>
          </View>
          <View style={localStyles.switchTarget}>
            <Switch
              accessibilityLabel="Hide balances"
              accessibilityHint="Hides amounts on portfolio and asset screens. It does not hide public blockchain data."
              value={hideBalances}
              onValueChange={onHideBalances}
              trackColor={{ false: colors.border, true: colors.pink }}
              thumbColor={colors.text}
              ios_backgroundColor={colors.border}
            />
          </View>
        </View>
      </Card>

      <Label>About</Label>
      <Card>
        <Row
          title="About Pali"
          subtitle={`Version ${appConfiguration.expo.version} · Mobile foundation`}
          icon="info"
          onPress={() => onNavigate('about')}
          last
        />
      </Card>

      <View style={localStyles.exit}>
        <Button
          title={preview ? 'Leave preview' : 'Hide accounts'}
          variant="secondary"
          onPress={onExit}
        />
        <Text style={localStyles.caption}>
          {preview
            ? 'No wallet or transaction is created in the preview.'
            : 'This app cannot sign or send transactions.'}
        </Text>
      </View>
    </Screen>
  );
}

function InformationHero({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <View style={localStyles.hero}>
      <View style={localStyles.heroIcon}>
        <Icon name={icon} size={30} color={colors.blue} />
      </View>
      <Text accessibilityRole="header" style={localStyles.heroTitle}>
        {title}
      </Text>
      <Text style={localStyles.heroBody}>{body}</Text>
    </View>
  );
}

function GuideStep({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <Card style={localStyles.guideCard}>
      <View style={localStyles.stepNumber}>
        <Text style={localStyles.stepText}>{number}</Text>
      </View>
      <View style={localStyles.flex}>
        <Text style={localStyles.rowTitle}>{title}</Text>
        <Text style={localStyles.guideBody}>{body}</Text>
      </View>
    </Card>
  );
}

export function InformationScreen({
  screen,
  preview,
  onBack,
}: InformationProps) {
  const title =
    screen === 'security'
      ? 'Security'
      : screen === 'backup'
      ? 'Recovery guide'
      : screen === 'connections'
      ? 'Connected apps'
      : 'About Pali';

  return (
    <Screen
      footer={<Button title="Done" onPress={onBack} variant="secondary" />}
    >
      <Header title={title} onBack={onBack} />

      {screen === 'security' && (
        <>
          <InformationHero
            icon="shield"
            title="Your keys stay with you."
            body="Watch balances with a public address. Watching this account does not require its recovery phrase or private key."
          />
          <Label>Current capabilities</Label>
          <Card>
            <Row
              title="Public account data"
              subtitle="Address and display preferences only"
              icon="eye"
            />
            <Row
              title="Signing and sending"
              subtitle="Unavailable in this build"
              icon="lock"
            />
            <Row
              title="Biometric wallet unlock"
              subtitle="Not enabled for watch-only accounts"
              icon="shield"
              last
            />
          </Card>
          <Notice
            title="Protect your device"
            body="Use your device's screen lock. Hiding balances only changes what is displayed; public blockchain activity remains public."
            tone="blue"
          />
        </>
      )}

      {screen === 'backup' && (
        <>
          <InformationHero
            icon="wallet"
            title="A backup is worth protecting."
            body="Watch-only accounts do not store a recovery phrase. Manage your backup in the wallet that controls the account."
          />
          <GuideStep
            number="1"
            title="Keep an offline copy"
            body="Follow your signing wallet's recovery instructions. Store the backup somewhere private and protected from loss or damage."
          />
          <GuideStep
            number="2"
            title="Keep it to yourself"
            body="Anyone with your recovery phrase may control your funds. Never share it with support, a website, or someone offering to help."
          />
          <GuideStep
            number="3"
            title="Know what it restores"
            body="A seed restores its derived accounts. Imported keys, passkeys and private notes may require separate backups."
          />
          <Notice
            title="No recovery phrase needed here"
            body={
              preview
                ? 'This is an educational preview. It cannot create, reveal or verify a wallet backup.'
                : 'Adding a watch-only account requires only a public address. Do not paste a recovery phrase into an address field.'
            }
            tone="amber"
          />
        </>
      )}

      {screen === 'connections' && (
        <>
          <InformationHero
            icon="globe"
            title="No connected apps."
            body="Your account has not granted any permissions through this app."
          />
          <Notice
            title="Connections are not available yet"
            body="WalletConnect, in-app dapps and transaction approvals are not enabled in this mobile foundation."
            tone="blue"
          />
          <Card style={localStyles.explainerCard}>
            <Text style={localStyles.rowTitle}>Before you connect</Text>
            <Text style={localStyles.guideBody}>
              A future connection must show the app&apos;s identity, requested
              accounts, networks and permissions before approval. A connection
              must never authorize a transfer by itself.
            </Text>
          </Card>
        </>
      )}

      {!['security', 'backup', 'connections'].includes(screen) && (
        <>
          <InformationHero
            icon="info"
            title="Pali, made for mobile."
            body="A native interface built alongside the Pali extension, sharing selected wallet validation and review logic."
          />
          <Card>
            <Row
              title="Version"
              subtitle="0.1.0 · Mobile foundation"
              icon="info"
            />
            <Row
              title="Current mode"
              subtitle={
                preview
                  ? 'Interactive design preview · Sample data'
                  : 'Public-address watch-only'
              }
              icon="eye"
              last
            />
          </Card>
          <Notice
            title="A foundation in development"
            body="Wallet setup is available in the iOS and Android development builds. Sending and other wallet features are still in development. Browser previews do not establish device security."
            tone="blue"
          />
        </>
      )}
    </Screen>
  );
}

const localStyles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 18,
    gap: 14,
    marginBottom: 12,
  },
  identityIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: colors.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '600',
    marginBottom: 3,
  },
  body: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  preferenceRow: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  preferenceIcon: { width: 34, alignItems: 'center' },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  switchTarget: {
    minWidth: 52,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exit: { marginTop: 20, marginBottom: 16, gap: 10 },
  caption: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  hero: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 24,
    paddingBottom: 28,
    gap: 14,
  },
  heroIcon: {
    width: 76,
    height: 76,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 4,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 27,
    lineHeight: 35,
    letterSpacing: -0.7,
    fontWeight: '600',
    textAlign: 'center',
  },
  heroBody: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  guideCard: { flexDirection: 'row', padding: 18, gap: 14, marginBottom: 12 },
  stepNumber: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
  },
  stepText: { color: colors.blue, fontSize: 15, fontWeight: '700' },
  guideBody: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    marginTop: 5,
  },
  explainerCard: { padding: 20, marginTop: 16 },
});
