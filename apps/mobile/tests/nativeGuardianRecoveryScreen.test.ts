import * as privateAuthentication from '../src/custody/privateAuthentication.ts';
import { allowsPrivateAuthenticationInterruption } from '../src/screens/privateAuthenticationLifecycle.ts';
import {
  guardianRecoveryTerminalNotice,
  guardianRecoveryTerminalReason,
} from '../../../source/utils/smartAccount/guardianRecoveryLifecycle.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { GuardianRecoveryObservation } from '../../../source/utils/smartAccount/guardianStatus.ts';
import type { NativeGuardianRecoveryIntent } from '../src/custody/walletCatalogue.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
import { guardianDelayLabel } from '../src/screens/guardianPolicyLabels.ts';
import {
  NativeGuardianRecoveryController,
  type NativeGuardianRecoveryChoice,
  type NativeGuardianRecoveryDraft,
  type NativeGuardianRecoveryStatus,
} from '../src/smartAccount/guardianRecovery.ts';
import { screenElements, screenFixture } from './screenFixture.ts';
import {
  nativeTranslationFixture,
  englishI18n,
  languageMessages,
} from './localizationFixture.ts';

const address = '0x1111111111111111111111111111111111111111';
const guardian = {
  id: 'smart:60:1',
  address: '0x2222222222222222222222222222222222222222',
  label: 'Guardian smart account',
};
const replacement = {
  id: 'imported:60:0',
  address: '0x3333333333333333333333333333333333333333',
  label: 'Replacement key',
};
const payer = {
  id: 'hd:60:0',
  address: '0x4444444444444444444444444444444444444444',
  label: 'Fee wallet',
};
const secondPayer = {
  id: 'hd:60:1',
  address: '0x5555555555555555555555555555555555555555',
  label: 'Second fee wallet',
};
const moduleAddress = '0x6666666666666666666666666666666666666666';
const hash = '0x' + 'ab'.repeat(32);
const observation: GuardianRecoveryObservation = {
  account: address,
  chainId: 1,
  moduleAddress,
  guardians: [guardian.address],
  guardianCount: '1',
  exists: true,
  threshold: 1,
  delay: '259200',
  delaySeconds: 259200,
  expirationSeconds: 518400,
  policyEpoch: '1',
  pending: null,
  active: null,
  knownOperation: null,
  observedBlock: { number: 100, hash, timestamp: 1794096000 },
};
const intent: NativeGuardianRecoveryIntent = {
  accountId: 'smart:60:0',
  operation: {
    account: address,
    chainId: 1,
    executionCalldata: '0x1234',
    hash,
    mode: '0x' + '00'.repeat(32),
    policyEpoch: '1',
    recoveryModule: moduleAddress,
    salt: '0x' + 'cd'.repeat(32),
  },
  target: { auth: { module: 'ecdsa', validator: moduleAddress, data: '0x' } },
  guardian: { ...guardian, xpub: guardian.address },
  replacement: { kind: 'software', account: { ...replacement, xpub: 'replacement public key' } },
  payer: { ...payer, xpub: 'payer public key' },
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const imports = {
  './guardianPolicyLabels': { guardianDelayLabel },
  '../../../../source/utils/smartAccount/guardianRecoveryLifecycle': {
    guardianRecoveryTerminalNotice,
  },
  '../custody/privateAuthentication': privateAuthentication,
    './privateAuthenticationLifecycle': { allowsPrivateAuthenticationInterruption },
    '../platform/localization': nativeTranslationFixture,
  'react-native': {
    AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
    ActivityIndicator: 'ActivityIndicator',
    View: 'View',
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    FlatList: 'FlatList',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Platform: { OS: 'android' },
    StyleSheet: { create: (value: unknown) => value },
  },
  'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
  '../core/amounts': { formatBaseUnits },
  '../ui': {
    ...Object.fromEntries(
      ['Button', 'Card', 'Header', 'Icon', 'Notice', 'Screen', 'Text'].map((name) => [
        name,
        name,
      ])
    ),
    colors: {},
    styles: {},
  },
  './IdleActivityBoundary': {
    IdlePressable: 'IdlePressable',
    IdleTextInput: 'IdleTextInput',
  },
  './NativeTransactionReview': { TransactionDetails: 'TransactionDetails' },
};
function screen(exported: string, globals: Record<string, unknown> = {}) {
  return screenFixture(
    new URL('../src/screens/NativeGuardianRecovery.tsx', import.meta.url),
    exported,
    imports,
    globals
  );
}
function button(elements: ReturnType<typeof screenElements>, title: string) {
  const element = elements.find(
    (element) => element.type === 'Button' && element.props.title === title
  );
  assert(element, `Missing button ${title}`);
  return element;
}
const text = (elements: ReturnType<typeof screenElements>) =>
  elements
    .flatMap((element) =>
      element.children.filter((value) => typeof value === 'string')
    )
    .join(' ');
function initialFixture(
  options: {
    guardian?: NativeGuardianRecoveryChoice;
    payers?: readonly NativeGuardianRecoveryChoice[];
    threshold?: number;
    failPasskey?: boolean;
  } = {}
) {
  const selectedGuardian = options.guardian ?? guardian;
  const lifetime = new AbortController(),
    drafts: NativeGuardianRecoveryDraft[] = [];
  let disposed = 0,
    activities = 0,
    alerts = 0;
  const next = {
    dispose() {
      disposed++;
    },
  };
  const recovery = {
    chainId: 1, passkeysAvailable: true,
    currency: 'ETH',
    guardians: [selectedGuardian],
    replacements: [replacement],
    payers: options.payers ?? [payer, secondPayer],
    hasIntent: false,
    async open(
      draft: NativeGuardianRecoveryDraft,
      _signal: AbortSignal,
      check: () => void
    ) {
      check();
      drafts.push(draft);
      if (options.failPasskey && draft.kind === 'start' && draft.replacement.kind === 'passkey' && !draft.replacement.recreate) throw Object.assign(Error('Failed'), {code:'PASSKEY_POSSESSION_FAILED'});
      return next;
    },
    async onActivity() {
      activities++;
    },
    async openRecoveryAlerts() {
      alerts++;
    },
  };
  const fixture = screen('NativeGuardianRecovery');
  const props = {
    address,
    networkLabel: 'Ethereum',
    observation: {
      ...observation,
      guardians: [selectedGuardian.address],
      threshold: options.threshold ?? 1,
    },
    recovery,
    lifetime: lifetime.signal,
    onBack() {
      lifetime.abort();
    },
  };
  const render = () => screenElements(fixture.render(props));
  const choose = (role: string, id: string) => {
    button(render(), role).props.onPress();
    const list = render().find((element) => element.type === 'FlatList');
    assert(list);
    const item = list.props.data.find(
      (account: NativeGuardianRecoveryChoice) => account.id === id
    );
    assert(item);
    list.props.renderItem({ item }).props.onPress();
  };
  return {
    render,
    choose,
    drafts,
    lifetime,
    close: fixture.close,
    get disposed() {
      return disposed;
    },
    get alerts() {
      return alerts;
    },
    get activities() {
      return activities;
    },
  };
}

test('Smart guardian recovery chooses a software payer independently and opens only the explicit three-role draft', async () => {
  const f = initialFixture();
  try {
    assert(text(f.render()).includes(guardian.label));
    assert(text(f.render()).includes(payer.label));
    assert(button(f.render(), 'Review recovery').props.disabled);
    f.choose('Choose replacement owner', replacement.id);
    f.choose('Choose fee payer', secondPayer.id);
    assert(text(f.render()).includes(secondPayer.address));
    assert.equal(button(f.render(), 'Review recovery').props.disabled, false);
    button(f.render(), 'Review recovery').props.onPress();
    await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.drafts)), [
      {
        kind: 'start',
        guardianId: guardian.id,
        replacement: { kind: 'software', accountId: replacement.id },
        payerId: secondPayer.id,
      },
    ]);
    assert.equal(f.disposed, 0);
  } finally {
    f.close();
  }
  assert.equal(f.disposed, 1);
});

