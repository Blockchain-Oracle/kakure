package xyz.getkakure.zingo

import org.json.JSONObject
import uniffi.zingo.confirm
import uniffi.zingo.drainOrchardToIronwood
import uniffi.zingo.planOrchardDrain
import uniffi.zingo.send

// The calls that move money. Mirrors ios/src/WalletSession+Money.swift. Each
// blocks on the binding; phases are reported through `onPhase` so the app can
// show its steps honestly:
// - `route`: bringing the Nym mixnet transport to `ready` (instant once warm)
// - `proving`: `confirm()` is proving, signing and transmitting over Nym (one call)
// - `sent`: the indexer accepted the transaction (txids returned)

internal typealias PhaseHandler = (phase: String, detail: Map<String, Any?>) -> Unit

/**
 * Proposes `zatoshis` to `address` with `memo`, refuses unless every source
 * pool is in `allowedPools` (a bet never spends Orchard), then confirms.
 */
internal fun WalletSession.pay(
  address: String,
  zatoshis: String,
  memo: String,
  allowedPools: List<String>,
  onPhase: PhaseHandler,
): Map<String, Any?> {
  current()
  val amount = zatoshis.toULongOrNull()
  if (amount == null || amount == 0uL) {
    throw ZingoError.invalidInput("zatoshis must be a positive integer, got $zatoshis")
  }
  // Written by hand so the full u64 amount reaches the binding as a JSON integer.
  val request = buildString {
    append("[{\"address\":").append(JSONObject.quote(address))
    append(",\"amount\":").append(amount.toString())
    if (memo.isNotEmpty()) append(",\"memo\":").append(JSONObject.quote(memo))
    append("}]")
  }

  val started = System.nanoTime()
  onPhase("route", emptyMap())
  val mixnetTimings = mixnet.ensureReady()
  val mixnetMs = millisecondsSince(started)

  val proposeStart = System.nanoTime()
  val proposal = parseObject(ffi { send(request) })
  val proposeMs = millisecondsSince(proposeStart)
  val sources = stringList(proposal["source_pools"]) ?: emptyList()
  if (allowedPools.isNotEmpty()) {
    val refused = sources.filter { it !in allowedPools }
    if (refused.isNotEmpty() || sources.isEmpty()) {
      throw ZingoError.poolRefused(
        "this payment would spend from ${sources.joinToString(", ")}; " +
          "only ${allowedPools.joinToString(", ")} is allowed",
      )
    }
  }

  val confirmStart = System.nanoTime()
  onPhase("proving", mapOf("fee" to proposal["fee"], "sourcePools" to sources))
  val sent = parseObject(ffi { confirm() })
  val confirmMs = millisecondsSince(confirmStart)
  val txids = stringList(sent["txids"]) ?: emptyList()
  onPhase("sent", mapOf("txids" to txids))
  save()

  return mapOf(
    "txids" to txids,
    "fee" to proposal["fee"],
    "sourcePools" to sources,
    "destinationPools" to (proposal["destination_pools"] ?: emptyList<String>()),
    "timings" to mapOf(
      "mixnetMs" to mixnetMs,
      "proxyStartMs" to (mixnetTimings["proxyStartMs"] ?: 0L),
      "proposeMs" to proposeMs,
      "confirmMs" to confirmMs,
      "totalMs" to millisecondsSince(started),
    ),
  )
}

/** Brings the mixnet up ahead of a bet, so a send pays only prove-and-send time. */
internal fun WalletSession.warmMixnet(): Map<String, Any?> {
  current()
  val started = System.nanoTime()
  val timings = mixnet.ensureReady()
  val reply = mixnet.indicator().toMutableMap()
  reply["proxyStartMs"] = timings["proxyStartMs"] ?: 0L
  reply["readyMs"] = millisecondsSince(started)
  return reply
}

internal fun WalletSession.mixnetStatus(): Map<String, Any?> {
  current()
  return mixnet.indicator()
}

/**
 * What moving every spendable Orchard note into Ironwood would cost
 * (`plan_orchard_drain`: transactions, migrated, fee, residual; zatoshis).
 */
internal fun WalletSession.orchardDrainPlan(): Map<String, Any?> {
  current()
  return parseObject(ffi { planOrchardDrain() })
}

/**
 * Migrates immediately (`drain_orchard_to_ironwood`). The amount crossing
 * the pool boundary is visible on chain; the app says so before asking.
 */
internal fun WalletSession.drainOrchard(): Map<String, Any?> {
  current()
  mixnet.ensureReady()
  val result = parseObject(ffi { drainOrchardToIronwood() })
  save()
  return result
}
