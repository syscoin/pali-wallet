const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('resource exports compile in the installed Expo builder and exist only in the exact SLH fixture', {
  skip: process.platform !== 'darwin',
}, () => {
  const module = readFileSync(require.resolve('../modules/pali-wallet-crypto/ios/PaliWalletCryptoModule.swift'), 'utf8');
  const helperStart = module.indexOf('  private func slhResourceDefinition(');
  const bodyStart = module.indexOf('    slhResourceDefinition(Function("beginSlhQualificationResources")');
  assert(helperStart > 0 && bodyStart > helperStart, 'the guarded definitions must use supported builder expressions');
  const helper = module.slice(helperStart, module.indexOf('  public func definition()', helperStart));
  const definitions = module.slice(bodyStart, module.indexOf('    AsyncFunction("publicMerkleBatch")', bodyStart));
  assert.equal((definitions.match(/slhResourceDefinition\(Function\(/g) || []).length, 3);
  assert.equal((module.match(/Function\("(?:begin|finish|cancel)SlhQualificationResources"/g) || []).length, 3);
  assert(helper.includes('guard Bundle.main.bundleIdentifier == PaliSlhQualificationResources.bundleIdentifier'));
  const resources = readFileSync(require.resolve('../modules/pali-wallet-crypto/ios/PaliSlhQualificationResources.swift'), 'utf8');
  assert.match(resources, /static let bundleIdentifier = "com\.paliwallet\.qualification\.physical\.slh"/);
  const expo = path.dirname(require.resolve('expo-modules-core/package.json'));
  const builder = path.join(expo, 'ios/Core/Modules/ModuleDefinitionBuilder.swift');
  // An empty ModuleDefinition has ObjectDefinition's unknown classification;
  // the actual collector ignores unknown definitions rather than flattening them.
  const object = readFileSync(path.join(expo, 'ios/Core/Objects/ObjectDefinition.swift'), 'utf8');
  assert.match(object, /_definitionClassification: DefinitionClassification\s*\{\s*return \.unknown/);
  assert.match(object, /case \.unknown,[\s\S]*?break/);
  const directory = mkdtempSync(path.join(tmpdir(), 'pali-slh-module-builder-'));
  try {
    const main = path.join(directory, 'main.swift'), executable = path.join(directory, 'builder-test');
    // Only the host/JSI values are shims. Compile the installed Expo builder and
    // exact production helper/expressions, including their autoclosure boundary.
    writeFileSync(main, `import Foundation
public protocol AnyDefinition {}
public final class ModuleDefinition: AnyDefinition {
  let definitions: [AnyDefinition]
  init(definitions: [AnyDefinition]) { self.definitions = definitions }
}
struct NamedDefinition: AnyDefinition { let name: String }
var constructed: [String] = []
func Function<R>(_ name: String, _ body: @escaping () throws -> R) -> AnyDefinition {
  constructed.append(name); return NamedDefinition(name: name)
}
func Function<A, R>(_ name: String, _ body: @escaping (A) throws -> R) -> AnyDefinition {
  constructed.append(name); return NamedDefinition(name: name)
}
enum PaliSlhQualificationResources {
  static let bundleIdentifier = "com.paliwallet.qualification.physical.slh"
}
struct Resources {
  func begin() throws -> String { "unused" }
  func finish(_ id: String) throws -> [String: Any] { [:] }
  func cancel(_ id: String) {}
}
enum PaliSlhFailure: Error { case unavailable }
final class Probe {
  let bundleIdentifier: String
  let slhQualificationResources = Resources()
  init(_ bundleIdentifier: String) { self.bundleIdentifier = bundleIdentifier }
  func slhForeground() -> Bool { true }
${helper.replaceAll('Bundle.main.bundleIdentifier', 'bundleIdentifier')}
  @ModuleDefinitionBuilder func definition() -> ModuleDefinition {
${definitions}
  }
}
for bundle in ["com.paliwallet.mobile", "com.paliwallet.qualification", "com.paliwallet.qualification.physical.import", "com.paliwallet.qualification.physical.generate", "com.paliwallet.qualification.physical.slh.other", "com.paliwallet.qualification.physical.slh"] {
  constructed = []
  let definition = Probe(bundle).definition()
  let names = definition.definitions.compactMap { ($0 as? NamedDefinition)?.name }
  let expected = bundle == PaliSlhQualificationResources.bundleIdentifier ? ["beginSlhQualificationResources", "finishSlhQualificationResources", "cancelSlhQualificationResources"] : []
  precondition(names == expected && constructed == expected)
}
print("6 bundle registrations checked")
`);
    const compiled = spawnSync('swiftc', ['-module-cache-path', path.join(directory, 'module-cache'), builder, main, '-o', executable],
      { encoding: 'utf8', timeout: 60000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '6 bundle registrations checked');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
