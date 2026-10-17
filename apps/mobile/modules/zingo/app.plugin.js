// Expo config plugin for the zingo module.
//
// 1. Gradle resolves the app's runtime classpath with the app-level repositories only (root `allprojects`),
//    so the local Maven repository that fetch-binding-layer extracts (the zingolib Binding Layer AAR) must be
//    declared there; the module's own `repositories {}` block is not consulted for `:app`'s configurations.
//    The path is derived from the digest pinned in binding-layer.json, so it changes exactly when the pin does.
// 2. The binding AAR declares minSdkVersion 26 (Android 8.0); Expo's default is lower. Expo autolinking reads
//    the `android.minSdkVersion` Gradle property, so raise it there (never lower an existing higher value).
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
  return withBindingMinSdk(withBindingRepository(config));
};
