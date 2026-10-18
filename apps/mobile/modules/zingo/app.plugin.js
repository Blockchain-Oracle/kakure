// Expo config plugin for the zingo module.
//
// 1. Gradle resolves the app's runtime classpath with the app-level repositories only (root `allprojects`),
//    so the local Maven repository that fetch-binding-layer extracts (the zingolib Binding Layer AAR) must be
//    declared there; the module's own `repositories {}` block is not consulted for `:app`'s configurations.
//    The path is derived from the digest pinned in binding-layer.json, so it changes exactly when the pin does.
// 2. The binding AAR declares minSdkVersion 26 (Android 8.0); Expo's default is lower. Expo autolinking reads
//    the `android.minSdkVersion` Gradle property, so raise it there (never lower an existing higher value).
// 3. APK size. The AAR ships the Rust libraries (already stripped to their dynamic symbols) for four ABIs, about
//    85 MB per ABI, and AGP stores native libraries uncompressed by default: a 411 MB APK. So:
//    - `reactNativeArchitectures=arm64-v8a`: the React Native Gradle plugin turns this into
//      `defaultConfig.ndk.abiFilters`, which also filters the AAR's libraries out of packaging (every phone
//      Kakure targets is arm64; 32-bit and x86 emulators are dropped on purpose);
//    - `android.packagingOptions.excludes` drops the other ABIs' folders as a backstop (Expo's template reads it);
//    - `expo.useLegacyPackaging=true` compresses native libraries inside the APK (they are extracted at install).
//    AGP strips release native libraries with the NDK (rootProject.ext.ndkVersion; CI installs NDK 27.1); nothing
//    here sets `doNotStrip` or `keepDebugSymbols`.
const { withGradleProperties, withProjectBuildGradle } = require("expo/config-plugins");
const binding = require("./binding-layer.json");

const MARKER = "// kakure: zingolib binding layer (local Maven)";
const MIN_SDK_PROPERTY = "android.minSdkVersion";
const BINDING_MIN_SDK = 26;

function localRepository() {
  const digest = binding.digests.android.replace(/^sha256:/, "");
  return `\${rootDir}/../modules/zingo/android/build/binding-layer/${digest}/extracted/repository`;
}

function withBindingRepository(config) {
  return withProjectBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== "groovy" || gradle.modResults.contents.includes(MARKER)) {
      return gradle;
    }
    gradle.modResults.contents = gradle.modResults.contents.replace(
      /allprojects\s*\{\s*repositories\s*\{/,
      (match) => `${match}\n    ${MARKER}\n    maven { url = uri("${localRepository()}") }`,
    );
    return gradle;
  });
}

const SIZE_PROPERTIES = {
  // Compressing the large native libraries in packageRelease ran out of Gradle's default 2 GB heap
  // (java.lang.OutOfMemoryError on CI); GitHub's ubuntu runners have 16 GB.
  "org.gradle.jvmargs": "-Xmx4096m -XX:MaxMetaspaceSize=1024m -XX:+HeapDumpOnOutOfMemoryError",
  reactNativeArchitectures: "arm64-v8a",
  "android.packagingOptions.excludes": "lib/armeabi-v7a/**,lib/x86/**,lib/x86_64/**",
  "expo.useLegacyPackaging": "true",
};

function withArm64Only(config) {
  return withGradleProperties(config, (gradle) => {
    const items = gradle.modResults;
    for (const [key, value] of Object.entries(SIZE_PROPERTIES)) {
      const existing = items.find((item) => item.type === "property" && item.key === key);
      if (existing) existing.value = value;
      else items.push({ type: "property", key, value });
    }
    return gradle;
  });
}

function withBindingMinSdk(config) {
  return withGradleProperties(config, (gradle) => {
    const items = gradle.modResults;
    const existing = items.find((item) => item.type === "property" && item.key === MIN_SDK_PROPERTY);
    if (existing) {
      existing.value = String(Math.max(Number(existing.value) || 0, BINDING_MIN_SDK));
    } else {
      items.push({ type: "property", key: MIN_SDK_PROPERTY, value: String(BINDING_MIN_SDK) });
    }
    return gradle;
  });
}

module.exports = function withZingo(config) {
  return withArm64Only(withBindingMinSdk(withBindingRepository(config)));
};
