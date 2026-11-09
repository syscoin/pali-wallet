/* Exercises the actual JNI file boundary, without loading a VM or running crypto. */
#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <jni.h>

static int full_disk;
static int reserve(int fd, off_t offset, off_t size) {
  if (full_disk) return ENOSPC;
#ifdef __APPLE__
  assert(offset == 0);
  fstore_t allocation = {0};
  allocation.fst_flags = F_ALLOCATEALL;
  allocation.fst_posmode = F_PEOFPOSMODE;
  allocation.fst_length = size;
  return fcntl(fd, F_PREALLOCATE, &allocation) == 0 && allocation.fst_bytesalloc >= size ? 0 : ENOSPC;
#else
  return posix_fallocate(fd, offset, size);
#endif
}
#define posix_fallocate reserve
#include "../android/src/main/cpp/PaliSlhJni.c"
#undef posix_fallocate

/* No cryptographic stub may execute: this is a file/admission test only. */
const uint8_t *pali_slh_qualification_seed(void) { abort(); }
void pali_slh_erase(void *value, size_t size) { volatile uint8_t *bytes = value; while (size--) *bytes++ = 0; }
#define REFUSE(name, params) enum pali_slh_status name params { abort(); }
REFUSE(pali_slh_leaf_chunk, (const uint8_t *a, size_t b, uint32_t c, uint32_t d, uint8_t *e, size_t f))
REFUSE(pali_slh_tree_level, (const uint8_t *a, size_t b, uint8_t *c, size_t d, uint32_t e, uint32_t f, uint32_t g))
REFUSE(pali_slh_prelude, (const uint8_t *a, size_t b, const uint8_t *c, size_t d, const uint8_t *e, size_t f, uint8_t *g, size_t h))
REFUSE(pali_slh_fors_tree, (const uint8_t *a, size_t b, const uint8_t *c, size_t d, uint32_t e, uint8_t *f, size_t g))
REFUSE(pali_slh_sign_cached, (const uint8_t *a, size_t b, const uint8_t *c, size_t d, const uint8_t *e, size_t f, const uint8_t *g, size_t h, uint8_t *i, size_t j))
REFUSE(pali_slh_finish, (const uint8_t *a, size_t b, const uint8_t *c, size_t d, const uint8_t *e, size_t f, const uint8_t *g, size_t h, const uint8_t *i, size_t j, const uint8_t *k, size_t l, uint8_t *m, size_t n))
REFUSE(pali_slh_verify, (const uint8_t *a, size_t b, const uint8_t *c, size_t d, const uint8_t *e, size_t f))
#undef REFUSE

static jsize JNICALL length(JNIEnv *env, jstring text) { (void)env; return (jsize)strlen((const char *)text); }
static const char * JNICALL chars(JNIEnv *env, jstring text, jboolean *copy) { (void)env; (void)copy; return (const char *)text; }
static void JNICALL release(JNIEnv *env, jstring text, const char *bytes) { (void)env; (void)text; (void)bytes; }
static jclass JNICALL object_class(JNIEnv *env, jobject object) { (void)env; return (jclass)object; }
static jmethodID JNICALL method(JNIEnv *env, jclass type, const char *name, const char *signature) {
  (void)env; (void)type; assert(!strcmp(name, "isCurrentForSlhIO") && !strcmp(signature, "()Z")); return (jmethodID)1;
}
static jboolean JNICALL boolean_method(JNIEnv *env, jobject object, jmethodID id, ...) { (void)env; (void)id; return *(int *)object; }
static jboolean JNICALL exception(JNIEnv *env) { (void)env; return 0; }
static void JNICALL delete_ref(JNIEnv *env, jobject object) { (void)env; (void)object; }
static const struct JNINativeInterface_ functions = {
  .GetStringUTFLength = length, .GetStringUTFChars = chars, .ReleaseStringUTFChars = release,
  .GetObjectClass = object_class, .GetMethodID = method, .CallBooleanMethod = boolean_method,
  .ExceptionCheck = exception, .DeleteLocalRef = delete_ref
};
#define CALL(name, ...) Java_expo_modules_paliwalletcrypto_PaliSlhNative_##name(&env, NULL, __VA_ARGS__)
#define STRING(value) ((jstring)(value))

