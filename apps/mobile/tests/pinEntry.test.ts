import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { screenElements, screenFixture, type ScreenElement } from './screenFixture.ts';

function fixture(exported: 'PinPad' | 'PinSetup' | 'PinField' | 'PinEntryScreen', feedback = { shaking: false, clear() {} }) {
  let state = 'active';
  const activities = new Set<(state: string) => void>();
  const backs = new Set<() => boolean>();
  const host = screenFixture(new URL('../src/screens/PinEntry.tsx', import.meta.url), exported, {
    'react-native': {
      View: 'View', Modal: 'Modal', Animated: { View: 'AnimatedView' }, StyleSheet: { create: (value: unknown) => value },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      AppState: { get currentState() { return state; }, addEventListener: (_event: string, handler: (next: string) => void) => {
        activities.add(handler); return { remove: () => activities.delete(handler) };
      } },
      BackHandler: { addEventListener: (_event: string, handler: () => boolean) => {
        backs.add(handler); return { remove: () => backs.delete(handler) };
      } },
    },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '../ui': { ...Object.fromEntries(['Button', 'Header', 'Icon', 'PaliMark', 'Screen', 'Text'].map(name => [name, name])), colors: {} },
    './IdleActivityBoundary': { IdlePressable: 'Key' },
    '../platform/useBiometricPresentation': { useBiometricPresentation: () => ({ label: 'biometrics', icon: 'fingerprint' }) },
    './usePinErrorFeedback': { usePinErrorFeedback: () => ({ style: {}, ...feedback }) },
    '../core/biometricPresentation': { genericBiometrics: { label: 'biometrics', icon: 'fingerprint' } },
  }, {}, { target: ts.ScriptTarget.ES2022 });
  return {
    render: (props: Record<string, unknown>) => screenElements(host.render(props)),
    state(next: string) { state = next; for (const notify of activities) notify(next); },
    hardwareBack() { return [...backs].reverse().some(back => back()); },
    get backCount() { return backs.size; }, close: host.close,
  };
}

function key(elements: ScreenElement[], digit: string) {
  const label = digit === 'delete' ? 'Delete PIN digit' : `PIN digit ${digit}`;
  const found = elements.find(element => element.type === 'Key' && element.props.accessibilityLabel === label);
  assert(found, label); return found;
}
function entry(elements: ScreenElement[]) {
  const found = elements.find(element => typeof element.type === 'function' && element.type.name === 'PinEntryScreen');
  assert(found); return found;
}
function button(elements: ScreenElement[], title: string) {
  const found = elements.find(element => element.type === 'Button' && element.props.title === title);
  assert(found, title); return found;
}

test('PIN keypad completes exactly six digits once and backspace edits only the active entry', () => {
  const f = fixture('PinPad'), completed: string[] = [];
  const props = { onComplete: (pin: string) => completed.push(pin), resetKey: 'first' };
  const press = (digit: string) => key(f.render(props), digit).props.onPress();
  for (const digit of ['1', '2', 'delete', '3', '4', '5', '6', '7']) press(digit);
  assert.deepEqual(completed, ['134567']);
  press('8'); press('delete'); assert.equal(completed.length, 1);
  const tree = f.render(props);
  assert(!tree.some(element => element.type === 'Text' && element.children.includes('134567')));
  f.close();
});

test('disabled and background keypad cannot complete; leaving clears partial digits', () => {
  const f = fixture('PinPad'), completed: string[] = [];
  const props = { onComplete: (pin: string) => completed.push(pin), resetKey: 'first', disabled: false };
  key(f.render(props), '1').props.onPress();
  const stale = key(f.render(props), '2');
  f.render({ ...props, disabled: true }); stale.props.onPress();
  assert(f.render(props).some(element => element.props.accessibilityLabel === 'PIN, 1 of 6 digits entered'));
  f.state('background'); stale.props.onPress();
  assert(f.render(props).some(element => element.props.accessibilityLabel === 'PIN, 0 of 6 digits entered'));
  assert.deepEqual(completed, []); f.close(); stale.props.onPress(); assert.deepEqual(completed, []);
});

test('keys captured before a reset cannot enter digits or complete the replacement PIN scope', () => {
  const f = fixture('PinPad'), first: string[] = [], second: string[] = [];
  const old = f.render({ resetKey: 'old-review', onComplete: (pin: string) => first.push(pin) });
  const keys = ['1', '2', '3', '4', '5', '6'].map(digit => key(old, digit));
  const props = { resetKey: 'new-review', onComplete: (pin: string) => second.push(pin) };
  f.render(props);
  for (const captured of keys) captured.props.onPress();
  assert.deepEqual(first, []); assert.deepEqual(second, []);
  assert(f.render(props).some(element => element.props.accessibilityLabel === 'PIN, 0 of 6 digits entered'));
  f.close();
});

