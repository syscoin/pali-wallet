/* Reuse the guarded production JNI file boundary and refusing crypto stubs. */
#define main slh_files_guard_main
#include "slh-native-files.c"
#undef main

JNIEXPORT jboolean JNICALL Java_expo_modules_paliwalletcrypto_SlhResourceNative_descriptorOpen(
    JNIEnv *env, jclass type, jint fd) {
  (void)env; (void)type;
  return fcntl(fd, F_GETFD) >= 0;
}
