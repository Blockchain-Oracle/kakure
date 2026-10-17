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
  private static let readyTimeout: TimeInterval = 120
  /// How long a fresh attach may still read "died" (unattached) before it is believed.
  private static let deathGrace: TimeInterval = 20
  private static let attempts = 2

  /// The wallet's indicator: `bootstrapping`, `ready`, `off` or `died`.
  func indicator() throws -> [String: Any] {
    try parseObject(try ffi { try mixnetIndicator() })
  }

  /// Brings the transport to `ready`, starting and attaching the proxy when
  /// needed (one retry with a fresh proxy). Returns step timings in ms.
  ///
  /// The indicator reads "died" for an unattached transport as well as a dead
  /// one (zingo-ffi `mixnet_indicator_string`), so right after `attach_mixnet`
  /// a "died" is only believed once bootstrapping was seen or a grace period
  /// has passed.
  func ensureReady() throws -> [String: Int] {
    lock.lock()
    defer { lock.unlock() }

    if (try indicator()["mixnet_indicator"] as? String) == "ready" {
      return ["proxyStartMs": 0, "readyMs": 0]
    }

    let started = DispatchTime.now()
    var proxyStartMs = 0
    var lastFailure = "failed"
    for _ in 0..<Self.attempts {
      handle?.stop()
      handle = nil
      let proxyStarted = DispatchTime.now()
      let proxy = try ffi { try MixnetProxyHandle.start(observer: nil) }
      handle = proxy
      proxyStartMs = milliseconds(since: proxyStarted)

      let endpoint = proxy.socks5Endpoint()
      guard let exitNode = proxy.exitNode() else {
        throw ZingoError.mixnet("the started proxy reported no exit node")
      }
      _ = try ffi { try attachMixnet(socks5Addr: "\(endpoint.host):\(endpoint.port)", exitNode: exitNode) }

      let attached = Date()
      let deadline = attached.addingTimeInterval(Self.readyTimeout)
      var bootstrapping = false
      attempt: while Date() < deadline {
        let state = try indicator()["mixnet_indicator"] as? String ?? "died"
        switch state {
        case "ready":
          return ["proxyStartMs": proxyStartMs, "readyMs": milliseconds(since: started)]
        case "bootstrapping":
          bootstrapping = true
        default:
          if bootstrapping || Date().timeIntervalSince(attached) > Self.deathGrace {
            lastFailure = state
            break attempt
          }
        }
        Thread.sleep(forTimeInterval: Self.pollInterval)
      }
    }
    throw ZingoError.mixnet("the mixnet transport \(lastFailure) while bootstrapping (\(Self.attempts) tries)")
  }

  /// Drops the proxy; the wallet re-initializes without a transport.
  func reset() {
    lock.lock()
    defer { lock.unlock() }
    handle?.stop()
    handle = nil
  }
}
