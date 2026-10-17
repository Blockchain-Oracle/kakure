package xyz.getkakure.zingo

import android.content.Context
import expo.modules.kotlin.exception.CodedException
import java.util.concurrent.atomic.AtomicBoolean
import uniffi.zingo.IndexerConnection
import uniffi.zingo.SyncSettings
import uniffi.zingo.createNewUnifiedAddress
import uniffi.zingo.getBalance
import uniffi.zingo.getLatestBlockServer
import uniffi.zingo.getLatestBlockWallet
import uniffi.zingo.getSpendableBalanceTotal
import uniffi.zingo.getUnifiedAddresses
import uniffi.zingo.getValueTransfers
import uniffi.zingo.initFromBytes
import uniffi.zingo.initFromSeed
import uniffi.zingo.initLogging
import uniffi.zingo.initNew
import uniffi.zingo.pollSync
import uniffi.zingo.runSync
import uniffi.zingo.saveWalletBytes
import uniffi.zingo.statusSync

/**
 * One live wallet at a time (the binding holds a single global LightClient).
 * Every method blocks on the binding, so callers run it off the JS thread.
 * Money-moving calls (send, migrate, the mixnet) live in WalletMoney.kt.
 * Mirrors ios/src/WalletSession.swift.
 */
internal class WalletSession(private val context: () -> Context) {
  class Live(val chain: String, val serverUri: String, val vault: WalletVault)

  /** The report of a finished sync task; `value` is the JSON under `sync_complete`, possibly null. */
  private class SyncReport(val value: Any?)

  private val lock = Any()
  private var live: Live? = null
  private var lastSyncReport: SyncReport? = null
  val mixnet = MixnetTransport()

  // Lifecycle

  /**
   * Opens the saved wallet for `chain`, or rebuilds it from the sealed
   * recovery info when only that survives. Never creates a wallet.
   */
  fun open(chain: String, serverUri: String): Map<String, Any?> {
    val vault = vaultFor(chain)
    val connection = indexerConnection(chain, serverUri)
    val status = when {
      vault.hasWalletFile() -> {
        val bytes = vault.readWallet()
        ffi { initFromBytes(bytes, connection) }
        "opened"
      }
      vault.hasRecoveryInfo() -> {
        val recovery = parseObject(String(vault.readRecoveryInfo(), Charsets.UTF_8))
        val seed = recovery["seed_phrase"] as? String
          ?: throw ZingoError.keychain("the stored recovery info has no seed phrase")
        ffi { initFromSeed(seed, birthdayOf(recovery), connection) }
        "restored"
      }
      else -> return mapOf("status" to "absent", "chain" to chain)
    }
    adopt(Live(chain, serverUri, vault))
    save()
    return mapOf("status" to status, "chain" to chain, "birthday" to storedBirthday(vault))
  }

  /**
   * Creates a new wallet for `chain`. The seed goes to the sealed store only;
   * the reply carries the birthday height, never the seed.
   */
  fun create(chain: String, serverUri: String): Map<String, Any?> {
    val vault = vaultFor(chain)
    refuseIfPresent(vault, chain)
    val connection = indexerConnection(chain, serverUri)
    val recoveryText = ffi { initNew(connection, 0u) }
    val recovery = parseObject(recoveryText)
    if (recovery["seed_phrase"] !is String) {
      throw ZingoError.malformedReply("init_new returned no recovery info")
    }
    vault.storeRecoveryInfo(recoveryText.toByteArray(Charsets.UTF_8))
    adopt(Live(chain, serverUri, vault))
    save()
    return mapOf("status" to "created", "chain" to chain, "birthday" to birthdayOf(recovery).toLong())
  }

