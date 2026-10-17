import Foundation
import Security

/// Where a wallet rests on the device, one slot per chain (`main`, `test`), so
/// networks never share a wallet, a seed or a file.
///
/// - The recovery info (seed phrase + birthday) lives in the iOS Keychain,
///   this-device-only and readable only while unlocked. It never crosses to JS.
/// - The serialized wallet (`save_wallet_bytes`) lives in Application Support,
///   excluded from backup, under file protection class C so a background save
///   still works while the screen is locked.
struct WalletVault {
  let chain: String

  private static let keychainService = "xyz.getkakure.app.zingo"
  private var keychainAccount: String { "recovery.\(chain)" }

  private var walletURL: URL {
    get throws {
      let base = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      let dir = base.appendingPathComponent("kakure/wallets/\(chain)", isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      return dir.appendingPathComponent("wallet.dat")
    }
  }

  // MARK: Wallet bytes

  func hasWalletFile() -> Bool {
    guard let url = try? walletURL else { return false }
    return FileManager.default.fileExists(atPath: url.path)
  }

  func readWallet() throws -> Data {
    try Data(contentsOf: try walletURL)
  }

  func writeWallet(_ bytes: Data) throws {
    var url = try walletURL
    try bytes.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try url.setResourceValues(values)
  }

  // MARK: Recovery info (Keychain)

  func hasRecoveryInfo() -> Bool {
    (try? readRecoveryInfo()) != nil
  }

  /// Stores the JSON that `init_new` returns (seed phrase, birthday, accounts).
  /// Refuses to overwrite: a second seed for the same chain would orphan funds.
  func storeRecoveryInfo(_ json: Data) throws {
    let attributes: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecValueData as String: json,
    ]
    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw ZingoError.keychain("could not store the recovery info (OSStatus \(status))")
    }
  }

  func readRecoveryInfo() throws -> Data {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.keychainService,
      kSecAttrAccount as String: keychainAccount,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess, let data = item as? Data else {
      throw ZingoError.keychain("no recovery info for \(chain) (OSStatus \(status))")
    }
    return data
  }
}
