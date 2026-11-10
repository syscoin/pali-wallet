import assert from 'node:assert/strict';
import test from 'node:test';
import type { GuardianRecoveryObservation } from '../../../source/utils/smartAccount/guardianStatus.ts';
import type { NativeGuardianRecoveryIntent } from '../src/custody/walletCatalogue.ts';
import { formatBaseUnits } from '../src/core/amounts.ts';
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
  replacement: { ...replacement, xpub: 'replacement public key' },
  payer: { ...payer, xpub: 'payer public key' },
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const imports = {
  '../platform/localization': nativeTranslationFixture,
  'react-native': {
    ActivityIndicator: 'ActivityIndicator',
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
      ['Button', 'Card', 'Header', 'Notice', 'Screen', 'Text'].map((name) => [
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
function screen(exported: string) {
  return screenFixture(
    new URL('../src/screens/NativeGuardianRecovery.tsx', import.meta.url),
    exported,
    imports
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
    chainId: 1,
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
        replacementId: replacement.id,
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
        replacementId: replacement.id,
        payerId: payer.id,
      },
    ]);
  } finally {
    f.close();
  }
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
    chainId: 1,
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
