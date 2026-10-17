import ExpoModulesCore

/// The JS surface over the zingolib Binding Layer. Every call blocks on the
/// binding (gRPC, proving, the mixnet bootstrap), so each runs on this module's
/// own concurrent queue rather than Expo's default queue, which is one serial
/// queue shared by every module.
public class ZingoModule: Module {
  private let session = WalletSession()
  private let queue = DispatchQueue(
    label: "xyz.getkakure.zingo", qos: .userInitiated, attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("Zingo")

    AsyncFunction("openWallet") { (chain: String, serverUri: String) in
      try self.run { try self.session.open(chain: chain, serverUri: serverUri) }
    }.runOnQueue(queue)

    AsyncFunction("createWallet") { (chain: String, serverUri: String) in
      try self.run { try self.session.create(chain: chain, serverUri: serverUri) }
    }.runOnQueue(queue)

    AsyncFunction("getAddress") {
      try self.run { try self.session.address() }
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

    AsyncFunction("send") { (address: String, zatoshis: String, memo: String) in
      try self.run { try self.session.pay(address: address, zatoshis: zatoshis, memo: memo) }
    }.runOnQueue(queue)

    AsyncFunction("mixnetStatus") {
      try self.run { try self.session.mixnetStatus() }
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
