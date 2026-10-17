import Foundation

/// One live wallet at a time (the binding holds a single global LightClient).
/// Every method blocks on the binding, so callers run it off the JS thread.
/// Money-moving calls (send, migrate, the mixnet) live in WalletSession+Money.swift.
final class WalletSession {
  struct Live {
    let chain: String
    let serverUri: String
    let vault: WalletVault
  }

  static let chains: Set<String> = ["main", "test"]
  /// Orchard only: `create_new_unified_address` reads `o` (Orchard) and `z`
  /// (Sapling) from this string; transparent receivers cannot be requested.
  static let orchardOnly = "o"
  /// zingo-mobile's defaults (`GlobalConst.minConfirmations`, the `High` level).
  static let syncSettings = SyncSettings(performanceLevel: "High", minConfirmations: 3)
  /// A restored seed is a BIP 39 phrase of this many words (zingolib writes 24).
  static let seedWordCounts: Set<Int> = [12, 15, 18, 21, 24]

  let lock = NSLock()
  private var live: Live?
  private var lastSyncReport: Any?
  let mixnet = MixnetTransport()

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
    try refuseIfPresent(vault, chain: chain)
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

  /// Restores a wallet from a seed phrase the person typed. `birthday` 0 scans
  /// from the binding's library birthday (slower, never misses funds).
  func restore(chain: String, serverUri: String, seedPhrase: String, birthday: UInt32) throws -> [String: Any] {
    let vault = try vault(for: chain)
    try refuseIfPresent(vault, chain: chain)
    let words = seedPhrase.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
    guard Self.seedWordCounts.contains(words.count) else {
      throw ZingoError.invalidInput("a recovery phrase has 12 to 24 words; this one has \(words.count)")
    }
    let connection = Self.connection(chain: chain, serverUri: serverUri)
    let recoveryText = try ffi {
      try initFromSeed(seed: words.joined(separator: " "), birthday: birthday, connection: connection)
    }
    let recovery = try parseObject(recoveryText)
    try vault.storeRecoveryInfo(Data(recoveryText.utf8))
    adopt(Live(chain: chain, serverUri: serverUri, vault: vault))
    try save()
    return ["status": "restored", "chain": chain, "birthday": Self.birthday(recovery)]
  }

  /// The recovery phrase for the backup screen and quiz. Only the person's own
  /// screen asks for it (screenshot-blocked, after the device lock).
  func revealSeed() throws -> [String: Any] {
    let live = try current()
    let recovery = try parseObject(String(decoding: try live.vault.readRecoveryInfo(), as: UTF8.self))
    guard let seed = recovery["seed_phrase"] as? String else {
      throw ZingoError.keychain("the stored recovery info has no seed phrase")
    }
    return ["words": seed.split(separator: " ").map(String.init), "birthday": Self.birthday(recovery)]
  }

  /// Forget this device: deletes the chain's wallet file and Keychain item.
  /// The in-memory client is dropped on the next init.
  func forget(chain: String) throws -> [String: Any] {
    let vault = try vault(for: chain)
    mixnet.reset()
    try vault.erase()
    lock.lock()
    if live?.chain == chain { live = nil }
    lock.unlock()
    return ["status": "forgotten", "chain": chain]
  }

  // MARK: Wallet reads

  /// The wallet's default Orchard-only unified address (receive screen).
  func address() throws -> [String: Any] {
    _ = try current()
    let listed = try parseJSON(try ffi { try getUnifiedAddresses() }) as? [[String: Any]] ?? []
    if let existing = listed.first(where: Self.isOrchardOnly) {
      return Self.addressReply(existing, created: false)
    }
    return try newAddress()
  }

  /// A fresh Orchard-only diversified address: one per ticket's payout (D8).
  func newAddress() throws -> [String: Any] {
    _ = try current()
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

  /// Sends and receipts as the wallet sees them (txid, status, pools, memos).
  func activity() throws -> [String: Any] {
    _ = try current()
    let transfers = try parseObject(try ffi { try getValueTransfers() })
    return ["transfers": transfers["value_transfers"] ?? [Any]()]
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
    let tip = try? ffi { try getLatestBlockServer(serveruri: live.serverUri) }
    return [
      "phase": phase,
      "progress": try parseObject(try ffi { try statusSync() }),
      "report": snapshotLastSyncReport() ?? NSNull(),
      "walletHeight": wallet["height"] ?? NSNull(),
      "serverHeight": tip.flatMap { Int($0) }.map { $0 as Any } ?? NSNull(),
    ]
  }

  // MARK: Helpers

  func vault(for chain: String) throws -> WalletVault {
    guard Self.chains.contains(chain) else {
      throw ZingoError.invalidInput("chain must be main or test, got \(chain)")
    }
    return WalletVault(chain: chain)
  }

  private func refuseIfPresent(_ vault: WalletVault, chain: String) throws {
    if vault.hasWalletFile() || vault.hasRecoveryInfo() {
      throw ZingoError.walletExists("a \(chain) wallet already exists on this device; open it instead")
    }
  }

  private func adopt(_ next: Live) {
    mixnet.reset()
    lock.lock()
    live = next
    lastSyncReport = nil
    lock.unlock()
  }

  func current() throws -> Live {
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
  func save() throws {
    let live = try current()
    if let bytes = try ffi({ try saveWalletBytes() }) {
      try live.vault.writeWallet(bytes)
    }
  }

  private func storedBirthday(_ vault: WalletVault) throws -> Any {
    guard let data = try? vault.readRecoveryInfo() else { return NSNull() }
    return Self.birthday(try parseObject(String(decoding: data, as: UTF8.self)))
  }

  static func birthday(_ recovery: [String: Any]) -> UInt32 {
    (recovery["birthday"] as? NSNumber)?.uint32Value ?? 0
  }

  static func connection(chain: String, serverUri: String) -> IndexerConnection {
    IndexerConnection(serverUri: serverUri, chainHint: chain, sync: syncSettings)
  }

  static func isOrchardOnly(_ entry: [String: Any]) -> Bool {
    (entry["has_orchard"] as? Bool) == true && (entry["has_sapling"] as? Bool) == false
      && (entry["has_transparent"] as? Bool) == false
  }

  static func addressReply(_ entry: [String: Any], created: Bool) -> [String: Any] {
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
