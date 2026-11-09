/* Bounded actual pinned-engine controls. Full FORS/signature qualification is separate. */
#include "pali_slh_native.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int value, const char *name) {
    if (!value) { fprintf(stderr, "SLH engine control failed: %s\n", name); exit(1); }
}
int main(void) {
    static const uint8_t expected_leaves[48] = {
        0xc3,0x6b,0x83,0x3b,0x84,0x47,0x36,0xc4,0x88,0xdf,0x16,0xe0,0xb8,0xa4,0xcc,0x5a,
        0x60,0x6f,0x2c,0x5b,0x31,0x29,0x21,0x98,0x93,0x04,0x6c,0x13,0x7b,0xa7,0xa3,0x0b,
        0x89,0xbc,0xf1,0x86,0xf6,0xe6,0x19,0xa8,0xa0,0xb6,0x6e,0xc9,0x1e,0x6c,0x3d,0xbb,
    };
    const uint8_t *seed = pali_slh_qualification_seed();
    uint8_t leaves[48];
    require(pali_slh_leaf_chunk(seed, 48, 0, 3, leaves, sizeof(leaves)) == PALI_SLH_OK,
            "actual three-leaf computation");
    require(!memcmp(leaves, expected_leaves, sizeof(leaves)), "existing public leaf vector");
    uint8_t *tree = calloc(1, PALI_SLH_XMSS_TREE_BYTES);
    require(tree != NULL, "native exact-capacity tree");
    require(pali_slh_tree_level(seed, 48, tree, PALI_SLH_XMSS_TREE_BYTES, 0, 0, 3) == PALI_SLH_OK,
            "actual bounded tree leaf update");
    require(!memcmp(tree, expected_leaves, sizeof(leaves)) && tree[48] == 0,
            "tree level layout and output window");
    require(pali_slh_tree_level(seed, 48, tree, PALI_SLH_XMSS_TREE_BYTES, 1, 0, 1) == PALI_SLH_OK,
            "actual parent-level computation");
    const size_t parent = (size_t)PALI_SLH_XMSS_LEAVES * 16;
    uint8_t changed = 0;
    for (size_t index = 0; index < 16; index++) changed |= tree[parent + index];
    require(changed != 0 && !memcmp(tree, expected_leaves, sizeof(leaves)) && tree[parent + 16] == 0,
            "parent update preserves children and adjacent node");
    uint8_t secret[64] = {0}, action[32] = {0}, optrand[16] = {0}, prelude[46];
    memcpy(secret, seed, 48);
    require(pali_slh_prelude(secret, 64, action, 32, optrand, 16, prelude, sizeof(prelude)) == PALI_SLH_OK,
            "actual checked prelude and strict RNG lease");
    uint8_t public_key[32] = {0}, signature[3856] = {0};
    require(pali_slh_verify(public_key, 32, action, 32, signature, sizeof(signature)) == PALI_SLH_INVALID_SIGNATURE,
            "actual engine rejects invalid full-length signature");
    free(tree);
    puts("Actual pinned SLH bounded controls passed: public leaves, tree levels, prelude, invalid verification; no positive FORS/signature qualification");
    return 0;
}