test('the software guardian remains the explicit default fee payer for the simple recovery flow', async () => {
  const f = initialFixture({ guardian: payer, payers: [secondPayer, payer] });
  try {
    f.choose('Choose replacement owner', replacement.id);
    button(f.render(), 'Review recovery').props.onPress();
    await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.drafts)), [
      {
        kind: 'start',
        guardianId: payer.id,
        replacement: { kind: 'software', accountId: replacement.id },
        payerId: payer.id,
      },
    ]);
  } finally {
    f.close();
  }
});

test('P256 replacement is an explicit icon-bearing choice and retains a separate payer', async () => {
  const f = initialFixture();
  try {
    const select = button(f.render(), 'Use passkey'); assert.equal(select.props.icon, 'fingerprint'); select.props.onPress();
    assert(englishI18n.exists('smartAccountHub.compositePasskeyDescription'));
    assert(text(f.render()).includes(englishI18n.t('smartAccountHub.compositePasskeyDescription')));
    assert(!text(f.render()).includes(englishI18n.t('settings.recoveryAuthenticatorP256WebAuthnDescription')));
    assert.equal(button(f.render(), 'Review recovery').props.disabled, false);
    button(f.render(), 'Review recovery').props.onPress(); await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.drafts)), [{kind:'start',guardianId:guardian.id,replacement:{kind:'passkey',recreate:false},payerId:payer.id}]);
  } finally { f.close(); }
});