  /**
   * Restores a wallet from a seed phrase the person typed. `birthday` 0 scans
   * from the binding's library birthday (slower, never misses funds).
   */
  fun restore(chain: String, serverUri: String, seedPhrase: String, birthday: UInt): Map<String, Any?> {
    val vault = vaultFor(chain)
    refuseIfPresent(vault, chain)
    val words = seedPhrase.lowercase()
      .map { if (it.isWhitespace()) ' ' else it }
      .joinToString("")
      .split(' ')
      .filter { it.isNotEmpty() }
    if (words.size !in SEED_WORD_COUNTS) {
      throw ZingoError.invalidInput("a recovery phrase has 12 to 24 words; this one has ${words.size}")
    }
    val connection = indexerConnection(chain, serverUri)
    val recoveryText = ffi { initFromSeed(words.joinToString(" "), birthday, connection) }
    val recovery = parseObject(recoveryText)
    vault.storeRecoveryInfo(recoveryText.toByteArray(Charsets.UTF_8))
    adopt(Live(chain, serverUri, vault))
    save()
    return mapOf("status" to "restored", "chain" to chain, "birthday" to birthdayOf(recovery).toLong())
  }

  /**
   * The recovery phrase for the backup screen and quiz. Only the person's own
   * screen asks for it (screenshot-blocked, after the device lock).
   */
  fun revealSeed(): Map<String, Any?> {
    val live = current()
    val recovery = parseObject(String(live.vault.readRecoveryInfo(), Charsets.UTF_8))
    val seed = recovery["seed_phrase"] as? String
      ?: throw ZingoError.keychain("the stored recovery info has no seed phrase")
    return mapOf("words" to seed.split(' ').filter { it.isNotEmpty() }, "birthday" to birthdayOf(recovery).toLong())
  }

  /**
   * Forget this device: deletes the chain's wallet file and sealed recovery
   * info. The in-memory client is dropped on the next init.
   */
  fun forget(chain: String): Map<String, Any?> {
    val vault = vaultFor(chain)
    mixnet.reset()
    vault.erase()
    synchronized(lock) {
      if (live?.chain == chain) live = null
    }
    return mapOf("status" to "forgotten", "chain" to chain)
  }

  // Wallet reads

  /** The wallet's default Orchard-only unified address (receive screen). */
  fun address(): Map<String, Any?> {
    current()
    val listed = parseJSON(ffi { getUnifiedAddresses() }) as? List<*> ?: emptyList<Any?>()
    val existing = listed.mapNotNull { asObject(it) }.firstOrNull { isOrchardOnly(it) }
    if (existing != null) return addressReply(existing, created = false)
    return newAddress()
  }

  /** A fresh Orchard-only diversified address: one per ticket's payout (D8). */
  fun newAddress(): Map<String, Any?> {
    current()
    val created = parseObject(ffi { createNewUnifiedAddress(ORCHARD_ONLY) })
    save()
    return addressReply(created, created = true)
  }

  fun balance(): Map<String, Any?> {
    current()
    val pools = parseObject(ffi { getBalance() })
    val spendable = parseJSON(ffi { getSpendableBalanceTotal() })
    return mapOf("pools" to pools, "spendable" to spendable)
  }

  /** Sends and receipts as the wallet sees them (txid, status, pools, memos). */
  fun activity(): Map<String, Any?> {
    current()
    val transfers = parseObject(ffi { getValueTransfers() })
    return mapOf("transfers" to (transfers["value_transfers"] ?: emptyList<Any?>()))
  }

  // Sync

  fun startSync(): Map<String, Any?> {
    current()
    setLastSyncReport(null)
    return mapOf("status" to ffi { runSync() })
  }

