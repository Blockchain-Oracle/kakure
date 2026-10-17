import Foundation

/// One live wallet at a time (the binding holds a single global LightClient).
/// Every method blocks on the binding, so callers run it off the JS thread.
final class WalletSession {
  private struct Live {
    let chain: String
    let serverUri: String
    let vault: WalletVault
  }

  private static let chains: Set<String> = ["main", "test"]
  /// Orchard only: `create_new_unified_address` reads `o` (Orchard) and `z`
  /// (Sapling) from this string; transparent receivers cannot be requested.
  private static let orchardOnly = "o"
  /// zingo-mobile's defaults (`GlobalConst.minConfirmations`, the `High` level).
  private static let syncSettings = SyncSettings(performanceLevel: "High", minConfirmations: 3)

  private let lock = NSLock()
  private var live: Live?
  private var lastSyncReport: Any?
  private let mixnet = MixnetTransport()

  // MARK: Lifecycle

  /// Opens the saved wallet for `chain`, or rebuilds it from the Keychain
  /// recovery info when only that survives. Never creates a wallet.
  func open(chain: String, serverUri: String) throws -> [String: Any] {
    let vault = try vault(for: chain)
    let connection = Self.connection(chain: chain, serverUri: serverUri)
    let status: String
    if vault.hasWalletFile() {
      let bytes = try vault.readWallet()
      _ = try ffi { try initFromBytes(walletBytes: bytes, connection: connection) }
      status = "opened"
    } else if vault.hasRecoveryInfo() {
      let recovery = try parseObject(String(decoding: try vault.readRecoveryInfo(), as: UTF8.self))
      guard let seed = recovery["seed_phrase"] as? String else {
        throw ZingoError.keychain("the stored recovery info has no seed phrase")
      }
      _ = try ffi { try initFromSeed(seed: seed, birthday: Self.birthday(recovery), connection: connection) }
      status = "restored"
    } else {
      return ["status": "absent", "chain": chain]
    }
    adopt(Live(chain: chain, serverUri: serverUri, vault: vault))
    try save()
    return ["status": status, "chain": chain, "birthday": try storedBirthday(vault)]
  }

  /// Creates a new wallet for `chain`. The seed goes to the Keychain only; the
  /// reply carries the birthday height, never the seed.
  func create(chain: String, serverUri: String) throws -> [String: Any] {
    let vault = try vault(for: chain)
    if vault.hasWalletFile() || vault.hasRecoveryInfo() {
      throw ZingoError.walletExists("a \(chain) wallet already exists on this device; open it instead")
    }
    let connection = Self.connection(chain: chain, serverUri: serverUri)
    let recoveryText = try ffi { try initNew(connection: connection, birthday: 0) }
    let recovery = try parseObject(recoveryText)
    guard recovery["seed_phrase"] is String else {
      throw ZingoError.malformedReply("init_new returned no recovery info")
    }
    try vault.storeRecoveryInfo(Data(recoveryText.utf8))
    adopt(Live(chain: chain, serverUri: serverUri, vault: vault))
    try save()
    return ["status": "created", "chain": chain, "birthday": Self.birthday(recovery)]
  }

  // MARK: Wallet reads

  /// The wallet's Orchard-only unified address, created on first use.
  func address() throws -> [String: Any] {
    _ = try current()
    let listed = try parseJSON(try ffi { try getUnifiedAddresses() }) as? [[String: Any]] ?? []
    let isOrchardOnly: ([String: Any]) -> Bool = {
      ($0["has_orchard"] as? Bool) == true && ($0["has_sapling"] as? Bool) == false
        && ($0["has_transparent"] as? Bool) == false
    }
    if let existing = listed.first(where: isOrchardOnly) {
      return Self.addressReply(existing, created: false)
    }
    let created = try parseObject(try ffi { try createNewUnifiedAddress(receivers: Self.orchardOnly) })
    try save()
    return Self.addressReply(created, created: true)
  }

  func balance() throws -> [String: Any] {
    _ = try current()
    let pools = try parseObject(try ffi { try getBalance() })
    let spendable = try parseJSON(try ffi { try getSpendableBalanceTotal() })
    return ["pools": pools, "spendable": spendable]
  }

  // MARK: Sync

  func startSync() throws -> [String: Any] {
    _ = try current()
    setLastSyncReport(nil)
    return ["status": try ffi { try runSync() }]
  }

