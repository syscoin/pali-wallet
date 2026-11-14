#include "PaliCredentialPublication.h"
#include <errno.h>
#include <stddef.h>
#include <jni.h>

JNIEXPORT jint JNICALL Java_org_syscoin_pali_storage_PaliCredentialPublication_renameNoReplace(
    JNIEnv *env, jclass type, jstring directory, jstring stem) {
  (void)type;
  if (!directory || !stem || (*env)->GetStringUTFLength(env, directory) > 4096 ||
      (*env)->GetStringUTFLength(env, stem) != 64) return EINVAL;
  const char *folder = (*env)->GetStringUTFChars(env, directory, NULL);
  if (!folder) return ENOMEM;
  const char *name = (*env)->GetStringUTFChars(env, stem, NULL);
  if (!name) { (*env)->ReleaseStringUTFChars(env, directory, folder); return ENOMEM; }
  const int result = pali_credential_publish(folder, name);
  (*env)->ReleaseStringUTFChars(env, stem, name);
  (*env)->ReleaseStringUTFChars(env, directory, folder);
  return result;
}
