package xyz.getkakure.zingo

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Same JS surface as ios/src/ZingoModule.swift. The Android port wraps the
// generated Kotlin bindings (uniffi.zingo.*, uniffi.zingo_nym_proxy_ffi.*) from
// the AAR that build.gradle resolves; until then every call rejects.
class ZingoModule : Module() {
  private fun pending(): Nothing =
    throw CodedException("ERR_ZINGO_ANDROID_PENDING", "the Android wallet binding is not wired yet", null)

  override fun definition() = ModuleDefinition {
    Name("Zingo")

    AsyncFunction("openWallet") { _: String, _: String -> pending() }
    AsyncFunction("createWallet") { _: String, _: String -> pending() }
    AsyncFunction("getAddress") { pending() }
    AsyncFunction("sync") { pending() }
    AsyncFunction("syncStatus") { pending() }
    AsyncFunction("balance") { pending() }
    AsyncFunction("send") { _: String, _: String, _: String -> pending() }
    AsyncFunction("mixnetStatus") { pending() }
  }
}
