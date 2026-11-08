require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'PaliPrivateProver'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.author = 'Pali Wallet'
  s.homepage = 'https://github.com/syscoin/pali-wallet'
  s.source = { :git => 'https://github.com/syscoin/pali-wallet.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WebKit', 'CryptoKit'
  s.source_files = 'ios/*.swift'
  s.resource_bundles = { 'PaliPrivateProver' => ['generated/pali-private-prover'] }
end
