/* What tree-sitter's lib.c uses of stdio, for wasm32-unknown-unknown: its
 * debug log and dot graphs, which diffr never turns on, so nothing is
 * written. Weak, since grammars may compile this file too. */
#include <stdio.h>

__attribute__((weak)) int fclose(FILE *stream) { (void)stream; return 0; }

__attribute__((weak)) FILE *fdopen(int fd, const char *mode) {
    (void)fd;
    (void)mode;
    return (FILE *)0;
}

__attribute__((weak)) int fputc(int c, FILE *stream) { (void)stream; return c; }

__attribute__((weak)) int fputs(const char *restrict s, FILE *restrict stream) {
    (void)s;
    (void)stream;
    return 0;
}

__attribute__((weak)) size_t fwrite(const void *restrict buffer, size_t size, size_t nmemb,
                                    FILE *restrict stream) {
    (void)buffer;
    (void)size;
    (void)stream;
    return nmemb;
}

__attribute__((weak)) int fprintf(FILE *restrict stream, const char *restrict format, ...) {
    (void)stream;
    (void)format;
    return 0;
}

__attribute__((weak)) int vsnprintf(char *restrict buffer, size_t buffsz,
                                    const char *restrict format, va_list vlist) {
    (void)format;
    (void)vlist;
    if (buffsz) buffer[0] = 0;
    return 0;
}

__attribute__((weak)) int snprintf(char *restrict buffer, size_t buffsz,
                                   const char *restrict format, ...) {
    (void)format;
    if (buffsz) buffer[0] = 0;
    return 0;
}
