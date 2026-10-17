import Foundation

/// The calls that move money. Each blocks on the binding; phases are reported
/// through `onPhase` so the app can show its steps honestly:
/// - `route`: bringing the Nym mixnet transport to `ready` (instant once warm)
/// - `proving`: `confirm()` is proving, signing and transmitting over Nym (one call)
/// - `sent`: the indexer accepted the transaction (txids returned)
extension WalletSession {
  typealias PhaseHandler = (_ phase: String, _ detail: [String: Any]) -> Void

  /// Proposes `zatoshis` to `address` with `memo`, refuses unless every source
  /// pool is in `allowedPools` (a bet never spends Orchard), then confirms.
  func pay(
    address: String, zatoshis: String, memo: String, allowedPools: [String], onPhase: PhaseHandler
  ) throws -> [String: Any] {
    _ = try current()
    guard let amount = UInt64(zatoshis), amount > 0 else {
      throw ZingoError.invalidInput("zatoshis must be a positive integer, got \(zatoshis)")
    }
    var payment: [String: Any] = ["address": address, "amount": NSNumber(value: amount)]
    if !memo.isEmpty { payment["memo"] = memo }
    let request = String(decoding: try JSONSerialization.data(withJSONObject: [payment]), as: UTF8.self)

    let started = DispatchTime.now()
    onPhase("route", [:])
    let mixnetTimings = try mixnet.ensureReady()
    let mixnetMs = milliseconds(since: started)

    let proposeStart = DispatchTime.now()
    let proposal = try parseObject(try ffi { try send(sendJson: request) })
    let proposeMs = milliseconds(since: proposeStart)
    let sources = proposal["source_pools"] as? [String] ?? []
    if !allowedPools.isEmpty {
      let refused = sources.filter { !allowedPools.contains($0) }
      if !refused.isEmpty || sources.isEmpty {
        throw ZingoError.poolRefused(
          "this payment would spend from \(sources.joined(separator: ", ")); only \(allowedPools.joined(separator: ", ")) is allowed")
      }
    }

    let confirmStart = DispatchTime.now()
    onPhase("proving", ["fee": proposal["fee"] ?? NSNull(), "sourcePools": sources])
    let sent = try parseObject(try ffi { try confirm() })
    let confirmMs = milliseconds(since: confirmStart)
    let txids = sent["txids"] as? [String] ?? []
    onPhase("sent", ["txids": txids])
    try save()

    return [
      "txids": txids,
      "fee": proposal["fee"] ?? NSNull(),
      "sourcePools": sources,
      "destinationPools": proposal["destination_pools"] ?? [String](),
      "timings": [
        "mixnetMs": mixnetMs,
        "proxyStartMs": mixnetTimings["proxyStartMs"] ?? 0,
        "proposeMs": proposeMs,
        "confirmMs": confirmMs,
        "totalMs": milliseconds(since: started),
      ],
    ]
  }

  /// Brings the mixnet up ahead of a bet, so a send pays only prove-and-send time.
  func warmMixnet() throws -> [String: Any] {
    _ = try current()
    let started = DispatchTime.now()
    let timings = try mixnet.ensureReady()
    var reply: [String: Any] = try mixnet.indicator()
    reply["proxyStartMs"] = timings["proxyStartMs"] ?? 0
    reply["readyMs"] = milliseconds(since: started)
    return reply
  }

  func mixnetStatus() throws -> [String: Any] {
    _ = try current()
    return try mixnet.indicator()
  }

  /// What moving every spendable Orchard note into Ironwood would cost
  /// (`plan_orchard_drain`: transactions, migrated, fee, residual; zatoshis).
  func orchardDrainPlan() throws -> [String: Any] {
    _ = try current()
    return try parseObject(try ffi { try planOrchardDrain() })
  }

  /// Migrates immediately (`drain_orchard_to_ironwood`). The amount crossing
  /// the pool boundary is visible on chain; the app says so before asking.
  func drainOrchard() throws -> [String: Any] {
    _ = try current()
    _ = try mixnet.ensureReady()
    let result = try parseObject(try ffi { try drainOrchardToIronwood() })
    try save()
    return result
  }
}
