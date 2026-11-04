Pod::Spec.new do |s|
  s.name           = 'PaliWalletStorage'
  s.version        = '1.0.0'
  s.summary        = 'Pali private wallet storage policy'
  s.description    = 'Private directory protection and process lease for wallet storage.'
  s.license        = { :type => 'MIT' }
  s.author         = 'Syscoin'
  s.homepage       = 'https://github.com/syscoin/pali-wallet'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.swift_version = '5.9'
end