int main(void) {
  JNIEnv env = &functions;
  char base[] = "/tmp/pali-slh-fd-XXXXXX";
  assert(mkdtemp(base)); assert(chmod(base, 0700) == 0);
  const char *scope = "0x1212121212121212121212121212121212121212121212121212121212121212";
  const char *partial = "123456789abcdef0123456789abcdef0.partial";
  const char *final = "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0.xmss";
  assert(CALL(openNamespace, STRING(base), STRING("0x12"), 1) == -1);
  const int directory = CALL(openNamespace, STRING(base), STRING(scope), 1); assert(directory >= 0);
  assert(CALL(openTree, directory, STRING("../escape.partial"), 1) == -1);
  const int fd = CALL(openTree, directory, STRING(partial), 1); assert(fd >= 0);
  assert(CALL(openTree, directory, STRING(partial), 1) == -1);
  full_disk = 1; assert(!CALL(reserveTree, fd));
  struct stat info; assert(fstat(fd, &info) == 0 && info.st_size == 0);
  full_disk = 0; assert(CALL(reserveTree, fd));
  assert(fstat(fd, &info) == 0 && info.st_size == PALI_SLH_XMSS_TREE_BYTES);
  assert(CALL(validateTree, directory, fd, STRING(partial)));
  assert(fchmod(fd, 0644) == 0); assert(!CALL(validateTree, directory, fd, STRING(partial))); assert(fchmod(fd, 0600) == 0);
  assert(linkat(directory, partial, directory, "alias", 0) == 0);
  assert(!CALL(validateTree, directory, fd, STRING(partial))); assert(unlinkat(directory, "alias", 0) == 0);
  assert(symlinkat(partial, directory, final) == 0);
  assert(CALL(openTree, directory, STRING(final), 0) == -1); assert(unlinkat(directory, final, 0) == 0);
  int live = 0;
  assert(CALL(publishTree, directory, fd, STRING(partial), STRING(final), (jobject)&live) == 0);
  assert(CALL(validateTree, directory, fd, STRING(partial)));
  live = 1; assert(CALL(publishTree, directory, fd, STRING(partial), STRING(final), (jobject)&live) == 1);
  assert(!CALL(abortTree, directory, fd, STRING(final)));
  assert(CALL(validateTree, directory, fd, STRING(final)));
  live = 0; assert(CALL(purgeTrees, directory, (jobject)&live) == 0);
  assert(CALL(validateTree, directory, fd, STRING(final)));
  live = 1; assert(CALL(closeDescriptor, fd));
  const int stale = CALL(openTree, directory, STRING(partial), 1); assert(stale >= 0);
  assert(unlinkat(directory, partial, 0) == 0);
  const int successor = CALL(openTree, directory, STRING(partial), 1); assert(successor >= 0);
  assert(!CALL(abortTree, directory, stale, STRING(partial)));
  assert(CALL(closeDescriptor, stale)); assert(CALL(closeDescriptor, successor));
  assert(CALL(purgeTrees, directory, (jobject)&live) == 1);
  assert(fstatat(directory, partial, &info, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT);
  assert(fstatat(directory, final, &info, AT_SYMLINK_NOFOLLOW) != 0 && errno == ENOENT);
  const int odd = openat(directory, "unexpected", O_CREAT | O_EXCL | O_WRONLY, 0600); assert(odd >= 0); assert(close(odd) == 0);
  assert(CALL(purgeTrees, directory, (jobject)&live) == 0); assert(unlinkat(directory, "unexpected", 0) == 0);
  assert(CALL(closeDescriptor, directory));
  char path[512]; snprintf(path, sizeof(path), "%s/PaliSlhCache/%s", base, scope + 2); assert(rmdir(path) == 0);
  snprintf(path, sizeof(path), "%s/PaliSlhCache", base); assert(rmdir(path) == 0); assert(rmdir(base) == 0);
  puts("SLH JNI protected-FD bounds, ENOSPC, inode, symlink, publication and purge controls passed");
  return 0;
}
