package xyz.getkakure.zingo

import expo.modules.kotlin.exception.CodedException
import java.util.Locale
import uniffi.zingo.ZingolibException
import uniffi.zingo_nym_proxy_ffi.ProxyFfiException

/**
 * Errors that reach JS, with the same codes as ios/src/ZingoError.swift. The
 * `code` is what the TS layer switches on; the message is for logs. Binding
 * errors keep zingolib's variant name in the code (`Send` -> `ERR_ZINGO_SEND`).
 */
internal object ZingoError {
  fun invalidInput(message: String) = make("ERR_ZINGO_INVALID_INPUT", message)

  fun walletExists(message: String) = make("ERR_ZINGO_WALLET_EXISTS", message)

  fun noWallet() = make("ERR_ZINGO_NO_WALLET", "open or create a wallet first")

  /** The recovery store failed: the AndroidKeyStore key or the sealed file (the iOS Keychain's role). */
  fun keychain(message: String, cause: Throwable? = null) = make("ERR_ZINGO_KEYCHAIN", message, cause)

  fun mixnet(message: String) = make("ERR_ZINGO_MIXNET", message)

  fun poolRefused(message: String) = make("ERR_ZINGO_POOL_REFUSED", message)

  fun malformedReply(message: String) = make("ERR_ZINGO_MALFORMED_REPLY", message)

  fun binding(error: ZingolibException): CodedException {
    val name = variant(error)
    return make("ERR_ZINGO_${name.uppercase(Locale.ROOT)}", "$name: ${error.message}", error)
  }

  fun proxy(error: ProxyFfiException): CodedException {
    val name = when (error) {
      is ProxyFfiException.Runtime -> "Runtime"
      is ProxyFfiException.Connect -> "Connect"
    }
    return make("ERR_ZINGO_PROXY", "$name: ${error.message}", error)
  }

  private fun make(code: String, message: String, cause: Throwable? = null) = CodedException(code, message, cause)

  /**
   * The variant name, spelled out rather than read from the class name, which
   * R8 may rename in a release build. Exhaustive over the sealed class, so a
   * binding that adds a variant fails the compile instead of mislabelling it.
   */
  private fun variant(error: ZingolibException): String = when (error) {
    is ZingolibException.LightclientNotInitialized -> "LightclientNotInitialized"
    is ZingolibException.LightclientLockPoisoned -> "LightclientLockPoisoned"
    is ZingolibException.Panic -> "Panic"
    is ZingolibException.Save -> "Save"
    is ZingolibException.Init -> "Init"
    is ZingolibException.Sync -> "Sync"
    is ZingolibException.Rescan -> "Rescan"
    is ZingolibException.Read -> "Read"
    is ZingolibException.Send -> "Send"
    is ZingolibException.Shield -> "Shield"
    is ZingolibException.InvalidInput -> "InvalidInput"
    is ZingolibException.Wallet -> "Wallet"
    is ZingolibException.Indexer -> "Indexer"
    is ZingolibException.Offline -> "Offline"
    is ZingolibException.SideChannelPoisoned -> "SideChannelPoisoned"
    is ZingolibException.MigrationNotInProgress -> "MigrationNotInProgress"
    is ZingolibException.MigrationAlreadyInProgress -> "MigrationAlreadyInProgress"
    is ZingolibException.MigrationConsentStale -> "MigrationConsentStale"
    is ZingolibException.MigrationCadenceFixed -> "MigrationCadenceFixed"
    is ZingolibException.MigrationSplit -> "MigrationSplit"
    is ZingolibException.Migration -> "Migration"
    is ZingolibException.Mixnet -> "Mixnet"
    is ZingolibException.WalletChainMismatch -> "WalletChainMismatch"
  }
}

/** Runs a binding call and maps its typed errors. */
internal inline fun <T> ffi(call: () -> T): T =
  try {
    call()
  } catch (error: ZingolibException) {
    throw ZingoError.binding(error)
  } catch (error: ProxyFfiException) {
    throw ZingoError.proxy(error)
  }

internal fun millisecondsSince(startNanos: Long): Long = (System.nanoTime() - startNanos) / 1_000_000
