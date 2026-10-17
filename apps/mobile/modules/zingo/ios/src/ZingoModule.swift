import ExpoModulesCore

/// The JS surface over the zingolib Binding Layer. Every call blocks on the
/// binding (gRPC, proving, the mixnet bootstrap), so each runs on this module's
/// own concurrent queue rather than Expo's default queue, which is one serial
/// queue shared by every module. Android mirrors this surface in ZingoModule.kt.
public class ZingoModule: Module {
  private let session = WalletSession()
  private let queue = DispatchQueue(
    label: "xyz.getkakure.zingo", qos: .userInitiated, attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("Zingo")

    /// `{ requestId, phase: "route" | "proving" | "sent", ...detail }` while a send runs.
    Events("onSendPhase")

    AsyncFunction("openWallet") { (chain: String, serverUri: String) in
      try self.run { try self.session.open(chain: chain, serverUri: serverUri) }
    }.runOnQueue(queue)

    AsyncFunction("createWallet") { (chain: String, serverUri: String) in
      try self.run { try self.session.create(chain: chain, serverUri: serverUri) }
    }.runOnQueue(queue)

    AsyncFunction("restoreWallet") { (chain: String, serverUri: String, seedPhrase: String, birthday: Int) in
      try self.run {
        try self.session.restore(
          chain: chain, serverUri: serverUri, seedPhrase: seedPhrase, birthday: UInt32(max(0, birthday)))
      }
    }.runOnQueue(queue)

    AsyncFunction("revealSeed") {
      try self.run { try self.session.revealSeed() }
    }.runOnQueue(queue)

    AsyncFunction("forgetWallet") { (chain: String) in
      try self.run { try self.session.forget(chain: chain) }
    }.runOnQueue(queue)

    AsyncFunction("getAddress") {
      try self.run { try self.session.address() }
    }.runOnQueue(queue)

    AsyncFunction("newPayoutAddress") {
      try self.run { try self.session.newAddress() }
    }.runOnQueue(queue)

    AsyncFunction("sync") {
      try self.run { try self.session.startSync() }
    }.runOnQueue(queue)

    AsyncFunction("syncStatus") {
      try self.run { try self.session.syncStatus() }
    }.runOnQueue(queue)

    AsyncFunction("balance") {
      try self.run { try self.session.balance() }
    }.runOnQueue(queue)

    AsyncFunction("activity") {
      try self.run { try self.session.activity() }
    }.runOnQueue(queue)

    AsyncFunction("send") {
      (address: String, zatoshis: String, memo: String, allowedPools: [String], requestId: String) in
      try self.run {
        try self.session.pay(address: address, zatoshis: zatoshis, memo: memo, allowedPools: allowedPools) {
          phase, detail in
          var body = detail
          body["requestId"] = requestId
          body["phase"] = phase
          self.sendEvent("onSendPhase", body)
        }
      }
    }.runOnQueue(queue)

    AsyncFunction("warmMixnet") {
      try self.run { try self.session.warmMixnet() }
    }.runOnQueue(queue)

    AsyncFunction("mixnetStatus") {
      try self.run { try self.session.mixnetStatus() }
    }.runOnQueue(queue)

    AsyncFunction("planOrchardDrain") {
      try self.run { try self.session.orchardDrainPlan() }
    }.runOnQueue(queue)

    AsyncFunction("drainOrchard") {
      try self.run { try self.session.drainOrchard() }
    }.runOnQueue(queue)

    AsyncFunction("excludeFromBackup") { (path: String) in
      try self.run {
        try WalletVault.excludeFromBackup(path: path)
        return ["path": path]
      }
    }.runOnQueue(queue)
  }

  private func run(_ body: () throws -> [String: Any]) throws -> [String: Any] {
    do {
      return try body()
    } catch let error as ZingoError {
      throw error.exception
    }
  }
}
