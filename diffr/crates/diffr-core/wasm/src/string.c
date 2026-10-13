/* What tree-sitter's lib.c uses of string.h beyond the compiler's builtins.
 * Weak, since grammars may compile this file too. */
#include <string.h>

__attribute__((weak)) int strncmp(const char *left, const char *right, size_t n) {
    for (; n; n--, left++, right++) {
        if (*left != *right) return (unsigned char)*left - (unsigned char)*right;
        if (!*left) return 0;
    }
    return 0;
}
