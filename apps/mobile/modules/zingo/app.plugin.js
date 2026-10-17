// Expo config plugin for the zingo module.
//
// Gradle resolves the app's runtime classpath with the app-level repositories only (root `allprojects`),
// so the local Maven repository that fetch-binding-layer extracts (the zingolib Binding Layer AAR) must be
// declared there; the module's own `repositories {}` block is not consulted for `:app`'s configurations.
// The path is derived from the digest pinned in binding-layer.json, so it changes exactly when the pin does.
const { withProjectBuildGradle } = require("expo/config-plugins");
const binding = require("./binding-layer.json");

const MARKER = "// kakure: zingolib binding layer (local Maven)";

function localRepository() {
  const digest = binding.digests.android.replace(/^sha256:/, "");
  return `\${rootDir}/../modules/zingo/android/build/binding-layer/${digest}/extracted/repository`;
}

module.exports = function withZingoBindingRepository(config) {
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
};
