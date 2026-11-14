#ifndef PALI_CREDENTIAL_PUBLICATION_H
#define PALI_CREDENTIAL_PUBLICATION_H

/* Returns zero or errno. Only <64 lowercase hex>.new -> .bin is admitted. */
int pali_credential_publish(const char *directory, const char *stem);

#endif
