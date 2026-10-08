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
/* tree-sitter-language's assert.h defines __assert_fail in every file that
 * includes it, which links as duplicates. Take its place with a static one. */
#define TREE_SITTER_WASM_ASSERT_H_
#ifdef NDEBUG
#define assert(e) ((void)0)
#else
static inline __attribute__((noreturn)) void diffr_assert_fail(void) { __builtin_trap(); }
#define assert(expression) ((expression) ? (void)0 : diffr_assert_fail())
#endif
/* The vendored scanners: a scanner that gives up traps. */
static inline __attribute__((noreturn)) void diffr_exit(int status) {
    (void)status;
    __builtin_trap();
}
#define exit diffr_exit
/* A grammar's generated lexer is one function: a loop around a switch with a
 * branch per state. LLVM's WebAssembly backend checks every loop for
 * irreducible control flow by working out which blocks reach which, which
 * takes memory in the square of the function's blocks: tens of gigabytes
 * for the largest grammars (tree-sitter-fortran, tree-sitter-julia), past a
 * CI runner's. So the loop moves out: the generated function takes one step
 * and says where to go next, and a small driver advances the lexer and
 * calls it again. tree-sitter's macros are replaced with ones that return
 * instead of jumping back; the rest of the generated code is unchanged. */
#if __has_include("tree_sitter/parser.h")
#include "tree_sitter/parser.h"
static bool diffr_lex_result, diffr_lex_skip;
static TSStateId diffr_lex_next;
static __attribute__((noinline)) bool diffr_lex_step(TSLexer *lexer, TSStateId state);
static __attribute__((noinline)) bool diffr_lex_keywords_step(TSLexer *lexer, TSStateId state);
static inline bool diffr_lex(bool (*step)(TSLexer *, TSStateId), TSLexer *lexer, TSStateId state) {
    diffr_lex_result = false;
    while (step(lexer, state)) {
        lexer->advance(lexer, diffr_lex_skip);
        state = diffr_lex_next;
    }
    return diffr_lex_result;
}
/* Unused, and so not compiled, outside a grammar's parser.c. */
static bool ts_lex(TSLexer *lexer, TSStateId state) { return diffr_lex(diffr_lex_step, lexer, state); }
static bool ts_lex_keywords(TSLexer *lexer, TSStateId state) {
    return diffr_lex(diffr_lex_keywords_step, lexer, state);
}
/* parser.c defines these by their names with arguments, and refers to them without. */
#define ts_lex(lexer, state) diffr_lex_step(lexer, state)
#define ts_lex_keywords(lexer, state) diffr_lex_keywords_step(lexer, state)
#undef START_LEXER
#define START_LEXER()                          \
    bool result = diffr_lex_result;            \
    __attribute__((unused)) bool skip = false; \
    __attribute__((unused)) bool eof = lexer->eof(lexer); \
    int32_t lookahead = lexer->lookahead;
#define DIFFR_LEX_NEXT(state_value, skipping) \
    {                                          \
        diffr_lex_result = result;             \
        diffr_lex_skip = skipping;             \
        diffr_lex_next = state_value;          \
        return true;                           \
    }
#undef ADVANCE
#define ADVANCE(state_value) DIFFR_LEX_NEXT(state_value, false)
#undef SKIP
#define SKIP(state_value) DIFFR_LEX_NEXT(state_value, true)
#undef ADVANCE_MAP
#define ADVANCE_MAP(...)                                               \
    {                                                                  \
        static const uint16_t map[] = {__VA_ARGS__};                   \
        for (uint32_t i = 0; i < sizeof(map) / sizeof(map[0]); i += 2) \
            if (map[i] == lookahead) ADVANCE(map[i + 1]);              \
    }
#undef END_STATE
#define END_STATE()                \
    {                              \
        diffr_lex_result = result; \
        return false;              \
    }
#endif
#endif