test('a failed replacement passkey proof requires explicit consent before recreation', async () => {
  const f = initialFixture({ failPasskey: true });
  try {
    button(f.render(), 'Use passkey').props.onPress();
    button(f.render(), 'Review recovery').props.onPress(); await tick();
    assert.equal(f.drafts.length, 1);
    const recreate = button(f.render(), englishI18n.t('settings.smartAccountPasskeyRecreateConfirmButton'));
    assert.equal(recreate.props.icon, 'fingerprint');
    recreate.props.onPress(); await tick();
    assert.deepEqual(JSON.parse(JSON.stringify(f.drafts)), [
      {kind:'start',guardianId:guardian.id,payerId:payer.id,replacement:{kind:'passkey',recreate:false}},
      {kind:'start',guardianId:guardian.id,payerId:payer.id,replacement:{kind:'passkey',recreate:true}},
    ]);
  } finally { f.close(); }
});

test('a missing payer, unsupported threshold or retired screen cannot open a recovery draft', async () => {
  for (const options of [{ payers: [] }, { threshold: 2 }]) {
    const f = initialFixture(options);
    try {
      f.choose('Choose replacement owner', replacement.id);
      const action = button(f.render(), 'Review recovery');
      assert(action.props.disabled);
      action.props.onPress();
      await tick();
      assert.equal(f.drafts.length, 0);
    } finally {
      f.close();
    }
  }
  const f = initialFixture();
  try {
    f.choose('Choose replacement owner', replacement.id);
    const action = button(f.render(), 'Review recovery');
    f.lifetime.abort();
    action.props.onPress();
    await tick();
    assert.equal(f.drafts.length, 0);
  } finally {
    f.close();
  }
});

test('the installed-policy alerts action opens only from a live recovery screen', async () => {
  const f = initialFixture();
  try {
    const action = button(
      f.render(),
      englishI18n.t('settings.smartAccountRecoveryEmailAlerts')
    );
    action.props.onPress();
    await tick();
    assert.equal(f.alerts, 1);
    f.lifetime.abort();
    action.props.onPress();
    await tick();
    assert.equal(f.alerts, 1);
  } finally {
    f.close();
  }
});

test('saved-view navigation callbacks retire immediately when their owning pane aborts', async () => {
  const f = initialFixture();
  try {
    f.choose('Choose replacement owner', replacement.id);
    button(f.render(), 'Review recovery').props.onPress();
    await tick();
    const saved = f.render().find((element) => element.props.controller);
    assert(saved);
    await saved.props.openRecoveryAlerts();
    await saved.props.onActivity(payer.id, 1, hash);
    assert.equal(f.alerts, 1);
    assert.equal(f.activities, 1);
    f.lifetime.abort();
    await assert.rejects(saved.props.openRecoveryAlerts(), /CANCELLED/);
    await assert.rejects(
      saved.props.onActivity(payer.id, 1, hash),
      /CANCELLED/
    );
    assert.equal(f.alerts, 1);
    assert.equal(f.activities, 1);
  } finally {
    f.close();
  }
});

