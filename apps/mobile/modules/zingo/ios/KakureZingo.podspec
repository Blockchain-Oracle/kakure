# The zingolib Binding Layer, pinned in ../binding-layer.json (zingolib entry 502a453f).
# `pnpm --filter @kakure/mobile binding:ios` fetches the bundle by digest into
# ios/binding-layer/ZingoBindings (git-ignored), then scripts/link-ios-framework.sh links
# its two static archives into the dynamic ZingoRust.xcframework vendored here (see the
# script for why they cannot be linked statically into the app).
layer = File.join(__dir__, 'binding-layer')
# The C module maps the generated Swift imports (zingoFFI, zingo_nym_proxy_ffiFFI). The app
# target needs them as well: its explicit module scan resolves KakureZingo's imports.
module_maps = File.join(layer, 'ZingoBindings', 'build', 'generated', 'headers')
unless File.directory?(File.join(layer, 'ZingoRust.xcframework'))
  raise "KakureZingo: #{layer}/ZingoRust.xcframework is missing. " \
        'Run `pnpm --filter @kakure/mobile binding:ios` first.'
end

Pod::Spec.new do |s|
  # Not 'Zingo': its libZingo.a would shadow the Rust libzingo.a on a case-insensitive
  # volume (-lzingo resolves to the pod's own library first).
  s.name           = 'KakureZingo'
  s.version        = '0.0.0'
  s.summary        = 'Kakure wallet module over the zingolib Binding Layer'
  s.license        = 'MIT'
  s.author         = 'Kakure'
  s.homepage       = 'https://getkakure.xyz'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Our Swift, plus the UniFFI Swift for the wallet (zingo.swift) and the Nym proxy shim
  # (zingo_nym_proxy_ffi.swift). Both compile into this module, as in the SPM target.
  s.source_files = [
    'src/**/*.swift',
    'binding-layer/ZingoBindings/build/Sources/ZingoBindings/*.swift'
  ]
  # Slices: ios-arm64 (device) and ios-arm64_x86_64-simulator.
  s.vendored_frameworks = 'binding-layer/ZingoRust.xcframework'
  s.frameworks = 'SystemConfiguration'
  s.preserve_paths = 'binding-layer/ZingoBindings/build/generated/headers/*'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_INCLUDE_PATHS' => "$(inherited) \"#{module_maps}\""
  }
  s.user_target_xcconfig = {
    'SWIFT_INCLUDE_PATHS' => "$(inherited) \"#{module_maps}\""
  }
end
