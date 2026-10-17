package xyz.getkakure.zingo

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The JS surface over the zingolib Binding Layer, the same surface as
 * ios/src/ZingoModule.swift. Every call blocks on the binding (gRPC, proving,
 * the mixnet bootstrap), so each body hops to Dispatchers.IO: Expo's default
 * async queue is one HandlerThread shared by every module, and the JS thread
 * must never wait on the binding.
 */
class ZingoModule : Module() {
  private val session by lazy { WalletSession { reactContext() } }

  override fun definition() = ModuleDefinition {
    Name("Zingo")

    // `{ requestId, phase: "route" | "proving" | "sent", ...detail }` while a send runs.
    Events("onSendPhase")

    AsyncFunction("openWallet") Coroutine { chain: String, serverUri: String ->
      blocking { session.open(chain, serverUri) }
    }

    AsyncFunction("createWallet") Coroutine { chain: String, serverUri: String ->
      blocking { session.create(chain, serverUri) }
    }

    AsyncFunction("restoreWallet") Coroutine { chain: String, serverUri: String, seedPhrase: String, birthday: Int ->
      blocking { session.restore(chain, serverUri, seedPhrase, birthday.coerceAtLeast(0).toUInt()) }
    }

    AsyncFunction("revealSeed") Coroutine { ->
      blocking { session.revealSeed() }
    }

    AsyncFunction("forgetWallet") Coroutine { chain: String ->
      blocking { session.forget(chain) }
    }

    AsyncFunction("getAddress") Coroutine { ->
      blocking { session.address() }
    }

    AsyncFunction("newPayoutAddress") Coroutine { ->
      blocking { session.newAddress() }
    }

    AsyncFunction("sync") Coroutine { ->
      blocking { session.startSync() }
    }

    AsyncFunction("syncStatus") Coroutine { ->
      blocking { session.syncStatus() }
    }

    AsyncFunction("balance") Coroutine { ->
      blocking { session.balance() }
    }

    AsyncFunction("activity") Coroutine { ->
      blocking { session.activity() }
    }

    AsyncFunction("send") Coroutine {
        address: String, zatoshis: String, memo: String, allowedPools: List<String>, requestId: String ->
      blocking {
        session.pay(address, zatoshis, memo, allowedPools) { phase, detail ->
          sendEvent("onSendPhase", detail + mapOf("requestId" to requestId, "phase" to phase))
        }
      }
    }

    AsyncFunction("warmMixnet") Coroutine { ->
      blocking { session.warmMixnet() }
    }

    AsyncFunction("mixnetStatus") Coroutine { ->
      blocking { session.mixnetStatus() }
    }

    AsyncFunction("planOrchardDrain") Coroutine { ->
      blocking { session.orchardDrainPlan() }
    }

    AsyncFunction("drainOrchard") Coroutine { ->
      blocking { session.drainOrchard() }
    }

    // Android has no per-file backup flag: wallet files sit in noBackupFilesDir,
    // and the app's own files rely on the manifest's backup settings.
    AsyncFunction("excludeFromBackup") Coroutine { path: String ->
      mapOf("path" to path)
    }
  }

  private fun reactContext(): Context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** Runs a blocking binding call on the IO pool; `init_logging` goes first, once. */
  private suspend fun <T> blocking(body: () -> T): T = withContext(Dispatchers.IO) {
    WalletSession.startLogging()
    body()
  }
}
