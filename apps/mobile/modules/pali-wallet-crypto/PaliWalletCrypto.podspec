require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'PaliWalletCrypto'
  s.version = package['version']
  s.summary = package['description']
  s.description = package['description']
  s.license = package['license']
  s.author = 'Pali Wallet'
  s.homepage = 'https://github.com/syscoin/pali-wallet'
  s.source = { :git => 'https://github.com/syscoin/pali-wallet.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CryptoKit', 'Security'
  s.source_files = 'ios/*.{swift,h,m}', 'shared/mimc_batch.{h,c}'
  s.public_header_files = 'shared/mimc_batch.h'
  s.preserve_paths = 'shared/*.inc', 'shared/FIAT-*', 'shared/PROVENANCE.md'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
