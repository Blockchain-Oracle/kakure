import ExpoModulesCore
import Foundation

/// Errors that reach JS. The `code` is what the TS layer switches on; the
/// message is for logs. Binding errors keep zingolib's variant name in the code.
enum ZingoError: Error {
  case invalidInput(String)
  case walletExists(String)
  case noWallet
  case keychain(String)
  case mixnet(String)
  case poolRefused(String)
  case binding(ZingolibError)
  case proxy(ProxyFfiError)
  case malformedReply(String)

  var exception: Exception {
    switch self {
    case .invalidInput(let m): return Self.make("ERR_ZINGO_INVALID_INPUT", m)
    case .walletExists(let m): return Self.make("ERR_ZINGO_WALLET_EXISTS", m)
    case .noWallet: return Self.make("ERR_ZINGO_NO_WALLET", "open or create a wallet first")
    case .keychain(let m): return Self.make("ERR_ZINGO_KEYCHAIN", m)
    case .mixnet(let m): return Self.make("ERR_ZINGO_MIXNET", m)
    case .poolRefused(let m): return Self.make("ERR_ZINGO_POOL_REFUSED", m)
    case .binding(let e): return Self.make("ERR_ZINGO_\(Self.variant(e))", "\(e)")
    case .proxy(let e): return Self.make("ERR_ZINGO_PROXY", "\(e)")
    case .malformedReply(let m): return Self.make("ERR_ZINGO_MALFORMED_REPLY", m)
    }
  }

  private static func make(_ code: String, _ message: String) -> Exception {
    Exception(name: "ZingoError", description: message, code: code)
  }

  /// `Send(message: "...")` -> `SEND`.
  private static func variant(_ error: ZingolibError) -> String {
    let reflected = String(describing: error)
    let name = reflected.split(separator: "(").first.map(String.init) ?? "UNKNOWN"
    return name.uppercased()
  }
}

/// Runs a binding call and maps its typed errors.
func ffi<T>(_ call: () throws -> T) throws -> T {
  do {
    return try call()
  } catch let error as ZingolibError {
    throw ZingoError.binding(error)
  } catch let error as ProxyFfiError {
    throw ZingoError.proxy(error)
  }
}

/// The binding answers in JSON text; JS gets plain objects.
func parseJSON(_ text: String) throws -> Any {
  guard let data = text.data(using: .utf8),
    let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
  else {
    throw ZingoError.malformedReply(String(text.prefix(200)))
  }
  return value
}

func parseObject(_ text: String) throws -> [String: Any] {
  guard let object = try parseJSON(text) as? [String: Any] else {
    throw ZingoError.malformedReply(String(text.prefix(200)))
  }
  return object
}

func milliseconds(since start: DispatchTime) -> Int {
  Int((DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1_000_000)
}
