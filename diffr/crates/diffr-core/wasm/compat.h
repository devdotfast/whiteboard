/* Included before every C file of a wasm32-unknown-unknown build. The
 * libc tree-sitter ships for that target leaves out a few things some
 * grammars' scanners use. */
#ifndef DIFFR_WASM_COMPAT_H
#define DIFFR_WASM_COMPAT_H
#ifndef __cplusplus
/* tree-sitter-language's wctype.h uses bool without including this. */
#include <stdbool.h>
/* tree-sitter-cpp, tree-sitter-xml */
typedef __WCHAR_TYPE__ wchar_t;
#ifndef static_assert
#define static_assert _Static_assert
#endif
#endif
/* tree-sitter-bash */
static inline int diffr_isdigit(int c) { return c >= '0' && c <= '9'; }
#define isdigit diffr_isdigit
/* tree-sitter-containerfile */
static inline int diffr_iswxdigit(int c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}
#define iswxdigit diffr_iswxdigit
static inline void *diffr_memchr(const void *s, int c, __SIZE_TYPE__ n) {
    const unsigned char *p = (const unsigned char *)s;
    for (; n; n--, p++)
        if (*p == (unsigned char)c) return (void *)p;
    return 0;
}
#define memchr diffr_memchr
/* tree-sitter-fortran, tree-sitter-r */
static inline int diffr_iswblank(int c) { return c == ' ' || c == '\t'; }
#define iswblank diffr_iswblank
/* ts-parser-perl */
static inline int diffr_strcmp(const char *a, const char *b) {
    for (; *a && *a == *b; a++, b++) {
    }
    return (unsigned char)*a - (unsigned char)*b;
}
#define strcmp diffr_strcmp
/* tree-sitter-ocaml, tree-sitter-ruby, tree-sitter-html: ASCII case only. */
static inline int diffr_iswlower(int c) { return c >= 'a' && c <= 'z'; }
#define iswlower diffr_iswlower
static inline int diffr_iswupper(int c) { return c >= 'A' && c <= 'Z'; }
#define iswupper diffr_iswupper
static inline int diffr_towupper(int c) { return diffr_iswlower(c) ? c - 'a' + 'A' : c; }
#define towupper diffr_towupper
static inline char *diffr_strchr(const char *s, int c) {
    for (;; s++) {
        if (*s == (char)c) return (char *)s;
        if (!*s) return 0;
    }
}
#define strchr diffr_strchr
static inline char *diffr_strncpy(char *dst, const char *src, __SIZE_TYPE__ n) {
    __SIZE_TYPE__ i = 0;
    for (; i < n && src[i]; i++) dst[i] = src[i];
    for (; i < n; i++) dst[i] = 0;
    return dst;
}
#define strncpy diffr_strncpy
/* The vendored scanners: a scanner that gives up traps. */
static inline __attribute__((noreturn)) void diffr_exit(int status) {
    (void)status;
    __builtin_trap();
}
#define exit diffr_exit
#endif