test('saved review and Activity use the captured payer while proofs and submission retain their separate confirmations', async () => {
  let preparations = 0,
    submissions = 0;
  let status: NativeGuardianRecoveryStatus = {
    intent,
    observation,
    action: 'schedule',
    transactionHash: null,
    terminal: null,
    canAbandon: true,
  };
  const lifetime = new AbortController();
  const controller = new NativeGuardianRecoveryController(
    {
      assertCurrent() {
        assert.equal(lifetime.signal.aborted, false);
      },
      dispose() {},
      submissionFailure() {
        return undefined;
      },
      async observe() {
        return status;
      },
      async prepare() {
        preparations++;
        return {
          transaction: {
            chainId: '1',
            from: payer.address,
            to: moduleAddress,
            nonce: '3',
            type: 2,
            value: '0x0',
            data: '0x1234',
            gasLimit: '0x186a0',
            maxFeePerGas: '0x3b9aca00',
            maxPriorityFeePerGas: '0x3b9aca00',
            accessList: [],
          },
          feeComparison: { recommendationOnly: true },
          maximumFeeUnits: '100000000000000',
          maximumTotalUnits: '100000000000000',
          coveredFeeUnits: '0',
          approval: null,
          expiresAtMonotonicMilliseconds: performance.now() + 60000,
          async submit(check, onBroadcast) {
            check();
            submissions++;
            onBroadcast(hash);
            status = {
              ...status,
              action: null,
              transactionHash: hash,
              canAbandon: false,
            };
            return hash;
          },
        };
      },
      async reconcile() {},
      async abandon() {},
    },
    lifetime.signal
  );
  const fixture = screen('NativeGuardianRecoveryView'),
    activity: unknown[][] = [];
  const props = {
    controller,
    address,
    chainId: 1, passkeysAvailable: true,
    currency: 'ETH',
    networkLabel: 'Ethereum',
    async onActivity(...args: unknown[]) {
      activity.push(args);
    },
    async openRecoveryAlerts() {},
    onBack() {},
  };
  const render = () => screenElements(fixture.render(props));
  try {
    render();
    await tick();
    assert(text(render()).includes(guardian.address));
    assert(text(render()).includes(payer.address));
    const initial = render();
    const intentIndex = initial.findIndex(element => element.type === 'Notice' && element.props.title === 'Authorize the recovery');
    const identityIndex = initial.findIndex(element => element.children.includes(address));
    assert(intentIndex >= 0 && intentIndex < identityIndex, 'Recovery intent precedes exact account identities');
    assert.match(text(initial), /ready after 3 days/);
    assert(!initial.some(element => element.type === 'Button' && element.props.title === 'Clear local recovery tracking'));
    assert.equal(preparations, 0);
    assert.equal(submissions, 0);
    button(render(), 'Authorize recovery').props.onPress();
    await tick();
    assert.equal(preparations, 1);
    assert.equal(submissions, 0);
    const feeReview = render();
    assert(
      feeReview.some(
        (element) =>
          element.type === 'Notice' &&
          element.props.body ===
            'The selected fee payer pays the network fee for the exact transaction below.'
      )
    );
    assert(text(feeReview).includes(payer.address));
    button(feeReview, 'Confirm schedule').props.onPress();
    await tick();
    assert.equal(submissions, 1);
    button(render(), 'View saved transaction').props.onPress();
    await tick();
    assert.deepEqual(activity, [[payer.id, 1, hash]]);
    assert.equal(controller.getSnapshot().intent?.guardian.id, guardian.id);
    assert.equal(controller.getSnapshot().intent?.payer.id, payer.id);
  } finally {
    fixture.close();
    controller.dispose();
  }
});

test('saved recovery dates follow Pali language without changing deadlines or refreshing status', async () => {
  const knownOperation = {
    operationId: hash,
    status: 'pending' as const,
    executableAt: Date.UTC(2030, 3, 5, 16, 7, 8) / 1000,
    expiresAt: Date.UTC(2030, 3, 8, 16, 7, 8) / 1000,
    scheduledAt: Date.UTC(2030, 3, 2, 16, 7, 8) / 1000,
  };
  let reads = 0;
  const controller = new NativeGuardianRecoveryController({
    assertCurrent() {},
    dispose() {},
    submissionFailure() { return undefined; },
    async observe() {
      reads++;
      return { intent, observation: { ...observation, knownOperation }, action: null,
        transactionHash: null, terminal: null, canAbandon: true };
    },
    async prepare() { throw new Error('displaying a date must not prepare a transaction'); },
    async reconcile() {},
    async abandon() {},
  }, new AbortController().signal);
  const f = screen('NativeGuardianRecoveryView', {
    Date: class extends Date {
      toLocaleString(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        return super.toLocaleString(locales ?? 'en-US', options);
      }
    },
  });
  const props = { controller, address, chainId: 1, currency: 'ETH', networkLabel: 'Ethereum',
    async onActivity() {}, async openRecoveryAlerts() {}, onBack() {} };
  try {
    englishI18n.addResourceBundle('de', 'translation', languageMessages('de'), true, true);
    await englishI18n.changeLanguage('de');
    f.render(props);
    await tick();
    const copy = text(screenElements(f.render(props)));
    for (const timestamp of [knownOperation.executableAt, knownOperation.expiresAt]) {
      assert(copy.includes(new Date(timestamp * 1000).toLocaleString('de')));
      assert(!copy.includes(new Date(timestamp * 1000).toLocaleString('en-US')));
    }
    await englishI18n.changeLanguage('en');
    const updated = text(screenElements(f.render(props)));
    for (const timestamp of [knownOperation.executableAt, knownOperation.expiresAt]) {
      assert(updated.includes(new Date(timestamp * 1000).toLocaleString('en')));
    }
    assert.equal(reads, 1);
    assert.deepEqual(controller.getSnapshot().observation?.knownOperation, knownOperation);
  } finally {
    await englishI18n.changeLanguage('en');
    f.close();
    controller.dispose();
  }
});

