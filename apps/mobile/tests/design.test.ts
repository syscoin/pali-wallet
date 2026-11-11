import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  screens,
  families,
  featureCoverage,
  getScreen,
  resolveDesignAction,
} from '../src/design/catalog.ts';

test('every source parity group has an explicitly mapped design surface', () => {
  const matrix = readFileSync(
    new URL('../design/PARITY_MATRIX.md', import.meta.url),
    'utf8'
  );
  const ids = [...matrix.matchAll(/^\| ([A-Z]\d{2}) \|/gm)].map((m) => m[1]!);
  assert.equal(ids.length, 46);
  assert.deepEqual(Object.keys(featureCoverage).sort(), ids.sort());
  for (const [id, targets] of Object.entries(featureCoverage)) {
    assert.ok(targets.length > 0, `${id} has no design surface`);
    for (const target of targets) assert.ok(getScreen(target));
  }
});
test('screen navigation is complete and every source-family entry resolves', () => {
  assert.equal(new Set(screens.map((s) => s.id)).size, screens.length);
  for (const family of families)
    assert.equal(getScreen(family.entry).family, family.id);
  for (const screen of screens) {
    assert.ok(screen.purpose.length > 20);
    assert.ok(screen.source.startsWith('source/'));
    for (const link of [
      screen.primary?.to,
      screen.secondary?.to,
      ...(screen.rows ?? []).map((r) => r.to),
    ])
      if (link) assert.ok(getScreen(link));
  }
});
test('the design never includes a usable private key or payment address', () => {
  const data = JSON.stringify(screens);
  assert.equal(/0x[0-9a-f]{40,64}/i.test(data), false);
  const phrase = getScreen('onboarding.phrase');
  assert.equal(phrase.fields, undefined);
});
test('critical journeys preserve source distinctions', () => {
  assert.equal(
    getScreen('onboarding.recover').primary?.to,
    'onboarding.recover-phrase'
  );
  assert.notEqual(
    getScreen('onboarding.recover').primary?.to,
    'onboarding.import'
  );
  assert.equal(
    getScreen('connections.proposal').primary?.to,
    'connections.session'
  );
  assert.match(getScreen('connections.batch').notice!.body, /does not undo/);
  assert.match(
    getScreen('transfer.unknown').notice!.body,
    /check the existing transaction/
  );
  assert.equal(getScreen('privacy.home').unit, 'ETH');
  assert.match(
    getScreen('privacy.deposit').fields!.find(
      (f) => f.label === 'Pool & network'
    )!.value,
    /Ethereum Mainnet/
  );
  assert.match(
    getScreen('accounts.import-key').notice!.body,
    /will not restore/
  );
});

test('shared authorizations retain their initiating operation and return path', () => {
  for (const sourceId of [
    'connections.transaction',
    'connections.batch',
    'sentry.service-review',
    'sentry.import-review',
    'activity.cancel-review',
  ]) {
    const source = getScreen(sourceId);
    const auth = getScreen(source.primary!.to);
    assert.equal(auth.authorization, true);
    assert.equal(auth.secondary!.to, sourceId);
    assert.ok(auth.rows!.some((row) => row.detail === source.title));
  }
  assert.match(
    getScreen(getScreen('connections.transaction').primary!.to).primary!.to,
    /connections.transaction/
  );
  assert.equal(
    getScreen(getScreen('privacy.deposit-ready').primary!.to).primary!.to,
    'privacy.deposit-pending'
  );
  assert.notEqual(
    getScreen('activity.cancel-review').rows!.find((r) => r.title === 'Action')!
      .detail,
    'Speed up'
  );
  assert.match(getScreen('privacy.backup-1').fields![0]!.value, /1 ETH/);
});

