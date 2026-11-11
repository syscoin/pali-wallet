package org.syscoin.pali.passkeys

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.Base64

class PaliPasskeyPolicyTest {
  private val value32 = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { it.toByte() })
  private fun create(): JSONObject = JSONObject().put("challenge", value32)
    .put("rp", JSONObject().put("id", "paliwallet.com").put("name", "Pali Wallet"))
    .put("user", JSONObject().put("id", value32).put("name", "Public account").put("displayName", "Pali account"))
    .put("pubKeyCredParams", JSONArray().put(JSONObject().put("type", "public-key").put("alg", -7)))
    .put("authenticatorSelection", JSONObject().put("residentKey", "required").put("requireResidentKey", true).put("userVerification", "required"))
    .put("attestation", "none").put("timeout", 90000)
  private fun get(): JSONObject = JSONObject().put("challenge", value32).put("rpId", "paliwallet.com")
    .put("userVerification", "required").put("timeout", 90000)
  private fun descriptor(): JSONObject = JSONObject().put("type", "public-key").put("id", value32)
  private fun refused(action: () -> Unit) {
    try { action(); fail("Invalid options were accepted") } catch (_: IllegalArgumentException) { } catch (_: org.json.JSONException) { }
  }

  @Test fun acceptsCanonicalCreateAndGetWithoutOriginOverrides() {
    val created = JSONObject(PaliPasskeyPolicy.createOptions(create().toString()))
    assertEquals("required", created.getJSONObject("authenticatorSelection").getString("userVerification"))
    assertEquals(-7, created.getJSONArray("pubKeyCredParams").getJSONObject(0).getInt("alg"))
    assertFalse(created.has("origin")); assertFalse(created.has("clientDataHash"))
    val assertion = get().put("allowCredentials", JSONArray().put(descriptor()))
    assertEquals(value32, JSONObject(PaliPasskeyPolicy.getOptions(assertion.toString())).getJSONArray("allowCredentials").getJSONObject(0).getString("id"))
  }

  @Test fun rejectsRpAndOriginSubstitution() {
    for (field in listOf("origin", "clientDataHash", "extensions")) {
      refused { PaliPasskeyPolicy.createOptions(create().put(field, "https://elsewhere.invalid").toString()) }
      refused { PaliPasskeyPolicy.getOptions(get().put(field, "https://elsewhere.invalid").toString()) }
    }
    refused { PaliPasskeyPolicy.createOptions(create().also { it.getJSONObject("rp").put("id", "evil.paliwallet.com") }.toString()) }
    refused { PaliPasskeyPolicy.getOptions(get().put("rpId", "elsewhere.invalid").toString()) }
  }

  @Test fun requiresVerifiedResidentEs256Creation() {
    for (field in listOf("userVerification", "residentKey")) refused {
      PaliPasskeyPolicy.createOptions(create().also { it.getJSONObject("authenticatorSelection").put(field, "preferred") }.toString())
    }
    refused { PaliPasskeyPolicy.createOptions(create().also { it.getJSONObject("authenticatorSelection").put("requireResidentKey", false) }.toString()) }
    refused { PaliPasskeyPolicy.createOptions(create().put("attestation", "direct").toString()) }
    refused { PaliPasskeyPolicy.createOptions(create().also { it.getJSONArray("pubKeyCredParams").getJSONObject(0).put("alg", -257) }.toString()) }
    refused { PaliPasskeyPolicy.createOptions(create().also { it.getJSONArray("pubKeyCredParams").put(JSONObject().put("type", "public-key").put("alg", -7)) }.toString()) }
    refused { PaliPasskeyPolicy.getOptions(get().put("userVerification", "discouraged").toString()) }
  }

  @Test fun enforcesCanonicalByteAndTextBounds() {
    for (bytes in listOf(31, 33)) refused { PaliPasskeyPolicy.getOptions(get().put("challenge", Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(bytes))).toString()) }
    refused { PaliPasskeyPolicy.getOptions(get().put("challenge", "$value32=").toString()) }
    refused { PaliPasskeyPolicy.createOptions(create().also { it.getJSONObject("user").put("name", "a".repeat(81)) }.toString()) }
    refused { PaliPasskeyPolicy.createOptions(create().also { it.getJSONObject("user").put("id", "YWJj") }.toString()) }
    refused { PaliPasskeyPolicy.getOptions(get().put("timeout", 90001).toString()) }
    refused { PaliPasskeyPolicy.getOptions(" ".repeat(PaliPasskeyPolicy.MAX_OPTIONS_BYTES + 1)) }
    refused { PaliPasskeyPolicy.getOptions("[".repeat(10000) + "]".repeat(10000)) }
    refused { PaliPasskeyPolicy.getOptions(get().toString() + "{}") }
  }

  @Test fun boundsAllowAndExcludeListsAndCredentialIds() {
    PaliPasskeyPolicy.createOptions(create().put("excludeCredentials", JSONArray().also { rows -> repeat(32) { rows.put(descriptor()) } }).toString())
    refused { PaliPasskeyPolicy.createOptions(create().put("excludeCredentials", JSONArray().also { rows -> repeat(33) { rows.put(descriptor()) } }).toString()) }
    refused { PaliPasskeyPolicy.getOptions(get().put("allowCredentials", JSONArray().put(descriptor()).put(descriptor())).toString()) }
    refused { PaliPasskeyPolicy.getOptions(get().put("allowCredentials", JSONArray().put(descriptor().put("id", ""))).toString()) }
    refused { PaliPasskeyPolicy.getOptions(get().put("allowCredentials", JSONArray().put(descriptor().put("type", "password"))).toString()) }
  }

  @Test fun derivesTheNativeOriginFromExactlyOneCurrentCertificate() {
    assertEquals("android:apk-key-hash:ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0", PaliPasskeyPolicy.origin(listOf("abc".toByteArray())))
    refused { PaliPasskeyPolicy.origin(emptyList()) }
    refused { PaliPasskeyPolicy.origin(listOf(byteArrayOf())) }
    refused { PaliPasskeyPolicy.origin(listOf("abc".toByteArray(), "second".toByteArray())) }
  }

  @Test fun returnsRawBoundedResponsesWithoutSignatureInterpretation() {
    val raw = "{\"type\":\"public-key\",\"response\":{\"signature\":\"public-fixture\"}}"
    assertEquals(raw, PaliPasskeyPolicy.response(raw))
    refused { PaliPasskeyPolicy.response("") }
    refused { PaliPasskeyPolicy.response("a".repeat(PaliPasskeyPolicy.MAX_RESPONSE_BYTES + 1)) }
  }
}