for (const [status, reason, title] of [
  ['expired', 'expired', 'Recovery expired'],
  ['canceled', 'cancelled', 'Recovery was cancelled'],
  ['policy-changed', 'policy-changed', 'Guardian policy changed'],
  ['inactive', 'inactive', 'Recovery is no longer active'],
] as const)
  test(`terminal ${reason} recovery preserves its reason and offers safe next actions`, async () => {
    const currentObservation: GuardianRecoveryObservation = {
      ...observation,
      policyEpoch: status === 'policy-changed' ? '2' : '1',
      knownOperation:
        status === 'policy-changed'
          ? null
          : {
              operationId: hash,
              status,
              executableAt: 1,
              expiresAt: 2,
              scheduledAt: 1,
            },
    };
    assert.equal(
      guardianRecoveryTerminalReason(
        intent.operation,
        currentObservation,
        null
      ),
      reason
    );
    assert.equal(
      guardianRecoveryTerminalReason(
        intent.operation,
        currentObservation,
        hash
      ),
      null,
      'unresolved signed transaction retains tracking'
    );
    let prepared = 0,
      refreshed = 0,
      returned = 0;
    const lifetime = new AbortController();
    const controller = new NativeGuardianRecoveryController(
      {
        assertCurrent() {},
        dispose() {},
        submissionFailure() {
          return undefined;
        },
        async observe() {
          refreshed++;
          return {
            intent,
            observation: currentObservation,
            action: null,
            terminal: 'obsolete',
            transactionHash: null,
            canAbandon: true,
          };
        },
        async prepare() {
          prepared++;
          throw Error('terminal recovery must not prepare');
        },
        async reconcile() {},
        async abandon() {},
      },
      lifetime.signal
    );
    const f = screen('NativeGuardianRecoveryView');
    const props = {
      controller,
      address,
      chainId: 1,
      currency: 'ETH',
      networkLabel: 'Ethereum',
      onActivity: async () => undefined,
      openRecoveryAlerts: async () => undefined,
      onBack() {
        returned++;
      },
    };
    try {
      f.render(props);
      await tick();
      let tree = screenElements(f.render(props));
      assert.equal(controller.getSnapshot().terminalReason, reason);
      assert(
        tree.some(
          (element) =>
            element.type === 'Notice' && element.props.title === title
        )
      );
      assert(
        !tree.some(
          (element) =>
            element.type === 'Button' &&
            /Confirm schedule|Authorize recovery/.test(element.props.title)
        )
      );
      button(tree, 'Refresh current policy').props.onPress();
      await tick();
      tree = screenElements(f.render(props));
      button(tree, 'Return to account').props.onPress();
      assert.equal(returned, 1);
      assert(refreshed >= 2);
      await controller.review();
      assert.equal(prepared, 0);
      assert(!tree.some(element => element.type === 'Button' && element.props.title === 'Clear local recovery tracking'));
      button(tree, 'Troubleshooting').props.onPress();
      tree = screenElements(f.render(props));
      button(tree, 'Clear local recovery tracking').props.onPress();
      const confirm = screenElements(f.render(props));
      assert(
        confirm.some(
          (element) =>
            element.type === 'Notice' &&
            /does not cancel transactions or recovery scheduled/.test(
              element.props.body
            )
        )
      );
    } finally {
      f.close();
      controller.dispose();
    }
  });