test('whole-note backup is a separately identified shared enhancement with a restore path', () => {
  for (const id of [
    'privacy.bundle-export',
    'privacy.bundle-import',
    'privacy.bundle-merge',
    'privacy.bundle-verify',
  ])
    assert.equal(getScreen(id).scope, 'shared-enhancement');
  assert.equal(
    getScreen('privacy.bundle-import').primary!.to,
    'privacy.bundle-merge'
  );
  assert.match(
    getScreen('privacy.bundle-merge').purpose,
    /never replaces newer spend state/
  );
  const auth = getScreen(getScreen('privacy.bundle-merge').primary!.to);
  assert.equal(auth.authorization, true);
  assert.equal(auth.requiresAccountSigner, false);
  assert.equal(auth.secondary!.to, 'privacy.bundle-merge');
  assert.equal(auth.primary!.to, 'privacy.bundle-restored');
  assert.equal(getScreen('privacy.bundle-restored').primary!.to, 'privacy.bundle-notes');
  assert.match(getScreen('privacy.bundle-notes').rows![0]!.detail!, /withdrawal unavailable/);
  const inventory = (id: string) => getScreen(id).rows!.filter((row) =>
    ['Snapshot', 'Retained inventory', 'Pools'].includes(row.title)
  );
  assert.equal(inventory('privacy.bundle-export').length, 3);
  assert.deepEqual(inventory('privacy.bundle-review'), inventory('privacy.bundle-export'));
  assert.deepEqual(inventory('privacy.bundle-verified'), inventory('privacy.bundle-export'));
});

test('reviewed software transfers confirm without a password screen while external signers retain their approval', () => {
  for (const id of ['transfer.review', 'transfer.eth-review', 'transfer.btc-review', 'transfer.nevm-review', 'transfer.nft-review', 'transfer.psbt']) {
    const review = getScreen(id), approval = getScreen(review.primary!.to);
    assert.equal(approval.deviceConfirmation, true);
    assert.equal(approval.fields?.some((field) => field.secret || field.label === 'Wallet password') ?? false, false);
    assert.equal(resolveDesignAction(review.primary!.to, 'personal'), approval.primary!.to);
    assert.equal(resolveDesignAction(review.primary!.to, 'hardware'), approval.id);
    assert.equal(resolveDesignAction(review.primary!.to, 'smart'), approval.id);
  }
  const secret = getScreen('settings.phrase');
  assert.equal(resolveDesignAction(secret.primary!.to, 'personal'), secret.primary!.to);
});

test('mobile previews use public entry and OS approval without collecting an app password', () => {
  for (const screen of screens) {
    for (const field of screen.fields ?? []) {
      if (!/password|\bpin\b/i.test(field.label)) continue;
      assert.ok(
        [
          'privacy.bundle-password',
          'privacy.bundle-verify',
          'privacy.bundle-import',
        ].includes(screen.id),
        `${screen.id} still collects an app credential`
      );
      assert.match(field.label, /backup.*password/i);
    }
    if (screen.authorization) {
      assert.equal(
        screen.fields?.some((field) => field.secret) ?? false,
        false
      );
      assert.match(
        screen.description!,
        /biometrics or your system passcode/
      );
    }
  }
  for (const id of [
    'onboarding.password',
    'onboarding.unlock',
    'onboarding.recover-password',
  ])
    assert.equal(getScreen(id).fields, undefined);
  assert.equal(getScreen('onboarding.unlock').primary!.label, 'Open wallet');
  assert.equal(getScreen('onboarding.biometrics').secondary, undefined);
  assert.equal(
    getScreen('settings.device-auth').primary!.to,
    'settings.security'
  );
});

test('portable note backups keep their separate file password', () => {
  assert.deepEqual(
    getScreen('privacy.bundle-password').fields!.map((field) => field.label),
    ['Backup file password', 'Confirm backup password']
  );
  for (const id of ['privacy.bundle-verify', 'privacy.bundle-import'])
    assert.ok(
      getScreen(id).fields!.some(
        (field) => field.label === 'Backup file password' && field.secret
      )
    );
});