  /**
   * `phase` is `running` while the sync task works, `complete` once it has
   * reached the tip (sync settings shut the task down there), else `idle`.
   */
  fun syncStatus(): Map<String, Any?> {
    val live = current()
    val poll = ffi { pollSync() }
    var phase = "idle"
    if (poll.startsWith("{")) {
      setLastSyncReport(SyncReport(parseObject(poll)["sync_complete"]))
      save()
      phase = "complete"
    } else if (poll == "Sync task is not complete.") {
      phase = "running"
    } else if (snapshotLastSyncReport() != null) {
      phase = "complete"
    }
    val wallet = parseObject(ffi { getLatestBlockWallet() })
    // Like Swift's `try?`: an unreachable indexer leaves `serverHeight` null.
    val tip = try {
      ffi { getLatestBlockServer(live.serverUri) }
    } catch (error: CodedException) {
      null
    } catch (error: Exception) {
      null
    }
    return mapOf(
      "phase" to phase,
      "progress" to parseObject(ffi { statusSync() }),
      "report" to snapshotLastSyncReport()?.value,
      "walletHeight" to wallet["height"],
      "serverHeight" to tip?.toLongOrNull(),
    )
  }

  // Helpers

  fun vaultFor(chain: String): WalletVault {
    if (chain !in CHAINS) throw ZingoError.invalidInput("chain must be main or test, got $chain")
    return WalletVault(context(), chain)
  }

  private fun refuseIfPresent(vault: WalletVault, chain: String) {
    if (vault.hasWalletFile() || vault.hasRecoveryInfo()) {
      throw ZingoError.walletExists("a $chain wallet already exists on this device; open it instead")
    }
  }

  private fun adopt(next: Live) {
    mixnet.reset()
    synchronized(lock) {
      live = next
      lastSyncReport = null
    }
  }

  fun current(): Live = synchronized(lock) { live } ?: throw ZingoError.noWallet()

  private fun setLastSyncReport(report: SyncReport?) {
    synchronized(lock) { lastSyncReport = report }
  }

  private fun snapshotLastSyncReport(): SyncReport? = synchronized(lock) { lastSyncReport }

  /** Persists the wallet when the binding reports changes (`null` = nothing new). */
  fun save() {
    val live = current()
    ffi { saveWalletBytes() }?.let { live.vault.writeWallet(it) }
  }

  private fun storedBirthday(vault: WalletVault): Long? {
    val data = try {
      vault.readRecoveryInfo()
    } catch (error: CodedException) {
      return null
    } catch (error: Exception) {
      return null
    }
    return birthdayOf(parseObject(String(data, Charsets.UTF_8))).toLong()
  }

  companion object {
    val CHAINS = setOf("main", "test")

    /**
     * Orchard only: `create_new_unified_address` reads `o` (Orchard) and `z`
     * (Sapling) from this string; transparent receivers cannot be requested.
     */
    const val ORCHARD_ONLY = "o"

    /** A restored seed is a BIP 39 phrase of this many words (zingolib writes 24). */
    val SEED_WORD_COUNTS = setOf(12, 15, 18, 21, 24)

    private val loggingStarted = AtomicBoolean(false)

    /**
     * `init_logging` installs the Android logger; it must run once. A failure
     * is ignored: the binding call that follows reports any load error.
     */
    fun startLogging() {
      if (loggingStarted.compareAndSet(false, true)) {
        runCatching { initLogging() }
      }
    }

    /** zingo-mobile's defaults (`GlobalConst.minConfirmations`, the `High` level). */
    fun indexerConnection(chain: String, serverUri: String) = IndexerConnection(
      serverUri = serverUri,
      chainHint = chain,
      sync = SyncSettings(performanceLevel = "High", minConfirmations = 3u),
    )

    fun birthdayOf(recovery: Map<String, Any?>): UInt = (recovery["birthday"] as? Number)?.toLong()?.toUInt() ?: 0u

    fun isOrchardOnly(entry: Map<String, Any?>): Boolean =
      entry["has_orchard"] == true && entry["has_sapling"] == false && entry["has_transparent"] == false

    fun addressReply(entry: Map<String, Any?>, created: Boolean): Map<String, Any?> = mapOf(
      "address" to entry["encoded_address"],
      "addressIndex" to entry["address_index"],
      "orchard" to (entry["has_orchard"] as? Boolean ?: false),
      "sapling" to (entry["has_sapling"] as? Boolean ?: false),
      "transparent" to (entry["has_transparent"] as? Boolean ?: false),
      "created" to created,
    )
  }
}
