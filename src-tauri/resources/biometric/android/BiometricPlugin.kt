package com.gabriel.notia

import android.app.Activity
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.annotation.RequiresApi
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Fingerprint boundary for ColdPass on Android.
 *
 * Each library gets an AES-GCM key in the Android Keystore that only works
 * right after a strong biometric (class 3) and is invalidated when the
 * fingerprints registered on the device change. The backend hands the
 * secret that unlocks ColdPass to `enable`, which seals it with that key
 * once the finger is accepted; `unlock` opens it again the same way. This
 * plugin decides nothing about the vault: it only seals and opens bytes
 * behind the fingerprint, and never logs them.
 *
 * Every answer is `{ ok, ... }`; a failure carries `code`:
 * `unavailable`, `cancelled`, `lockout`, `invalidated`, `missing`, `busy`
 * or `failed`.
 */
@TauriPlugin
class BiometricPlugin(private val activity: Activity) : Plugin(activity) {

    /** Only one prompt at a time. */
    private val prompting = AtomicBoolean(false)

    @Command
    fun status(invoke: Invoke) {
        invoke.resolve(JSObject().put("ok", true).put("availability", availability()))
    }

    @Command
    fun enable(invoke: Invoke) {
        val args = try {
            enableArgs(invoke.getArgs())
        } catch (error: Exception) {
            logFailure("enable args", error)
            invoke.resolve(failure("failed"))
            return
        }
        if (!isValidAlias(args.alias) || Build.VERSION.SDK_INT < Build.VERSION_CODES.R || availability() != "available") {
            invoke.resolve(failure("unavailable"))
            return
        }
        val secret = try {
            Base64.decode(args.secret, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            invoke.resolve(failure("failed"))
            return
        }
        val cipher = try {
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, createKey(args.alias)) }
        } catch (error: Exception) {
            logFailure("enable key", error)
            secret.fill(0)
            deleteKey(args.alias)
            invoke.resolve(failure("failed"))
            return
        }
        authenticate(invoke, cipher, args.title, args.subtitle, onDone = { secret.fill(0) }) { ready ->
            val sealed = ready.doFinal(secret)
            JSObject()
                .put("ok", true)
                .put("iv", Base64.encodeToString(ready.iv, Base64.NO_WRAP))
                .put("ciphertext", Base64.encodeToString(sealed, Base64.NO_WRAP))
        }
    }

    @Command
    fun unlock(invoke: Invoke) {
        val args = try {
            unlockArgs(invoke.getArgs())
        } catch (error: Exception) {
            logFailure("unlock args", error)
            invoke.resolve(failure("failed"))
            return
        }
        if (!isValidAlias(args.alias) || Build.VERSION.SDK_INT < Build.VERSION_CODES.R || availability() != "available") {
            invoke.resolve(failure("unavailable"))
            return
        }
        val key = loadKey(args.alias)
        if (key == null) {
            invoke.resolve(failure("missing"))
            return
        }
        val cipher = try {
            val iv = Base64.decode(args.iv, Base64.NO_WRAP)
            Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, iv)) }
        } catch (_: KeyPermanentlyInvalidatedException) {
            deleteKey(args.alias)
            invoke.resolve(failure("invalidated"))
            return
        } catch (error: Exception) {
            logFailure("unlock cipher", error)
            invoke.resolve(failure("failed"))
            return
        }
        val sealed = try {
            Base64.decode(args.ciphertext, Base64.NO_WRAP)
        } catch (_: IllegalArgumentException) {
            invoke.resolve(failure("failed"))
            return
        }
        authenticate(invoke, cipher, args.title, args.subtitle, onDone = {}) { ready ->
            val secret = ready.doFinal(sealed)
            val encoded = Base64.encodeToString(secret, Base64.NO_WRAP)
            secret.fill(0)
            JSObject().put("ok", true).put("secret", encoded)
        }
    }

    @Command
    fun remove(invoke: Invoke) {
        val alias = try {
            invoke.getArgs().text("alias")
        } catch (error: Exception) {
            logFailure("remove args", error)
            invoke.resolve(failure("failed"))
            return
        }
        if (isValidAlias(alias)) {
            deleteKey(alias)
        }
        invoke.resolve(JSObject().put("ok", true))
    }

    /** `available`, `not-enrolled` (a sensor without fingerprints) or `unsupported`. */
    private fun availability(): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            return "unsupported"
        }
        val manager = activity.getSystemService(BiometricManager::class.java) ?: return "unsupported"
        return when (manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)) {
            BiometricManager.BIOMETRIC_SUCCESS -> "available"
            BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "not-enrolled"
            else -> "unsupported"
        }
    }

    /**
     * Shows the system fingerprint prompt bound to `cipher` and resolves
     * `invoke` once: with `onSuccess` when the finger is accepted, with a
     * failure otherwise. A wrong finger keeps the prompt open, as Android
     * does.
     */
    @RequiresApi(Build.VERSION_CODES.R)
    private fun authenticate(
        invoke: Invoke,
        cipher: Cipher,
        title: String,
        subtitle: String,
        onDone: () -> Unit,
        onSuccess: (Cipher) -> JSObject,
    ) {
        if (!prompting.compareAndSet(false, true)) {
            onDone()
            invoke.resolve(failure("busy"))
            return
        }
        val resolved = AtomicBoolean(false)
        val finish = { answer: JSObject ->
            if (resolved.compareAndSet(false, true)) {
                onDone()
                prompting.set(false)
                invoke.resolve(answer)
            }
        }
        activity.runOnUiThread {
            try {
                val executor = activity.mainExecutor
                val signal = CancellationSignal()
                val prompt = BiometricPrompt.Builder(activity)
                    .setTitle(title.take(MAX_TEXT))
                    .setSubtitle(subtitle.take(MAX_TEXT))
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .setNegativeButton("Usar contraseña", executor) { _, _ -> finish(failure("cancelled")) }
                    .build()
                prompt.authenticate(
                    BiometricPrompt.CryptoObject(cipher),
                    signal,
                    executor,
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                            val ready = result.cryptoObject?.cipher
                            val answer = try {
                                if (ready == null) failure("failed") else onSuccess(ready)
                            } catch (error: Exception) {
                                logFailure("prompt result", error)
                                failure("failed")
                            }
                            finish(answer)
                        }

                        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                            Log.w(TAG, "prompt error $errorCode")
                            finish(failure(errorCodeName(errorCode)))
                        }
                    },
                )
            } catch (error: Exception) {
                logFailure("prompt", error)
                finish(failure("failed"))
            }
        }
    }

    private fun errorCodeName(errorCode: Int): String = when (errorCode) {
        BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED,
        BiometricPrompt.BIOMETRIC_ERROR_CANCELED,
        BiometricPrompt.BIOMETRIC_ERROR_TIMEOUT -> "cancelled"
        BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT,
        BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT -> "lockout"
        BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS,
        BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT,
        BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "unavailable"
        else -> "failed"
    }

    /** A new key for `alias`, replacing the one before. */
    @RequiresApi(Build.VERSION_CODES.R)
    private fun createKey(alias: String): SecretKey {
        deleteKey(alias)
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                .setInvalidatedByBiometricEnrollment(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun loadKey(alias: String): SecretKey? = try {
        keyStore().getKey(alias, null) as? SecretKey
    } catch (_: Exception) {
        null
    }

    private fun deleteKey(alias: String) {
        try {
            val store = keyStore()
            if (store.containsAlias(alias)) {
                store.deleteEntry(alias)
            }
        } catch (_: Exception) {
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun isValidAlias(alias: String): Boolean =
        alias.startsWith(ALIAS_PREFIX) && alias.length <= MAX_ALIAS && alias.all { it.isLetterOrDigit() || it == '-' }

    /**
     * Only the step and the exception class. Never the message: it can
     * quote the arguments, which carry the secret.
     */
    private fun logFailure(step: String, error: Exception) {
        Log.w(TAG, "$step failed: ${error.javaClass.name}")
    }

    private fun failure(code: String): JSObject = JSObject().put("ok", false).put("code", code)

    private companion object {
        const val TAG = "NotiaBiometric"
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
        const val ALIAS_PREFIX = "notia-coldpass-"
        const val MAX_ALIAS = 96
        const val MAX_TEXT = 120
    }
}

private data class EnableArgs(val alias: String, val secret: String, val title: String, val subtitle: String)

private data class UnlockArgs(
    val alias: String,
    val iv: String,
    val ciphertext: String,
    val title: String,
    val subtitle: String,
)

// Read by hand: `parseArgs` cannot build Kotlin data classes (Jackson has
// no Kotlin module here).
private fun JSObject.text(key: String): String =
    getString(key, null) ?: throw IllegalArgumentException("missing argument")

private fun enableArgs(args: JSObject) =
    EnableArgs(args.text("alias"), args.text("secret"), args.text("title"), args.text("subtitle"))

private fun unlockArgs(args: JSObject) =
    UnlockArgs(args.text("alias"), args.text("iv"), args.text("ciphertext"), args.text("title"), args.text("subtitle"))
