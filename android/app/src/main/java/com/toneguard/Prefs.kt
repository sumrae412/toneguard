package com.toneguard

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

object Prefs {
    private const val FILE = "toneguard_prefs"
    private const val KEY_API_KEY = "api_key"
    private const val KEY_STRICTNESS = "strictness"
    private const val KEY_ENABLED = "enabled"

    private fun prefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
            context, FILE, masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    fun getApiKey(context: Context): String? = prefs(context).getString(KEY_API_KEY, null)
    fun setApiKey(context: Context, key: String) = prefs(context).edit().putString(KEY_API_KEY, key).apply()

    fun getStrictness(context: Context): Int = prefs(context).getInt(KEY_STRICTNESS, 2)
    fun setStrictness(context: Context, level: Int) = prefs(context).edit().putInt(KEY_STRICTNESS, level).apply()

    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, true)
    fun setEnabled(context: Context, enabled: Boolean) = prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
}
