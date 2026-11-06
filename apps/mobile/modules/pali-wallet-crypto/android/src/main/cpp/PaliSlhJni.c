#include <jni.h>
#include <stdlib.h>

#include "../../../../shared/slh/pali_slh_native.h"
#include "../../../../shared/slh/strict_rng.h"

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_paliwalletcrypto_PaliSlhNative_publicFixtureSeed(JNIEnv *env, jclass type) {
  (void)type;
  jbyteArray result = (*env)->NewByteArray(env, PALI_SLH_SEED_BYTES);
  if (result != NULL) {
    (*env)->SetByteArrayRegion(env, result, 0, PALI_SLH_SEED_BYTES,
      (const jbyte *)pali_slh_qualification_seed());
  }
  return (*env)->ExceptionCheck(env) ? NULL : result;
}

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_paliwalletcrypto_PaliSlhNative_leafChunk(
    JNIEnv *env, jclass type, jbyteArray seed, jint start, jint count) {
  (void)type;
  if (seed == NULL || (*env)->GetArrayLength(env, seed) != PALI_SLH_SEED_BYTES ||
      start < 0 || count <= 0 || count > PALI_SLH_MAX_LEAF_CHUNK ||
      start > PALI_SLH_XMSS_LEAVES - count) return NULL;
  uint8_t owned_seed[PALI_SLH_SEED_BYTES];
  (*env)->GetByteArrayRegion(env, seed, 0, PALI_SLH_SEED_BYTES, (jbyte *)owned_seed);
  if ((*env)->ExceptionCheck(env)) {
    pali_slh_erase(owned_seed, sizeof(owned_seed));
    return NULL;
  }
  const size_t size = (size_t)count * 16;
  uint8_t *output = malloc(size);
  if (output == NULL) { pali_slh_erase(owned_seed, sizeof(owned_seed)); return NULL; }
  const enum pali_slh_status status = pali_slh_leaf_chunk(owned_seed, sizeof(owned_seed),
      (uint32_t)start, (uint32_t)count, output, size);
  pali_slh_erase(owned_seed, sizeof(owned_seed));
  jbyteArray result = NULL;
  if (status == PALI_SLH_OK) {
    result = (*env)->NewByteArray(env, (jsize)size);
    if (result != NULL) (*env)->SetByteArrayRegion(env, result, 0, (jsize)size, (const jbyte *)output);
  }
  pali_slh_erase(output, size);
  free(output);
  return (*env)->ExceptionCheck(env) ? NULL : result;
}
