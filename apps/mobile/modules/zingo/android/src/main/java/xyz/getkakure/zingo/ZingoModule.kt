package xyz.getkakure.zingo

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Same JS surface as ios/src/ZingoModule.swift. The Android port wraps the
// generated Kotlin bindings (uniffi.zingo.*, uniffi.zingo_nym_proxy_ffi.*) from
// the AAR that build.gradle resolves (stage S06); until then every call rejects
// with an explicit code, so the app can show an honest "not available yet" state.
class ZingoModule : Module() {
  private fun reject(promise: Promise) =
    promise.reject(CodedException("ERR_ZINGO_ANDROID_PENDING", "the Android wallet binding is not wired yet", null))

  override fun definition() = ModuleDefinition {
    Name("Zingo")

    AsyncFunction("openWallet") { _: String, _: String, promise: Promise -> reject(promise) }
    AsyncFunction("createWallet") { _: String, _: String, promise: Promise -> reject(promise) }
    AsyncFunction("getAddress") { promise: Promise -> reject(promise) }
    AsyncFunction("sync") { promise: Promise -> reject(promise) }
    AsyncFunction("syncStatus") { promise: Promise -> reject(promise) }
    AsyncFunction("balance") { promise: Promise -> reject(promise) }
    AsyncFunction("send") { _: String, _: String, _: String, promise: Promise -> reject(promise) }
    AsyncFunction("mixnetStatus") { promise: Promise -> reject(promise) }
  }
}
