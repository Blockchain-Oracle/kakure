package xyz.getkakure.zingo

import uniffi.zingo.attachMixnet
import uniffi.zingo.mixnetIndicator
import uniffi.zingo_nym_proxy_ffi.MixnetProxyHandle

/**
 * The Nym mixnet path a send must take. zingolib starts every session under
 * the mixnet transmit policy and the FFI exposes no nakednet consent, so
 * `confirm()` refuses until the indicator reads `ready`.
 *
 * The app hosts the proxy in process (uniffi.zingo_nym_proxy_ffi, the same
 * shim iOS links) and hands its SOCKS5 endpoint to the wallet's `attach_mixnet`.
 * Mirrors ios/src/MixnetTransport.swift.
 */
internal class MixnetTransport {
  private val lock = Any()
  private var handle: MixnetProxyHandle? = null

  /** The wallet's indicator: `bootstrapping`, `ready`, `off` or `died`. */
  fun indicator(): Map<String, Any?> = parseObject(ffi { mixnetIndicator() })

  /**
   * Brings the transport to `ready`, starting and attaching the proxy when
   * needed (one retry with a fresh proxy). Returns step timings in ms.
   *
   * The indicator reads "died" for an unattached transport as well as a dead
   * one (zingo-ffi `mixnet_indicator_string`), so right after `attach_mixnet`
   * a "died" is only believed once bootstrapping was seen or a grace period
   * has passed. Mirrors ios/src/MixnetTransport.swift.
   */
  fun ensureReady(): Map<String, Long> {
    return synchronized(lock) {
      if (indicator()["mixnet_indicator"] == "ready") {
        return mapOf("proxyStartMs" to 0L, "readyMs" to 0L)
      }

      val started = System.nanoTime()
      var proxyStartMs = 0L
      var lastFailure = "failed"
      repeat(ATTEMPTS) {
        release()
        val proxyStarted = System.nanoTime()
        val proxy = ffi { MixnetProxyHandle.start(null) }
        handle = proxy
        proxyStartMs = millisecondsSince(proxyStarted)

        val endpoint = proxy.socks5Endpoint()
        val exitNode = proxy.exitNode() ?: throw ZingoError.mixnet("the started proxy reported no exit node")
        ffi { attachMixnet(socks5Addr = "${endpoint.host}:${endpoint.port.toInt()}", exitNode = exitNode) }

        val attached = System.nanoTime()
        val deadline = attached + READY_TIMEOUT_MS * NANOS_PER_MS
        var bootstrapping = false
        while (System.nanoTime() < deadline) {
          val state = indicator()["mixnet_indicator"] as? String ?: "died"
          if (state == "ready") {
            return mapOf("proxyStartMs" to proxyStartMs, "readyMs" to millisecondsSince(started))
          }
          if (state == "bootstrapping") {
            bootstrapping = true
          } else if (bootstrapping || System.nanoTime() - attached > DEATH_GRACE_MS * NANOS_PER_MS) {
            lastFailure = state
            break
          }
          Thread.sleep(POLL_INTERVAL_MS)
        }
      }
      throw ZingoError.mixnet("the mixnet transport $lastFailure while bootstrapping ($ATTEMPTS tries)")
    }
  }

  /** Drops the proxy; the wallet re-initializes without a transport. */
  fun reset() {
    synchronized(lock) { release() }
  }

  /**
   * Stops the proxy and frees its handle now. Swift releases the handle as
   * soon as it is dropped; Kotlin would wait for the GC, so `destroy()` does it.
   */
  private fun release() {
    val stored = handle ?: return
    handle = null
    try {
      stored.stop()
    } finally {
      stored.destroy()
    }
  }

  private companion object {
    const val POLL_INTERVAL_MS = 1_000L
    const val READY_TIMEOUT_MS = 120_000L
    /** How long a fresh attach may still read "died" (unattached) before it is believed. */
    const val DEATH_GRACE_MS = 20_000L
    const val ATTEMPTS = 2
    const val NANOS_PER_MS = 1_000_000L
  }
}
