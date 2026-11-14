cmake_minimum_required(VERSION 3.22)
project(pali_credential_publication LANGUAGES C)

add_library(pali_credential_publication SHARED
  PaliCredentialPublication.c
  PaliCredentialPublicationJni.c
)
set_target_properties(pali_credential_publication PROPERTIES C_STANDARD 11 C_STANDARD_REQUIRED ON)
target_compile_options(pali_credential_publication PRIVATE -Wall -Wextra -Werror -fvisibility=hidden)
target_link_options(pali_credential_publication PRIVATE "-Wl,-z,max-page-size=16384" "-Wl,-z,common-page-size=16384")
