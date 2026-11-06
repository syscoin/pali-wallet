#include <jni.h>
#include <stdint.h>

#include "../../../../shared/mimc_batch.h"

JNIEXPORT jbyteArray JNICALL
Java_expo_modules_paliwalletcrypto_PaliPublicMerkleNative_execute(
    JNIEnv *env, jclass type, jbyteArray program) {
  (void)type;
  if (program == NULL) return NULL;
  const jsize length = (*env)->GetArrayLength(env, program);
  if (length < MIMC_BATCH_HEADER_BYTES || length > MIMC_BATCH_MAX_INPUT) return NULL;

  uint8_t input[MIMC_BATCH_MAX_INPUT];
  (*env)->GetByteArrayRegion(env, program, 0, length, (jbyte *)input);
  if ((*env)->ExceptionCheck(env)) return NULL;
  const size_t count = ((size_t)input[1] << 8) | input[2];
  if (!count || count > MIMC_BATCH_MAX_OPERATIONS ||
      (size_t)length != MIMC_BATCH_HEADER_BYTES + count * MIMC_BATCH_OPERATION_BYTES) return NULL;

  uint8_t output[MIMC_BATCH_MAX_OUTPUT];
  const size_t output_length = count * MIMC_BATCH_WORD_BYTES;
  if (!mimc_batch_execute(input, (size_t)length, output, output_length)) return NULL;
  jbyteArray result = (*env)->NewByteArray(env, (jsize)output_length);
  if (result == NULL) return NULL;
  (*env)->SetByteArrayRegion(env, result, 0, (jsize)output_length, (const jbyte *)output);
  if ((*env)->ExceptionCheck(env)) return NULL;
  return result;
}