test('error feedback can retain only the filled-dot count after the PIN has cleared', () => {
  const feedback = { shaking: false, clear() { feedback.shaking = false; } };
  const f = fixture('PinPad', feedback), completed: string[] = [];
  const props = { resetKey: 0, onComplete: (pin: string) => completed.push(pin) };
  for (const digit of '123456') key(f.render(props), digit).props.onPress();
  assert.deepEqual(completed, ['123456']);
  feedback.shaking = true;
  const failed = { ...props, resetKey: 1, error: 'Incorrect PIN' };
  const tree = f.render(failed);
  const dots = tree.find(element => element.props.testID === 'pin-error-feedback'); assert(dots);
  assert.equal(dots.props.accessibilityLabel, 'PIN, 0 of 6 digits entered');
  const filled = screenElements(dots).filter(element => element.type === 'View' && element.props.style?.some((style: object | false) => style && 'backgroundColor' in style));
  assert.equal(filled.length, 6);
  feedback.shaking = false;
  assert.equal(screenElements(f.render(failed).find(element => element.props.testID === 'pin-error-feedback')).filter(element =>
    element.type === 'View' && element.props.style?.some((style: object | false) => style && 'backgroundColor' in style)).length, 0);
  for (const digit of '654321') key(f.render(failed), digit).props.onPress();
  assert.deepEqual(completed, ['123456', '654321'], 'Animation adds no submission and the new PIN is independent');
  f.close();
});

test('PIN setup confirms the same value, shows mismatch, then submits biometric choice once', () => {
  const f = fixture('PinSetup'), completed: { pin: string; biometric: boolean }[] = [];
  const props = { available: true, onBack() {}, onComplete: (pin: string, biometric: boolean) => completed.push({ pin, biometric }) };
  entry(f.render(props)).props.onComplete('123456');
  assert.equal(entry(f.render(props)).props.title, 'Confirm your PIN');
  entry(f.render(props)).props.onComplete('654321');
  assert.match(entry(f.render(props)).props.error, /do not match/);
  entry(f.render(props)).props.onComplete('123456');
  const choices = f.render(props);
  button(choices, 'Use biometrics').props.onPress(); button(choices, 'Not now').props.onPress();
  assert.deepEqual(completed, [{ pin: '123456', biometric: true }]);
  f.close();
});

test('an old setup choice cannot submit the PIN entered after returning to Create', () => {
  const f = fixture('PinSetup'), completed: string[] = [];
  const props = { available: true, onBack() {}, onComplete: (pin: string) => completed.push(pin) };
  entry(f.render(props)).props.onComplete('123456'); entry(f.render(props)).props.onComplete('123456');
  const previous = f.render(props), staleChoice = button(previous, 'Not now');
  previous.find(element => element.type === 'Header')!.props.onBack();
  entry(f.render(props)).props.onComplete('654321'); entry(f.render(props)).props.onComplete('654321');
  f.render(props); staleChoice.props.onPress(); assert.deepEqual(completed, []);
  button(f.render(props), 'Not now').props.onPress(); assert.deepEqual(completed, ['654321']);
  f.close();
});

for (const renderedBusy of [true, false]) test(`failed PIN setup permits return and a new entry ${renderedBusy ? 'after busy' : 'after an immediate failure'}`, () => {
  const f = fixture('PinSetup'), completed: string[] = [];
  const props = { available: true, onBack() {}, onComplete: (pin: string) => completed.push(pin) };
  entry(f.render(props)).props.onComplete('123456'); entry(f.render(props)).props.onComplete('123456');
  button(f.render(props), 'Not now').props.onPress();
  assert.deepEqual(completed, ['123456']);
  if (renderedBusy) f.render({ ...props, busy: true });
  const failed = f.render({ ...props, busy: false, error: 'Could not save the wallet. Try again.' });
  failed.find(element => element.type === 'Header')!.props.onBack();
  assert.equal(entry(f.render(props)).props.title, 'Create a 6-digit PIN');
  f.close();
});

