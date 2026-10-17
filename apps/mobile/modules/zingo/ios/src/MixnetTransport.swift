import Foundation

/// The Nym mixnet path a send must take. zingolib starts every session under
/// the mixnet transmit policy and the FFI exposes no nakednet consent, so
/// `confirm()` refuses until the indicator reads `ready`.
///
/// iOS cannot spawn the `nym-proxy` binary, so the app hosts the proxy in
/// process (ZingoNymProxyFFI) and hands its SOCKS5 endpoint to the wallet's
/// `attach_mixnet`.
final class MixnetTransport {
  private var handle: MixnetProxyHandle?
  private let lock = NSLock()

  private static let pollInterval: TimeInterval = 1
  private static let readyTimeout: TimeInterval = 180

  /// The wallet's indicator: `bootstrapping`, `ready`, `off` or `died`.
  func indicator() throws -> [String: Any] {
    try parseObject(try ffi { try mixnetIndicator() })
  }

  /// Brings the transport to `ready`, starting and attaching the proxy when
  /// needed. Returns how long each step took, in milliseconds.
  func ensureReady() throws -> [String: Int] {
    lock.lock()
    defer { lock.unlock() }

    if (try indicator()["mixnet_indicator"] as? String) == "ready" {
      return ["proxyStartMs": 0, "readyMs": 0]
    }

    let started = DispatchTime.now()
    handle?.stop()
    handle = nil
    let proxy = try ffi { try MixnetProxyHandle.start(observer: nil) }
    handle = proxy
    let proxyStartMs = milliseconds(since: started)

    let endpoint = proxy.socks5Endpoint()
    guard let exitNode = proxy.exitNode() else {
      throw ZingoError.mixnet("the started proxy reported no exit node")
    }
    _ = try ffi { try attachMixnet(socks5Addr: "\(endpoint.host):\(endpoint.port)", exitNode: exitNode) }

    let deadline = Date().addingTimeInterval(Self.readyTimeout)
    while Date() < deadline {
      let state = try indicator()["mixnet_indicator"] as? String
      if state == "ready" {
        return ["proxyStartMs": proxyStartMs, "readyMs": milliseconds(since: started)]
      }
      if state == "died" || state == "off" {
        throw ZingoError.mixnet("the mixnet transport \(state ?? "failed") while bootstrapping")
      }
      Thread.sleep(forTimeInterval: Self.pollInterval)
    }
    throw ZingoError.mixnet("the mixnet was not ready after \(Int(Self.readyTimeout)) s")
  }

  /// Drops the proxy; the wallet re-initializes without a transport.
  func reset() {
    lock.lock()
    defer { lock.unlock() }
    handle?.stop()
    handle = nil
  }
}