  /// `phase` is `running` while the sync task works, `complete` once it has
  /// reached the tip (sync settings shut the task down there), else `idle`.
  func syncStatus() throws -> [String: Any] {
    let live = try current()
    let poll = try ffi { try pollSync() }
    var phase = "idle"
    if poll.hasPrefix("{") {
      let report = try parseObject(poll)["sync_complete"] ?? NSNull()
      setLastSyncReport(report)
      try save()
      phase = "complete"
    } else if poll == "Sync task is not complete." {
      phase = "running"
    } else if snapshotLastSyncReport() != nil {
      phase = "complete"
    }
    let wallet = try parseObject(try ffi { try getLatestBlockWallet() })
    let tip = try ffi { try getLatestBlockServer(serveruri: live.serverUri) }
    return [
      "phase": phase,
      "progress": try parseObject(try ffi { try statusSync() }),
      "report": snapshotLastSyncReport() ?? NSNull(),
      "walletHeight": wallet["height"] ?? NSNull(),
      "serverHeight": Int(tip).map { $0 as Any } ?? NSNull(),
    ]
  }

  // MARK: Send

  /// Proposes `zatoshis` to `address` with `memo`, brings the mixnet up, then
  /// confirms (proves, signs and transmits over Nym).
  func pay(address: String, zatoshis: String, memo: String) throws -> [String: Any] {
    _ = try current()
    guard let amount = UInt64(zatoshis), amount > 0 else {
      throw ZingoError.invalidInput("zatoshis must be a positive integer, got \(zatoshis)")
    }
    var payment: [String: Any] = ["address": address, "amount": NSNumber(value: amount)]
    if !memo.isEmpty { payment["memo"] = memo }
    let request = String(decoding: try JSONSerialization.data(withJSONObject: [payment]), as: UTF8.self)

    let started = DispatchTime.now()
    let mixnetTimings = try mixnet.ensureReady()
    let mixnetMs = milliseconds(since: started)

    let proposeStart = DispatchTime.now()
    let proposal = try parseObject(try ffi { try send(sendJson: request) })
    let proposeMs = milliseconds(since: proposeStart)

    let confirmStart = DispatchTime.now()
    let sent = try parseObject(try ffi { try confirm() })
    let confirmMs = milliseconds(since: confirmStart)
    try save()

    return [
      "txids": sent["txids"] ?? [String](),
      "fee": proposal["fee"] ?? NSNull(),
      "sourcePools": proposal["source_pools"] ?? [String](),
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

  func mixnetStatus() throws -> [String: Any] {
    _ = try current()
    return try mixnet.indicator()
  }

  // MARK: Helpers

  private func vault(for chain: String) throws -> WalletVault {
    guard Self.chains.contains(chain) else {
      throw ZingoError.invalidInput("chain must be main or test, got \(chain)")
    }
    return WalletVault(chain: chain)
  }

  private func adopt(_ next: Live) {
    mixnet.reset()
    lock.lock()
    live = next
    lastSyncReport = nil
    lock.unlock()
  }

  private func current() throws -> Live {
    lock.lock()
    defer { lock.unlock() }
    guard let live else { throw ZingoError.noWallet }
    return live
  }

  private func setLastSyncReport(_ report: Any?) {
    lock.lock()
    lastSyncReport = report
    lock.unlock()
  }

  private func snapshotLastSyncReport() -> Any? {
    lock.lock()
    defer { lock.unlock() }
    return lastSyncReport
  }

  /// Persists the wallet when the binding reports changes (`nil` = nothing new).
  private func save() throws {
    let live = try current()
    if let bytes = try ffi({ try saveWalletBytes() }) {
      try live.vault.writeWallet(bytes)
    }
  }

  private func storedBirthday(_ vault: WalletVault) throws -> Any {
    guard let data = try? vault.readRecoveryInfo() else { return NSNull() }
    return Self.birthday(try parseObject(String(decoding: data, as: UTF8.self)))
  }

  private static func birthday(_ recovery: [String: Any]) -> UInt32 {
    (recovery["birthday"] as? NSNumber)?.uint32Value ?? 0
  }

  private static func connection(chain: String, serverUri: String) -> IndexerConnection {
    IndexerConnection(serverUri: serverUri, chainHint: chain, sync: syncSettings)
  }

  private static func addressReply(_ entry: [String: Any], created: Bool) -> [String: Any] {
    [
      "address": entry["encoded_address"] ?? NSNull(),
      "addressIndex": entry["address_index"] ?? NSNull(),
      "orchard": (entry["has_orchard"] as? Bool) ?? false,
      "sapling": (entry["has_sapling"] as? Bool) ?? false,
      "transparent": (entry["has_transparent"] as? Bool) ?? false,
      "created": created,
    ]
  }
}