for (const boundary of ['back', 'background', 'unmount', 'foreign-prompt'] as const) test(`guardian recovery keeps only its own prompt and retires on ${boundary}`, async () => {
  const events = new Map<string, (state: string) => void>();
  const native = { ...imports['react-native'], AppState: { currentState: 'active', addEventListener(event: string, callback: (state: string) => void) {
    events.set(event, callback); return { remove() { events.delete(event); } };
  } } };
  const f = screenFixture(new URL('../src/screens/NativeGuardianRecovery.tsx', import.meta.url), 'NativeGuardianRecovery', { ...imports, 'react-native': native });
  let authentication!: privateAuthentication.NativePrivateAuthenticationScope, guard!: () => void, returned = 0;
  const props = { address, networkLabel: 'Ethereum', observation, lifetime: new AbortController().signal, onBack() { returned++; },
    recovery: { chainId: 1, passkeysAvailable: false, currency: 'ETH', guardians: [guardian], replacements: [replacement], payers: [payer], hasIntent: true,
      async open(_draft: unknown, _signal: AbortSignal, check: () => void, scope: privateAuthentication.NativePrivateAuthenticationScope) {
        authentication = scope; guard = check; return { dispose() {} };
      }, async onActivity() {}, async openRecoveryAlerts() {} } };
  f.render(props); await tick(); f.render(props); guard();
  const promptScope = boundary === 'foreign-prompt' ? privateAuthentication.createNativePrivateAuthenticationScope() : authentication;
  const held = Promise.withResolvers<void>();
  let promptActive = true;
  const binding = privateAuthentication.bindNativePrivateAuthentication(promptScope, { assertCurrent() {}, isPromptActive: () => promptActive });
  const proof = privateAuthentication.withNativePrivateAuthentication(binding, new AbortController().signal, () => {}, () => held.promise);
  const emit = (event: string, state = '') => { if (event === 'change') native.AppState.currentState = state; events.get(event)?.(state); };
  try {
    if (boundary !== 'foreign-prompt') { emit('change', 'inactive'); emit('blur'); guard(); assert.equal(returned, 0); emit('change', 'active'); }
    if (boundary === 'background') promptActive = false;
    if (boundary === 'unmount') f.close();
    else if (boundary !== 'back') emit('change', boundary === 'background' ? 'background' : 'inactive');
    if (boundary === 'back') {
      const child = screenElements(f.render(props)).find(node => typeof node.type === 'function' && node.props.controller);
      assert(child); child.props.onBack();
    }
    assert.throws(guard, /CANCELLED/); assert.equal(authentication.isAuthenticating(), false);
    assert.equal(returned, boundary === 'unmount' ? 0 : 1);
  } finally { held.resolve(); await proof.catch(() => undefined); promptScope.retire(); f.close(); }
});

test('watch recovery changes status and date language without repeating the network read', async () => {
  const f = screenFixture(new URL('../src/screens/WatchGuardianRecovery.tsx', import.meta.url), 'WatchGuardianRecovery', {
    'react-native': imports['react-native'], 'react-native-safe-area-context': imports['react-native-safe-area-context'],
    '../ui': imports['../ui'], '../platform/localization': nativeTranslationFixture,
    './NativeGuardianPolicy': { NativeGuardianPolicy: 'GuardianPolicy' },
    './NativeGuardianRecovery': { NativeGuardianRecovery: 'GuardianRecovery' },
  }, { AbortController });
  let reads = 0;
  const executableAt = 1_790_000_000, expiresAt = executableAt + 86_400;
  const props = { address, networkLabel: 'Ethereum', lifetime: new AbortController().signal, onBack() {},
    async read() { reads++; return { status: 'observed', observation: { exists: true,
      active: { status: 'pending', executableAt, expiresAt }, observedBlock: { number: 1_234_567 } } }; } };
  try {
    const initial = screenElements(f.render(props));
    button(initial, englishI18n.t('settings.smartAccountInfrastructureCheckStatus')).props.onPress(); await tick();
    assert.equal(reads, 1);
    assert(screenElements(f.render(props)).some(node => node.children.includes('Recovery scheduled')));
    englishI18n.addResourceBundle('ko', 'translation', languageMessages('ko'), true, true);
    await englishI18n.changeLanguage('ko');
    const localized = screenElements(f.render(props));
    assert(localized.some(node => node.children.includes('복구 예약됨')));
    const dateLabel = englishI18n.t('mobile.recoveryStatusViews.watch.readyAt', {
      date: new Date(executableAt * 1000).toLocaleString('ko'),
    });
    assert(localized.some(node => node.children.includes(dateLabel)));
    assert.equal(reads, 1);
  } finally { await englishI18n.changeLanguage('en'); f.close(); }
});
