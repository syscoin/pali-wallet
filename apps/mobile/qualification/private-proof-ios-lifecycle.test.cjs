/* global __dirname */
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// UIKit/WebKit execution remains a native qualification gate. These contracts
// prevent the source-level unmounted-host regression without mocking WebKit.
const source = readFileSync(path.join(__dirname,
  '../modules/pali-private-prover/ios/PaliPrivateProverModule.swift'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first, `Missing lifecycle boundary: ${start}`);
  return source.slice(first, last);
}

test('iOS creates its isolated document in one owned foreground key window before loading', () => {
  const create = section('init(owner: PaliProofHost, id: String)', 'func userContentController');
  assert.match(create, /UIApplication\.shared\.connectedScenes/);
  assert.match(create, /\$0 as\? UIWindowScene/);
  assert.match(create, /activationState == \.foregroundActive/);
  assert.match(create, /isKeyWindow/);
  assert.match(create, /!\$0\.isHidden/);
  assert.match(create, /windows\.count == 1/);
  assert.match(create, /width: 1, height: 1/);
  assert.match(create, /view\.isUserInteractionEnabled = false/);
  assert.match(create, /view\.accessibilityElementsHidden = true/);
  assert.match(create, /view\.isOpaque = false/);
  assert.match(create, /window\.insertSubview\(view, at: 0\)/);
  assert.doesNotMatch(create, /view\.isHidden = true|view\.alpha = 0|makeKeyAndVisible/);
  const run = section('private func runJob(', 'func close()');
  assert(run.indexOf('self.document = document') < run.indexOf('document.load()'));
});

test('the original window and scene fence new work and results while disposal can still drain', () => {
  assert.match(source, /private weak var hostingWindow: UIWindow\?/);
  assert.match(source, /private weak var hostingScene: UIWindowScene\?/);
  const owner = section('var ownsForegroundWindow: Bool', 'func userContentController');
  assert.match(owner, /view\.window === window/);
  assert.match(owner, /window\.windowScene === scene/);
  assert.match(owner, /scene\.activationState == \.foregroundActive/);
  const invoke = section('func invoke(', 'func retire(');
  assert.match(invoke, /operation == "start" \|\| operation == "startSentry"/);
  assert.match(invoke, /guard ownsForegroundWindow else/);
  const receive = section('fileprivate func receive(', 'fileprivate func fail(');
  assert(receive.indexOf('type == "disposed"') < receive.indexOf('document?.ownsForegroundWindow'));
  assert.match(receive, /guard document\?\.ownsForegroundWindow == true else/);
});

test('window removal remains behind document retirement and outstanding resource-read drainage', () => {
  assert.equal((source.match(/removeFromSuperview\(\)/g) ?? []).length, 1);
  const retire = section('func retire(contentProcessTerminated:', 'func detach()');
  assert.match(retire, /resources\.retire/);
  assert.match(retire, /documentRetired && readsDrained/);
  assert.doesNotMatch(retire, /removeFromSuperview/);
  const finish = section('fileprivate func finish(clean:', 'override func sharedObjectDidRelease');
  assert(finish.indexOf('document?.detach()') < finish.indexOf('ProofAdmission.release'));
  assert.match(source, /func detach\(\)[\s\S]*view\.removeFromSuperview\(\)/);
});

test('attachment preserves the isolated origin, pins, deadlines and poisoning boundary', () => {
  assert.match(source, /pali-private-prover:\/\/\\\(id\)\/index\.html/);
  assert.match(source, /hash == pin\.sha256/);
  assert.match(source, /worker-src/);
  assert.match(source, /\.now\(\) \+ 120/);
  assert.match(source, /\.now\(\) \+ 3/);
  assert.match(source, /poisoned = poisoned \|\| !clean/);
  assert.match(source, /message\.frameInfo\.isMainFrame/);
});

test('native SDK timeout evidence requires one exact observed entry and leaves both deadlines unchanged', () => {
  const android = readFileSync(path.join(__dirname,
    '../modules/pali-private-prover/android/src/main/java/org/syscoin/pali/prover/PaliPrivateProverModule.kt'), 'utf8');
  for (const native of [source, android]) {
    assert.match(native, /ERR_PALI_NATIVE_SDK_JOB_TIMEOUT/);
    assert.match(native, /sentry && submitted && domain && type == "sdk-start" && keys == basic && !sdkStarted/);
    assert.match(native, /sdkStarted = true/);
  }
  const run = section('private func runJob(', 'func close()');
  assert.match(run, /self\.submitted \? \(self\.sdkStarted \? \.sdkJobTimeout : \.jobTimeout\) : \.readinessTimeout/);
  assert.match(run, /\.now\(\) \+ 120/);
  const receive = section('fileprivate func receive(', 'fileprivate func fail(');
  const entry = receive.indexOf('type == "sdk-start"');
  assert(receive.indexOf('guard !isRevoked') < entry);
  assert(receive.indexOf('document?.ownsForegroundWindow == true') < entry);
  const branch = receive.slice(entry, receive.indexOf('} else if', entry));
  assert.doesNotMatch(branch, /resolve|deadline|cancel|invoke/);
  assert.match(android, /if \(submitted\) \{ if \(sdkStarted\) ProofFailure\.SDK_JOB_TIMEOUT else ProofFailure\.JOB_TIMEOUT \} else ProofFailure\.READINESS_TIMEOUT/);
  assert.match(android, /main\.postDelayed\(it, 120000\)/);
  assert.match(android, /main\.postDelayed\(it, 3000\)/);
});
