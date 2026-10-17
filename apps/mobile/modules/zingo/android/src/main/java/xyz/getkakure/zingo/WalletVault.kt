package xyz.getkakure.zingo

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import java.security.ProviderException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Where a wallet rests on the device, one slot per chain (`main`, `test`), so
 * networks never share a wallet, a seed or a file. Mirrors ios/src/WalletVault.swift.
 *
 * Both files live in `noBackupFilesDir/kakure/wallets/<chain>/`, which Android
 * never backs up or restores, whatever the app's backup settings say.
 * - `recovery.bin`: the recovery info (seed phrase + birthday) sealed with
 *   AES-256-GCM under a non-exportable AndroidKeyStore key, stored as
 *   `iv ‖ ciphertext`. It never crosses to JS except through revealSeed.
 * - `wallet.dat`: the serialized wallet (`save_wallet_bytes`), replaced
 *   atomically (temp file, fsync, rename).
 */
internal class WalletVault(context: Context, val chain: String) {
  private val dir = File(context.noBackupFilesDir, "kakure/wallets/$chain")
  private val walletFile = File(dir, "wallet.dat")
  private val recoveryFile = File(dir, "recovery.bin")

  // Wallet bytes

  fun hasWalletFile(): Boolean = walletFile.isFile

  fun readWallet(): ByteArray = walletFile.readBytes()

  fun writeWallet(bytes: ByteArray) = writeAtomically(walletFile, bytes)

  /** Forget this device: the wallet file and the sealed recovery info, both or whichever exists. */
  fun erase() {
    synchronized(fileLock) {
      for (file in listOf(walletFile, recoveryFile, temp(walletFile), temp(recoveryFile))) {
        if (file.exists() && !file.delete()) {
          throw ZingoError.keychain("could not delete ${file.name} for $chain")
        }
      }
    }
  }

  // Recovery info (AndroidKeyStore)

  fun hasRecoveryInfo(): Boolean = recoveryFile.isFile

  /**
   * Stores the JSON that `init_new` returns (seed phrase, birthday, accounts).
   * Refuses to overwrite: a second seed for the same chain would orphan funds.
   */
  fun storeRecoveryInfo(json: ByteArray) {
    synchronized(fileLock) {
      if (recoveryFile.exists()) {
        throw ZingoError.keychain("recovery info for $chain already exists; refusing to overwrite it")
      }
      val sealed = keystore("could not store the recovery info") { RecoveryKey.seal(json) }
      writeAtomically(recoveryFile, sealed)
    }
  }

  fun readRecoveryInfo(): ByteArray {
    val sealed = try {
      recoveryFile.readBytes()
    } catch (error: IOException) {
      throw ZingoError.keychain("no recovery info for $chain", error)
    }
    return keystore("could not read the recovery info for $chain") { RecoveryKey.open(sealed) }
  }

  // Helpers

  private fun temp(file: File) = File(dir, "${file.name}.tmp")

  /** One writer at a time across sessions and chains: the temp file name is fixed. */
  private fun writeAtomically(target: File, bytes: ByteArray) {
    synchronized(fileLock) {
      if (!dir.isDirectory && !dir.mkdirs()) throw IOException("could not create ${dir.path}")
      val temp = temp(target)
      try {
        FileOutputStream(temp).use { out ->
          out.write(bytes)
          out.fd.sync()
        }
        if (!temp.renameTo(target)) throw IOException("could not move ${temp.name} onto ${target.name}")
      } finally {
        temp.delete()
      }
    }
  }

  /** Keystore and cipher failures surface as ERR_ZINGO_KEYCHAIN, never with the plaintext. */
  private inline fun <T> keystore(what: String, body: () -> T): T =
    try {
      body()
    } catch (error: GeneralSecurityException) {
      throw ZingoError.keychain("$what (${error.javaClass.simpleName})", error)
    } catch (error: ProviderException) {
      throw ZingoError.keychain("$what (${error.javaClass.simpleName})", error)
    } catch (error: IOException) {
      throw ZingoError.keychain("$what (${error.javaClass.simpleName})", error)
    }

  private companion object {
    val fileLock = Any()
  }
}

/** The AES-256-GCM key that seals every chain's recovery info. It never leaves the keystore. */
private object RecoveryKey {
  private const val ALIAS = "kakure.zingo.recovery"
  private const val KEYSTORE = "AndroidKeyStore"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"
  private const val IV_BYTES = 12
  private const val TAG_BITS = 128

  /** The keystore draws a fresh IV per seal (randomized encryption is required). */
  fun seal(plain: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val iv = cipher.iv
    if (iv == null || iv.size != IV_BYTES) throw GeneralSecurityException("unexpected GCM IV length")
    return iv + cipher.doFinal(plain)
  }

  fun open(sealed: ByteArray): ByteArray {
    if (sealed.size <= IV_BYTES) throw GeneralSecurityException("the sealed recovery info is truncated")
    val key = storedKey() ?: throw GeneralSecurityException("the recovery key is missing from the keystore")
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, sealed, 0, IV_BYTES))
    return cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
  }

  @Synchronized
  private fun key(): SecretKey = storedKey() ?: generate()

  private fun storedKey(): SecretKey? {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    return store.getKey(ALIAS, null) as? SecretKey
  }

  private fun generate(): SecretKey {
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUserAuthenticationRequired(false)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }
}