for (const renderedBusy of [true, false]) test(`PIN-only setup clears a failed confirmation for a fresh keypad retry ${renderedBusy ? 'after busy' : 'after an immediate failure'}`, () => {
  const setup = fixture('PinSetup'), pad = fixture('PinPad'), completed: string[] = [];
  let props = { offerBiometrics: false, busy: false, error: '', onBack() {}, onComplete: (pin: string) => completed.push(pin) };
  const currentEntry = () => {
    setup.render(props);
    return entry(setup.render(props));
  };
  const keypad = () => {
    const current = currentEntry();
    return pad.render({ onComplete: current.props.onComplete, resetKey: current.props.resetKey, disabled: current.props.busy, error: current.props.error });
  };
  const enter = (pin: string) => { for (const digit of pin) key(keypad(), digit).props.onPress(); };
  enter('123456');
  assert.equal(currentEntry().props.title, 'Confirm your PIN');
  const previousConfirmation = currentEntry();
  enter('123456');
  assert.deepEqual(completed, ['123456']);
  enter('123456');
  assert.deepEqual(completed, ['123456'], 'A submitted confirmation cannot run twice');
  if (renderedBusy) { props = { ...props, busy: true }; keypad(); }
  props = { ...props, busy: false, error: 'Could not save the PIN. Try again.' };
  const retry = keypad();
  assert(retry.some(element => element.props.accessibilityLabel === 'PIN, 0 of 6 digits entered'));
  previousConfirmation.props.onComplete('123456');
  assert.deepEqual(completed, ['123456'], 'The previous confirmation callback is retired');
  enter('654321');
  assert.match(currentEntry().props.error, /do not match/);
  assert.deepEqual(completed, ['123456']);
  enter('123456');
  assert.deepEqual(completed, ['123456', '123456']);
  enter('123456');
  assert.deepEqual(completed, ['123456', '123456'], 'The retried confirmation still submits once');
  setup.close(); pad.close();
});

test('Back from a failed PIN confirmation retires its error through the next local flow', () => {
  const f = fixture('PinSetup');
  const props = { offerBiometrics: false, onBack() {}, onComplete() {} };
  entry(f.render(props)).props.onComplete('123456'); entry(f.render(props)).props.onComplete('123456');
  f.render({ ...props, busy: true });
  const failedProps = { ...props, error: 'Could not save the PIN. Try again.' };
  f.render(failedProps);
  const failed = entry(f.render(failedProps)); assert.equal(failed.props.error, failedProps.error);
  failed.props.onBack();
  const create = entry(f.render(failedProps));
  assert.equal(create.props.title, 'Create a 6-digit PIN'); assert.equal(create.props.error, undefined);
  create.props.onComplete('654321');
  const confirm = entry(f.render(failedProps));
  assert.equal(confirm.props.error, undefined, 'The dismissed parent error does not return on Confirm');
  confirm.props.onComplete('123456');
  assert.match(entry(f.render(failedProps)).props.error, /do not match/);
  entry(f.render(failedProps)).props.onComplete('654321');
  f.render({ ...failedProps, busy: true }); f.render(failedProps);
  assert.equal(entry(f.render(failedProps)).props.error, failedProps.error, 'A later failed submission reports the same error again');
  f.close();
});

test('PIN field cancellation retires the modal callback and another field cannot inherit it', () => {
  const f = fixture('PinField'), changes: string[] = [], other: string[] = [];
  const props = { label: 'Wallet PIN', value: '', busy: false, onChange: (pin: string) => changes.push(pin) };
  button(f.render(props), 'Enter PIN').props.onPress();
  const first = entry(f.render(props)); first.props.onBack(); first.props.onComplete('123456');
  assert.deepEqual(changes, []);
  button(f.render(props), 'Enter PIN').props.onPress(); const second = entry(f.render(props));
  f.render({ ...props, label: 'Different wallet PIN', onChange: (pin: string) => other.push(pin) });
  second.props.onComplete('654321'); assert.deepEqual(other, []);
  f.close();
});

test('PIN screen owns and removes its hardware Back handler', () => {
  const f = fixture('PinEntryScreen'); let cancelled = 0;
  f.render({ title: 'Unlock', onComplete() {}, onBack() { cancelled++; } });
  assert.equal(f.backCount, 1); assert.equal(f.hardwareBack(), true); assert.equal(cancelled, 1);
  f.close(); assert.equal(f.backCount, 0);
});


test('PIN setup displays detected Face ID without changing the enrollment choice', () => {
  const f = fixture('PinSetup'), completed: boolean[] = [];
  const props = { available: true, biometrics: { label: 'Face ID', icon: 'face-id' }, onBack() {},
    onComplete: (_pin: string, enrolled: boolean) => completed.push(enrolled) };
  entry(f.render(props)).props.onComplete('123456'); entry(f.render(props)).props.onComplete('123456');
  const choices = f.render(props);
  assert(choices.some(element => element.type === 'Icon' && element.props.name === 'face-id'));
  button(choices, 'Use Face ID').props.onPress();
  assert.deepEqual(completed, [true]); f.close();
});
