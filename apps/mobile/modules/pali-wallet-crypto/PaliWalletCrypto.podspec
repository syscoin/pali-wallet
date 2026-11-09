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
  s.dependency 'QuickCrypto', '1.1.9'
  s.frameworks = 'CryptoKit', 'Security'
  s.source_files = 'ios/*.{swift,h,m}', 'shared/mimc_batch.{h,c}', 'shared/slh/*.{h,c}'
  s.public_header_files = 'shared/mimc_batch.h', 'shared/slh/pali_slh_native.h'
  s.preserve_paths = 'shared/*.inc', 'shared/FIAT-*', 'shared/PROVENANCE.md',
    'shared/slh/*.json', 'shared/slh/*.patch', 'shared/slh/LICENSE.upstream', 'shared/slh/licenses/*'
  # QuickCrypto's pinned pod materializes and links this exact public OpenSSL
  # artifact. The bridge alone includes its rnqc_* prefix before openssl/sha.h;
  # missing headers or declarations are a compile failure, never a fallback.
  quickcrypto = File.realpath(File.join(__dir__, '../../node_modules/react-native-quick-crypto'))
  openssl = File.join(quickcrypto, 'ios', 'openssl')
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_C_LANGUAGE_STANDARD' => 'c11',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) PALI_SLH_OPENSSL_SHA256=1',
    'HEADER_SEARCH_PATHS' => "$(inherited) \"#{openssl}\" \"#{File.join(openssl, 'include')}\""
  }
end
