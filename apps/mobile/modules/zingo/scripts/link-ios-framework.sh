#!/bin/sh
# Links the pinned Binding Layer's two static archives (libzingo.a, the wallet;
# libzingo_nym_proxy_ffi.a, the Nym proxy) into one dynamic ZingoRust.xcframework.
#
# Why: at zingolib 502a453f both archives build with panic = "unwind", so each
# brings its own rust_eh_personality. Linked statically into a React Native app,
# which already uses the C++ and Objective-C personalities, that is four, and
# Apple's linker fails: "Too many personality routines for compact unwind to
# encode". In their own image the two Rust archives still share one std and one
# panic runtime, as upstream intends, and the app keeps its two.
#
# Input: ios/binding-layer/ZingoBindings (placed by fetch-binding-layer).
# Output: ios/binding-layer/ZingoRust.xcframework, rebuilt only when the bundle
# digest changes. Prints the output path.
set -eu

module=$(cd "$(dirname "$0")/.." && pwd)
layer="$module/ios/binding-layer"
build="$layer/ZingoBindings/build"
out="$layer/ZingoRust.xcframework"
stamp="$layer/ZingoRust.digest"
digest=$(cat "$layer/digest")

if [ -d "$out" ] && [ "$(cat "$stamp" 2>/dev/null)" = "$digest" ]; then
  echo "$out"
  exit 0
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# link <sdk> <xcframework slice> <clang target> <output>
link() {
  xcrun -sdk "$1" clang -dynamiclib -target "$3" \
    -Wl,-all_load \
    "$build/Zingolib.xcframework/$2/libzingo.a" \
    "$build/ZingoNymProxyFFI.xcframework/$2/libzingo_nym_proxy_ffi.a" \
    '-Wl,-exported_symbol,_ffi_zingo_*' '-Wl,-exported_symbol,_uniffi_zingo_*' \
    -Wl,-dead_strip \
    -framework SystemConfiguration -framework CoreFoundation -framework Security -lobjc \
    -install_name @rpath/ZingoRust.framework/ZingoRust \
    -o "$4" 2>&1 | grep -v 'was built for newer' >&2 || true
  [ -f "$4" ]
}

# framework <dir> <platform> <binary>
framework() {
  mkdir -p "$1/ZingoRust.framework"
  mv "$3" "$1/ZingoRust.framework/ZingoRust"
  cat > "$1/ZingoRust.framework/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>ZingoRust</string>
  <key>CFBundleIdentifier</key><string>xyz.getkakure.ZingoRust</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>ZingoRust</string>
  <key>CFBundlePackageType</key><string>FMWK</string>
  <key>CFBundleShortVersionString</key><string>7.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleSupportedPlatforms</key><array><string>$2</string></array>
  <key>MinimumOSVersion</key><string>16.0</string>
</dict>
</plist>
PLIST
}

link iphoneos ios-arm64 arm64-apple-ios16.0 "$work/device"
framework "$work/ios-arm64" iPhoneOS "$work/device"

link iphonesimulator ios-arm64_x86_64-simulator arm64-apple-ios16.0-simulator "$work/sim-arm64"
link iphonesimulator ios-arm64_x86_64-simulator x86_64-apple-ios16.0-simulator "$work/sim-x86_64"
lipo -create "$work/sim-arm64" "$work/sim-x86_64" -output "$work/sim"
framework "$work/ios-simulator" iPhoneSimulator "$work/sim"

rm -rf "$out"
xcodebuild -create-xcframework \
  -framework "$work/ios-arm64/ZingoRust.framework" \
  -framework "$work/ios-simulator/ZingoRust.framework" \
  -output "$out" >&2
echo "$digest" > "$stamp"
echo "$out"
