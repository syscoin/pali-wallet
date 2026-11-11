package org.syscoin.pali.passkeys

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.security.MessageDigest
import java.util.Base64

/** Data admission only. Credential Manager supplies the native origin and response. */
internal object PaliPasskeyPolicy {
  const val RP_ID = "paliwallet.com"
  const val TIMEOUT_MS = 90_000L
  const val MAX_OPTIONS_BYTES = 65_536
  const val MAX_RESPONSE_BYTES = 262_144

  fun origin(certificates: List<ByteArray>): String {
    require(certificates.size == 1 && certificates.single().isNotEmpty()) { "PASSKEY_UNAVAILABLE" }
    return "android:apk-key-hash:" + Base64.getUrlEncoder().withoutPadding()
      .encodeToString(MessageDigest.getInstance("SHA-256").digest(certificates.single()))
  }

  private fun parse(raw: String): JSONObject {
    require(raw.isNotEmpty() && raw.length <= MAX_OPTIONS_BYTES && raw.toByteArray(Charsets.UTF_8).size <= MAX_OPTIONS_BYTES)
    var depth = 0
    var quoted = false
    var escaped = false
    for (character in raw) {
      if (quoted) {
        require(character.code >= 32)
        if (escaped) escaped = false else if (character == '\\') escaped = true else if (character == '"') quoted = false
      } else when (character) {
        '"' -> quoted = true
        '{', '[' -> { depth++; require(depth <= 8) }
        '}', ']' -> { depth--; require(depth >= 0) }
        '\'' -> throw IllegalArgumentException("Invalid JSON quote")
      }
    }
    require(depth == 0 && !quoted)
    val tokener = JSONTokener(raw)
    val value = tokener.nextValue()
    require(value is JSONObject && tokener.nextClean() == '\u0000')
    return value
  }

  private fun fields(value: JSONObject, required: Set<String>, optional: Set<String> = emptySet()) {
    val keys = value.keys().asSequence().toSet()
    require(keys.containsAll(required) && keys.all { it in required || it in optional })
  }

  private fun text(value: Any, maximum: Int): String {
    require(value is String && value.isNotEmpty() && value.length <= maximum)
    require(value.none { it.code < 32 || it.code == 127 })
    return value
  }

  private fun bytes(value: Any, minimum: Int, maximum: Int) {
    require(value is String && value.length <= (maximum * 4 + 2) / 3 && Regex("[A-Za-z0-9_-]+").matches(value))
    val decoded = Base64.getUrlDecoder().decode(value)
    require(decoded.size in minimum..maximum && Base64.getUrlEncoder().withoutPadding().encodeToString(decoded) == value)
  }

  private fun timeout(value: JSONObject) {
    require(value.get("timeout") is Number && (value.get("timeout") as Number).toDouble() == TIMEOUT_MS.toDouble())
  }

  private fun descriptors(value: Any, maximum: Int) {
    require(value is JSONArray && value.length() <= maximum)
    for (index in 0 until value.length()) {
      val descriptor = value.get(index)
      require(descriptor is JSONObject)
      fields(descriptor, setOf("type", "id"), setOf("transports"))
      require(descriptor.get("type") == "public-key")
      bytes(descriptor.get("id"), 1, 1024)
      if (descriptor.has("transports")) {
        val transports = descriptor.get("transports")
        require(transports is JSONArray && transports.length() <= 8)
        for (transport in 0 until transports.length()) require(transports.get(transport) in setOf("usb", "nfc", "ble", "internal", "hybrid", "smart-card"))
      }
    }
  }

  fun createOptions(raw: String): String {
    val value = parse(raw)
    fields(value, setOf("challenge", "rp", "user", "pubKeyCredParams", "authenticatorSelection", "attestation", "timeout"), setOf("excludeCredentials"))
    bytes(value.get("challenge"), 32, 32)
    timeout(value)
    require(value.get("attestation") == "none")
    val rp = value.get("rp")
    require(rp is JSONObject)
    fields(rp, setOf("id", "name"))
    require(rp.get("id") == RP_ID && rp.get("name") == "Pali Wallet")
    val user = value.get("user")
    require(user is JSONObject)
    fields(user, setOf("id", "name", "displayName"))
    bytes(user.get("id"), 32, 32)
    text(user.get("name"), 80)
    text(user.get("displayName"), 80)
    val algorithms = value.get("pubKeyCredParams")
    require(algorithms is JSONArray && algorithms.length() == 1)
    val algorithm = algorithms.get(0)
    require(algorithm is JSONObject)
    fields(algorithm, setOf("type", "alg"))
    require(algorithm.get("type") == "public-key" && algorithm.get("alg") is Number && (algorithm.get("alg") as Number).toDouble() == -7.0)
    val selection = value.get("authenticatorSelection")
    require(selection is JSONObject)
    fields(selection, setOf("residentKey", "requireResidentKey", "userVerification"))
    require(selection.get("residentKey") == "required" && selection.get("requireResidentKey") == true && selection.get("userVerification") == "required")
    if (value.has("excludeCredentials")) descriptors(value.get("excludeCredentials"), 32)
    return value.toString()
  }

  fun getOptions(raw: String): String {
    val value = parse(raw)
    fields(value, setOf("challenge", "rpId", "userVerification", "timeout"), setOf("allowCredentials"))
    bytes(value.get("challenge"), 32, 32)
    timeout(value)
    require(value.get("rpId") == RP_ID && value.get("userVerification") == "required")
    if (value.has("allowCredentials")) descriptors(value.get("allowCredentials"), 1)
    return value.toString()
  }

  fun response(raw: String): String {
    require(raw.isNotEmpty() && raw.length <= MAX_RESPONSE_BYTES && raw.toByteArray(Charsets.UTF_8).size <= MAX_RESPONSE_BYTES)
    return raw
  }
}
