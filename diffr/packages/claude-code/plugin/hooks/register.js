var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// ../viewer/src/theme/palette.ts
var ansi = {
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  gray: "#666666",
  grey: "#666666",
  "light-red": "#f14c4c",
  "light-green": "#23d18b",
  "light-yellow": "#f5f543",
  "light-blue": "#3b8eea",
  "light-magenta": "#d670d6",
  "light-cyan": "#29b8db",
  "light-white": "#ffffff",
  "light-gray": "#a0a0a0",
  "light-grey": "#a0a0a0",
  "light-black": "#333333"
};
function helixTheme(raw, name) {
  const palette = new Map;
  const rawPalette = raw.palette;
  if (rawPalette && typeof rawPalette === "object")
    for (const [key, value] of Object.entries(rawPalette)) {
      if (typeof value !== "string")
        throw new Error(`Theme ${name}: palette entry ${key} is not a colour`);
      palette.set(key, value);
    }
  const styles = new Map;
  for (const [scope, value] of Object.entries(raw)) {
    if (scope === "palette" || scope === "inherits")
      continue;
    if (typeof value === "string")
      styles.set(scope, { fg: value, modifiers: [] });
    else if (value && typeof value === "object") {
      const style = value;
      styles.set(scope, { fg: style.fg, bg: style.bg, modifiers: style.modifiers ?? [] });
    } else
      throw new Error(`Theme ${name}: scope ${scope} has an unsupported value`);
  }
  if (typeof raw.inherits === "string")
    throw new Error(`Theme ${name} inherits from ${raw.inherits}; inherited themes are not supported`);
  return { name, styles, palette };
}
function colorOf(theme, value) {
  const fromPalette = theme.palette.get(value);
  if (fromPalette !== undefined)
    return colorOf(theme, fromPalette);
  if (/^#[0-9a-fA-F]{6}$/.test(value))
    return value;
  const named = ansi[value];
  if (named)
    return named;
  throw new Error(`Theme ${theme.name}: unknown colour ${value}`);
}
function scopeStyle(theme, scope) {
  const parts = scope.split(".");
  while (parts.length) {
    const style = theme.styles.get(parts.join("."));
    if (style)
      return style;
    parts.pop();
  }
  return;
}
var scopeFg = (theme, scope) => {
  const style = scopeStyle(theme, scope);
  return style?.fg === undefined ? undefined : colorOf(theme, style.fg);
};
var scopeBg = (theme, scope) => {
  const style = scopeStyle(theme, scope);
  return style?.bg === undefined ? undefined : colorOf(theme, style.bg);
};
function luminance(hex) {
  const channel = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function mix(hex, other, amount) {
  const channel = (i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount) + parseInt(other.slice(i, i + 2), 16) * amount);
  return `#${[1, 3, 5].map((i) => channel(i).toString(16).padStart(2, "0")).join("")}`;
}
function paletteFromHelix(theme) {
  const bg = scopeBg(theme, "ui.background");
  const fg = scopeFg(theme, "ui.text");
  if (!bg || !fg)
    throw new Error(`Theme ${theme.name} lacks ui.background or ui.text`);
  const isLight = luminance(bg) > 0.5;
  const muted = scopeFg(theme, "ui.linenr") ?? scopeFg(theme, "comment") ?? mix(fg, bg, 0.4);
  const plus = scopeFg(theme, "diff.plus") ?? (isLight ? "#1a7f37" : "#7ee787");
  const minus = scopeFg(theme, "diff.minus") ?? (isLight ? "#cf222e" : "#ffa198");
  const delta = scopeFg(theme, "diff.delta") ?? (isLight ? "#9a6700" : "#e3b341");
  const selection = scopeBg(theme, "ui.selection") ?? mix(bg, fg, 0.15);
  const fileHeader = mix(bg, fg, isLight ? 0.12 : 0.16);
  const accent = scopeFg(theme, "function") ?? scopeFg(theme, "ui.text.focus") ?? fg;
  return {
    name: theme.name,
    isLight,
    bg,
    fg,
    muted,
    chrome: scopeBg(theme, "ui.statusline") ?? mix(bg, fg, 0.06),
    fileHeader,
    fileHeaderDir: mix(fg, fileHeader, 0.3),
    highlight: selection,
    addition: mix(bg, plus, 0.12),
    deletion: mix(bg, minus, 0.12),
    modification: mix(bg, delta, 0.12),
    readAddition: mix(bg, plus, 0.06),
    readDeletion: mix(bg, minus, 0.06),
    searchMatch: mix(bg, delta, 0.3),
    searchCurrent: delta,
    addWord: mix(bg, plus, 0.28),
    deleteWord: mix(bg, minus, 0.28),
    addedText: plus,
    removedText: minus,
    accent,
    foldPlaceholder: mix(muted, fg, 0.45),
    guide: scopeFg(theme, "ui.virtual.indent-guide") ?? mix(bg, fg, 0.22),
    focusWash: mix(bg, accent, 0.08),
    focusBrace: mix(bg, accent, 0.3),
    syntax: (capture) => scopeFg(theme, capture)
  };
}
var bundledThemes = {
  "default-dark": "onedark",
  "default-light": "onelight",
  onedark: "onedark",
  onelight: "onelight",
  gruvbox: "gruvbox",
  solarized_light: "solarized_light"
};
function themeConfig(show) {
  const theme = show.theme;
  if (!theme || typeof theme.name !== "string" || theme.path !== null && theme.path !== undefined && typeof theme.path !== "string")
    throw new Error("diffr config show did not include a theme section");
  return { name: theme.name, path: theme.path ?? null };
}

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/error.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1;i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += `
`;
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += `^
`;
    }
  }
  return codeblock;
}

class TomlError extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
}

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/util.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function isEscaped(str, ptr) {
  let i = 0;
  while (str[ptr - ++i] === "\\")
    ;
  return --i && i % 2;
}
function indexOfNewline(str, start = 0, end = str.length) {
  let idx = str.indexOf(`
`, start);
  if (str[idx - 1] === "\r")
    idx--;
  return idx <= end ? idx : -1;
}
function skipComment(str, ptr) {
  for (let i = ptr;i < str.length; i++) {
    let c = str[i];
    if (c === `
`)
      return i;
    if (c === "\r" && str[i + 1] === `
`)
      return i + 1;
    if (c < " " && c !== "\t" || c === "") {
      throw new TomlError("control characters are not allowed in comments", {
        toml: str,
        ptr
      });
    }
  }
  return str.length;
}
function skipVoid(str, ptr, banNewLines, banComments) {
  let c;
  while ((c = str[ptr]) === " " || c === "\t" || !banNewLines && (c === `
` || c === "\r" && str[ptr + 1] === `
`))
    ptr++;
  return banComments || c !== "#" ? ptr : skipVoid(str, skipComment(str, ptr), banNewLines);
}
function skipUntil(str, ptr, sep, end, banNewLines = false) {
  if (!end) {
    ptr = indexOfNewline(str, ptr);
    return ptr < 0 ? str.length : ptr;
  }
  for (let i = ptr;i < str.length; i++) {
    let c = str[i];
    if (c === "#") {
      i = indexOfNewline(str, i);
    } else if (c === sep) {
      return i + 1;
    } else if (c === end || banNewLines && (c === `
` || c === "\r" && str[i + 1] === `
`)) {
      return i;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: str,
    ptr
  });
}
function getStringEnd(str, seek) {
  let first = str[seek];
  let target = first === str[seek + 1] && str[seek + 1] === str[seek + 2] ? str.slice(seek, seek + 3) : first;
  seek += target.length - 1;
  do
    seek = str.indexOf(target, ++seek);
  while (seek > -1 && first !== "'" && isEscaped(str, seek));
  if (seek > -1) {
    seek += target.length;
    if (target.length > 1) {
      if (str[seek] === first)
        seek++;
      if (str[seek] === first)
        seek++;
    }
  }
  return seek;
}

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/date.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}:\d{2}(?:\.\d+)?)?(Z|[-+]\d{2}:\d{2})?$/i;

class TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    if (typeof date === "string") {
      let match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        hasTime && date[10] === " " && (date = date.replace(" ", "T"));
        if (match[2] && +match[2] > 23) {
          date = "";
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset && hasTime)
            date += "Z";
        }
      } else {
        date = "";
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 60000);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
}

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/primitive.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
var ESCAPE_REGEX = /^[0-9a-f]{4,8}$/i;
var ESC_MAP = {
  b: "\b",
  t: "\t",
  n: `
`,
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\"
};
function parseString(str, ptr = 0, endPtr = str.length) {
  let isLiteral = str[ptr] === "'";
  let isMultiline = str[ptr++] === str[ptr] && str[ptr] === str[ptr + 1];
  if (isMultiline) {
    endPtr -= 2;
    if (str[ptr += 2] === "\r")
      ptr++;
    if (str[ptr] === `
`)
      ptr++;
  }
  let tmp = 0;
  let isEscape;
  let parsed = "";
  let sliceStart = ptr;
  while (ptr < endPtr - 1) {
    let c = str[ptr++];
    if (c === `
` || c === "\r" && str[ptr] === `
`) {
      if (!isMultiline) {
        throw new TomlError("newlines are not allowed in strings", {
          toml: str,
          ptr: ptr - 1
        });
      }
    } else if (c < " " && c !== "\t" || c === "") {
      throw new TomlError("control characters are not allowed in strings", {
        toml: str,
        ptr: ptr - 1
      });
    }
    if (isEscape) {
      isEscape = false;
      if (c === "u" || c === "U") {
        let code = str.slice(ptr, ptr += c === "u" ? 4 : 8);
        if (!ESCAPE_REGEX.test(code)) {
          throw new TomlError("invalid unicode escape", {
            toml: str,
            ptr: tmp
          });
        }
        try {
          parsed += String.fromCodePoint(parseInt(code, 16));
        } catch {
          throw new TomlError("invalid unicode escape", {
            toml: str,
            ptr: tmp
          });
        }
      } else if (isMultiline && (c === `
` || c === " " || c === "\t" || c === "\r")) {
        ptr = skipVoid(str, ptr - 1, true);
        if (str[ptr] !== `
` && str[ptr] !== "\r") {
          throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
            toml: str,
            ptr: tmp
          });
        }
        ptr = skipVoid(str, ptr);
      } else if (c in ESC_MAP) {
        parsed += ESC_MAP[c];
      } else {
        throw new TomlError("unrecognized escape sequence", {
          toml: str,
          ptr: tmp
        });
      }
      sliceStart = ptr;
    } else if (!isLiteral && c === "\\") {
      tmp = ptr - 1;
      isEscape = true;
      parsed += str.slice(sliceStart, tmp);
    }
  }
  return parsed + str.slice(sliceStart, endPtr - 1);
}
function parseValue(value, toml, ptr, integersAsBigInt) {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", {
        toml,
        ptr
      });
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", {
        toml,
        ptr
      });
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", {
          toml,
          ptr
        });
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid()) {
    throw new TomlError("invalid value", {
      toml,
      ptr
    });
  }
  return date;
}

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/extract.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function sliceAndTrimEndOf(str, startPtr, endPtr, allowNewLines) {
  let value = str.slice(startPtr, endPtr);
  let commentIdx = value.indexOf("#");
  if (commentIdx > -1) {
    skipComment(str, commentIdx);
    value = value.slice(0, commentIdx);
  }
  let trimmed = value.trimEnd();
  if (!allowNewLines) {
    let newlineIdx = value.indexOf(`
`, trimmed.length);
    if (newlineIdx > -1) {
      throw new TomlError("newlines are not allowed in inline tables", {
        toml: str,
        ptr: startPtr + newlineIdx
      });
    }
  }
  return [trimmed, commentIdx];
}
function extractValue(str, ptr, end, depth, integersAsBigInt) {
  if (depth === 0) {
    throw new TomlError("document contains excessively nested structures. aborting.", {
      toml: str,
      ptr
    });
  }
  let c = str[ptr];
  if (c === "[" || c === "{") {
    let [value, endPtr2] = c === "[" ? parseArray(str, ptr, depth, integersAsBigInt) : parseInlineTable(str, ptr, depth, integersAsBigInt);
    let newPtr = end ? skipUntil(str, endPtr2, ",", end) : endPtr2;
    if (endPtr2 - newPtr && end === "}") {
      let nextNewLine = indexOfNewline(str, endPtr2, newPtr);
      if (nextNewLine > -1) {
        throw new TomlError("newlines are not allowed in inline tables", {
          toml: str,
          ptr: nextNewLine
        });
      }
    }
    return [value, newPtr];
  }
  let endPtr;
  if (c === '"' || c === "'") {
    endPtr = getStringEnd(str, ptr);
    let parsed = parseString(str, ptr, endPtr);
    if (end) {
      endPtr = skipVoid(str, endPtr, end !== "]");
      if (str[endPtr] && str[endPtr] !== "," && str[endPtr] !== end && str[endPtr] !== `
` && str[endPtr] !== "\r") {
        throw new TomlError("unexpected character encountered", {
          toml: str,
          ptr: endPtr
        });
      }
      endPtr += +(str[endPtr] === ",");
    }
    return [parsed, endPtr];
  }
  endPtr = skipUntil(str, ptr, ",", end);
  let slice = sliceAndTrimEndOf(str, ptr, endPtr - +(str[endPtr - 1] === ","), end === "]");
  if (!slice[0]) {
    throw new TomlError("incomplete key-value declaration: no value specified", {
      toml: str,
      ptr
    });
  }
  if (end && slice[1] > -1) {
    endPtr = skipVoid(str, ptr + slice[1]);
    endPtr += +(str[endPtr] === ",");
  }
  return [
    parseValue(slice[0], str, ptr, integersAsBigInt),
    endPtr
  ];
}

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/struct.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(str, ptr, end = "=") {
  let dot = ptr - 1;
  let parsed = [];
  let endPtr = str.indexOf(end, ptr);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: str,
      ptr
    });
  }
  do {
    let c = str[ptr = ++dot];
    if (c !== " " && c !== "\t") {
      if (c === '"' || c === "'") {
        if (c === str[ptr + 1] && c === str[ptr + 2]) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: str,
            ptr
          });
        }
        let eos = getStringEnd(str, ptr);
        if (eos < 0) {
          throw new TomlError("unfinished string encountered", {
            toml: str,
            ptr
          });
        }
        dot = str.indexOf(".", eos);
        let strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: str,
            ptr: ptr + dot + newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: str,
            ptr: eos
          });
        }
        if (endPtr < eos) {
          endPtr = str.indexOf(end, eos);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: str,
              ptr
            });
          }
        }
        parsed.push(parseString(str, ptr, eos));
      } else {
        dot = str.indexOf(".", ptr);
        let part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: str,
            ptr
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  return [parsed, skipVoid(str, endPtr + 1, true, true)];
}
function parseInlineTable(str, ptr, depth, integersAsBigInt) {
  let res = {};
  let seen = new Set;
  let c;
  let comma = 0;
  ptr++;
  while ((c = str[ptr++]) !== "}" && c) {
    let err = { toml: str, ptr: ptr - 1 };
    if (c === `
`) {
      throw new TomlError("newlines are not allowed in inline tables", err);
    } else if (c === "#") {
      throw new TomlError("inline tables cannot contain comments", err);
    } else if (c === ",") {
      throw new TomlError("expected key-value, found comma", err);
    } else if (c !== " " && c !== "\t") {
      let k;
      let t = res;
      let hasOwn = false;
      let [key, keyEndPtr] = parseKey(str, ptr - 1);
      for (let i = 0;i < key.length; i++) {
        if (i)
          t = hasOwn ? t[k] : t[k] = {};
        k = key[i];
        if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
          throw new TomlError("trying to redefine an already defined value", {
            toml: str,
            ptr
          });
        }
        if (!hasOwn && k === "__proto__") {
          Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        }
      }
      if (hasOwn) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: str,
          ptr
        });
      }
      let [value, valueEndPtr] = extractValue(str, keyEndPtr, "}", depth - 1, integersAsBigInt);
      seen.add(value);
      t[k] = value;
      ptr = valueEndPtr;
      comma = str[ptr - 1] === "," ? ptr - 1 : 0;
    }
  }
  if (comma) {
    throw new TomlError("trailing commas are not allowed in inline tables", {
      toml: str,
      ptr: comma
    });
  }
  if (!c) {
    throw new TomlError("unfinished table encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}
function parseArray(str, ptr, depth, integersAsBigInt) {
  let res = [];
  let c;
  ptr++;
  while ((c = str[ptr++]) !== "]" && c) {
    if (c === ",") {
      throw new TomlError("expected value, found comma", {
        toml: str,
        ptr: ptr - 1
      });
    } else if (c === "#")
      ptr = skipComment(str, ptr);
    else if (c !== " " && c !== "\t" && c !== `
` && c !== "\r") {
      let e = extractValue(str, ptr - 1, "]", depth - 1, integersAsBigInt);
      res.push(e[0]);
      ptr = e[1];
    }
  }
  if (!c) {
    throw new TomlError("unfinished array encountered", {
      toml: str,
      ptr
    });
  }
  return [res, ptr];
}

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/parse.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0;i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1000, integersAsBigInt } = {}) {
  let res = {};
  let meta = {};
  let tbl = res;
  let m = meta;
  for (let ptr = skipVoid(toml, 0);ptr < toml.length; ) {
    if (toml[ptr] === "[") {
      let isTableArray = toml[++ptr] === "[";
      let k = parseKey(toml, ptr += +isTableArray, "]");
      if (isTableArray) {
        if (toml[k[1] - 1] !== "]") {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: k[1] - 1
          });
        }
        k[1]++;
      }
      let p = peekTable(k[0], res, meta, isTableArray ? 2 : 1);
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      m = p[2];
      tbl = p[1];
      ptr = k[1];
    } else {
      let k = parseKey(toml, ptr);
      let p = peekTable(k[0], tbl, m, 0);
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr
        });
      }
      let v = extractValue(toml, k[1], undefined, maxDepth, integersAsBigInt);
      p[1][p[0]] = v[0];
      ptr = v[1];
    }
    ptr = skipVoid(toml, ptr, true);
    if (toml[ptr] && toml[ptr] !== `
` && toml[ptr] !== "\r") {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr
      });
    }
    ptr = skipVoid(toml, ptr);
  }
  return res;
}

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/stringify.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// ../node_modules/.bun/smol-toml@1.4.2/node_modules/smol-toml/dist/index.js
/*!
 * Copyright (c) Squirrel Chat et al., All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holder nor the names of its contributors
 *    may be used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// ../viewer/themes/onedark.toml
var onedark_default = `# Author : Gokul Soumya <gokulps15@gmail.com>

"tag" = { fg = "red" }
"attribute" = { fg = "yellow" }
"comment" = { fg = "comment-gray", modifiers = ["italic"] }
"constant" = { fg = "cyan" }
"constant.numeric" = { fg = "gold" }
"constant.builtin" = { fg = "gold" }
"constant.character.escape" = { fg = "gold" }
"constructor" = { fg = "blue" }
"function" = { fg = "blue" }
"function.builtin" = { fg = "blue" }
"function.macro" = { fg = "purple" }
"keyword" = { fg = "red" }
"keyword.control" = { fg = "purple" }
"keyword.control.import" = { fg = "red" }
"keyword.directive" = { fg = "purple" }
"keyword.storage" = { fg = "purple" }
"label" = { fg = "purple" }
"namespace" = { fg = "blue" }
"operator" = { fg = "purple" }
"keyword.operator" = { fg = "purple" }
"special" = { fg = "blue" }
"string" = { fg = "green" }
"type" = { fg = "yellow" }
"variable" = { fg = "white" }
"variable.builtin" = { fg = "blue" }
"variable.parameter" = { fg = "red" }
"variable.other.member" = { fg = "red" }
"punctuation" = { fg = "white" }
"punctuation.special" = { fg = "purple" }

"markup.heading" = { fg = "red" }
"markup.raw.inline" = { fg = "green" }
"markup.bold" = { fg = "gold", modifiers = ["bold"] }
"markup.italic" = { fg = "purple", modifiers = ["italic"] }
"markup.strikethrough" = { modifiers = ["crossed_out"] }
"markup.list" = { fg = "red" }
"markup.quote" = { fg = "yellow" }
"markup.link.url" = { fg = "cyan", modifiers = ["underlined"]}
"markup.link.text" = { fg = "purple" }

"diff.plus" = "green"
"diff.delta" = "gold"
"diff.minus" = "red"

"diagnostic.info".underline = { color = "blue", style = "curl" } 
"diagnostic.hint".underline = { color = "green", style = "curl" } 
"diagnostic.warning".underline = { color = "yellow", style = "curl" } 
"diagnostic.error".underline = { color = "red", style = "curl" } 
"diagnostic.unnecessary" = { modifiers = ["dim"] }
"diagnostic.deprecated" = { modifiers = ["crossed_out"] }
"info" = { fg = "blue", modifiers = ["bold"] }
"hint" = { fg = "green", modifiers = ["bold"] }
"warning" = { fg = "yellow", modifiers = ["bold"] }
"error" = { fg = "red", modifiers = ["bold"] }

"ui.background" = { bg = "black" }
"ui.virtual" = { fg = "faint-gray" }
"ui.virtual.indent-guide" = { fg = "faint-gray" }
"ui.virtual.whitespace" = { fg = "light-gray" }
"ui.virtual.ruler" = { bg = "gray" }
"ui.virtual.inlay-hint" = { fg = "light-gray" }
"ui.virtual.jump-label" = { fg = "light-gray", modifiers = ["bold"] }

"ui.cursor" = { fg = "white", modifiers = ["reversed"] }
"ui.cursor.primary" = { fg = "white", modifiers = ["reversed"] }
"ui.cursor.match" = { fg = "blue", modifiers = ["underlined"]}

"ui.selection" = { bg = "faint-gray" }
"ui.selection.primary" = { bg = "light-gray" }
"ui.cursorline.primary" = { bg = "light-black" }

"ui.highlight" = { bg = "gray" }
"ui.highlight.frameline" = { bg = "#97202a" }

"ui.linenr" = { fg = "linenr" }
"ui.linenr.selected" = { fg = "white" }

"ui.statusline" = { fg = "white", bg = "light-black" }
"ui.statusline.inactive" = { fg = "light-gray", bg = "light-black" }
"ui.statusline.normal" = { fg = "light-black", bg = "blue", modifiers = ["bold"] }
"ui.statusline.insert" = { fg = "light-black", bg = "green", modifiers = ["bold"] }
"ui.statusline.select" = { fg = "light-black", bg = "purple", modifiers = ["bold"] }

"ui.bufferline" = { fg = "light-gray", bg = "light-black" }
"ui.bufferline.active" = { fg = "light-black", bg = "blue", underline = { color = "light-black", style = "line" } }
"ui.bufferline.background" = { bg = "light-black" }

"ui.text" = { fg = "white" }
"ui.text.directory" = { fg = "blue" }
"ui.text.focus" = { fg = "white", bg = "light-black", modifiers = ["bold"] }

"ui.help" = { fg = "white", bg = "gray" }
"ui.popup" = { bg = "gray" }
"ui.window" = { fg = "gray" }
"ui.menu" = { fg = "white", bg = "gray" }
"ui.menu.selected" = { fg = "black", bg = "blue" }
"ui.menu.scroll" = { fg = "white", bg = "light-gray" }

"ui.debug" = { fg = "red" }

[palette]

yellow = "#E5C07B"
blue = "#61AFEF"
red = "#E06C75"
purple = "#C678DD"
green = "#98C379"
gold = "#D19A66"
cyan = "#56B6C2"
white = "#ABB2BF"
black = "#282C34"
light-black = "#2C323C"
gray = "#3E4452"
faint-gray = "#3B4048"
light-gray = "#5C6370"
comment-gray = "#C8CED8"
linenr = "#687184"
`;

// ../viewer/themes/onelight.toml
var onelight_default = `# Author : erasin<erasinoo@gmail.com>

"attribute" = { fg = "yellow" }
"label" = { fg = "cyan" }
"operator" = { fg = "red" }
"tag" = { fg = "cyan" }
"special" = { fg = "deep-purple" }
"property" = { fg = "purple" }
"constructor" = { fg = "blue" }
"namespace" = { fg = "blue" }
"module" = { fg = "blue" }

"type" = { fg = "gold" }
"type.builtin" = { fg = "yellow" }
"type.enum" = { fg = "cyan" }
"type.enum.variant" = { fg = "cyan" }

"constant" = { fg = "cyan", modifiers = ["bold"] }
"constant.builtin" = { fg = "deep-purple" }
"constant.builtin.boolean" = { fg = "purple" , modifiers = ["bold"]}
"constant.character" = { fg = "green" }
"constant.character.escape" = { fg = "brown" , modifiers = ["bold"]}
"constant.numeric" = { fg = "brown" , modifiers = ["bold"]}
"constant.numeric.integer" = { fg = "brown" , modifiers = ["bold"]}
"constant.numeric.float" = { fg = "brown" , modifiers = ["bold"]}

"string" = { fg = "green" }
"string.regexp" = { fg = "purple" }
"string.special" = { fg = "green" }
"string.special.path" = { fg = "blue" }
"string.special.url" = { fg = "light-blue" }
"string.special.symbol" = { fg = "pink" }

"comment" = { fg = "grey", modifiers = ["italic"] }
"comment.line" = { fg = "grey", modifiers = ["italic"] }
"comment.line.documentation" = { fg = "grey", modifiers = ["italic"] }
"comment.block" = { fg = "grey", modifiers = ["italic"] }
"comment.block.documentation" = { fg = "grey", modifiers = ["italic"] }

# "variable" = { fg = "black" }
"variable.builtin" = { fg = "light-blue" }
"variable.parameter" = { fg = "red" }
"variable.other" = { fg = "pink" }
"variable.other.member" = { fg = "pink" }

"punctuation" = { fg = "black" }
"punctuation.delimiter" = { fg = "purple" }
"punctuation.bracket" = { fg = "brown" }
"punctuation.special" = { fg = "brown" }

"keyword" = { fg = "purple" }
"keyword.control" = { fg = "purple" }
"keyword.control.conditional" = { fg = "red", modifiers = ["bold"] }
"keyword.control.repeat" = { fg = "pink", modifiers = ["bold"] }
"keyword.control.import" = { fg = "red" }
"keyword.control.return" = { fg = "deep-purple", modifiers = ["bold"] }
"keyword.control.exception" = { fg = "purple" }
"keyword.operator" = { fg = "red" }
"keyword.directive" = { fg = "deep-purple" }
"keyword.function" = { fg = "purple" }
"keyword.storage" = { fg = "purple" }
"keyword.storage.type" = { fg = "purple" }
"keyword.storage.modifier" = { fg = "purple", modifiers = ["bold"] }

"function" = { fg = "blue" }
"function.builtin" = { fg = "cyan" }
"function.method" = { fg = "light-blue" }
"function.macro" = { fg = "pink", modifiers = ["bold"] }
"function.special" = { fg = "cyan" }

"markup.heading" = { fg = "red" }
"markup.heading.marker" = { fg = "red" }
"markup.heading.1" = { fg = "red", modifiers = ["bold"] }
"markup.heading.2" = { fg = "gold", modifiers = [
  "bold",
], underline = { style = "line" } }
"markup.heading.3" = { fg = "yellow", modifiers = ["bold"] }
"markup.heading.4" = { fg = "green", modifiers = ["bold"] }
"markup.heading.5" = { fg = "blue", modifiers = ["bold"] }
"markup.heading.6" = { fg = "purple", modifiers = ["bold"] }
"markup.list" = { fg = "light-blue" }
"markup.list.unnumbered" = { fg = "light-blue" }
"markup.list.numbered" = { fg = "light-blue" }
"markup.list.checked" = { fg = "green" }
"markup.list.unchecked" = { fg = "blue" }
"markup.bold" = { fg = "yellow", modifiers = ["bold"] }
"markup.italic" = { fg = "purple", modifiers = ["italic"] }
"markup.strikethrough" = { fg = "red", modifiers = ["crossed_out"] }
"markup.link" = { fg = "light-blue" }
"markup.link.url" = { fg = "cyan", modifiers = ["underlined"] }
"markup.link.text" = { fg = "light-blue" }
"markup.quote" = { fg = "grey" }
"markup.raw" = { fg = "brown" }
"markup.raw.inline" = { fg = "green" }
"markup.raw.block" = { fg = "brown" }

"diff" = { fg = "red" }
"diff.plus" = { fg = "green" }
"diff.minus" = { fg = "red" }
"diff.delta" = { fg = "cyan" }
"diff.delta.moved" = { fg = "cyan" }
"diff.delta.conflict" = {fg = "blue"}

"ui.background" = { bg = "white" }
"ui.background.separator" = { bg = "white" }

"ui.cursor" = { fg = "white", bg = "grey" }
"ui.cursor.normal" = { fg = "white", bg = "grey" }
"ui.cursor.insert" = { fg = "white", bg = "grey" }
"ui.cursor.select" = { fg = "white", bg = "grey" }
"ui.cursor.match" = { bg = "grey-300", modifiers = ["bold"] }
"ui.cursor.primary" = { fg = "white", bg = "black" }
"ui.cursor.primary.normal" = { fg = "white", bg = "black" }
"ui.cursor.primary.insert" = { fg = "red", bg = "black" }
"ui.cursor.primary.select" = { fg = "white", bg = "black" }

"ui.gutter" = { fg = "grey-500" }
"ui.gutter.selected" = { fg = "black" }

"ui.linenr" = { fg = "grey-500" }
"ui.linenr.selected" = { fg = "black", modifiers = ["bold"] }

"ui.statusline" = { fg = "black", bg = "grey-300" }
"ui.statusline.inactive" = { fg = "grey", bg = "grey-200" }
"ui.statusline.normal" = { fg = "grey-300", bg = "light-blue" }
"ui.statusline.insert" = { fg = "grey-300", bg = "green" }
"ui.statusline.select" = { fg = "grey-300", bg = "purple" }

"ui.popup" = { fg = "black", bg = "grey-200" }
"ui.popup.info" = { fg = "black", bg = "grey-200" }
"ui.window" = { fg = "grey-500", bg = "grey-100" }
"ui.help" = { fg = "black", bg = "grey-200" }

"ui.text" = { fg = "black" }
"ui.text.focus" = { fg = "red", bg = "grey-300", modifiers = ["bold"] }
"ui.text.inactive" = { fg = "grey" }
"ui.text.info" = { fg = "black" }
"ui.text.directory" = { fg = "blue", underline = { style = "line" } }

"ui.virtual" = { fg = "grey-500" }
"ui.virtual.ruler" = { bg = "grey-200" }
"ui.virtual.wrap" = { fg = "grey-500" }
"ui.virtual.whitespace" = { fg = "grey-400" }
"ui.virtual.indent-guide" = { fg = "grey-500" }
"ui.virtual.inlay-hint" = { fg = "grey-500" }
"ui.virtual.inlay-hint.parameter" = { fg = "grey-500", modifiers = ["italic"] }
"ui.virtual.inlay-hint.type" = { fg = "grey-500" }
"ui.virtual.jump-label" = { fg = "black", bg = "grey-200", modifiers = ["bold" ] }

"ui.menu" = { fg = "black", bg = "grey-300" }
"ui.menu.selected" = { fg = "white", bg = "light-blue" }
"ui.menu.scroll" = { fg = "light-blue", bg = "white" }

"ui.selection" = { bg = "grey-300", modifiers = ["dim"] }
"ui.selection.primary" = { bg = "grey-300" }

"ui.cursorline.primary" = { fg = "white", bg = "grey-100" }
"ui.cursorline.secondary" = { fg = "white", bg = "grey-200" }

"ui.cursorcolumn.primary" = { fg = "white", bg = "grey-100" }
"ui.cursorcolumn.secondary" = { fg = "white", bg = "grey-200" }

"ui.highlight" = { bg = "grey-300" }

"ui.picker.header" = { fg = "purple"}
"ui.picker.header.column.active" = { fg = "blue"}

"diagnostic.info" = { underline = { color = "blue", style = "dotted" } }
"diagnostic.hint" = { underline = { color = "green", style = "dashed" } }
"diagnostic.warning" = { underline = { color = "yellow", style = "curl" } }
"diagnostic.error" = { underline = { color = "red", style = "curl" } }
"diagnostic.unnecessary" = { modifiers = ["dim"] }
"diagnostic.deprecated" = { modifiers = ["crossed_out"] }

"info" = { fg = "blue", modifiers = ["bold"] }
"hint" = { fg = "green", modifiers = ["bold"] }
"warning" = { fg = "yellow", modifiers = ["bold"] }
"error" = { fg = "red", modifiers = ["bold"] }

"tabstop" = { modifiers = ["italic"], bg = "grey-300" }

[palette]
white = "#FAFAFA"
yellow = "#FF6F00"
gold = "#D35400"
brown = "#795548"
blue = "#0061FF"
light-blue = "#0091EA"
red = "#D50000"
pink = "#C2185B"
purple = "#B500A9"
deep-purple = "#651FFF"
green = "#24A443"
cyan = "#0086C1"
black = "#282C34"
grey = "#5C6370"
grey-500 = "#9E9E9E"
grey-400 = "#BDBDBD"
grey-300 = "#E0E0E0"
grey-200 = "#EEEEEE"
grey-100 = "#F2F2F2"
`;

// ../viewer/themes/gruvbox.toml
var gruvbox_default = `# Author : Jakub Bartodziej <kubabartodziej@gmail.com>
# The theme uses the gruvbox dark palette with standard contrast: github.com/morhetz/gruvbox

"annotation" = { fg = "fg1" }

"attribute" = { fg = "aqua1", modifiers = ["italic"] }

"comment" = { fg = "gray", modifiers = ["italic"] }

"constant" = { fg = "purple1" }
"constant.character" = { fg = "aqua1" }
"constant.character.escape" = { fg = "orange1" }
"constant.macro" = { fg = "aqua1" }
"constructor" = { fg = "purple1" }

"definition" = { underline = { color = "aqua1" } }

"diagnostic" = { underline = { color = "orange1", style = "curl" } }
"diagnostic.deprecated" = { modifiers = ["crossed_out"] }
"diagnostic.error" = { underline = { color = "red1", style = "curl" } }
"diagnostic.hint" = { underline = { color = "blue1", style = "curl" } }
"diagnostic.info" = { underline = { color = "aqua1", style = "curl" } }
"diagnostic.warning" = { underline = { color = "yellow1", style = "curl" } }
# "diagnostic.unnecessary" = { modifiers = ["dim"] }  # do not remove this for future resolving

"error" = { fg = "red1" }
"hint" = { fg = "blue1" }
"info" = { fg = "aqua1" }
"warning" = { fg = "yellow1" }

"diff.delta" = { fg = "yellow1" }
"diff.minus" = { fg = "red1" }
"diff.plus" = { fg = "green1" }

"function" = { fg = "green1" }
"function.builtin" = { fg = "yellow1" }
"function.macro" = { fg = "blue1" }

"keyword" = { fg = "red1" }
"keyword.control.import" = { fg = "aqua1" }

"label" = { fg = "red1" }

"markup.bold" = { modifiers = ["bold"] }
"markup.heading" = "aqua1"
"markup.italic" = { modifiers = ["italic"] }
"markup.link.text" = "red1"
"markup.link.url" = { fg = "green1", modifiers = ["underlined"] }
"markup.raw" = "red1"
"markup.strikethrough" = { modifiers = ["crossed_out"] }

"module" = { fg = "aqua1" }

"namespace" = { fg = "fg1" }

"operator" = { fg = "purple1" }

"punctuation" = { fg = "orange1" }

"special" = { fg = "purple0" }

"string" = { fg = "green1" }
"string.regexp" = { fg = "orange1" }
"string.special" = { fg = "orange1" }
"string.symbol" = { fg = "yellow1" }

"tag" = { fg = "aqua1" }

"type" = { fg = "yellow1" }
"type.enum.variant" = { modifiers = ["italic"] }

"ui.background" = { bg = "bg0" }
"ui.bufferline" = { fg = "fg1", bg = "bg1" }
"ui.bufferline.active" = { fg = "bg0", bg = "yellow0" }
"ui.bufferline.background" = { bg = "bg2" }

"ui.cursor" = { fg = "bg1", bg = "bg2" }
"ui.cursor.insert" = { fg = "bg1", bg = "blue0" }
"ui.cursor.normal" = { fg = "bg1", bg = "gray" }
"ui.cursor.select" = { fg = "bg1", bg = "orange0" }
"ui.cursor.match" = { fg = "fg3", bg = "bg3" }

"ui.cursor.primary" = { bg = "fg3", fg = "bg1" }
"ui.cursor.primary.insert" = { fg = "bg1", bg = "blue1" }
"ui.cursor.primary.normal" = { fg = "bg1", bg = "fg3" }
"ui.cursor.primary.select" = { fg = "bg1", bg = "orange1" }

"ui.cursorline" = { bg = "bg0_s" }
"ui.cursorline.primary" = { bg = "bg1" }

"ui.help" = { bg = "bg1", fg = "fg1" }
"ui.linenr" = { fg = "bg3" }
"ui.linenr.selected" = { fg = "yellow1" }
"ui.menu" = { fg = "fg1", bg = "bg2" }
"ui.menu.selected" = { fg = "green1", bg = "bg1", modifiers = ["bold"] }
"ui.popup" = { bg = "bg1" }
"ui.picker.header.column" = { underline.style = "line" }
"ui.picker.header.column.active" = { modifiers = ["bold"], underline.style = "line" }
"ui.selection" = { bg = "bg2" }
"ui.selection.primary" = { bg = "bg3" }

"ui.statusline" = { fg = "fg1", bg = "bg2" }
"ui.statusline.inactive" = { fg = "fg4", bg = "bg2" }
"ui.statusline.insert" = { fg = "bg1", bg = "blue1", modifiers = ["bold"] }
"ui.statusline.normal" = { fg = "bg1", bg = "fg3", modifiers = ["bold"] }
"ui.statusline.select" = { fg = "bg1", bg = "orange1", modifiers = ["bold"] }

"ui.text" = { fg = "fg1" }
"ui.text.focus" = { fg = "green1", bg="bg1" }
"ui.text.directory" = { fg = "blue1" }
"ui.virtual.inlay-hint" = { fg = "gray" }
"ui.virtual.jump-label" = { fg = "purple0", modifiers = ["bold"] }
"ui.virtual.ruler" = { bg = "bg1" }
"ui.virtual.whitespace" = "bg2"
"ui.virtual.wrap" = { fg = "bg2" }
"ui.window" = { bg = "bg1" }

"variable" = { fg = "fg1" }
"variable.builtin" = { fg = "orange1", modifiers = ["italic"] }
"variable.other.member" = { fg = "blue1" }
"variable.parameter" = { fg = "blue1", modifiers = ["italic"] }


[palette]
bg0 = "#282828"   # main background
bg0_s = "#32302f"
bg1 = "#3c3836"
bg2 = "#504945"
bg3 = "#665c54"
bg4 = "#7c6f64"

fg0 = "#fbf1c7"
fg1 = "#ebdbb2" # main foreground
fg2 = "#d5c4a1"
fg3 = "#bdae93"
fg4 = "#a89984"

gray = "#928374"

red0 = "#cc241d"    # neutral
red1 = "#fb4934"    # bright
green0 = "#98971a"
green1 = "#b8bb26"
yellow0 = "#d79921"
yellow1 = "#fabd2f"
blue0 = "#458588"
blue1 = "#83a598"
purple0 = "#b16286"
purple1 = "#d3869b"
aqua0 = "#689d6a"
aqua1 = "#8ec07c"
orange0 = "#d65d0e"
orange1 = "#fe8019"
`;

// ../viewer/themes/solarized_light.toml
var solarized_light_default = `"attribute" = { fg = "violet" }
"keyword" = { fg = "green" }
"keyword.directive" = { fg = "orange" }
"namespace" = { fg = "violet" }
"operator" = { fg = "green" }
"special" = { fg = "orange" }
"variable.builtin" = { fg = "cyan", modifiers = ["bold"] }
"variable.function" = { fg = "blue" }
"type" = { fg = "yellow" }
"type.builtin" = { fg = "yellow", modifiers = ["bold"] }
"constructor" = { fg = "blue" }
"function" = { fg = "blue" }
"function.macro" = { fg = "magenta" }
"function.builtin" = { fg = "blue", modifiers = ["bold"] }
"function.special" = { fg = "magenta" }
"comment" = { fg = "base01" }
"string" = { fg = "cyan" }
"constant" = { fg = "cyan" }
"constant.builtin" = { fg = "cyan", modifiers = ["bold"] }
"constant.character.escape" = { fg = "red", modifiers = ["bold"] }
"label" = { fg = "green" }
"module" = { fg = "violet" }
"tag" = { fg = "magenta" }

# TODO
"markup.heading" = "blue"
"markup.list" = "red"
"markup.bold" = { fg = "yellow", modifiers = ["bold"] }
"markup.italic" = { fg = "magenta", modifiers = ["italic"] }
"markup.strikethrough" = { modifiers = ["crossed_out"] }
"markup.link.url" = { fg = "yellow", modifiers = ["underlined"] }
"markup.link.text" = "red"
"markup.quote" = "cyan"
"markup.raw" = "green"

"diff.plus" = { fg = "green" }
"diff.delta" = { fg = "yellow" }
"diff.minus" = { fg = "red" }

# 背景
# background
"ui.background" = { bg = "base03" }

"ui.virtual.whitespace" = { fg = "base01" }
"ui.virtual.inlay-hint" = { fg = "base01", modifiers = ["italic"] }
"ui.virtual.jump-label" = { fg = "red", modifiers = ["bold"] }

# 行号栏
# line number column
"ui.linenr" = { fg = "base0", bg = "base02" }
# 当前行号栏
# current line number column
"ui.linenr.selected" = { fg = "blue", modifiers = ["bold"] }
# cursorline
"ui.cursorline" = { bg = "base0" }

# 状态栏
# status bar
"ui.statusline" = { fg = "base03", bg = "base0" }
"ui.statusline.normal" = { bg = "blue" }
"ui.statusline.insert" = { bg = "green" }
"ui.statusline.select" = { bg = "yellow" }

# 非活动状态栏
# inactive status bar
"ui.statusline.inactive" = { fg = "base1", bg = "base01" }

# 补全窗口, preview窗口
# Completion window, preview window
"ui.popup" = { bg = "base02" }
# 影响 补全选中 cmd弹出信息选中
# Affect completion selection, cmd pop-up information selection
"ui.menu.selected" = { fg = "base02", bg = "base2"}
"ui.menu" = { fg = "base0", bg = "base02" }
# ??
"ui.window" = { fg = "base3" }
# 命令行 补全的帮助信息
# Command line completion help information
"ui.help" = { modifiers = ["reversed"] }

# 快捷键窗口 
# Shortcut window
"ui.popup.info" = { bg = "base1" }
# 快捷键字体
# Shortcut font
"ui.text.info" = {fg = "base02", modifiers = ["bold"]}

# 普通ui的字体样式
# Normal ui font style
"ui.text" = { fg = "base1" }
# 影响 picker列表选中, 快捷键帮助窗口文本
# Affects picker list selection, shortcut key help window text
"ui.text.focus" = { fg = "blue", modifiers = ["bold"]}

# 主光标/selection
# main cursor/selection
"ui.cursor.primary" = { fg = "base03", bg = "base1" }
"ui.cursor.select" = { fg = "base02", bg = "cyan" }

"ui.cursorline.primary" = { bg = "base02" }
"ui.cursorline.secondary" = { bg = "base025" }

"ui.selection" = { bg = "base0175" }
"ui.selection.primary" = { bg = "base015" }

"ui.virtual.indent-guide" = { fg = "base02" }
"ui.virtual.ruler" = { bg = "base02" }

# normal模式的光标
# normal mode cursor
"ui.cursor" = {fg = "base02", bg = "cyan"}
"ui.cursor.insert" = {fg = "base03", bg = "base3"}
# 当前光标匹配的标点符号
# The punctuation character matched by the current cursor
"ui.cursor.match" = { fg = "base02", bg = "base015" }

"warning" =  { fg = "orange", modifiers= ["bold", "underlined"] }
"error" = { fg = "red", modifiers= ["bold", "underlined"] }
"info" = { fg = "blue", modifiers= ["bold", "underlined"] }
"hint" = { fg = "base01", modifiers= ["bold", "underlined"] }

"diagnostic.warning" = { underline = { style = "curl", color = "orange" } }
"diagnostic.error" = { underline = { style = "curl", color = "red" } }
"diagnostic.info" = { underline = { style = "curl", color = "blue" } }
"diagnostic.hint" = { underline = { style = "curl", color = "base01" } }
"diagnostic.unnecessary" = { modifiers = ["dim"] }
"diagnostic.deprecated" = { modifiers = ["crossed_out"] }


[palette]
red      = '#dc322f'
green    = '#859900'
yellow   = '#b58900'
blue     = '#268bd2'
magenta  = '#d33682'
cyan     = '#2aa198'
orange   = '#cb4b16'
violet   = '#6c71c4'

# 深色 越来越深
# dark getting darker
base0    = '#657b83'
base1    = '#586e75'
base2    = '#073642'
base3    = '#002b36'

# 浅色 越來越浅
# Lighter and lighter
base00   = '#839496'
base01   = '#93a1a1'
base015  = '#c5c8bd'
base0175 = '#dddbcc'
base02   = '#eee8d5'
base025  = '#f5eedb'
base03   = '#fdf6e3'
`;

// ../viewer/src/theme/themes.ts
function parseHelixTheme(text, name) {
  return helixTheme(parse(text), name);
}
var themeSources = { onedark: onedark_default, onelight: onelight_default, gruvbox: gruvbox_default, solarized_light: solarized_light_default };
function loadBundledTheme(name) {
  const file = bundledThemes[name];
  if (!file)
    throw new Error(`Unknown theme ${name}; bundled themes: ${Object.keys(bundledThemes).join(", ")}`);
  return paletteFromHelix(parseHelixTheme(themeSources[file], name));
}
var dark = loadBundledTheme("default-dark");
var light = loadBundledTheme("default-light");

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/classic/external.js
var exports_external = {};
__export(exports_external, {
  xid: () => xid2,
  void: () => _void2,
  uuidv7: () => uuidv7,
  uuidv6: () => uuidv6,
  uuidv4: () => uuidv4,
  uuid: () => uuid2,
  util: () => exports_util,
  url: () => url,
  uppercase: () => _uppercase,
  unknown: () => unknown,
  union: () => union,
  undefined: () => _undefined3,
  ulid: () => ulid2,
  uint64: () => uint64,
  uint32: () => uint32,
  tuple: () => tuple,
  trim: () => _trim,
  treeifyError: () => treeifyError,
  transform: () => transform,
  toUpperCase: () => _toUpperCase,
  toLowerCase: () => _toLowerCase,
  toJSONSchema: () => toJSONSchema,
  templateLiteral: () => templateLiteral,
  symbol: () => symbol,
  superRefine: () => superRefine,
  success: () => success,
  stringbool: () => stringbool,
  stringFormat: () => stringFormat,
  string: () => string2,
  strictObject: () => strictObject,
  startsWith: () => _startsWith,
  size: () => _size,
  setErrorMap: () => setErrorMap,
  set: () => set,
  safeParseAsync: () => safeParseAsync2,
  safeParse: () => safeParse2,
  safeEncodeAsync: () => safeEncodeAsync2,
  safeEncode: () => safeEncode2,
  safeDecodeAsync: () => safeDecodeAsync2,
  safeDecode: () => safeDecode2,
  registry: () => registry,
  regexes: () => exports_regexes,
  regex: () => _regex,
  refine: () => refine,
  record: () => record,
  readonly: () => readonly,
  property: () => _property,
  promise: () => promise,
  prettifyError: () => prettifyError,
  preprocess: () => preprocess,
  prefault: () => prefault,
  positive: () => _positive,
  pipe: () => pipe,
  partialRecord: () => partialRecord,
  parseAsync: () => parseAsync2,
  parse: () => parse4,
  overwrite: () => _overwrite,
  optional: () => optional,
  object: () => object,
  number: () => number2,
  nullish: () => nullish2,
  nullable: () => nullable,
  null: () => _null3,
  normalize: () => _normalize,
  nonpositive: () => _nonpositive,
  nonoptional: () => nonoptional,
  nonnegative: () => _nonnegative,
  never: () => never,
  negative: () => _negative,
  nativeEnum: () => nativeEnum,
  nanoid: () => nanoid2,
  nan: () => nan,
  multipleOf: () => _multipleOf,
  minSize: () => _minSize,
  minLength: () => _minLength,
  mime: () => _mime,
  maxSize: () => _maxSize,
  maxLength: () => _maxLength,
  map: () => map,
  lte: () => _lte,
  lt: () => _lt,
  lowercase: () => _lowercase,
  looseObject: () => looseObject,
  locales: () => exports_locales,
  literal: () => literal,
  length: () => _length,
  lazy: () => lazy,
  ksuid: () => ksuid2,
  keyof: () => keyof,
  jwt: () => jwt,
  json: () => json,
  iso: () => exports_iso,
  ipv6: () => ipv62,
  ipv4: () => ipv42,
  intersection: () => intersection,
  int64: () => int64,
  int32: () => int32,
  int: () => int,
  instanceof: () => _instanceof,
  includes: () => _includes,
  httpUrl: () => httpUrl,
  hostname: () => hostname2,
  hex: () => hex2,
  hash: () => hash,
  guid: () => guid2,
  gte: () => _gte,
  gt: () => _gt,
  globalRegistry: () => globalRegistry,
  getErrorMap: () => getErrorMap,
  function: () => _function,
  formatError: () => formatError,
  float64: () => float64,
  float32: () => float32,
  flattenError: () => flattenError,
  file: () => file,
  enum: () => _enum2,
  endsWith: () => _endsWith,
  encodeAsync: () => encodeAsync2,
  encode: () => encode2,
  emoji: () => emoji2,
  email: () => email2,
  e164: () => e1642,
  discriminatedUnion: () => discriminatedUnion,
  decodeAsync: () => decodeAsync2,
  decode: () => decode2,
  date: () => date3,
  custom: () => custom,
  cuid2: () => cuid22,
  cuid: () => cuid3,
  core: () => exports_core2,
  config: () => config,
  coerce: () => exports_coerce,
  codec: () => codec,
  clone: () => clone,
  cidrv6: () => cidrv62,
  cidrv4: () => cidrv42,
  check: () => check,
  catch: () => _catch2,
  boolean: () => boolean2,
  bigint: () => bigint2,
  base64url: () => base64url2,
  base64: () => base642,
  array: () => array,
  any: () => any,
  _function: () => _function,
  _default: () => _default2,
  _ZodString: () => _ZodString,
  ZodXID: () => ZodXID,
  ZodVoid: () => ZodVoid,
  ZodUnknown: () => ZodUnknown,
  ZodUnion: () => ZodUnion,
  ZodUndefined: () => ZodUndefined,
  ZodUUID: () => ZodUUID,
  ZodURL: () => ZodURL,
  ZodULID: () => ZodULID,
  ZodType: () => ZodType,
  ZodTuple: () => ZodTuple,
  ZodTransform: () => ZodTransform,
  ZodTemplateLiteral: () => ZodTemplateLiteral,
  ZodSymbol: () => ZodSymbol,
  ZodSuccess: () => ZodSuccess,
  ZodStringFormat: () => ZodStringFormat,
  ZodString: () => ZodString,
  ZodSet: () => ZodSet,
  ZodRecord: () => ZodRecord,
  ZodRealError: () => ZodRealError,
  ZodReadonly: () => ZodReadonly,
  ZodPromise: () => ZodPromise,
  ZodPrefault: () => ZodPrefault,
  ZodPipe: () => ZodPipe,
  ZodOptional: () => ZodOptional,
  ZodObject: () => ZodObject,
  ZodNumberFormat: () => ZodNumberFormat,
  ZodNumber: () => ZodNumber,
  ZodNullable: () => ZodNullable,
  ZodNull: () => ZodNull,
  ZodNonOptional: () => ZodNonOptional,
  ZodNever: () => ZodNever,
  ZodNanoID: () => ZodNanoID,
  ZodNaN: () => ZodNaN,
  ZodMap: () => ZodMap,
  ZodLiteral: () => ZodLiteral,
  ZodLazy: () => ZodLazy,
  ZodKSUID: () => ZodKSUID,
  ZodJWT: () => ZodJWT,
  ZodIssueCode: () => ZodIssueCode,
  ZodIntersection: () => ZodIntersection,
  ZodISOTime: () => ZodISOTime,
  ZodISODuration: () => ZodISODuration,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODate: () => ZodISODate,
  ZodIPv6: () => ZodIPv6,
  ZodIPv4: () => ZodIPv4,
  ZodGUID: () => ZodGUID,
  ZodFunction: () => ZodFunction,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFile: () => ZodFile,
  ZodError: () => ZodError,
  ZodEnum: () => ZodEnum,
  ZodEmoji: () => ZodEmoji,
  ZodEmail: () => ZodEmail,
  ZodE164: () => ZodE164,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodDefault: () => ZodDefault,
  ZodDate: () => ZodDate,
  ZodCustomStringFormat: () => ZodCustomStringFormat,
  ZodCustom: () => ZodCustom,
  ZodCodec: () => ZodCodec,
  ZodCatch: () => ZodCatch,
  ZodCUID2: () => ZodCUID2,
  ZodCUID: () => ZodCUID,
  ZodCIDRv6: () => ZodCIDRv6,
  ZodCIDRv4: () => ZodCIDRv4,
  ZodBoolean: () => ZodBoolean,
  ZodBigIntFormat: () => ZodBigIntFormat,
  ZodBigInt: () => ZodBigInt,
  ZodBase64URL: () => ZodBase64URL,
  ZodBase64: () => ZodBase64,
  ZodArray: () => ZodArray,
  ZodAny: () => ZodAny,
  TimePrecision: () => TimePrecision,
  NEVER: () => NEVER,
  $output: () => $output,
  $input: () => $input,
  $brand: () => $brand
});

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/index.js
var exports_core2 = {};
__export(exports_core2, {
  version: () => version,
  util: () => exports_util,
  treeifyError: () => treeifyError,
  toJSONSchema: () => toJSONSchema,
  toDotPath: () => toDotPath,
  safeParseAsync: () => safeParseAsync,
  safeParse: () => safeParse,
  safeEncodeAsync: () => safeEncodeAsync,
  safeEncode: () => safeEncode,
  safeDecodeAsync: () => safeDecodeAsync,
  safeDecode: () => safeDecode,
  registry: () => registry,
  regexes: () => exports_regexes,
  prettifyError: () => prettifyError,
  parseAsync: () => parseAsync,
  parse: () => parse2,
  locales: () => exports_locales,
  isValidJWT: () => isValidJWT,
  isValidBase64URL: () => isValidBase64URL,
  isValidBase64: () => isValidBase64,
  globalRegistry: () => globalRegistry,
  globalConfig: () => globalConfig,
  formatError: () => formatError,
  flattenError: () => flattenError,
  encodeAsync: () => encodeAsync,
  encode: () => encode,
  decodeAsync: () => decodeAsync,
  decode: () => decode,
  config: () => config,
  clone: () => clone,
  _xid: () => _xid,
  _void: () => _void,
  _uuidv7: () => _uuidv7,
  _uuidv6: () => _uuidv6,
  _uuidv4: () => _uuidv4,
  _uuid: () => _uuid,
  _url: () => _url,
  _uppercase: () => _uppercase,
  _unknown: () => _unknown,
  _union: () => _union,
  _undefined: () => _undefined2,
  _ulid: () => _ulid,
  _uint64: () => _uint64,
  _uint32: () => _uint32,
  _tuple: () => _tuple,
  _trim: () => _trim,
  _transform: () => _transform,
  _toUpperCase: () => _toUpperCase,
  _toLowerCase: () => _toLowerCase,
  _templateLiteral: () => _templateLiteral,
  _symbol: () => _symbol,
  _superRefine: () => _superRefine,
  _success: () => _success,
  _stringbool: () => _stringbool,
  _stringFormat: () => _stringFormat,
  _string: () => _string,
  _startsWith: () => _startsWith,
  _size: () => _size,
  _set: () => _set,
  _safeParseAsync: () => _safeParseAsync,
  _safeParse: () => _safeParse,
  _safeEncodeAsync: () => _safeEncodeAsync,
  _safeEncode: () => _safeEncode,
  _safeDecodeAsync: () => _safeDecodeAsync,
  _safeDecode: () => _safeDecode,
  _regex: () => _regex,
  _refine: () => _refine,
  _record: () => _record,
  _readonly: () => _readonly,
  _property: () => _property,
  _promise: () => _promise,
  _positive: () => _positive,
  _pipe: () => _pipe,
  _parseAsync: () => _parseAsync,
  _parse: () => _parse,
  _overwrite: () => _overwrite,
  _optional: () => _optional,
  _number: () => _number,
  _nullable: () => _nullable,
  _null: () => _null2,
  _normalize: () => _normalize,
  _nonpositive: () => _nonpositive,
  _nonoptional: () => _nonoptional,
  _nonnegative: () => _nonnegative,
  _never: () => _never,
  _negative: () => _negative,
  _nativeEnum: () => _nativeEnum,
  _nanoid: () => _nanoid,
  _nan: () => _nan,
  _multipleOf: () => _multipleOf,
  _minSize: () => _minSize,
  _minLength: () => _minLength,
  _min: () => _gte,
  _mime: () => _mime,
  _maxSize: () => _maxSize,
  _maxLength: () => _maxLength,
  _max: () => _lte,
  _map: () => _map,
  _lte: () => _lte,
  _lt: () => _lt,
  _lowercase: () => _lowercase,
  _literal: () => _literal,
  _length: () => _length,
  _lazy: () => _lazy,
  _ksuid: () => _ksuid,
  _jwt: () => _jwt,
  _isoTime: () => _isoTime,
  _isoDuration: () => _isoDuration,
  _isoDateTime: () => _isoDateTime,
  _isoDate: () => _isoDate,
  _ipv6: () => _ipv6,
  _ipv4: () => _ipv4,
  _intersection: () => _intersection,
  _int64: () => _int64,
  _int32: () => _int32,
  _int: () => _int,
  _includes: () => _includes,
  _guid: () => _guid,
  _gte: () => _gte,
  _gt: () => _gt,
  _float64: () => _float64,
  _float32: () => _float32,
  _file: () => _file,
  _enum: () => _enum,
  _endsWith: () => _endsWith,
  _encodeAsync: () => _encodeAsync,
  _encode: () => _encode,
  _emoji: () => _emoji2,
  _email: () => _email,
  _e164: () => _e164,
  _discriminatedUnion: () => _discriminatedUnion,
  _default: () => _default,
  _decodeAsync: () => _decodeAsync,
  _decode: () => _decode,
  _date: () => _date,
  _custom: () => _custom,
  _cuid2: () => _cuid2,
  _cuid: () => _cuid,
  _coercedString: () => _coercedString,
  _coercedNumber: () => _coercedNumber,
  _coercedDate: () => _coercedDate,
  _coercedBoolean: () => _coercedBoolean,
  _coercedBigint: () => _coercedBigint,
  _cidrv6: () => _cidrv6,
  _cidrv4: () => _cidrv4,
  _check: () => _check,
  _catch: () => _catch,
  _boolean: () => _boolean,
  _bigint: () => _bigint,
  _base64url: () => _base64url,
  _base64: () => _base64,
  _array: () => _array,
  _any: () => _any,
  TimePrecision: () => TimePrecision,
  NEVER: () => NEVER,
  JSONSchemaGenerator: () => JSONSchemaGenerator,
  JSONSchema: () => exports_json_schema,
  Doc: () => Doc,
  $output: () => $output,
  $input: () => $input,
  $constructor: () => $constructor,
  $brand: () => $brand,
  $ZodXID: () => $ZodXID,
  $ZodVoid: () => $ZodVoid,
  $ZodUnknown: () => $ZodUnknown,
  $ZodUnion: () => $ZodUnion,
  $ZodUndefined: () => $ZodUndefined,
  $ZodUUID: () => $ZodUUID,
  $ZodURL: () => $ZodURL,
  $ZodULID: () => $ZodULID,
  $ZodType: () => $ZodType,
  $ZodTuple: () => $ZodTuple,
  $ZodTransform: () => $ZodTransform,
  $ZodTemplateLiteral: () => $ZodTemplateLiteral,
  $ZodSymbol: () => $ZodSymbol,
  $ZodSuccess: () => $ZodSuccess,
  $ZodStringFormat: () => $ZodStringFormat,
  $ZodString: () => $ZodString,
  $ZodSet: () => $ZodSet,
  $ZodRegistry: () => $ZodRegistry,
  $ZodRecord: () => $ZodRecord,
  $ZodRealError: () => $ZodRealError,
  $ZodReadonly: () => $ZodReadonly,
  $ZodPromise: () => $ZodPromise,
  $ZodPrefault: () => $ZodPrefault,
  $ZodPipe: () => $ZodPipe,
  $ZodOptional: () => $ZodOptional,
  $ZodObjectJIT: () => $ZodObjectJIT,
  $ZodObject: () => $ZodObject,
  $ZodNumberFormat: () => $ZodNumberFormat,
  $ZodNumber: () => $ZodNumber,
  $ZodNullable: () => $ZodNullable,
  $ZodNull: () => $ZodNull,
  $ZodNonOptional: () => $ZodNonOptional,
  $ZodNever: () => $ZodNever,
  $ZodNanoID: () => $ZodNanoID,
  $ZodNaN: () => $ZodNaN,
  $ZodMap: () => $ZodMap,
  $ZodLiteral: () => $ZodLiteral,
  $ZodLazy: () => $ZodLazy,
  $ZodKSUID: () => $ZodKSUID,
  $ZodJWT: () => $ZodJWT,
  $ZodIntersection: () => $ZodIntersection,
  $ZodISOTime: () => $ZodISOTime,
  $ZodISODuration: () => $ZodISODuration,
  $ZodISODateTime: () => $ZodISODateTime,
  $ZodISODate: () => $ZodISODate,
  $ZodIPv6: () => $ZodIPv6,
  $ZodIPv4: () => $ZodIPv4,
  $ZodGUID: () => $ZodGUID,
  $ZodFunction: () => $ZodFunction,
  $ZodFile: () => $ZodFile,
  $ZodError: () => $ZodError,
  $ZodEnum: () => $ZodEnum,
  $ZodEncodeError: () => $ZodEncodeError,
  $ZodEmoji: () => $ZodEmoji,
  $ZodEmail: () => $ZodEmail,
  $ZodE164: () => $ZodE164,
  $ZodDiscriminatedUnion: () => $ZodDiscriminatedUnion,
  $ZodDefault: () => $ZodDefault,
  $ZodDate: () => $ZodDate,
  $ZodCustomStringFormat: () => $ZodCustomStringFormat,
  $ZodCustom: () => $ZodCustom,
  $ZodCodec: () => $ZodCodec,
  $ZodCheckUpperCase: () => $ZodCheckUpperCase,
  $ZodCheckStringFormat: () => $ZodCheckStringFormat,
  $ZodCheckStartsWith: () => $ZodCheckStartsWith,
  $ZodCheckSizeEquals: () => $ZodCheckSizeEquals,
  $ZodCheckRegex: () => $ZodCheckRegex,
  $ZodCheckProperty: () => $ZodCheckProperty,
  $ZodCheckOverwrite: () => $ZodCheckOverwrite,
  $ZodCheckNumberFormat: () => $ZodCheckNumberFormat,
  $ZodCheckMultipleOf: () => $ZodCheckMultipleOf,
  $ZodCheckMinSize: () => $ZodCheckMinSize,
  $ZodCheckMinLength: () => $ZodCheckMinLength,
  $ZodCheckMimeType: () => $ZodCheckMimeType,
  $ZodCheckMaxSize: () => $ZodCheckMaxSize,
  $ZodCheckMaxLength: () => $ZodCheckMaxLength,
  $ZodCheckLowerCase: () => $ZodCheckLowerCase,
  $ZodCheckLessThan: () => $ZodCheckLessThan,
  $ZodCheckLengthEquals: () => $ZodCheckLengthEquals,
  $ZodCheckIncludes: () => $ZodCheckIncludes,
  $ZodCheckGreaterThan: () => $ZodCheckGreaterThan,
  $ZodCheckEndsWith: () => $ZodCheckEndsWith,
  $ZodCheckBigIntFormat: () => $ZodCheckBigIntFormat,
  $ZodCheck: () => $ZodCheck,
  $ZodCatch: () => $ZodCatch,
  $ZodCUID2: () => $ZodCUID2,
  $ZodCUID: () => $ZodCUID,
  $ZodCIDRv6: () => $ZodCIDRv6,
  $ZodCIDRv4: () => $ZodCIDRv4,
  $ZodBoolean: () => $ZodBoolean,
  $ZodBigIntFormat: () => $ZodBigIntFormat,
  $ZodBigInt: () => $ZodBigInt,
  $ZodBase64URL: () => $ZodBase64URL,
  $ZodBase64: () => $ZodBase64,
  $ZodAsyncError: () => $ZodAsyncError,
  $ZodArray: () => $ZodArray,
  $ZodAny: () => $ZodAny
});

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/core.js
var NEVER = Object.freeze({
  status: "aborted"
});
function $constructor(name, initializer, params) {
  function init(inst, def) {
    var _a;
    Object.defineProperty(inst, "_zod", {
      value: inst._zod ?? {},
      enumerable: false
    });
    (_a = inst._zod).traits ?? (_a.traits = new Set);
    inst._zod.traits.add(name);
    initializer(inst, def);
    for (const k in _.prototype) {
      if (!(k in inst))
        Object.defineProperty(inst, k, { value: _.prototype[k].bind(inst) });
    }
    inst._zod.constr = _;
    inst._zod.def = def;
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
var globalConfig = {};
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/util.js
var exports_util = {};
__export(exports_util, {
  unwrapMessage: () => unwrapMessage,
  uint8ArrayToHex: () => uint8ArrayToHex,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  stringifyPrimitive: () => stringifyPrimitive,
  shallowClone: () => shallowClone,
  safeExtend: () => safeExtend,
  required: () => required,
  randomString: () => randomString,
  propertyKeyTypes: () => propertyKeyTypes,
  promiseAllObject: () => promiseAllObject,
  primitiveTypes: () => primitiveTypes,
  prefixIssues: () => prefixIssues,
  pick: () => pick,
  partial: () => partial,
  optionalKeys: () => optionalKeys,
  omit: () => omit,
  objectClone: () => objectClone,
  numKeys: () => numKeys,
  nullish: () => nullish,
  normalizeParams: () => normalizeParams,
  mergeDefs: () => mergeDefs,
  merge: () => merge,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  joinValues: () => joinValues,
  issue: () => issue,
  isPlainObject: () => isPlainObject,
  isObject: () => isObject,
  hexToUint8Array: () => hexToUint8Array,
  getSizableOrigin: () => getSizableOrigin,
  getParsedType: () => getParsedType,
  getLengthableOrigin: () => getLengthableOrigin,
  getEnumValues: () => getEnumValues,
  getElementAtPath: () => getElementAtPath,
  floatSafeRemainder: () => floatSafeRemainder,
  finalizeIssue: () => finalizeIssue,
  extend: () => extend,
  escapeRegex: () => escapeRegex,
  esc: () => esc,
  defineLazy: () => defineLazy,
  createTransparentProxy: () => createTransparentProxy,
  cloneDef: () => cloneDef,
  clone: () => clone,
  cleanRegex: () => cleanRegex,
  cleanEnum: () => cleanEnum,
  captureStackTrace: () => captureStackTrace,
  cached: () => cached,
  base64urlToUint8Array: () => base64urlToUint8Array,
  base64ToUint8Array: () => base64ToUint8Array,
  assignProp: () => assignProp,
  assertNotEqual: () => assertNotEqual,
  assertNever: () => assertNever,
  assertIs: () => assertIs,
  assertEqual: () => assertEqual,
  assert: () => assert,
  allowsEval: () => allowsEval,
  aborted: () => aborted,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  Class: () => Class,
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {}
function assertNever(_x) {
  throw new Error;
}
function assert(_) {}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepString = step.toString();
  let stepDecCount = (stepString.split(".")[1] || "").length;
  if (stepDecCount === 0 && /\d?e-\d?/.test(stepString)) {
    const match = stepString.match(/\d?e-(\d?)/);
    if (match?.[1]) {
      stepDecCount = Number.parseInt(match[1]);
    }
  }
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var EVALUATING = Symbol("evaluating");
function defineLazy(object, key, getter) {
  let value = undefined;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) {
        return;
      }
      if (value === undefined) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0;i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0;i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = cached(() => {
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = new Set(["string", "number", "symbol"]);
var primitiveTypes = new Set(["string", "number", "bigint", "boolean", "symbol", "undefined"]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error("Object schemas containing refinements cannot be extended. Use `.safeExtend()` instead.");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = {
    ...schema._zod.def,
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    checks: schema._zod.def.checks
  };
  return clone(schema, def);
}
function merge(a, b) {
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: []
  });
  return clone(a, def);
}
function partial(Class, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a;
    (_a = iss).path ?? (_a.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const full = { ...iss, path: iss.path ?? [] };
  if (!iss.message) {
    const message = unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
    full.message = message;
  }
  delete full.inst;
  delete full.continue;
  if (!ctx?.reportInput) {
    delete full.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0;i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0;i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  return base64ToUint8Array(base64 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex) {
  const cleanHex = hex.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0;i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

class Class {
  constructor(..._args) {}
}

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error2) => {
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues });
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues });
      } else if (issue2.path.length === 0) {
        fieldErrors._errors.push(mapper(issue2));
      } else {
        let curr = fieldErrors;
        let i = 0;
        while (i < issue2.path.length) {
          const el = issue2.path[i];
          const terminal = i === issue2.path.length - 1;
          if (!terminal) {
            curr[el] = curr[el] || { _errors: [] };
          } else {
            curr[el] = curr[el] || { _errors: [] };
            curr[el]._errors.push(mapper(issue2));
          }
          curr = curr[el];
          i++;
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}
function treeifyError(error, mapper = (issue2) => issue2.message) {
  const result = { errors: [] };
  const processError = (error2, path = []) => {
    var _a, _b;
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, issue2.path));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, issue2.path);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, issue2.path);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          result.errors.push(mapper(issue2));
          continue;
        }
        let curr = result;
        let i = 0;
        while (i < fullpath.length) {
          const el = fullpath[i];
          const terminal = i === fullpath.length - 1;
          if (typeof el === "string") {
            curr.properties ?? (curr.properties = {});
            (_a = curr.properties)[el] ?? (_a[el] = { errors: [] });
            curr = curr.properties[el];
          } else {
            curr.items ?? (curr.items = []);
            (_b = curr.items)[el] ?? (_b[el] = { errors: [] });
            curr = curr.items[el];
          }
          if (terminal) {
            curr.errors.push(mapper(issue2));
          }
          i++;
        }
      }
    }
  };
  processError(error);
  return result;
}
function toDotPath(_path) {
  const segs = [];
  const path = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
  for (const seg of path) {
    if (typeof seg === "number")
      segs.push(`[${seg}]`);
    else if (typeof seg === "symbol")
      segs.push(`[${JSON.stringify(String(seg))}]`);
    else if (/[^\w$]/.test(seg))
      segs.push(`[${JSON.stringify(seg)}]`);
    else {
      if (segs.length)
        segs.push(".");
      segs.push(seg);
    }
  }
  return segs.join("");
}
function prettifyError(error) {
  const lines = [];
  const issues = [...error.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
  for (const issue2 of issues) {
    lines.push(`✖ ${issue2.message}`);
    if (issue2.path?.length)
      lines.push(`  → at ${toDotPath(issue2.path)}`);
  }
  return lines.join(`
`);
}

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: false }) : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var parse2 = /* @__PURE__ */ _parse($ZodRealError);
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var parseAsync = /* @__PURE__ */ _parseAsync($ZodRealError);
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { async: true }) : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var encode = /* @__PURE__ */ _encode($ZodRealError);
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var decode = /* @__PURE__ */ _decode($ZodRealError);
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var encodeAsync = /* @__PURE__ */ _encodeAsync($ZodRealError);
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var decodeAsync = /* @__PURE__ */ _decodeAsync($ZodRealError);
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var safeEncode = /* @__PURE__ */ _safeEncode($ZodRealError);
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var safeDecode = /* @__PURE__ */ _safeDecode($ZodRealError);
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? Object.assign(_ctx, { direction: "backward" }) : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync($ZodRealError);
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync($ZodRealError);
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/regexes.js
var exports_regexes = {};
__export(exports_regexes, {
  xid: () => xid,
  uuid7: () => uuid7,
  uuid6: () => uuid6,
  uuid4: () => uuid4,
  uuid: () => uuid,
  uppercase: () => uppercase,
  unicodeEmail: () => unicodeEmail,
  undefined: () => _undefined,
  ulid: () => ulid,
  time: () => time,
  string: () => string,
  sha512_hex: () => sha512_hex,
  sha512_base64url: () => sha512_base64url,
  sha512_base64: () => sha512_base64,
  sha384_hex: () => sha384_hex,
  sha384_base64url: () => sha384_base64url,
  sha384_base64: () => sha384_base64,
  sha256_hex: () => sha256_hex,
  sha256_base64url: () => sha256_base64url,
  sha256_base64: () => sha256_base64,
  sha1_hex: () => sha1_hex,
  sha1_base64url: () => sha1_base64url,
  sha1_base64: () => sha1_base64,
  rfc5322Email: () => rfc5322Email,
  number: () => number,
  null: () => _null,
  nanoid: () => nanoid,
  md5_hex: () => md5_hex,
  md5_base64url: () => md5_base64url,
  md5_base64: () => md5_base64,
  lowercase: () => lowercase,
  ksuid: () => ksuid,
  ipv6: () => ipv6,
  ipv4: () => ipv4,
  integer: () => integer,
  idnEmail: () => idnEmail,
  html5Email: () => html5Email,
  hostname: () => hostname,
  hex: () => hex,
  guid: () => guid,
  extendedDuration: () => extendedDuration,
  emoji: () => emoji,
  email: () => email,
  e164: () => e164,
  duration: () => duration,
  domain: () => domain,
  datetime: () => datetime,
  date: () => date,
  cuid2: () => cuid2,
  cuid: () => cuid,
  cidrv6: () => cidrv6,
  cidrv4: () => cidrv4,
  browserEmail: () => browserEmail,
  boolean: () => boolean,
  bigint: () => bigint,
  base64url: () => base64url,
  base64: () => base64
});
var cuid = /^[cC][^\s-]{8,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var extendedDuration = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var uuid4 = /* @__PURE__ */ uuid(4);
var uuid6 = /* @__PURE__ */ uuid(6);
var uuid7 = /* @__PURE__ */ uuid(7);
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var html5Email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var rfc5322Email = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
var unicodeEmail = /^[^\s@"]{1,64}@[^\s@]{1,255}$/u;
var idnEmail = unicodeEmail;
var browserEmail = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var hostname = /^(?=.{1,253}\.?$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[-0-9a-zA-Z]{0,61}[0-9a-zA-Z])?)*\.?$/;
var domain = /^([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
var e164 = /^\+(?:[0-9]){6,14}[0-9]$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time2 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time2}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var bigint = /^-?\d+n?$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?/;
var boolean = /^(?:true|false)$/i;
var _null = /^null$/i;
var _undefined = /^undefined$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;
var hex = /^[0-9a-fA-F]*$/;
function fixedBase64(bodyLength, padding) {
  return new RegExp(`^[A-Za-z0-9+/]{${bodyLength}}${padding}$`);
}
function fixedBase64url(length) {
  return new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
}
var md5_hex = /^[0-9a-fA-F]{32}$/;
var md5_base64 = /* @__PURE__ */ fixedBase64(22, "==");
var md5_base64url = /* @__PURE__ */ fixedBase64url(22);
var sha1_hex = /^[0-9a-fA-F]{40}$/;
var sha1_base64 = /* @__PURE__ */ fixedBase64(27, "=");
var sha1_base64url = /* @__PURE__ */ fixedBase64url(27);
var sha256_hex = /^[0-9a-fA-F]{64}$/;
var sha256_base64 = /* @__PURE__ */ fixedBase64(43, "=");
var sha256_base64url = /* @__PURE__ */ fixedBase64url(43);
var sha384_hex = /^[0-9a-fA-F]{96}$/;
var sha384_base64 = /* @__PURE__ */ fixedBase64(64, "");
var sha384_base64url = /* @__PURE__ */ fixedBase64url(64);
var sha512_hex = /^[0-9a-fA-F]{128}$/;
var sha512_base64 = /* @__PURE__ */ fixedBase64(86, "==");
var sha512_base64url = /* @__PURE__ */ fixedBase64url(86);

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a = inst._zod).onattach ?? (_a.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a;
    (_a = inst2._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inst
      });
    }
  };
});
var $ZodCheckBigIntFormat = /* @__PURE__ */ $constructor("$ZodCheckBigIntFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  const [minimum, maximum] = BIGINT_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (input < minimum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "bigint",
        input,
        code: "too_big",
        maximum,
        inst
      });
    }
  };
});
var $ZodCheckMaxSize = /* @__PURE__ */ $constructor("$ZodCheckMaxSize", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size <= def.maximum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinSize = /* @__PURE__ */ $constructor("$ZodCheckMinSize", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size >= def.minimum)
      return;
    payload.issues.push({
      origin: getSizableOrigin(input),
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckSizeEquals = /* @__PURE__ */ $constructor("$ZodCheckSizeEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.size !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.size;
    bag.maximum = def.size;
    bag.size = def.size;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const size = input.size;
    if (size === def.size)
      return;
    const tooBig = size > def.size;
    payload.issues.push({
      origin: getSizableOrigin(input),
      ...tooBig ? { code: "too_big", maximum: def.size } : { code: "too_small", minimum: def.size },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a;
  $ZodCheck.init(inst, def);
  (_a = inst._zod.def).when ?? (_a.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a = inst._zod).check ?? (_a.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function handleCheckPropertyResult(result, payload, property) {
  if (result.issues.length) {
    payload.issues.push(...prefixIssues(property, result.issues));
  }
}
var $ZodCheckProperty = /* @__PURE__ */ $constructor("$ZodCheckProperty", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    const result = def.schema._zod.run({
      value: payload.value[def.property],
      issues: []
    }, {});
    if (result instanceof Promise) {
      return result.then((result2) => handleCheckPropertyResult(result2, payload, def.property));
    }
    handleCheckPropertyResult(result, payload, def.property);
    return;
  };
});
var $ZodCheckMimeType = /* @__PURE__ */ $constructor("$ZodCheckMimeType", (inst, def) => {
  $ZodCheck.init(inst, def);
  const mimeSet = new Set(def.mime);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.mime = def.mime;
  });
  inst._zod.check = (payload) => {
    if (mimeSet.has(payload.value.type))
      return;
    payload.issues.push({
      code: "invalid_value",
      values: def.mime,
      input: payload.value.type,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join(`
`));
  }
}

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 1,
  patch: 12
};

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a = inst._zod).deferred ?? (_a.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  inst["~standard"] = {
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  };
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = `ipv4`;
  });
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = `ipv6`;
  });
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error;
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error;
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error;
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error;
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.contentEncoding = "base64";
  });
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    inst2._zod.bag.contentEncoding = "base64url";
  });
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCustomStringFormat = /* @__PURE__ */ $constructor("$ZodCustomStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (def.fn(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: def.format,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodBigInt = /* @__PURE__ */ $constructor("$ZodBigInt", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = bigint;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = BigInt(payload.value);
      } catch (_) {}
    if (typeof payload.value === "bigint")
      return payload;
    payload.issues.push({
      expected: "bigint",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodBigIntFormat = /* @__PURE__ */ $constructor("$ZodBigInt", (inst, def) => {
  $ZodCheckBigIntFormat.init(inst, def);
  $ZodBigInt.init(inst, def);
});
var $ZodSymbol = /* @__PURE__ */ $constructor("$ZodSymbol", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "symbol")
      return payload;
    payload.issues.push({
      expected: "symbol",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUndefined = /* @__PURE__ */ $constructor("$ZodUndefined", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _undefined;
  inst._zod.values = new Set([undefined]);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "undefined",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodNull = /* @__PURE__ */ $constructor("$ZodNull", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = _null;
  inst._zod.values = new Set([null]);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input === null)
      return payload;
    payload.issues.push({
      expected: "null",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodAny = /* @__PURE__ */ $constructor("$ZodAny", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodVoid = /* @__PURE__ */ $constructor("$ZodVoid", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (typeof input === "undefined")
      return payload;
    payload.issues.push({
      expected: "void",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodDate = /* @__PURE__ */ $constructor("$ZodDate", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce) {
      try {
        payload.value = new Date(payload.value);
      } catch (_err) {}
    }
    const input = payload.value;
    const isDate = input instanceof Date;
    const isValidDate = isDate && !Number.isNaN(input.getTime());
    if (isValidDate)
      return payload;
    payload.issues.push({
      expected: "date",
      code: "invalid_type",
      input,
      ...isDate ? { received: "Invalid Date" } : {},
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (result.value === undefined) {
    if (key in input) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  for (const key of Object.keys(input)) {
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input)));
    } else {
      handlePropertyResult(r, payload, key, input);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = new Set);
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input)));
      } else {
        handlePropertyResult(r, payload, key, input);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      doc.write(`const ${id} = ${parseStr(key)};`);
      doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const single = def.options.length === 1;
  const first = def.options[0]._zod.run;
  inst._zod.parse = (payload, ctx) => {
    if (single) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazy(inst._zod, "propValues", () => {
    const propValues = {};
    for (const option of def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
      for (const [k, v] of Object.entries(pv)) {
        if (!propValues[k])
          propValues[k] = new Set;
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    return propValues;
  });
  const disc = cached(() => {
    const opts = def.options;
    const map = new Map;
    for (const o of opts) {
      const values = o._zod.propValues?.[def.discriminator];
      if (!values || values.size === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
      for (const v of values) {
        if (map.has(v)) {
          throw new Error(`Duplicate discriminator value "${String(v)}"`);
        }
        map.set(v, o);
      }
    }
    return map;
  });
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const opt = disc.value.get(input?.[def.discriminator]);
    if (opt) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback) {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  if (left.issues.length) {
    result.issues.push(...left.issues);
  }
  if (right.issues.length) {
    result.issues.push(...right.issues);
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodTuple = /* @__PURE__ */ $constructor("$ZodTuple", (inst, def) => {
  $ZodType.init(inst, def);
  const items = def.items;
  const optStart = items.length - [...items].reverse().findIndex((item) => item._zod.optin !== "optional");
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        input,
        inst,
        expected: "tuple",
        code: "invalid_type"
      });
      return payload;
    }
    payload.value = [];
    const proms = [];
    if (!def.rest) {
      const tooBig = input.length > items.length;
      const tooSmall = input.length < optStart - 1;
      if (tooBig || tooSmall) {
        payload.issues.push({
          ...tooBig ? { code: "too_big", maximum: items.length } : { code: "too_small", minimum: items.length },
          input,
          inst,
          origin: "array"
        });
        return payload;
      }
    }
    let i = -1;
    for (const item of items) {
      i++;
      if (i >= input.length) {
        if (i >= optStart)
          continue;
      }
      const result = item._zod.run({
        value: input[i],
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleTupleResult(result2, payload, i)));
      } else {
        handleTupleResult(result, payload, i);
      }
    }
    if (def.rest) {
      const rest = input.slice(items.length);
      for (const el of rest) {
        i++;
        const result = def.rest._zod.run({
          value: el,
          issues: []
        }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => handleTupleResult(result2, payload, i)));
        } else {
          handleTupleResult(result, payload, i);
        }
      }
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleTupleResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    if (def.keyType._zod.values) {
      const values = def.keyType._zod.values;
      payload.value = {};
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[key] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[key] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!values.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        if (keyResult.issues.length) {
          payload.issues.push({
            code: "invalid_key",
            origin: "record",
            issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
            input: key,
            path: [key],
            inst
          });
          payload.value[keyResult.value] = keyResult.value;
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[keyResult.value] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodMap = /* @__PURE__ */ $constructor("$ZodMap", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!(input instanceof Map)) {
      payload.issues.push({
        expected: "map",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    payload.value = new Map;
    for (const [key, value] of input) {
      const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
      const valueResult = def.valueType._zod.run({ value, issues: [] }, ctx);
      if (keyResult instanceof Promise || valueResult instanceof Promise) {
        proms.push(Promise.all([keyResult, valueResult]).then(([keyResult2, valueResult2]) => {
          handleMapResult(keyResult2, valueResult2, payload, key, input, inst, ctx);
        }));
      } else {
        handleMapResult(keyResult, valueResult, payload, key, input, inst, ctx);
      }
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleMapResult(keyResult, valueResult, final, key, input, inst, ctx) {
  if (keyResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, keyResult.issues));
    } else {
      final.issues.push({
        code: "invalid_key",
        origin: "map",
        input,
        inst,
        issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  if (valueResult.issues.length) {
    if (propertyKeyTypes.has(typeof key)) {
      final.issues.push(...prefixIssues(key, valueResult.issues));
    } else {
      final.issues.push({
        origin: "map",
        code: "invalid_element",
        input,
        inst,
        key,
        issues: valueResult.issues.map((iss) => finalizeIssue(iss, ctx, config()))
      });
    }
  }
  final.value.set(keyResult.value, valueResult.value);
}
var $ZodSet = /* @__PURE__ */ $constructor("$ZodSet", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!(input instanceof Set)) {
      payload.issues.push({
        input,
        inst,
        expected: "set",
        code: "invalid_type"
      });
      return payload;
    }
    const proms = [];
    payload.value = new Set;
    for (const item of input) {
      const result = def.valueType._zod.run({ value: item, issues: [] }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleSetResult(result2, payload)));
      } else
        handleSetResult(result, payload);
    }
    if (proms.length)
      return Promise.all(proms).then(() => payload);
    return payload;
  };
});
function handleSetResult(result, final) {
  if (result.issues.length) {
    final.issues.push(...result.issues);
  }
  final.value.add(result.value);
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  inst._zod.values = new Set(def.values);
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (inst._zod.values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodFile = /* @__PURE__ */ $constructor("$ZodFile", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (input instanceof File)
      return payload;
    payload.issues.push({
      expected: "file",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (result.issues.length && input === undefined) {
    return { issues: [], value: undefined };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, payload.value));
      return handleOptionalResult(result, payload.value);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodSuccess = /* @__PURE__ */ $constructor("$ZodSuccess", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError("ZodSuccess");
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.issues.length === 0;
        return payload;
      });
    }
    payload.value = result.issues.length === 0;
    return payload;
  };
});
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
    }
    return payload;
  };
});
var $ZodNaN = /* @__PURE__ */ $constructor("$ZodNaN", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "number" || !Number.isNaN(payload.value)) {
      payload.issues.push({
        input: payload.value,
        inst,
        expected: "nan",
        code: "invalid_type"
      });
      return payload;
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodCodec = /* @__PURE__ */ $constructor("$ZodCodec", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    const direction = ctx.direction || "forward";
    if (direction === "forward") {
      const left = def.in._zod.run(payload, ctx);
      if (left instanceof Promise) {
        return left.then((left2) => handleCodecAResult(left2, def, ctx));
      }
      return handleCodecAResult(left, def, ctx);
    } else {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handleCodecAResult(right2, def, ctx));
      }
      return handleCodecAResult(right, def, ctx);
    }
  };
});
function handleCodecAResult(result, def, ctx) {
  if (result.issues.length) {
    result.aborted = true;
    return result;
  }
  const direction = ctx.direction || "forward";
  if (direction === "forward") {
    const transformed = def.transform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.out, ctx));
    }
    return handleCodecTxResult(result, transformed, def.out, ctx);
  } else {
    const transformed = def.reverseTransform(result.value, result);
    if (transformed instanceof Promise) {
      return transformed.then((value) => handleCodecTxResult(result, value, def.in, ctx));
    }
    return handleCodecTxResult(result, transformed, def.in, ctx);
  }
}
function handleCodecTxResult(left, value, nextSchema, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return nextSchema._zod.run({ value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodTemplateLiteral = /* @__PURE__ */ $constructor("$ZodTemplateLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const regexParts = [];
  for (const part of def.parts) {
    if (typeof part === "object" && part !== null) {
      if (!part._zod.pattern) {
        throw new Error(`Invalid template literal part, no pattern found: ${[...part._zod.traits].shift()}`);
      }
      const source = part._zod.pattern instanceof RegExp ? part._zod.pattern.source : part._zod.pattern;
      if (!source)
        throw new Error(`Invalid template literal part: ${part._zod.traits}`);
      const start = source.startsWith("^") ? 1 : 0;
      const end = source.endsWith("$") ? source.length - 1 : source.length;
      regexParts.push(source.slice(start, end));
    } else if (part === null || primitiveTypes.has(typeof part)) {
      regexParts.push(escapeRegex(`${part}`));
    } else {
      throw new Error(`Invalid template literal part: ${part}`);
    }
  }
  inst._zod.pattern = new RegExp(`^${regexParts.join("")}$`);
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "string") {
      payload.issues.push({
        input: payload.value,
        inst,
        expected: "template_literal",
        code: "invalid_type"
      });
      return payload;
    }
    inst._zod.pattern.lastIndex = 0;
    if (!inst._zod.pattern.test(payload.value)) {
      payload.issues.push({
        input: payload.value,
        inst,
        code: "invalid_format",
        format: def.format ?? "template_literal",
        pattern: inst._zod.pattern.source
      });
      return payload;
    }
    return payload;
  };
});
var $ZodFunction = /* @__PURE__ */ $constructor("$ZodFunction", (inst, def) => {
  $ZodType.init(inst, def);
  inst._def = def;
  inst._zod.def = def;
  inst.implement = (func) => {
    if (typeof func !== "function") {
      throw new Error("implement() must be called with a function");
    }
    return function(...args) {
      const parsedArgs = inst._def.input ? parse2(inst._def.input, args) : args;
      const result = Reflect.apply(func, this, parsedArgs);
      if (inst._def.output) {
        return parse2(inst._def.output, result);
      }
      return result;
    };
  };
  inst.implementAsync = (func) => {
    if (typeof func !== "function") {
      throw new Error("implementAsync() must be called with a function");
    }
    return async function(...args) {
      const parsedArgs = inst._def.input ? await parseAsync(inst._def.input, args) : args;
      const result = await Reflect.apply(func, this, parsedArgs);
      if (inst._def.output) {
        return await parseAsync(inst._def.output, result);
      }
      return result;
    };
  };
  inst._zod.parse = (payload, _ctx) => {
    if (typeof payload.value !== "function") {
      payload.issues.push({
        code: "invalid_type",
        expected: "function",
        input: payload.value,
        inst
      });
      return payload;
    }
    const hasPromiseOutput = inst._def.output && inst._def.output._zod.def.type === "promise";
    if (hasPromiseOutput) {
      payload.value = inst.implementAsync(payload.value);
    } else {
      payload.value = inst.implement(payload.value);
    }
    return payload;
  };
  inst.input = (...args) => {
    const F = inst.constructor;
    if (Array.isArray(args[0])) {
      return new F({
        type: "function",
        input: new $ZodTuple({
          type: "tuple",
          items: args[0],
          rest: args[1]
        }),
        output: inst._def.output
      });
    }
    return new F({
      type: "function",
      input: args[0],
      output: inst._def.output
    });
  };
  inst.output = (output) => {
    const F = inst.constructor;
    return new F({
      type: "function",
      input: inst._def.input,
      output
    });
  };
  return inst;
});
var $ZodPromise = /* @__PURE__ */ $constructor("$ZodPromise", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    return Promise.resolve(payload.value).then((inner) => def.innerType._zod.run({ value: inner, issues: [] }, ctx));
  };
});
var $ZodLazy = /* @__PURE__ */ $constructor("$ZodLazy", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "innerType", () => def.getter());
  defineLazy(inst._zod, "pattern", () => inst._zod.innerType._zod.pattern);
  defineLazy(inst._zod, "propValues", () => inst._zod.innerType._zod.propValues);
  defineLazy(inst._zod, "optin", () => inst._zod.innerType._zod.optin ?? undefined);
  defineLazy(inst._zod, "optout", () => inst._zod.innerType._zod.optout ?? undefined);
  inst._zod.parse = (payload, ctx) => {
    const inner = inst._zod.innerType;
    return inner._zod.run(payload, ctx);
  };
});
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/index.js
var exports_locales = {};
__export(exports_locales, {
  zhTW: () => zh_TW_default,
  zhCN: () => zh_CN_default,
  yo: () => yo_default,
  vi: () => vi_default,
  ur: () => ur_default,
  uk: () => uk_default,
  ua: () => ua_default,
  tr: () => tr_default,
  th: () => th_default,
  ta: () => ta_default,
  sv: () => sv_default,
  sl: () => sl_default,
  ru: () => ru_default,
  pt: () => pt_default,
  ps: () => ps_default,
  pl: () => pl_default,
  ota: () => ota_default,
  no: () => no_default,
  nl: () => nl_default,
  ms: () => ms_default,
  mk: () => mk_default,
  lt: () => lt_default,
  ko: () => ko_default,
  km: () => km_default,
  kh: () => kh_default,
  ka: () => ka_default,
  ja: () => ja_default,
  it: () => it_default,
  is: () => is_default,
  id: () => id_default,
  hu: () => hu_default,
  he: () => he_default,
  frCA: () => fr_CA_default,
  fr: () => fr_default,
  fi: () => fi_default,
  fa: () => fa_default,
  es: () => es_default,
  eo: () => eo_default,
  en: () => en_default,
  de: () => de_default,
  da: () => da_default,
  cs: () => cs_default,
  ca: () => ca_default,
  bg: () => bg_default,
  be: () => be_default,
  az: () => az_default,
  ar: () => ar_default
});

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ar.js
var error = () => {
  const Sizable = {
    string: { unit: "حرف", verb: "أن يحوي" },
    file: { unit: "بايت", verb: "أن يحوي" },
    array: { unit: "عنصر", verb: "أن يحوي" },
    set: { unit: "عنصر", verb: "أن يحوي" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "مدخل",
    email: "بريد إلكتروني",
    url: "رابط",
    emoji: "إيموجي",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "تاريخ ووقت بمعيار ISO",
    date: "تاريخ بمعيار ISO",
    time: "وقت بمعيار ISO",
    duration: "مدة بمعيار ISO",
    ipv4: "عنوان IPv4",
    ipv6: "عنوان IPv6",
    cidrv4: "مدى عناوين بصيغة IPv4",
    cidrv6: "مدى عناوين بصيغة IPv6",
    base64: "نَص بترميز base64-encoded",
    base64url: "نَص بترميز base64url-encoded",
    json_string: "نَص على هيئة JSON",
    e164: "رقم هاتف بمعيار E.164",
    jwt: "JWT",
    template_literal: "مدخل"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `مدخلات غير مقبولة: يفترض إدخال ${issue2.expected}، ولكن تم إدخال ${parsedType(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `مدخلات غير مقبولة: يفترض إدخال ${stringifyPrimitive(issue2.values[0])}`;
        return `اختيار غير مقبول: يتوقع انتقاء أحد هذه الخيارات: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return ` أكبر من اللازم: يفترض أن تكون ${issue2.origin ?? "القيمة"} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "عنصر"}`;
        return `أكبر من اللازم: يفترض أن تكون ${issue2.origin ?? "القيمة"} ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `أصغر من اللازم: يفترض لـ ${issue2.origin} أن يكون ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `أصغر من اللازم: يفترض لـ ${issue2.origin} أن يكون ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `نَص غير مقبول: يجب أن يبدأ بـ "${issue2.prefix}"`;
        if (_issue.format === "ends_with")
          return `نَص غير مقبول: يجب أن ينتهي بـ "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `نَص غير مقبول: يجب أن يتضمَّن "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `نَص غير مقبول: يجب أن يطابق النمط ${_issue.pattern}`;
        return `${Nouns[_issue.format] ?? issue2.format} غير مقبول`;
      }
      case "not_multiple_of":
        return `رقم غير مقبول: يجب أن يكون من مضاعفات ${issue2.divisor}`;
      case "unrecognized_keys":
        return `معرف${issue2.keys.length > 1 ? "ات" : ""} غريب${issue2.keys.length > 1 ? "ة" : ""}: ${joinValues(issue2.keys, "، ")}`;
      case "invalid_key":
        return `معرف غير مقبول في ${issue2.origin}`;
      case "invalid_union":
        return "مدخل غير مقبول";
      case "invalid_element":
        return `مدخل غير مقبول في ${issue2.origin}`;
      default:
        return "مدخل غير مقبول";
    }
  };
};
function ar_default() {
  return {
    localeError: error()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/az.js
var error2 = () => {
  const Sizable = {
    string: { unit: "simvol", verb: "olmalıdır" },
    file: { unit: "bayt", verb: "olmalıdır" },
    array: { unit: "element", verb: "olmalıdır" },
    set: { unit: "element", verb: "olmalıdır" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Yanlış dəyər: gözlənilən ${issue2.expected}, daxil olan ${parsedType(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Yanlış dəyər: gözlənilən ${stringifyPrimitive(issue2.values[0])}`;
        return `Yanlış seçim: aşağıdakılardan biri olmalıdır: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Çox böyük: gözlənilən ${issue2.origin ?? "dəyər"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "element"}`;
        return `Çox böyük: gözlənilən ${issue2.origin ?? "dəyər"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Çox kiçik: gözlənilən ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        return `Çox kiçik: gözlənilən ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Yanlış mətn: "${_issue.prefix}" ilə başlamalıdır`;
        if (_issue.format === "ends_with")
          return `Yanlış mətn: "${_issue.suffix}" ilə bitməlidir`;
        if (_issue.format === "includes")
          return `Yanlış mətn: "${_issue.includes}" daxil olmalıdır`;
        if (_issue.format === "regex")
          return `Yanlış mətn: ${_issue.pattern} şablonuna uyğun olmalıdır`;
        return `Yanlış ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Yanlış ədəd: ${issue2.divisor} ilə bölünə bilən olmalıdır`;
      case "unrecognized_keys":
        return `Tanınmayan açar${issue2.keys.length > 1 ? "lar" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} daxilində yanlış açar`;
      case "invalid_union":
        return "Yanlış dəyər";
      case "invalid_element":
        return `${issue2.origin} daxilində yanlış dəyər`;
      default:
        return `Yanlış dəyər`;
    }
  };
};
function az_default() {
  return {
    localeError: error2()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/be.js
function getBelarusianPlural(count, one, few, many) {
  const absCount = Math.abs(count);
  const lastDigit = absCount % 10;
  const lastTwoDigits = absCount % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return many;
  }
  if (lastDigit === 1) {
    return one;
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return few;
  }
  return many;
}
var error3 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "сімвал",
        few: "сімвалы",
        many: "сімвалаў"
      },
      verb: "мець"
    },
    array: {
      unit: {
        one: "элемент",
        few: "элементы",
        many: "элементаў"
      },
      verb: "мець"
    },
    set: {
      unit: {
        one: "элемент",
        few: "элементы",
        many: "элементаў"
      },
      verb: "мець"
    },
    file: {
      unit: {
        one: "байт",
        few: "байты",
        many: "байтаў"
      },
      verb: "мець"
    }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "лік";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "масіў";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "увод",
    email: "email адрас",
    url: "URL",
    emoji: "эмодзі",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO дата і час",
    date: "ISO дата",
    time: "ISO час",
    duration: "ISO працягласць",
    ipv4: "IPv4 адрас",
    ipv6: "IPv6 адрас",
    cidrv4: "IPv4 дыяпазон",
    cidrv6: "IPv6 дыяпазон",
    base64: "радок у фармаце base64",
    base64url: "радок у фармаце base64url",
    json_string: "JSON радок",
    e164: "нумар E.164",
    jwt: "JWT",
    template_literal: "увод"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Няправільны ўвод: чакаўся ${issue2.expected}, атрымана ${parsedType(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Няправільны ўвод: чакалася ${stringifyPrimitive(issue2.values[0])}`;
        return `Няправільны варыянт: чакаўся адзін з ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const maxValue = Number(issue2.maximum);
          const unit = getBelarusianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `Занадта вялікі: чакалася, што ${issue2.origin ?? "значэнне"} павінна ${sizing.verb} ${adj}${issue2.maximum.toString()} ${unit}`;
        }
        return `Занадта вялікі: чакалася, што ${issue2.origin ?? "значэнне"} павінна быць ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const minValue = Number(issue2.minimum);
          const unit = getBelarusianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `Занадта малы: чакалася, што ${issue2.origin} павінна ${sizing.verb} ${adj}${issue2.minimum.toString()} ${unit}`;
        }
        return `Занадта малы: чакалася, што ${issue2.origin} павінна быць ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Няправільны радок: павінен пачынацца з "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Няправільны радок: павінен заканчвацца на "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Няправільны радок: павінен змяшчаць "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Няправільны радок: павінен адпавядаць шаблону ${_issue.pattern}`;
        return `Няправільны ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Няправільны лік: павінен быць кратным ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Нераспазнаны ${issue2.keys.length > 1 ? "ключы" : "ключ"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Няправільны ключ у ${issue2.origin}`;
      case "invalid_union":
        return "Няправільны ўвод";
      case "invalid_element":
        return `Няправільнае значэнне ў ${issue2.origin}`;
      default:
        return `Няправільны ўвод`;
    }
  };
};
function be_default() {
  return {
    localeError: error3()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/bg.js
var parsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "число";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "масив";
      }
      if (data === null) {
        return "null";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  return t;
};
var error4 = () => {
  const Sizable = {
    string: { unit: "символа", verb: "да съдържа" },
    file: { unit: "байта", verb: "да съдържа" },
    array: { unit: "елемента", verb: "да съдържа" },
    set: { unit: "елемента", verb: "да съдържа" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "вход",
    email: "имейл адрес",
    url: "URL",
    emoji: "емоджи",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO време",
    date: "ISO дата",
    time: "ISO време",
    duration: "ISO продължителност",
    ipv4: "IPv4 адрес",
    ipv6: "IPv6 адрес",
    cidrv4: "IPv4 диапазон",
    cidrv6: "IPv6 диапазон",
    base64: "base64-кодиран низ",
    base64url: "base64url-кодиран низ",
    json_string: "JSON низ",
    e164: "E.164 номер",
    jwt: "JWT",
    template_literal: "вход"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Невалиден вход: очакван ${issue2.expected}, получен ${parsedType(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Невалиден вход: очакван ${stringifyPrimitive(issue2.values[0])}`;
        return `Невалидна опция: очаквано едно от ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Твърде голямо: очаква се ${issue2.origin ?? "стойност"} да съдържа ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "елемента"}`;
        return `Твърде голямо: очаква се ${issue2.origin ?? "стойност"} да бъде ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Твърде малко: очаква се ${issue2.origin} да съдържа ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Твърде малко: очаква се ${issue2.origin} да бъде ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Невалиден низ: трябва да започва с "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Невалиден низ: трябва да завършва с "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Невалиден низ: трябва да включва "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Невалиден низ: трябва да съвпада с ${_issue.pattern}`;
        let invalid_adj = "Невалиден";
        if (_issue.format === "emoji")
          invalid_adj = "Невалидно";
        if (_issue.format === "datetime")
          invalid_adj = "Невалидно";
        if (_issue.format === "date")
          invalid_adj = "Невалидна";
        if (_issue.format === "time")
          invalid_adj = "Невалидно";
        if (_issue.format === "duration")
          invalid_adj = "Невалидна";
        return `${invalid_adj} ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Невалидно число: трябва да бъде кратно на ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Неразпознат${issue2.keys.length > 1 ? "и" : ""} ключ${issue2.keys.length > 1 ? "ове" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Невалиден ключ в ${issue2.origin}`;
      case "invalid_union":
        return "Невалиден вход";
      case "invalid_element":
        return `Невалидна стойност в ${issue2.origin}`;
      default:
        return `Невалиден вход`;
    }
  };
};
function bg_default() {
  return {
    localeError: error4()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ca.js
var error5 = () => {
  const Sizable = {
    string: { unit: "caràcters", verb: "contenir" },
    file: { unit: "bytes", verb: "contenir" },
    array: { unit: "elements", verb: "contenir" },
    set: { unit: "elements", verb: "contenir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType2 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "entrada",
    email: "adreça electrònica",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data i hora ISO",
    date: "data ISO",
    time: "hora ISO",
    duration: "durada ISO",
    ipv4: "adreça IPv4",
    ipv6: "adreça IPv6",
    cidrv4: "rang IPv4",
    cidrv6: "rang IPv6",
    base64: "cadena codificada en base64",
    base64url: "cadena codificada en base64url",
    json_string: "cadena JSON",
    e164: "número E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Tipus invàlid: s'esperava ${issue2.expected}, s'ha rebut ${parsedType2(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Valor invàlid: s'esperava ${stringifyPrimitive(issue2.values[0])}`;
        return `Opció invàlida: s'esperava una de ${joinValues(issue2.values, " o ")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "com a màxim" : "menys de";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Massa gran: s'esperava que ${issue2.origin ?? "el valor"} contingués ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Massa gran: s'esperava que ${issue2.origin ?? "el valor"} fos ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "com a mínim" : "més de";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Massa petit: s'esperava que ${issue2.origin} contingués ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Massa petit: s'esperava que ${issue2.origin} fos ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Format invàlid: ha de començar amb "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Format invàlid: ha d'acabar amb "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Format invàlid: ha d'incloure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Format invàlid: ha de coincidir amb el patró ${_issue.pattern}`;
        return `Format invàlid per a ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Número invàlid: ha de ser múltiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Clau${issue2.keys.length > 1 ? "s" : ""} no reconeguda${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Clau invàlida a ${issue2.origin}`;
      case "invalid_union":
        return "Entrada invàlida";
      case "invalid_element":
        return `Element invàlid a ${issue2.origin}`;
      default:
        return `Entrada invàlida`;
    }
  };
};
function ca_default() {
  return {
    localeError: error5()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/cs.js
var error6 = () => {
  const Sizable = {
    string: { unit: "znaků", verb: "mít" },
    file: { unit: "bajtů", verb: "mít" },
    array: { unit: "prvků", verb: "mít" },
    set: { unit: "prvků", verb: "mít" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType2 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "číslo";
      }
      case "string": {
        return "řetězec";
      }
      case "boolean": {
        return "boolean";
      }
      case "bigint": {
        return "bigint";
      }
      case "function": {
        return "funkce";
      }
      case "symbol": {
        return "symbol";
      }
      case "undefined": {
        return "undefined";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "pole";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "regulární výraz",
    email: "e-mailová adresa",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "datum a čas ve formátu ISO",
    date: "datum ve formátu ISO",
    time: "čas ve formátu ISO",
    duration: "doba trvání ISO",
    ipv4: "IPv4 adresa",
    ipv6: "IPv6 adresa",
    cidrv4: "rozsah IPv4",
    cidrv6: "rozsah IPv6",
    base64: "řetězec zakódovaný ve formátu base64",
    base64url: "řetězec zakódovaný ve formátu base64url",
    json_string: "řetězec ve formátu JSON",
    e164: "číslo E.164",
    jwt: "JWT",
    template_literal: "vstup"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Neplatný vstup: očekáváno ${issue2.expected}, obdrženo ${parsedType2(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Neplatný vstup: očekáváno ${stringifyPrimitive(issue2.values[0])}`;
        return `Neplatná možnost: očekávána jedna z hodnot ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Hodnota je příliš velká: ${issue2.origin ?? "hodnota"} musí mít ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "prvků"}`;
        }
        return `Hodnota je příliš velká: ${issue2.origin ?? "hodnota"} musí být ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Hodnota je příliš malá: ${issue2.origin ?? "hodnota"} musí mít ${adj}${issue2.minimum.toString()} ${sizing.unit ?? "prvků"}`;
        }
        return `Hodnota je příliš malá: ${issue2.origin ?? "hodnota"} musí být ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Neplatný řetězec: musí začínat na "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Neplatný řetězec: musí končit na "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Neplatný řetězec: musí obsahovat "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Neplatný řetězec: musí odpovídat vzoru ${_issue.pattern}`;
        return `Neplatný formát ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Neplatné číslo: musí být násobkem ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Neznámé klíče: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Neplatný klíč v ${issue2.origin}`;
      case "invalid_union":
        return "Neplatný vstup";
      case "invalid_element":
        return `Neplatná hodnota v ${issue2.origin}`;
      default:
        return `Neplatný vstup`;
    }
  };
};
function cs_default() {
  return {
    localeError: error6()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/da.js
var error7 = () => {
  const Sizable = {
    string: { unit: "tegn", verb: "havde" },
    file: { unit: "bytes", verb: "havde" },
    array: { unit: "elementer", verb: "indeholdt" },
    set: { unit: "elementer", verb: "indeholdt" }
  };
  const TypeNames = {
    string: "streng",
    number: "tal",
    boolean: "boolean",
    array: "liste",
    object: "objekt",
    set: "sæt",
    file: "fil"
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  function getTypeName(type) {
    return TypeNames[type] ?? type;
  }
  const parsedType2 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "tal";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "liste";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
        return "objekt";
      }
    }
    return t;
  };
  const Nouns = {
    regex: "input",
    email: "e-mailadresse",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dato- og klokkeslæt",
    date: "ISO-dato",
    time: "ISO-klokkeslæt",
    duration: "ISO-varighed",
    ipv4: "IPv4-område",
    ipv6: "IPv6-område",
    cidrv4: "IPv4-spektrum",
    cidrv6: "IPv6-spektrum",
    base64: "base64-kodet streng",
    base64url: "base64url-kodet streng",
    json_string: "JSON-streng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Ugyldigt input: forventede ${getTypeName(issue2.expected)}, fik ${getTypeName(parsedType2(issue2.input))}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ugyldig værdi: forventede ${stringifyPrimitive(issue2.values[0])}`;
        return `Ugyldigt valg: forventede en af følgende ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const origin = getTypeName(issue2.origin);
        if (sizing)
          return `For stor: forventede ${origin ?? "value"} ${sizing.verb} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "elementer"}`;
        return `For stor: forventede ${origin ?? "value"} havde ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const origin = getTypeName(issue2.origin);
        if (sizing) {
          return `For lille: forventede ${origin} ${sizing.verb} ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `For lille: forventede ${origin} havde ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ugyldig streng: skal starte med "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Ugyldig streng: skal ende med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ugyldig streng: skal indeholde "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ugyldig streng: skal matche mønsteret ${_issue.pattern}`;
        return `Ugyldig ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ugyldigt tal: skal være deleligt med ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Ukendte nøgler" : "Ukendt nøgle"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ugyldig nøgle i ${issue2.origin}`;
      case "invalid_union":
        return "Ugyldigt input: matcher ingen af de tilladte typer";
      case "invalid_element":
        return `Ugyldig værdi i ${issue2.origin}`;
      default:
        return `Ugyldigt input`;
    }
  };
};
function da_default() {
  return {
    localeError: error7()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/de.js
var error8 = () => {
  const Sizable = {
    string: { unit: "Zeichen", verb: "zu haben" },
    file: { unit: "Bytes", verb: "zu haben" },
    array: { unit: "Elemente", verb: "zu haben" },
    set: { unit: "Elemente", verb: "zu haben" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType2 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "Zahl";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "Array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "Eingabe",
    email: "E-Mail-Adresse",
    url: "URL",
    emoji: "Emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-Datum und -Uhrzeit",
    date: "ISO-Datum",
    time: "ISO-Uhrzeit",
    duration: "ISO-Dauer",
    ipv4: "IPv4-Adresse",
    ipv6: "IPv6-Adresse",
    cidrv4: "IPv4-Bereich",
    cidrv6: "IPv6-Bereich",
    base64: "Base64-codierter String",
    base64url: "Base64-URL-codierter String",
    json_string: "JSON-String",
    e164: "E.164-Nummer",
    jwt: "JWT",
    template_literal: "Eingabe"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Ungültige Eingabe: erwartet ${issue2.expected}, erhalten ${parsedType2(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ungültige Eingabe: erwartet ${stringifyPrimitive(issue2.values[0])}`;
        return `Ungültige Option: erwartet eine von ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Zu groß: erwartet, dass ${issue2.origin ?? "Wert"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "Elemente"} hat`;
        return `Zu groß: erwartet, dass ${issue2.origin ?? "Wert"} ${adj}${issue2.maximum.toString()} ist`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Zu klein: erwartet, dass ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} hat`;
        }
        return `Zu klein: erwartet, dass ${issue2.origin} ${adj}${issue2.minimum.toString()} ist`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ungültiger String: muss mit "${_issue.prefix}" beginnen`;
        if (_issue.format === "ends_with")
          return `Ungültiger String: muss mit "${_issue.suffix}" enden`;
        if (_issue.format === "includes")
          return `Ungültiger String: muss "${_issue.includes}" enthalten`;
        if (_issue.format === "regex")
          return `Ungültiger String: muss dem Muster ${_issue.pattern} entsprechen`;
        return `Ungültig: ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ungültige Zahl: muss ein Vielfaches von ${issue2.divisor} sein`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Unbekannte Schlüssel" : "Unbekannter Schlüssel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ungültiger Schlüssel in ${issue2.origin}`;
      case "invalid_union":
        return "Ungültige Eingabe";
      case "invalid_element":
        return `Ungültiger Wert in ${issue2.origin}`;
      default:
        return `Ungültige Eingabe`;
    }
  };
};
function de_default() {
  return {
    localeError: error8()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/en.js
var parsedType2 = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "number";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  return t;
};
var error9 = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Invalid input: expected ${issue2.expected}, received ${parsedType2(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error9()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/eo.js
var parsedType3 = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "nombro";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "tabelo";
      }
      if (data === null) {
        return "senvalora";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  return t;
};
var error10 = () => {
  const Sizable = {
    string: { unit: "karaktrojn", verb: "havi" },
    file: { unit: "bajtojn", verb: "havi" },
    array: { unit: "elementojn", verb: "havi" },
    set: { unit: "elementojn", verb: "havi" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "enigo",
    email: "retadreso",
    url: "URL",
    emoji: "emoĝio",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-datotempo",
    date: "ISO-dato",
    time: "ISO-tempo",
    duration: "ISO-daŭro",
    ipv4: "IPv4-adreso",
    ipv6: "IPv6-adreso",
    cidrv4: "IPv4-rango",
    cidrv6: "IPv6-rango",
    base64: "64-ume kodita karaktraro",
    base64url: "URL-64-ume kodita karaktraro",
    json_string: "JSON-karaktraro",
    e164: "E.164-nombro",
    jwt: "JWT",
    template_literal: "enigo"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Nevalida enigo: atendiĝis ${issue2.expected}, riceviĝis ${parsedType3(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Nevalida enigo: atendiĝis ${stringifyPrimitive(issue2.values[0])}`;
        return `Nevalida opcio: atendiĝis unu el ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Tro granda: atendiĝis ke ${issue2.origin ?? "valoro"} havu ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementojn"}`;
        return `Tro granda: atendiĝis ke ${issue2.origin ?? "valoro"} havu ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Tro malgranda: atendiĝis ke ${issue2.origin} havu ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Tro malgranda: atendiĝis ke ${issue2.origin} estu ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Nevalida karaktraro: devas komenciĝi per "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Nevalida karaktraro: devas finiĝi per "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Nevalida karaktraro: devas inkluzivi "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Nevalida karaktraro: devas kongrui kun la modelo ${_issue.pattern}`;
        return `Nevalida ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Nevalida nombro: devas esti oblo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Nekonata${issue2.keys.length > 1 ? "j" : ""} ŝlosilo${issue2.keys.length > 1 ? "j" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Nevalida ŝlosilo en ${issue2.origin}`;
      case "invalid_union":
        return "Nevalida enigo";
      case "invalid_element":
        return `Nevalida valoro en ${issue2.origin}`;
      default:
        return `Nevalida enigo`;
    }
  };
};
function eo_default() {
  return {
    localeError: error10()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/es.js
var error11 = () => {
  const Sizable = {
    string: { unit: "caracteres", verb: "tener" },
    file: { unit: "bytes", verb: "tener" },
    array: { unit: "elementos", verb: "tener" },
    set: { unit: "elementos", verb: "tener" }
  };
  const TypeNames = {
    string: "texto",
    number: "número",
    boolean: "booleano",
    array: "arreglo",
    object: "objeto",
    set: "conjunto",
    file: "archivo",
    date: "fecha",
    bigint: "número grande",
    symbol: "símbolo",
    undefined: "indefinido",
    null: "nulo",
    function: "función",
    map: "mapa",
    record: "registro",
    tuple: "tupla",
    enum: "enumeración",
    union: "unión",
    literal: "literal",
    promise: "promesa",
    void: "vacío",
    never: "nunca",
    unknown: "desconocido",
    any: "cualquiera"
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  function getTypeName(type) {
    return TypeNames[type] ?? type;
  }
  const parsedType4 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype) {
          return data.constructor.name;
        }
        return "object";
      }
    }
    return t;
  };
  const Nouns = {
    regex: "entrada",
    email: "dirección de correo electrónico",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "fecha y hora ISO",
    date: "fecha ISO",
    time: "hora ISO",
    duration: "duración ISO",
    ipv4: "dirección IPv4",
    ipv6: "dirección IPv6",
    cidrv4: "rango IPv4",
    cidrv6: "rango IPv6",
    base64: "cadena codificada en base64",
    base64url: "URL codificada en base64",
    json_string: "cadena JSON",
    e164: "número E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Entrada inválida: se esperaba ${getTypeName(issue2.expected)}, recibido ${getTypeName(parsedType4(issue2.input))}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrada inválida: se esperaba ${stringifyPrimitive(issue2.values[0])}`;
        return `Opción inválida: se esperaba una de ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        const origin = getTypeName(issue2.origin);
        if (sizing)
          return `Demasiado grande: se esperaba que ${origin ?? "valor"} tuviera ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementos"}`;
        return `Demasiado grande: se esperaba que ${origin ?? "valor"} fuera ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        const origin = getTypeName(issue2.origin);
        if (sizing) {
          return `Demasiado pequeño: se esperaba que ${origin} tuviera ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Demasiado pequeño: se esperaba que ${origin} fuera ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Cadena inválida: debe comenzar con "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Cadena inválida: debe terminar en "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Cadena inválida: debe incluir "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Cadena inválida: debe coincidir con el patrón ${_issue.pattern}`;
        return `Inválido ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Número inválido: debe ser múltiplo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Llave${issue2.keys.length > 1 ? "s" : ""} desconocida${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Llave inválida en ${getTypeName(issue2.origin)}`;
      case "invalid_union":
        return "Entrada inválida";
      case "invalid_element":
        return `Valor inválido en ${getTypeName(issue2.origin)}`;
      default:
        return `Entrada inválida`;
    }
  };
};
function es_default() {
  return {
    localeError: error11()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/fa.js
var error12 = () => {
  const Sizable = {
    string: { unit: "کاراکتر", verb: "داشته باشد" },
    file: { unit: "بایت", verb: "داشته باشد" },
    array: { unit: "آیتم", verb: "داشته باشد" },
    set: { unit: "آیتم", verb: "داشته باشد" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType4 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "عدد";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "آرایه";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "ورودی",
    email: "آدرس ایمیل",
    url: "URL",
    emoji: "ایموجی",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "تاریخ و زمان ایزو",
    date: "تاریخ ایزو",
    time: "زمان ایزو",
    duration: "مدت زمان ایزو",
    ipv4: "IPv4 آدرس",
    ipv6: "IPv6 آدرس",
    cidrv4: "IPv4 دامنه",
    cidrv6: "IPv6 دامنه",
    base64: "base64-encoded رشته",
    base64url: "base64url-encoded رشته",
    json_string: "JSON رشته",
    e164: "E.164 عدد",
    jwt: "JWT",
    template_literal: "ورودی"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `ورودی نامعتبر: می‌بایست ${issue2.expected} می‌بود، ${parsedType4(issue2.input)} دریافت شد`;
      case "invalid_value":
        if (issue2.values.length === 1) {
          return `ورودی نامعتبر: می‌بایست ${stringifyPrimitive(issue2.values[0])} می‌بود`;
        }
        return `گزینه نامعتبر: می‌بایست یکی از ${joinValues(issue2.values, "|")} می‌بود`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `خیلی بزرگ: ${issue2.origin ?? "مقدار"} باید ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "عنصر"} باشد`;
        }
        return `خیلی بزرگ: ${issue2.origin ?? "مقدار"} باید ${adj}${issue2.maximum.toString()} باشد`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `خیلی کوچک: ${issue2.origin} باید ${adj}${issue2.minimum.toString()} ${sizing.unit} باشد`;
        }
        return `خیلی کوچک: ${issue2.origin} باید ${adj}${issue2.minimum.toString()} باشد`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `رشته نامعتبر: باید با "${_issue.prefix}" شروع شود`;
        }
        if (_issue.format === "ends_with") {
          return `رشته نامعتبر: باید با "${_issue.suffix}" تمام شود`;
        }
        if (_issue.format === "includes") {
          return `رشته نامعتبر: باید شامل "${_issue.includes}" باشد`;
        }
        if (_issue.format === "regex") {
          return `رشته نامعتبر: باید با الگوی ${_issue.pattern} مطابقت داشته باشد`;
        }
        return `${Nouns[_issue.format] ?? issue2.format} نامعتبر`;
      }
      case "not_multiple_of":
        return `عدد نامعتبر: باید مضرب ${issue2.divisor} باشد`;
      case "unrecognized_keys":
        return `کلید${issue2.keys.length > 1 ? "های" : ""} ناشناس: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `کلید ناشناس در ${issue2.origin}`;
      case "invalid_union":
        return `ورودی نامعتبر`;
      case "invalid_element":
        return `مقدار نامعتبر در ${issue2.origin}`;
      default:
        return `ورودی نامعتبر`;
    }
  };
};
function fa_default() {
  return {
    localeError: error12()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/fi.js
var error13 = () => {
  const Sizable = {
    string: { unit: "merkkiä", subject: "merkkijonon" },
    file: { unit: "tavua", subject: "tiedoston" },
    array: { unit: "alkiota", subject: "listan" },
    set: { unit: "alkiota", subject: "joukon" },
    number: { unit: "", subject: "luvun" },
    bigint: { unit: "", subject: "suuren kokonaisluvun" },
    int: { unit: "", subject: "kokonaisluvun" },
    date: { unit: "", subject: "päivämäärän" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType4 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "säännöllinen lauseke",
    email: "sähköpostiosoite",
    url: "URL-osoite",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-aikaleima",
    date: "ISO-päivämäärä",
    time: "ISO-aika",
    duration: "ISO-kesto",
    ipv4: "IPv4-osoite",
    ipv6: "IPv6-osoite",
    cidrv4: "IPv4-alue",
    cidrv6: "IPv6-alue",
    base64: "base64-koodattu merkkijono",
    base64url: "base64url-koodattu merkkijono",
    json_string: "JSON-merkkijono",
    e164: "E.164-luku",
    jwt: "JWT",
    template_literal: "templaattimerkkijono"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Virheellinen tyyppi: odotettiin ${issue2.expected}, oli ${parsedType4(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Virheellinen syöte: täytyy olla ${stringifyPrimitive(issue2.values[0])}`;
        return `Virheellinen valinta: täytyy olla yksi seuraavista: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Liian suuri: ${sizing.subject} täytyy olla ${adj}${issue2.maximum.toString()} ${sizing.unit}`.trim();
        }
        return `Liian suuri: arvon täytyy olla ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Liian pieni: ${sizing.subject} täytyy olla ${adj}${issue2.minimum.toString()} ${sizing.unit}`.trim();
        }
        return `Liian pieni: arvon täytyy olla ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Virheellinen syöte: täytyy alkaa "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Virheellinen syöte: täytyy loppua "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Virheellinen syöte: täytyy sisältää "${_issue.includes}"`;
        if (_issue.format === "regex") {
          return `Virheellinen syöte: täytyy vastata säännöllistä lauseketta ${_issue.pattern}`;
        }
        return `Virheellinen ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Virheellinen luku: täytyy olla luvun ${issue2.divisor} monikerta`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Tuntemattomat avaimet" : "Tuntematon avain"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return "Virheellinen avain tietueessa";
      case "invalid_union":
        return "Virheellinen unioni";
      case "invalid_element":
        return "Virheellinen arvo joukossa";
      default:
        return `Virheellinen syöte`;
    }
  };
};
function fi_default() {
  return {
    localeError: error13()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/fr.js
var error14 = () => {
  const Sizable = {
    string: { unit: "caractères", verb: "avoir" },
    file: { unit: "octets", verb: "avoir" },
    array: { unit: "éléments", verb: "avoir" },
    set: { unit: "éléments", verb: "avoir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType4 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "nombre";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "tableau";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "entrée",
    email: "adresse e-mail",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "date et heure ISO",
    date: "date ISO",
    time: "heure ISO",
    duration: "durée ISO",
    ipv4: "adresse IPv4",
    ipv6: "adresse IPv6",
    cidrv4: "plage IPv4",
    cidrv6: "plage IPv6",
    base64: "chaîne encodée en base64",
    base64url: "chaîne encodée en base64url",
    json_string: "chaîne JSON",
    e164: "numéro E.164",
    jwt: "JWT",
    template_literal: "entrée"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Entrée invalide : ${issue2.expected} attendu, ${parsedType4(issue2.input)} reçu`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrée invalide : ${stringifyPrimitive(issue2.values[0])} attendu`;
        return `Option invalide : une valeur parmi ${joinValues(issue2.values, "|")} attendue`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Trop grand : ${issue2.origin ?? "valeur"} doit ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "élément(s)"}`;
        return `Trop grand : ${issue2.origin ?? "valeur"} doit être ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Trop petit : ${issue2.origin} doit ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Trop petit : ${issue2.origin} doit être ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Chaîne invalide : doit commencer par "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Chaîne invalide : doit se terminer par "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Chaîne invalide : doit inclure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Chaîne invalide : doit correspondre au modèle ${_issue.pattern}`;
        return `${Nouns[_issue.format] ?? issue2.format} invalide`;
      }
      case "not_multiple_of":
        return `Nombre invalide : doit être un multiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Clé${issue2.keys.length > 1 ? "s" : ""} non reconnue${issue2.keys.length > 1 ? "s" : ""} : ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Clé invalide dans ${issue2.origin}`;
      case "invalid_union":
        return "Entrée invalide";
      case "invalid_element":
        return `Valeur invalide dans ${issue2.origin}`;
      default:
        return `Entrée invalide`;
    }
  };
};
function fr_default() {
  return {
    localeError: error14()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/fr-CA.js
var error15 = () => {
  const Sizable = {
    string: { unit: "caractères", verb: "avoir" },
    file: { unit: "octets", verb: "avoir" },
    array: { unit: "éléments", verb: "avoir" },
    set: { unit: "éléments", verb: "avoir" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType4 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "entrée",
    email: "adresse courriel",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "date-heure ISO",
    date: "date ISO",
    time: "heure ISO",
    duration: "durée ISO",
    ipv4: "adresse IPv4",
    ipv6: "adresse IPv6",
    cidrv4: "plage IPv4",
    cidrv6: "plage IPv6",
    base64: "chaîne encodée en base64",
    base64url: "chaîne encodée en base64url",
    json_string: "chaîne JSON",
    e164: "numéro E.164",
    jwt: "JWT",
    template_literal: "entrée"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Entrée invalide : attendu ${issue2.expected}, reçu ${parsedType4(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrée invalide : attendu ${stringifyPrimitive(issue2.values[0])}`;
        return `Option invalide : attendu l'une des valeurs suivantes ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "≤" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Trop grand : attendu que ${issue2.origin ?? "la valeur"} ait ${adj}${issue2.maximum.toString()} ${sizing.unit}`;
        return `Trop grand : attendu que ${issue2.origin ?? "la valeur"} soit ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "≥" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Trop petit : attendu que ${issue2.origin} ait ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Trop petit : attendu que ${issue2.origin} soit ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Chaîne invalide : doit commencer par "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Chaîne invalide : doit se terminer par "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Chaîne invalide : doit inclure "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Chaîne invalide : doit correspondre au motif ${_issue.pattern}`;
        return `${Nouns[_issue.format] ?? issue2.format} invalide`;
      }
      case "not_multiple_of":
        return `Nombre invalide : doit être un multiple de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Clé${issue2.keys.length > 1 ? "s" : ""} non reconnue${issue2.keys.length > 1 ? "s" : ""} : ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Clé invalide dans ${issue2.origin}`;
      case "invalid_union":
        return "Entrée invalide";
      case "invalid_element":
        return `Valeur invalide dans ${issue2.origin}`;
      default:
        return `Entrée invalide`;
    }
  };
};
function fr_CA_default() {
  return {
    localeError: error15()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/he.js
var error16 = () => {
  const Sizable = {
    string: { unit: "אותיות", verb: "לכלול" },
    file: { unit: "בייטים", verb: "לכלול" },
    array: { unit: "פריטים", verb: "לכלול" },
    set: { unit: "פריטים", verb: "לכלול" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType4 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "קלט",
    email: "כתובת אימייל",
    url: "כתובת רשת",
    emoji: "אימוג'י",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "תאריך וזמן ISO",
    date: "תאריך ISO",
    time: "זמן ISO",
    duration: "משך זמן ISO",
    ipv4: "כתובת IPv4",
    ipv6: "כתובת IPv6",
    cidrv4: "טווח IPv4",
    cidrv6: "טווח IPv6",
    base64: "מחרוזת בבסיס 64",
    base64url: "מחרוזת בבסיס 64 לכתובות רשת",
    json_string: "מחרוזת JSON",
    e164: "מספר E.164",
    jwt: "JWT",
    template_literal: "קלט"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `קלט לא תקין: צריך ${issue2.expected}, התקבל ${parsedType4(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `קלט לא תקין: צריך ${stringifyPrimitive(issue2.values[0])}`;
        return `קלט לא תקין: צריך אחת מהאפשרויות  ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `גדול מדי: ${issue2.origin ?? "value"} צריך להיות ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `גדול מדי: ${issue2.origin ?? "value"} צריך להיות ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `קטן מדי: ${issue2.origin} צריך להיות ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `קטן מדי: ${issue2.origin} צריך להיות ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `מחרוזת לא תקינה: חייבת להתחיל ב"${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `מחרוזת לא תקינה: חייבת להסתיים ב "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `מחרוזת לא תקינה: חייבת לכלול "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `מחרוזת לא תקינה: חייבת להתאים לתבנית ${_issue.pattern}`;
        return `${Nouns[_issue.format] ?? issue2.format} לא תקין`;
      }
      case "not_multiple_of":
        return `מספר לא תקין: חייב להיות מכפלה של ${issue2.divisor}`;
      case "unrecognized_keys":
        return `מפתח${issue2.keys.length > 1 ? "ות" : ""} לא מזוה${issue2.keys.length > 1 ? "ים" : "ה"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `מפתח לא תקין ב${issue2.origin}`;
      case "invalid_union":
        return "קלט לא תקין";
      case "invalid_element":
        return `ערך לא תקין ב${issue2.origin}`;
      default:
        return `קלט לא תקין`;
    }
  };
};
function he_default() {
  return {
    localeError: error16()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/hu.js
var error17 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "legyen" },
    file: { unit: "byte", verb: "legyen" },
    array: { unit: "elem", verb: "legyen" },
    set: { unit: "elem", verb: "legyen" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType4 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "szám";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "tömb";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "bemenet",
    email: "email cím",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO időbélyeg",
    date: "ISO dátum",
    time: "ISO idő",
    duration: "ISO időintervallum",
    ipv4: "IPv4 cím",
    ipv6: "IPv6 cím",
    cidrv4: "IPv4 tartomány",
    cidrv6: "IPv6 tartomány",
    base64: "base64-kódolt string",
    base64url: "base64url-kódolt string",
    json_string: "JSON string",
    e164: "E.164 szám",
    jwt: "JWT",
    template_literal: "bemenet"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Érvénytelen bemenet: a várt érték ${issue2.expected}, a kapott érték ${parsedType4(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Érvénytelen bemenet: a várt érték ${stringifyPrimitive(issue2.values[0])}`;
        return `Érvénytelen opció: valamelyik érték várt ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Túl nagy: ${issue2.origin ?? "érték"} mérete túl nagy ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elem"}`;
        return `Túl nagy: a bemeneti érték ${issue2.origin ?? "érték"} túl nagy: ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Túl kicsi: a bemeneti érték ${issue2.origin} mérete túl kicsi ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Túl kicsi: a bemeneti érték ${issue2.origin} túl kicsi ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Érvénytelen string: "${_issue.prefix}" értékkel kell kezdődnie`;
        if (_issue.format === "ends_with")
          return `Érvénytelen string: "${_issue.suffix}" értékkel kell végződnie`;
        if (_issue.format === "includes")
          return `Érvénytelen string: "${_issue.includes}" értéket kell tartalmaznia`;
        if (_issue.format === "regex")
          return `Érvénytelen string: ${_issue.pattern} mintának kell megfelelnie`;
        return `Érvénytelen ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Érvénytelen szám: ${issue2.divisor} többszörösének kell lennie`;
      case "unrecognized_keys":
        return `Ismeretlen kulcs${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Érvénytelen kulcs ${issue2.origin}`;
      case "invalid_union":
        return "Érvénytelen bemenet";
      case "invalid_element":
        return `Érvénytelen érték: ${issue2.origin}`;
      default:
        return `Érvénytelen bemenet`;
    }
  };
};
function hu_default() {
  return {
    localeError: error17()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/id.js
var error18 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "memiliki" },
    file: { unit: "byte", verb: "memiliki" },
    array: { unit: "item", verb: "memiliki" },
    set: { unit: "item", verb: "memiliki" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType4 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "input",
    email: "alamat email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "tanggal dan waktu format ISO",
    date: "tanggal format ISO",
    time: "jam format ISO",
    duration: "durasi format ISO",
    ipv4: "alamat IPv4",
    ipv6: "alamat IPv6",
    cidrv4: "rentang alamat IPv4",
    cidrv6: "rentang alamat IPv6",
    base64: "string dengan enkode base64",
    base64url: "string dengan enkode base64url",
    json_string: "string JSON",
    e164: "angka E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Input tidak valid: diharapkan ${issue2.expected}, diterima ${parsedType4(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input tidak valid: diharapkan ${stringifyPrimitive(issue2.values[0])}`;
        return `Pilihan tidak valid: diharapkan salah satu dari ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Terlalu besar: diharapkan ${issue2.origin ?? "value"} memiliki ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemen"}`;
        return `Terlalu besar: diharapkan ${issue2.origin ?? "value"} menjadi ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Terlalu kecil: diharapkan ${issue2.origin} memiliki ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Terlalu kecil: diharapkan ${issue2.origin} menjadi ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `String tidak valid: harus dimulai dengan "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `String tidak valid: harus berakhir dengan "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `String tidak valid: harus menyertakan "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `String tidak valid: harus sesuai pola ${_issue.pattern}`;
        return `${Nouns[_issue.format] ?? issue2.format} tidak valid`;
      }
      case "not_multiple_of":
        return `Angka tidak valid: harus kelipatan dari ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Kunci tidak dikenali ${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Kunci tidak valid di ${issue2.origin}`;
      case "invalid_union":
        return "Input tidak valid";
      case "invalid_element":
        return `Nilai tidak valid di ${issue2.origin}`;
      default:
        return `Input tidak valid`;
    }
  };
};
function id_default() {
  return {
    localeError: error18()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/is.js
var parsedType4 = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "númer";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "fylki";
      }
      if (data === null) {
        return "null";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  return t;
};
var error19 = () => {
  const Sizable = {
    string: { unit: "stafi", verb: "að hafa" },
    file: { unit: "bæti", verb: "að hafa" },
    array: { unit: "hluti", verb: "að hafa" },
    set: { unit: "hluti", verb: "að hafa" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "gildi",
    email: "netfang",
    url: "vefslóð",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dagsetning og tími",
    date: "ISO dagsetning",
    time: "ISO tími",
    duration: "ISO tímalengd",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded strengur",
    base64url: "base64url-encoded strengur",
    json_string: "JSON strengur",
    e164: "E.164 tölugildi",
    jwt: "JWT",
    template_literal: "gildi"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Rangt gildi: Þú slóst inn ${parsedType4(issue2.input)} þar sem á að vera ${issue2.expected}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Rangt gildi: gert ráð fyrir ${stringifyPrimitive(issue2.values[0])}`;
        return `Ógilt val: má vera eitt af eftirfarandi ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Of stórt: gert er ráð fyrir að ${issue2.origin ?? "gildi"} hafi ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "hluti"}`;
        return `Of stórt: gert er ráð fyrir að ${issue2.origin ?? "gildi"} sé ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Of lítið: gert er ráð fyrir að ${issue2.origin} hafi ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Of lítið: gert er ráð fyrir að ${issue2.origin} sé ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Ógildur strengur: verður að byrja á "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Ógildur strengur: verður að enda á "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ógildur strengur: verður að innihalda "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ógildur strengur: verður að fylgja mynstri ${_issue.pattern}`;
        return `Rangt ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Röng tala: verður að vera margfeldi af ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Óþekkt ${issue2.keys.length > 1 ? "ir lyklar" : "ur lykill"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Rangur lykill í ${issue2.origin}`;
      case "invalid_union":
        return "Rangt gildi";
      case "invalid_element":
        return `Rangt gildi í ${issue2.origin}`;
      default:
        return `Rangt gildi`;
    }
  };
};
function is_default() {
  return {
    localeError: error19()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/it.js
var error20 = () => {
  const Sizable = {
    string: { unit: "caratteri", verb: "avere" },
    file: { unit: "byte", verb: "avere" },
    array: { unit: "elementi", verb: "avere" },
    set: { unit: "elementi", verb: "avere" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType5 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "numero";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "vettore";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "input",
    email: "indirizzo email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data e ora ISO",
    date: "data ISO",
    time: "ora ISO",
    duration: "durata ISO",
    ipv4: "indirizzo IPv4",
    ipv6: "indirizzo IPv6",
    cidrv4: "intervallo IPv4",
    cidrv6: "intervallo IPv6",
    base64: "stringa codificata in base64",
    base64url: "URL codificata in base64",
    json_string: "stringa JSON",
    e164: "numero E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Input non valido: atteso ${issue2.expected}, ricevuto ${parsedType5(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input non valido: atteso ${stringifyPrimitive(issue2.values[0])}`;
        return `Opzione non valida: atteso uno tra ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Troppo grande: ${issue2.origin ?? "valore"} deve avere ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementi"}`;
        return `Troppo grande: ${issue2.origin ?? "valore"} deve essere ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Troppo piccolo: ${issue2.origin} deve avere ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Troppo piccolo: ${issue2.origin} deve essere ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Stringa non valida: deve iniziare con "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Stringa non valida: deve terminare con "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Stringa non valida: deve includere "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Stringa non valida: deve corrispondere al pattern ${_issue.pattern}`;
        return `Invalid ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Numero non valido: deve essere un multiplo di ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Chiav${issue2.keys.length > 1 ? "i" : "e"} non riconosciut${issue2.keys.length > 1 ? "e" : "a"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Chiave non valida in ${issue2.origin}`;
      case "invalid_union":
        return "Input non valido";
      case "invalid_element":
        return `Valore non valido in ${issue2.origin}`;
      default:
        return `Input non valido`;
    }
  };
};
function it_default() {
  return {
    localeError: error20()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ja.js
var error21 = () => {
  const Sizable = {
    string: { unit: "文字", verb: "である" },
    file: { unit: "バイト", verb: "である" },
    array: { unit: "要素", verb: "である" },
    set: { unit: "要素", verb: "である" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType5 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "数値";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "配列";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "入力値",
    email: "メールアドレス",
    url: "URL",
    emoji: "絵文字",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO日時",
    date: "ISO日付",
    time: "ISO時刻",
    duration: "ISO期間",
    ipv4: "IPv4アドレス",
    ipv6: "IPv6アドレス",
    cidrv4: "IPv4範囲",
    cidrv6: "IPv6範囲",
    base64: "base64エンコード文字列",
    base64url: "base64urlエンコード文字列",
    json_string: "JSON文字列",
    e164: "E.164番号",
    jwt: "JWT",
    template_literal: "入力値"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `無効な入力: ${issue2.expected}が期待されましたが、${parsedType5(issue2.input)}が入力されました`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `無効な入力: ${stringifyPrimitive(issue2.values[0])}が期待されました`;
        return `無効な選択: ${joinValues(issue2.values, "、")}のいずれかである必要があります`;
      case "too_big": {
        const adj = issue2.inclusive ? "以下である" : "より小さい";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `大きすぎる値: ${issue2.origin ?? "値"}は${issue2.maximum.toString()}${sizing.unit ?? "要素"}${adj}必要があります`;
        return `大きすぎる値: ${issue2.origin ?? "値"}は${issue2.maximum.toString()}${adj}必要があります`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "以上である" : "より大きい";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `小さすぎる値: ${issue2.origin}は${issue2.minimum.toString()}${sizing.unit}${adj}必要があります`;
        return `小さすぎる値: ${issue2.origin}は${issue2.minimum.toString()}${adj}必要があります`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `無効な文字列: "${_issue.prefix}"で始まる必要があります`;
        if (_issue.format === "ends_with")
          return `無効な文字列: "${_issue.suffix}"で終わる必要があります`;
        if (_issue.format === "includes")
          return `無効な文字列: "${_issue.includes}"を含む必要があります`;
        if (_issue.format === "regex")
          return `無効な文字列: パターン${_issue.pattern}に一致する必要があります`;
        return `無効な${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `無効な数値: ${issue2.divisor}の倍数である必要があります`;
      case "unrecognized_keys":
        return `認識されていないキー${issue2.keys.length > 1 ? "群" : ""}: ${joinValues(issue2.keys, "、")}`;
      case "invalid_key":
        return `${issue2.origin}内の無効なキー`;
      case "invalid_union":
        return "無効な入力";
      case "invalid_element":
        return `${issue2.origin}内の無効な値`;
      default:
        return `無効な入力`;
    }
  };
};
function ja_default() {
  return {
    localeError: error21()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ka.js
var parsedType5 = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "რიცხვი";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "მასივი";
      }
      if (data === null) {
        return "null";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  const typeMap = {
    string: "სტრინგი",
    boolean: "ბულეანი",
    undefined: "undefined",
    bigint: "bigint",
    symbol: "symbol",
    function: "ფუნქცია"
  };
  return typeMap[t] ?? t;
};
var error22 = () => {
  const Sizable = {
    string: { unit: "სიმბოლო", verb: "უნდა შეიცავდეს" },
    file: { unit: "ბაიტი", verb: "უნდა შეიცავდეს" },
    array: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" },
    set: { unit: "ელემენტი", verb: "უნდა შეიცავდეს" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "შეყვანა",
    email: "ელ-ფოსტის მისამართი",
    url: "URL",
    emoji: "ემოჯი",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "თარიღი-დრო",
    date: "თარიღი",
    time: "დრო",
    duration: "ხანგრძლივობა",
    ipv4: "IPv4 მისამართი",
    ipv6: "IPv6 მისამართი",
    cidrv4: "IPv4 დიაპაზონი",
    cidrv6: "IPv6 დიაპაზონი",
    base64: "base64-კოდირებული სტრინგი",
    base64url: "base64url-კოდირებული სტრინგი",
    json_string: "JSON სტრინგი",
    e164: "E.164 ნომერი",
    jwt: "JWT",
    template_literal: "შეყვანა"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `არასწორი შეყვანა: მოსალოდნელი ${issue2.expected}, მიღებული ${parsedType5(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `არასწორი შეყვანა: მოსალოდნელი ${stringifyPrimitive(issue2.values[0])}`;
        return `არასწორი ვარიანტი: მოსალოდნელია ერთ-ერთი ${joinValues(issue2.values, "|")}-დან`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `ზედმეტად დიდი: მოსალოდნელი ${issue2.origin ?? "მნიშვნელობა"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit}`;
        return `ზედმეტად დიდი: მოსალოდნელი ${issue2.origin ?? "მნიშვნელობა"} იყოს ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `ზედმეტად პატარა: მოსალოდნელი ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `ზედმეტად პატარა: მოსალოდნელი ${issue2.origin} იყოს ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `არასწორი სტრინგი: უნდა იწყებოდეს "${_issue.prefix}"-ით`;
        }
        if (_issue.format === "ends_with")
          return `არასწორი სტრინგი: უნდა მთავრდებოდეს "${_issue.suffix}"-ით`;
        if (_issue.format === "includes")
          return `არასწორი სტრინგი: უნდა შეიცავდეს "${_issue.includes}"-ს`;
        if (_issue.format === "regex")
          return `არასწორი სტრინგი: უნდა შეესაბამებოდეს შაბლონს ${_issue.pattern}`;
        return `არასწორი ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `არასწორი რიცხვი: უნდა იყოს ${issue2.divisor}-ის ჯერადი`;
      case "unrecognized_keys":
        return `უცნობი გასაღებ${issue2.keys.length > 1 ? "ები" : "ი"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `არასწორი გასაღები ${issue2.origin}-ში`;
      case "invalid_union":
        return "არასწორი შეყვანა";
      case "invalid_element":
        return `არასწორი მნიშვნელობა ${issue2.origin}-ში`;
      default:
        return `არასწორი შეყვანა`;
    }
  };
};
function ka_default() {
  return {
    localeError: error22()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/km.js
var error23 = () => {
  const Sizable = {
    string: { unit: "តួអក្សរ", verb: "គួរមាន" },
    file: { unit: "បៃ", verb: "គួរមាន" },
    array: { unit: "ធាតុ", verb: "គួរមាន" },
    set: { unit: "ធាតុ", verb: "គួរមាន" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType6 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "មិនមែនជាលេខ (NaN)" : "លេខ";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "អារេ (Array)";
        }
        if (data === null) {
          return "គ្មានតម្លៃ (null)";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "ទិន្នន័យបញ្ចូល",
    email: "អាសយដ្ឋានអ៊ីមែល",
    url: "URL",
    emoji: "សញ្ញាអារម្មណ៍",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "កាលបរិច្ឆេទ និងម៉ោង ISO",
    date: "កាលបរិច្ឆេទ ISO",
    time: "ម៉ោង ISO",
    duration: "រយៈពេល ISO",
    ipv4: "អាសយដ្ឋាន IPv4",
    ipv6: "អាសយដ្ឋាន IPv6",
    cidrv4: "ដែនអាសយដ្ឋាន IPv4",
    cidrv6: "ដែនអាសយដ្ឋាន IPv6",
    base64: "ខ្សែអក្សរអ៊ិកូដ base64",
    base64url: "ខ្សែអក្សរអ៊ិកូដ base64url",
    json_string: "ខ្សែអក្សរ JSON",
    e164: "លេខ E.164",
    jwt: "JWT",
    template_literal: "ទិន្នន័យបញ្ចូល"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ ${issue2.expected} ប៉ុន្តែទទួលបាន ${parsedType6(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `ទិន្នន័យបញ្ចូលមិនត្រឹមត្រូវ៖ ត្រូវការ ${stringifyPrimitive(issue2.values[0])}`;
        return `ជម្រើសមិនត្រឹមត្រូវ៖ ត្រូវជាមួយក្នុងចំណោម ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `ធំពេក៖ ត្រូវការ ${issue2.origin ?? "តម្លៃ"} ${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "ធាតុ"}`;
        return `ធំពេក៖ ត្រូវការ ${issue2.origin ?? "តម្លៃ"} ${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `តូចពេក៖ ត្រូវការ ${issue2.origin} ${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `តូចពេក៖ ត្រូវការ ${issue2.origin} ${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវចាប់ផ្តើមដោយ "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវបញ្ចប់ដោយ "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវមាន "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `ខ្សែអក្សរមិនត្រឹមត្រូវ៖ ត្រូវតែផ្គូផ្គងនឹងទម្រង់ដែលបានកំណត់ ${_issue.pattern}`;
        return `មិនត្រឹមត្រូវ៖ ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `លេខមិនត្រឹមត្រូវ៖ ត្រូវតែជាពហុគុណនៃ ${issue2.divisor}`;
      case "unrecognized_keys":
        return `រកឃើញសោមិនស្គាល់៖ ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `សោមិនត្រឹមត្រូវនៅក្នុង ${issue2.origin}`;
      case "invalid_union":
        return `ទិន្នន័យមិនត្រឹមត្រូវ`;
      case "invalid_element":
        return `ទិន្នន័យមិនត្រឹមត្រូវនៅក្នុង ${issue2.origin}`;
      default:
        return `ទិន្នន័យមិនត្រឹមត្រូវ`;
    }
  };
};
function km_default() {
  return {
    localeError: error23()
  };
}

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/kh.js
function kh_default() {
  return km_default();
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ko.js
var error24 = () => {
  const Sizable = {
    string: { unit: "문자", verb: "to have" },
    file: { unit: "바이트", verb: "to have" },
    array: { unit: "개", verb: "to have" },
    set: { unit: "개", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType6 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "입력",
    email: "이메일 주소",
    url: "URL",
    emoji: "이모지",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO 날짜시간",
    date: "ISO 날짜",
    time: "ISO 시간",
    duration: "ISO 기간",
    ipv4: "IPv4 주소",
    ipv6: "IPv6 주소",
    cidrv4: "IPv4 범위",
    cidrv6: "IPv6 범위",
    base64: "base64 인코딩 문자열",
    base64url: "base64url 인코딩 문자열",
    json_string: "JSON 문자열",
    e164: "E.164 번호",
    jwt: "JWT",
    template_literal: "입력"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `잘못된 입력: 예상 타입은 ${issue2.expected}, 받은 타입은 ${parsedType6(issue2.input)}입니다`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `잘못된 입력: 값은 ${stringifyPrimitive(issue2.values[0])} 이어야 합니다`;
        return `잘못된 옵션: ${joinValues(issue2.values, "또는 ")} 중 하나여야 합니다`;
      case "too_big": {
        const adj = issue2.inclusive ? "이하" : "미만";
        const suffix = adj === "미만" ? "이어야 합니다" : "여야 합니다";
        const sizing = getSizing(issue2.origin);
        const unit = sizing?.unit ?? "요소";
        if (sizing)
          return `${issue2.origin ?? "값"}이 너무 큽니다: ${issue2.maximum.toString()}${unit} ${adj}${suffix}`;
        return `${issue2.origin ?? "값"}이 너무 큽니다: ${issue2.maximum.toString()} ${adj}${suffix}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "이상" : "초과";
        const suffix = adj === "이상" ? "이어야 합니다" : "여야 합니다";
        const sizing = getSizing(issue2.origin);
        const unit = sizing?.unit ?? "요소";
        if (sizing) {
          return `${issue2.origin ?? "값"}이 너무 작습니다: ${issue2.minimum.toString()}${unit} ${adj}${suffix}`;
        }
        return `${issue2.origin ?? "값"}이 너무 작습니다: ${issue2.minimum.toString()} ${adj}${suffix}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `잘못된 문자열: "${_issue.prefix}"(으)로 시작해야 합니다`;
        }
        if (_issue.format === "ends_with")
          return `잘못된 문자열: "${_issue.suffix}"(으)로 끝나야 합니다`;
        if (_issue.format === "includes")
          return `잘못된 문자열: "${_issue.includes}"을(를) 포함해야 합니다`;
        if (_issue.format === "regex")
          return `잘못된 문자열: 정규식 ${_issue.pattern} 패턴과 일치해야 합니다`;
        return `잘못된 ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `잘못된 숫자: ${issue2.divisor}의 배수여야 합니다`;
      case "unrecognized_keys":
        return `인식할 수 없는 키: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `잘못된 키: ${issue2.origin}`;
      case "invalid_union":
        return `잘못된 입력`;
      case "invalid_element":
        return `잘못된 값: ${issue2.origin}`;
      default:
        return `잘못된 입력`;
    }
  };
};
function ko_default() {
  return {
    localeError: error24()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/lt.js
var parsedType6 = (data) => {
  const t = typeof data;
  return parsedTypeFromType(t, data);
};
var parsedTypeFromType = (t, data = undefined) => {
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "skaičius";
    }
    case "bigint": {
      return "sveikasis skaičius";
    }
    case "string": {
      return "eilutė";
    }
    case "boolean": {
      return "loginė reikšmė";
    }
    case "undefined":
    case "void": {
      return "neapibrėžta reikšmė";
    }
    case "function": {
      return "funkcija";
    }
    case "symbol": {
      return "simbolis";
    }
    case "object": {
      if (data === undefined)
        return "nežinomas objektas";
      if (data === null)
        return "nulinė reikšmė";
      if (Array.isArray(data))
        return "masyvas";
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
      return "objektas";
    }
    case "null": {
      return "nulinė reikšmė";
    }
  }
  return t;
};
var capitalizeFirstCharacter = (text) => {
  return text.charAt(0).toUpperCase() + text.slice(1);
};
function getUnitTypeFromNumber(number2) {
  const abs = Math.abs(number2);
  const last = abs % 10;
  const last2 = abs % 100;
  if (last2 >= 11 && last2 <= 19 || last === 0)
    return "many";
  if (last === 1)
    return "one";
  return "few";
}
var error25 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "simbolis",
        few: "simboliai",
        many: "simbolių"
      },
      verb: {
        smaller: {
          inclusive: "turi būti ne ilgesnė kaip",
          notInclusive: "turi būti trumpesnė kaip"
        },
        bigger: {
          inclusive: "turi būti ne trumpesnė kaip",
          notInclusive: "turi būti ilgesnė kaip"
        }
      }
    },
    file: {
      unit: {
        one: "baitas",
        few: "baitai",
        many: "baitų"
      },
      verb: {
        smaller: {
          inclusive: "turi būti ne didesnis kaip",
          notInclusive: "turi būti mažesnis kaip"
        },
        bigger: {
          inclusive: "turi būti ne mažesnis kaip",
          notInclusive: "turi būti didesnis kaip"
        }
      }
    },
    array: {
      unit: {
        one: "elementą",
        few: "elementus",
        many: "elementų"
      },
      verb: {
        smaller: {
          inclusive: "turi turėti ne daugiau kaip",
          notInclusive: "turi turėti mažiau kaip"
        },
        bigger: {
          inclusive: "turi turėti ne mažiau kaip",
          notInclusive: "turi turėti daugiau kaip"
        }
      }
    },
    set: {
      unit: {
        one: "elementą",
        few: "elementus",
        many: "elementų"
      },
      verb: {
        smaller: {
          inclusive: "turi turėti ne daugiau kaip",
          notInclusive: "turi turėti mažiau kaip"
        },
        bigger: {
          inclusive: "turi turėti ne mažiau kaip",
          notInclusive: "turi turėti daugiau kaip"
        }
      }
    }
  };
  function getSizing(origin, unitType, inclusive, targetShouldBe) {
    const result = Sizable[origin] ?? null;
    if (result === null)
      return result;
    return {
      unit: result.unit[unitType],
      verb: result.verb[targetShouldBe][inclusive ? "inclusive" : "notInclusive"]
    };
  }
  const Nouns = {
    regex: "įvestis",
    email: "el. pašto adresas",
    url: "URL",
    emoji: "jaustukas",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO data ir laikas",
    date: "ISO data",
    time: "ISO laikas",
    duration: "ISO trukmė",
    ipv4: "IPv4 adresas",
    ipv6: "IPv6 adresas",
    cidrv4: "IPv4 tinklo prefiksas (CIDR)",
    cidrv6: "IPv6 tinklo prefiksas (CIDR)",
    base64: "base64 užkoduota eilutė",
    base64url: "base64url užkoduota eilutė",
    json_string: "JSON eilutė",
    e164: "E.164 numeris",
    jwt: "JWT",
    template_literal: "įvestis"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Gautas tipas ${parsedType6(issue2.input)}, o tikėtasi - ${parsedTypeFromType(issue2.expected)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Privalo būti ${stringifyPrimitive(issue2.values[0])}`;
        return `Privalo būti vienas iš ${joinValues(issue2.values, "|")} pasirinkimų`;
      case "too_big": {
        const origin = parsedTypeFromType(issue2.origin);
        const sizing = getSizing(issue2.origin, getUnitTypeFromNumber(Number(issue2.maximum)), issue2.inclusive ?? false, "smaller");
        if (sizing?.verb)
          return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} ${sizing.verb} ${issue2.maximum.toString()} ${sizing.unit ?? "elementų"}`;
        const adj = issue2.inclusive ? "ne didesnis kaip" : "mažesnis kaip";
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} turi būti ${adj} ${issue2.maximum.toString()} ${sizing?.unit}`;
      }
      case "too_small": {
        const origin = parsedTypeFromType(issue2.origin);
        const sizing = getSizing(issue2.origin, getUnitTypeFromNumber(Number(issue2.minimum)), issue2.inclusive ?? false, "bigger");
        if (sizing?.verb)
          return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} ${sizing.verb} ${issue2.minimum.toString()} ${sizing.unit ?? "elementų"}`;
        const adj = issue2.inclusive ? "ne mažesnis kaip" : "didesnis kaip";
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} turi būti ${adj} ${issue2.minimum.toString()} ${sizing?.unit}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Eilutė privalo prasidėti "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Eilutė privalo pasibaigti "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Eilutė privalo įtraukti "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Eilutė privalo atitikti ${_issue.pattern}`;
        return `Neteisingas ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Skaičius privalo būti ${issue2.divisor} kartotinis.`;
      case "unrecognized_keys":
        return `Neatpažint${issue2.keys.length > 1 ? "i" : "as"} rakt${issue2.keys.length > 1 ? "ai" : "as"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return "Rastas klaidingas raktas";
      case "invalid_union":
        return "Klaidinga įvestis";
      case "invalid_element": {
        const origin = parsedTypeFromType(issue2.origin);
        return `${capitalizeFirstCharacter(origin ?? issue2.origin ?? "reikšmė")} turi klaidingą įvestį`;
      }
      default:
        return "Klaidinga įvestis";
    }
  };
};
function lt_default() {
  return {
    localeError: error25()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/mk.js
var error26 = () => {
  const Sizable = {
    string: { unit: "знаци", verb: "да имаат" },
    file: { unit: "бајти", verb: "да имаат" },
    array: { unit: "ставки", verb: "да имаат" },
    set: { unit: "ставки", verb: "да имаат" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "број";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "низа";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "внес",
    email: "адреса на е-пошта",
    url: "URL",
    emoji: "емоџи",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO датум и време",
    date: "ISO датум",
    time: "ISO време",
    duration: "ISO времетраење",
    ipv4: "IPv4 адреса",
    ipv6: "IPv6 адреса",
    cidrv4: "IPv4 опсег",
    cidrv6: "IPv6 опсег",
    base64: "base64-енкодирана низа",
    base64url: "base64url-енкодирана низа",
    json_string: "JSON низа",
    e164: "E.164 број",
    jwt: "JWT",
    template_literal: "внес"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Грешен внес: се очекува ${issue2.expected}, примено ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Грешана опција: се очекува една ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Премногу голем: се очекува ${issue2.origin ?? "вредноста"} да има ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "елементи"}`;
        return `Премногу голем: се очекува ${issue2.origin ?? "вредноста"} да биде ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Премногу мал: се очекува ${issue2.origin} да има ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Премногу мал: се очекува ${issue2.origin} да биде ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Неважечка низа: мора да започнува со "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Неважечка низа: мора да завршува со "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Неважечка низа: мора да вклучува "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Неважечка низа: мора да одгоара на патернот ${_issue.pattern}`;
        return `Invalid ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Грешен број: мора да биде делив со ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Непрепознаени клучеви" : "Непрепознаен клуч"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Грешен клуч во ${issue2.origin}`;
      case "invalid_union":
        return "Грешен внес";
      case "invalid_element":
        return `Грешна вредност во ${issue2.origin}`;
      default:
        return `Грешен внес`;
    }
  };
};
function mk_default() {
  return {
    localeError: error26()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ms.js
var error27 = () => {
  const Sizable = {
    string: { unit: "aksara", verb: "mempunyai" },
    file: { unit: "bait", verb: "mempunyai" },
    array: { unit: "elemen", verb: "mempunyai" },
    set: { unit: "elemen", verb: "mempunyai" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "nombor";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "input",
    email: "alamat e-mel",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "tarikh masa ISO",
    date: "tarikh ISO",
    time: "masa ISO",
    duration: "tempoh ISO",
    ipv4: "alamat IPv4",
    ipv6: "alamat IPv6",
    cidrv4: "julat IPv4",
    cidrv6: "julat IPv6",
    base64: "string dikodkan base64",
    base64url: "string dikodkan base64url",
    json_string: "string JSON",
    e164: "nombor E.164",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Input tidak sah: dijangka ${issue2.expected}, diterima ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Input tidak sah: dijangka ${stringifyPrimitive(issue2.values[0])}`;
        return `Pilihan tidak sah: dijangka salah satu daripada ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Terlalu besar: dijangka ${issue2.origin ?? "nilai"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elemen"}`;
        return `Terlalu besar: dijangka ${issue2.origin ?? "nilai"} adalah ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Terlalu kecil: dijangka ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Terlalu kecil: dijangka ${issue2.origin} adalah ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `String tidak sah: mesti bermula dengan "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `String tidak sah: mesti berakhir dengan "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `String tidak sah: mesti mengandungi "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `String tidak sah: mesti sepadan dengan corak ${_issue.pattern}`;
        return `${Nouns[_issue.format] ?? issue2.format} tidak sah`;
      }
      case "not_multiple_of":
        return `Nombor tidak sah: perlu gandaan ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Kunci tidak dikenali: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Kunci tidak sah dalam ${issue2.origin}`;
      case "invalid_union":
        return "Input tidak sah";
      case "invalid_element":
        return `Nilai tidak sah dalam ${issue2.origin}`;
      default:
        return `Input tidak sah`;
    }
  };
};
function ms_default() {
  return {
    localeError: error27()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/nl.js
var error28 = () => {
  const Sizable = {
    string: { unit: "tekens" },
    file: { unit: "bytes" },
    array: { unit: "elementen" },
    set: { unit: "elementen" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "getal";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "invoer",
    email: "emailadres",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datum en tijd",
    date: "ISO datum",
    time: "ISO tijd",
    duration: "ISO duur",
    ipv4: "IPv4-adres",
    ipv6: "IPv6-adres",
    cidrv4: "IPv4-bereik",
    cidrv6: "IPv6-bereik",
    base64: "base64-gecodeerde tekst",
    base64url: "base64 URL-gecodeerde tekst",
    json_string: "JSON string",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "invoer"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Ongeldige invoer: verwacht ${issue2.expected}, ontving ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ongeldige invoer: verwacht ${stringifyPrimitive(issue2.values[0])}`;
        return `Ongeldige optie: verwacht één van ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Te lang: verwacht dat ${issue2.origin ?? "waarde"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementen"} bevat`;
        return `Te lang: verwacht dat ${issue2.origin ?? "waarde"} ${adj}${issue2.maximum.toString()} is`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Te kort: verwacht dat ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} bevat`;
        }
        return `Te kort: verwacht dat ${issue2.origin} ${adj}${issue2.minimum.toString()} is`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Ongeldige tekst: moet met "${_issue.prefix}" beginnen`;
        }
        if (_issue.format === "ends_with")
          return `Ongeldige tekst: moet op "${_issue.suffix}" eindigen`;
        if (_issue.format === "includes")
          return `Ongeldige tekst: moet "${_issue.includes}" bevatten`;
        if (_issue.format === "regex")
          return `Ongeldige tekst: moet overeenkomen met patroon ${_issue.pattern}`;
        return `Ongeldig: ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ongeldig getal: moet een veelvoud van ${issue2.divisor} zijn`;
      case "unrecognized_keys":
        return `Onbekende key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ongeldige key in ${issue2.origin}`;
      case "invalid_union":
        return "Ongeldige invoer";
      case "invalid_element":
        return `Ongeldige waarde in ${issue2.origin}`;
      default:
        return `Ongeldige invoer`;
    }
  };
};
function nl_default() {
  return {
    localeError: error28()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/no.js
var error29 = () => {
  const Sizable = {
    string: { unit: "tegn", verb: "å ha" },
    file: { unit: "bytes", verb: "å ha" },
    array: { unit: "elementer", verb: "å inneholde" },
    set: { unit: "elementer", verb: "å inneholde" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "tall";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "liste";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "input",
    email: "e-postadresse",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO dato- og klokkeslett",
    date: "ISO-dato",
    time: "ISO-klokkeslett",
    duration: "ISO-varighet",
    ipv4: "IPv4-område",
    ipv6: "IPv6-område",
    cidrv4: "IPv4-spekter",
    cidrv6: "IPv6-spekter",
    base64: "base64-enkodet streng",
    base64url: "base64url-enkodet streng",
    json_string: "JSON-streng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Ugyldig input: forventet ${issue2.expected}, fikk ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ugyldig verdi: forventet ${stringifyPrimitive(issue2.values[0])}`;
        return `Ugyldig valg: forventet en av ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `For stor(t): forventet ${issue2.origin ?? "value"} til å ha ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementer"}`;
        return `For stor(t): forventet ${issue2.origin ?? "value"} til å ha ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `For lite(n): forventet ${issue2.origin} til å ha ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `For lite(n): forventet ${issue2.origin} til å ha ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ugyldig streng: må starte med "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Ugyldig streng: må ende med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ugyldig streng: må inneholde "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ugyldig streng: må matche mønsteret ${_issue.pattern}`;
        return `Ugyldig ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ugyldig tall: må være et multiplum av ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Ukjente nøkler" : "Ukjent nøkkel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ugyldig nøkkel i ${issue2.origin}`;
      case "invalid_union":
        return "Ugyldig input";
      case "invalid_element":
        return `Ugyldig verdi i ${issue2.origin}`;
      default:
        return `Ugyldig input`;
    }
  };
};
function no_default() {
  return {
    localeError: error29()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ota.js
var error30 = () => {
  const Sizable = {
    string: { unit: "harf", verb: "olmalıdır" },
    file: { unit: "bayt", verb: "olmalıdır" },
    array: { unit: "unsur", verb: "olmalıdır" },
    set: { unit: "unsur", verb: "olmalıdır" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "numara";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "saf";
        }
        if (data === null) {
          return "gayb";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "giren",
    email: "epostagâh",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO hengâmı",
    date: "ISO tarihi",
    time: "ISO zamanı",
    duration: "ISO müddeti",
    ipv4: "IPv4 nişânı",
    ipv6: "IPv6 nişânı",
    cidrv4: "IPv4 menzili",
    cidrv6: "IPv6 menzili",
    base64: "base64-şifreli metin",
    base64url: "base64url-şifreli metin",
    json_string: "JSON metin",
    e164: "E.164 sayısı",
    jwt: "JWT",
    template_literal: "giren"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Fâsit giren: umulan ${issue2.expected}, alınan ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Fâsit giren: umulan ${stringifyPrimitive(issue2.values[0])}`;
        return `Fâsit tercih: mûteberler ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Fazla büyük: ${issue2.origin ?? "value"}, ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"} sahip olmalıydı.`;
        return `Fazla büyük: ${issue2.origin ?? "value"}, ${adj}${issue2.maximum.toString()} olmalıydı.`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Fazla küçük: ${issue2.origin}, ${adj}${issue2.minimum.toString()} ${sizing.unit} sahip olmalıydı.`;
        }
        return `Fazla küçük: ${issue2.origin}, ${adj}${issue2.minimum.toString()} olmalıydı.`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Fâsit metin: "${_issue.prefix}" ile başlamalı.`;
        if (_issue.format === "ends_with")
          return `Fâsit metin: "${_issue.suffix}" ile bitmeli.`;
        if (_issue.format === "includes")
          return `Fâsit metin: "${_issue.includes}" ihtivâ etmeli.`;
        if (_issue.format === "regex")
          return `Fâsit metin: ${_issue.pattern} nakşına uymalı.`;
        return `Fâsit ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Fâsit sayı: ${issue2.divisor} katı olmalıydı.`;
      case "unrecognized_keys":
        return `Tanınmayan anahtar ${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} için tanınmayan anahtar var.`;
      case "invalid_union":
        return "Giren tanınamadı.";
      case "invalid_element":
        return `${issue2.origin} için tanınmayan kıymet var.`;
      default:
        return `Kıymet tanınamadı.`;
    }
  };
};
function ota_default() {
  return {
    localeError: error30()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ps.js
var error31 = () => {
  const Sizable = {
    string: { unit: "توکي", verb: "ولري" },
    file: { unit: "بایټس", verb: "ولري" },
    array: { unit: "توکي", verb: "ولري" },
    set: { unit: "توکي", verb: "ولري" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "عدد";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "ارې";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "ورودي",
    email: "بریښنالیک",
    url: "یو آر ال",
    emoji: "ایموجي",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "نیټه او وخت",
    date: "نېټه",
    time: "وخت",
    duration: "موده",
    ipv4: "د IPv4 پته",
    ipv6: "د IPv6 پته",
    cidrv4: "د IPv4 ساحه",
    cidrv6: "د IPv6 ساحه",
    base64: "base64-encoded متن",
    base64url: "base64url-encoded متن",
    json_string: "JSON متن",
    e164: "د E.164 شمېره",
    jwt: "JWT",
    template_literal: "ورودي"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `ناسم ورودي: باید ${issue2.expected} وای, مګر ${parsedType7(issue2.input)} ترلاسه شو`;
      case "invalid_value":
        if (issue2.values.length === 1) {
          return `ناسم ورودي: باید ${stringifyPrimitive(issue2.values[0])} وای`;
        }
        return `ناسم انتخاب: باید یو له ${joinValues(issue2.values, "|")} څخه وای`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `ډیر لوی: ${issue2.origin ?? "ارزښت"} باید ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "عنصرونه"} ولري`;
        }
        return `ډیر لوی: ${issue2.origin ?? "ارزښت"} باید ${adj}${issue2.maximum.toString()} وي`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `ډیر کوچنی: ${issue2.origin} باید ${adj}${issue2.minimum.toString()} ${sizing.unit} ولري`;
        }
        return `ډیر کوچنی: ${issue2.origin} باید ${adj}${issue2.minimum.toString()} وي`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `ناسم متن: باید د "${_issue.prefix}" سره پیل شي`;
        }
        if (_issue.format === "ends_with") {
          return `ناسم متن: باید د "${_issue.suffix}" سره پای ته ورسيږي`;
        }
        if (_issue.format === "includes") {
          return `ناسم متن: باید "${_issue.includes}" ولري`;
        }
        if (_issue.format === "regex") {
          return `ناسم متن: باید د ${_issue.pattern} سره مطابقت ولري`;
        }
        return `${Nouns[_issue.format] ?? issue2.format} ناسم دی`;
      }
      case "not_multiple_of":
        return `ناسم عدد: باید د ${issue2.divisor} مضرب وي`;
      case "unrecognized_keys":
        return `ناسم ${issue2.keys.length > 1 ? "کلیډونه" : "کلیډ"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `ناسم کلیډ په ${issue2.origin} کې`;
      case "invalid_union":
        return `ناسمه ورودي`;
      case "invalid_element":
        return `ناسم عنصر په ${issue2.origin} کې`;
      default:
        return `ناسمه ورودي`;
    }
  };
};
function ps_default() {
  return {
    localeError: error31()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/pl.js
var error32 = () => {
  const Sizable = {
    string: { unit: "znaków", verb: "mieć" },
    file: { unit: "bajtów", verb: "mieć" },
    array: { unit: "elementów", verb: "mieć" },
    set: { unit: "elementów", verb: "mieć" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "liczba";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "tablica";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "wyrażenie",
    email: "adres email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data i godzina w formacie ISO",
    date: "data w formacie ISO",
    time: "godzina w formacie ISO",
    duration: "czas trwania ISO",
    ipv4: "adres IPv4",
    ipv6: "adres IPv6",
    cidrv4: "zakres IPv4",
    cidrv6: "zakres IPv6",
    base64: "ciąg znaków zakodowany w formacie base64",
    base64url: "ciąg znaków zakodowany w formacie base64url",
    json_string: "ciąg znaków w formacie JSON",
    e164: "liczba E.164",
    jwt: "JWT",
    template_literal: "wejście"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Nieprawidłowe dane wejściowe: oczekiwano ${issue2.expected}, otrzymano ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Nieprawidłowe dane wejściowe: oczekiwano ${stringifyPrimitive(issue2.values[0])}`;
        return `Nieprawidłowa opcja: oczekiwano jednej z wartości ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Za duża wartość: oczekiwano, że ${issue2.origin ?? "wartość"} będzie mieć ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementów"}`;
        }
        return `Zbyt duż(y/a/e): oczekiwano, że ${issue2.origin ?? "wartość"} będzie wynosić ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Za mała wartość: oczekiwano, że ${issue2.origin ?? "wartość"} będzie mieć ${adj}${issue2.minimum.toString()} ${sizing.unit ?? "elementów"}`;
        }
        return `Zbyt mał(y/a/e): oczekiwano, że ${issue2.origin ?? "wartość"} będzie wynosić ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Nieprawidłowy ciąg znaków: musi zaczynać się od "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Nieprawidłowy ciąg znaków: musi kończyć się na "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Nieprawidłowy ciąg znaków: musi zawierać "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Nieprawidłowy ciąg znaków: musi odpowiadać wzorcowi ${_issue.pattern}`;
        return `Nieprawidłow(y/a/e) ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Nieprawidłowa liczba: musi być wielokrotnością ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Nierozpoznane klucze${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Nieprawidłowy klucz w ${issue2.origin}`;
      case "invalid_union":
        return "Nieprawidłowe dane wejściowe";
      case "invalid_element":
        return `Nieprawidłowa wartość w ${issue2.origin}`;
      default:
        return `Nieprawidłowe dane wejściowe`;
    }
  };
};
function pl_default() {
  return {
    localeError: error32()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/pt.js
var error33 = () => {
  const Sizable = {
    string: { unit: "caracteres", verb: "ter" },
    file: { unit: "bytes", verb: "ter" },
    array: { unit: "itens", verb: "ter" },
    set: { unit: "itens", verb: "ter" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "número";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "nulo";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "padrão",
    email: "endereço de e-mail",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "data e hora ISO",
    date: "data ISO",
    time: "hora ISO",
    duration: "duração ISO",
    ipv4: "endereço IPv4",
    ipv6: "endereço IPv6",
    cidrv4: "faixa de IPv4",
    cidrv6: "faixa de IPv6",
    base64: "texto codificado em base64",
    base64url: "URL codificada em base64",
    json_string: "texto JSON",
    e164: "número E.164",
    jwt: "JWT",
    template_literal: "entrada"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Tipo inválido: esperado ${issue2.expected}, recebido ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Entrada inválida: esperado ${stringifyPrimitive(issue2.values[0])}`;
        return `Opção inválida: esperada uma das ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Muito grande: esperado que ${issue2.origin ?? "valor"} tivesse ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementos"}`;
        return `Muito grande: esperado que ${issue2.origin ?? "valor"} fosse ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Muito pequeno: esperado que ${issue2.origin} tivesse ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Muito pequeno: esperado que ${issue2.origin} fosse ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Texto inválido: deve começar com "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Texto inválido: deve terminar com "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Texto inválido: deve incluir "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Texto inválido: deve corresponder ao padrão ${_issue.pattern}`;
        return `${Nouns[_issue.format] ?? issue2.format} inválido`;
      }
      case "not_multiple_of":
        return `Número inválido: deve ser múltiplo de ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Chave${issue2.keys.length > 1 ? "s" : ""} desconhecida${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Chave inválida em ${issue2.origin}`;
      case "invalid_union":
        return "Entrada inválida";
      case "invalid_element":
        return `Valor inválido em ${issue2.origin}`;
      default:
        return `Campo inválido`;
    }
  };
};
function pt_default() {
  return {
    localeError: error33()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ru.js
function getRussianPlural(count, one, few, many) {
  const absCount = Math.abs(count);
  const lastDigit = absCount % 10;
  const lastTwoDigits = absCount % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
    return many;
  }
  if (lastDigit === 1) {
    return one;
  }
  if (lastDigit >= 2 && lastDigit <= 4) {
    return few;
  }
  return many;
}
var error34 = () => {
  const Sizable = {
    string: {
      unit: {
        one: "символ",
        few: "символа",
        many: "символов"
      },
      verb: "иметь"
    },
    file: {
      unit: {
        one: "байт",
        few: "байта",
        many: "байт"
      },
      verb: "иметь"
    },
    array: {
      unit: {
        one: "элемент",
        few: "элемента",
        many: "элементов"
      },
      verb: "иметь"
    },
    set: {
      unit: {
        one: "элемент",
        few: "элемента",
        many: "элементов"
      },
      verb: "иметь"
    }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "число";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "массив";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "ввод",
    email: "email адрес",
    url: "URL",
    emoji: "эмодзи",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO дата и время",
    date: "ISO дата",
    time: "ISO время",
    duration: "ISO длительность",
    ipv4: "IPv4 адрес",
    ipv6: "IPv6 адрес",
    cidrv4: "IPv4 диапазон",
    cidrv6: "IPv6 диапазон",
    base64: "строка в формате base64",
    base64url: "строка в формате base64url",
    json_string: "JSON строка",
    e164: "номер E.164",
    jwt: "JWT",
    template_literal: "ввод"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Неверный ввод: ожидалось ${issue2.expected}, получено ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Неверный ввод: ожидалось ${stringifyPrimitive(issue2.values[0])}`;
        return `Неверный вариант: ожидалось одно из ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const maxValue = Number(issue2.maximum);
          const unit = getRussianPlural(maxValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `Слишком большое значение: ожидалось, что ${issue2.origin ?? "значение"} будет иметь ${adj}${issue2.maximum.toString()} ${unit}`;
        }
        return `Слишком большое значение: ожидалось, что ${issue2.origin ?? "значение"} будет ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          const minValue = Number(issue2.minimum);
          const unit = getRussianPlural(minValue, sizing.unit.one, sizing.unit.few, sizing.unit.many);
          return `Слишком маленькое значение: ожидалось, что ${issue2.origin} будет иметь ${adj}${issue2.minimum.toString()} ${unit}`;
        }
        return `Слишком маленькое значение: ожидалось, что ${issue2.origin} будет ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Неверная строка: должна начинаться с "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Неверная строка: должна заканчиваться на "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Неверная строка: должна содержать "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Неверная строка: должна соответствовать шаблону ${_issue.pattern}`;
        return `Неверный ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Неверное число: должно быть кратным ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Нераспознанн${issue2.keys.length > 1 ? "ые" : "ый"} ключ${issue2.keys.length > 1 ? "и" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Неверный ключ в ${issue2.origin}`;
      case "invalid_union":
        return "Неверные входные данные";
      case "invalid_element":
        return `Неверное значение в ${issue2.origin}`;
      default:
        return `Неверные входные данные`;
    }
  };
};
function ru_default() {
  return {
    localeError: error34()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/sl.js
var error35 = () => {
  const Sizable = {
    string: { unit: "znakov", verb: "imeti" },
    file: { unit: "bajtov", verb: "imeti" },
    array: { unit: "elementov", verb: "imeti" },
    set: { unit: "elementov", verb: "imeti" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "število";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "tabela";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "vnos",
    email: "e-poštni naslov",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datum in čas",
    date: "ISO datum",
    time: "ISO čas",
    duration: "ISO trajanje",
    ipv4: "IPv4 naslov",
    ipv6: "IPv6 naslov",
    cidrv4: "obseg IPv4",
    cidrv6: "obseg IPv6",
    base64: "base64 kodiran niz",
    base64url: "base64url kodiran niz",
    json_string: "JSON niz",
    e164: "E.164 številka",
    jwt: "JWT",
    template_literal: "vnos"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Neveljaven vnos: pričakovano ${issue2.expected}, prejeto ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Neveljaven vnos: pričakovano ${stringifyPrimitive(issue2.values[0])}`;
        return `Neveljavna možnost: pričakovano eno izmed ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Preveliko: pričakovano, da bo ${issue2.origin ?? "vrednost"} imelo ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elementov"}`;
        return `Preveliko: pričakovano, da bo ${issue2.origin ?? "vrednost"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Premajhno: pričakovano, da bo ${issue2.origin} imelo ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Premajhno: pričakovano, da bo ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Neveljaven niz: mora se začeti z "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Neveljaven niz: mora se končati z "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Neveljaven niz: mora vsebovati "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Neveljaven niz: mora ustrezati vzorcu ${_issue.pattern}`;
        return `Neveljaven ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Neveljavno število: mora biti večkratnik ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Neprepoznan${issue2.keys.length > 1 ? "i ključi" : " ključ"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Neveljaven ključ v ${issue2.origin}`;
      case "invalid_union":
        return "Neveljaven vnos";
      case "invalid_element":
        return `Neveljavna vrednost v ${issue2.origin}`;
      default:
        return "Neveljaven vnos";
    }
  };
};
function sl_default() {
  return {
    localeError: error35()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/sv.js
var error36 = () => {
  const Sizable = {
    string: { unit: "tecken", verb: "att ha" },
    file: { unit: "bytes", verb: "att ha" },
    array: { unit: "objekt", verb: "att innehålla" },
    set: { unit: "objekt", verb: "att innehålla" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "antal";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "lista";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "reguljärt uttryck",
    email: "e-postadress",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO-datum och tid",
    date: "ISO-datum",
    time: "ISO-tid",
    duration: "ISO-varaktighet",
    ipv4: "IPv4-intervall",
    ipv6: "IPv6-intervall",
    cidrv4: "IPv4-spektrum",
    cidrv6: "IPv6-spektrum",
    base64: "base64-kodad sträng",
    base64url: "base64url-kodad sträng",
    json_string: "JSON-sträng",
    e164: "E.164-nummer",
    jwt: "JWT",
    template_literal: "mall-literal"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Ogiltig inmatning: förväntat ${issue2.expected}, fick ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ogiltig inmatning: förväntat ${stringifyPrimitive(issue2.values[0])}`;
        return `Ogiltigt val: förväntade en av ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `För stor(t): förväntade ${issue2.origin ?? "värdet"} att ha ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "element"}`;
        }
        return `För stor(t): förväntat ${issue2.origin ?? "värdet"} att ha ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `För lite(t): förväntade ${issue2.origin ?? "värdet"} att ha ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `För lite(t): förväntade ${issue2.origin ?? "värdet"} att ha ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Ogiltig sträng: måste börja med "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Ogiltig sträng: måste sluta med "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ogiltig sträng: måste innehålla "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ogiltig sträng: måste matcha mönstret "${_issue.pattern}"`;
        return `Ogiltig(t) ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Ogiltigt tal: måste vara en multipel av ${issue2.divisor}`;
      case "unrecognized_keys":
        return `${issue2.keys.length > 1 ? "Okända nycklar" : "Okänd nyckel"}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Ogiltig nyckel i ${issue2.origin ?? "värdet"}`;
      case "invalid_union":
        return "Ogiltig input";
      case "invalid_element":
        return `Ogiltigt värde i ${issue2.origin ?? "värdet"}`;
      default:
        return `Ogiltig input`;
    }
  };
};
function sv_default() {
  return {
    localeError: error36()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ta.js
var error37 = () => {
  const Sizable = {
    string: { unit: "எழுத்துக்கள்", verb: "கொண்டிருக்க வேண்டும்" },
    file: { unit: "பைட்டுகள்", verb: "கொண்டிருக்க வேண்டும்" },
    array: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" },
    set: { unit: "உறுப்புகள்", verb: "கொண்டிருக்க வேண்டும்" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "எண் அல்லாதது" : "எண்";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "அணி";
        }
        if (data === null) {
          return "வெறுமை";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "உள்ளீடு",
    email: "மின்னஞ்சல் முகவரி",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO தேதி நேரம்",
    date: "ISO தேதி",
    time: "ISO நேரம்",
    duration: "ISO கால அளவு",
    ipv4: "IPv4 முகவரி",
    ipv6: "IPv6 முகவரி",
    cidrv4: "IPv4 வரம்பு",
    cidrv6: "IPv6 வரம்பு",
    base64: "base64-encoded சரம்",
    base64url: "base64url-encoded சரம்",
    json_string: "JSON சரம்",
    e164: "E.164 எண்",
    jwt: "JWT",
    template_literal: "input"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது ${issue2.expected}, பெறப்பட்டது ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `தவறான உள்ளீடு: எதிர்பார்க்கப்பட்டது ${stringifyPrimitive(issue2.values[0])}`;
        return `தவறான விருப்பம்: எதிர்பார்க்கப்பட்டது ${joinValues(issue2.values, "|")} இல் ஒன்று`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `மிக பெரியது: எதிர்பார்க்கப்பட்டது ${issue2.origin ?? "மதிப்பு"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "உறுப்புகள்"} ஆக இருக்க வேண்டும்`;
        }
        return `மிக பெரியது: எதிர்பார்க்கப்பட்டது ${issue2.origin ?? "மதிப்பு"} ${adj}${issue2.maximum.toString()} ஆக இருக்க வேண்டும்`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `மிகச் சிறியது: எதிர்பார்க்கப்பட்டது ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit} ஆக இருக்க வேண்டும்`;
        }
        return `மிகச் சிறியது: எதிர்பார்க்கப்பட்டது ${issue2.origin} ${adj}${issue2.minimum.toString()} ஆக இருக்க வேண்டும்`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `தவறான சரம்: "${_issue.prefix}" இல் தொடங்க வேண்டும்`;
        if (_issue.format === "ends_with")
          return `தவறான சரம்: "${_issue.suffix}" இல் முடிவடைய வேண்டும்`;
        if (_issue.format === "includes")
          return `தவறான சரம்: "${_issue.includes}" ஐ உள்ளடக்க வேண்டும்`;
        if (_issue.format === "regex")
          return `தவறான சரம்: ${_issue.pattern} முறைபாட்டுடன் பொருந்த வேண்டும்`;
        return `தவறான ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `தவறான எண்: ${issue2.divisor} இன் பலமாக இருக்க வேண்டும்`;
      case "unrecognized_keys":
        return `அடையாளம் தெரியாத விசை${issue2.keys.length > 1 ? "கள்" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} இல் தவறான விசை`;
      case "invalid_union":
        return "தவறான உள்ளீடு";
      case "invalid_element":
        return `${issue2.origin} இல் தவறான மதிப்பு`;
      default:
        return `தவறான உள்ளீடு`;
    }
  };
};
function ta_default() {
  return {
    localeError: error37()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/th.js
var error38 = () => {
  const Sizable = {
    string: { unit: "ตัวอักษร", verb: "ควรมี" },
    file: { unit: "ไบต์", verb: "ควรมี" },
    array: { unit: "รายการ", verb: "ควรมี" },
    set: { unit: "รายการ", verb: "ควรมี" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType7 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "ไม่ใช่ตัวเลข (NaN)" : "ตัวเลข";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "อาร์เรย์ (Array)";
        }
        if (data === null) {
          return "ไม่มีค่า (null)";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "ข้อมูลที่ป้อน",
    email: "ที่อยู่อีเมล",
    url: "URL",
    emoji: "อิโมจิ",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "วันที่เวลาแบบ ISO",
    date: "วันที่แบบ ISO",
    time: "เวลาแบบ ISO",
    duration: "ช่วงเวลาแบบ ISO",
    ipv4: "ที่อยู่ IPv4",
    ipv6: "ที่อยู่ IPv6",
    cidrv4: "ช่วง IP แบบ IPv4",
    cidrv6: "ช่วง IP แบบ IPv6",
    base64: "ข้อความแบบ Base64",
    base64url: "ข้อความแบบ Base64 สำหรับ URL",
    json_string: "ข้อความแบบ JSON",
    e164: "เบอร์โทรศัพท์ระหว่างประเทศ (E.164)",
    jwt: "โทเคน JWT",
    template_literal: "ข้อมูลที่ป้อน"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `ประเภทข้อมูลไม่ถูกต้อง: ควรเป็น ${issue2.expected} แต่ได้รับ ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `ค่าไม่ถูกต้อง: ควรเป็น ${stringifyPrimitive(issue2.values[0])}`;
        return `ตัวเลือกไม่ถูกต้อง: ควรเป็นหนึ่งใน ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "ไม่เกิน" : "น้อยกว่า";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `เกินกำหนด: ${issue2.origin ?? "ค่า"} ควรมี${adj} ${issue2.maximum.toString()} ${sizing.unit ?? "รายการ"}`;
        return `เกินกำหนด: ${issue2.origin ?? "ค่า"} ควรมี${adj} ${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? "อย่างน้อย" : "มากกว่า";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `น้อยกว่ากำหนด: ${issue2.origin} ควรมี${adj} ${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `น้อยกว่ากำหนด: ${issue2.origin} ควรมี${adj} ${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `รูปแบบไม่ถูกต้อง: ข้อความต้องขึ้นต้นด้วย "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `รูปแบบไม่ถูกต้อง: ข้อความต้องลงท้ายด้วย "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `รูปแบบไม่ถูกต้อง: ข้อความต้องมี "${_issue.includes}" อยู่ในข้อความ`;
        if (_issue.format === "regex")
          return `รูปแบบไม่ถูกต้อง: ต้องตรงกับรูปแบบที่กำหนด ${_issue.pattern}`;
        return `รูปแบบไม่ถูกต้อง: ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `ตัวเลขไม่ถูกต้อง: ต้องเป็นจำนวนที่หารด้วย ${issue2.divisor} ได้ลงตัว`;
      case "unrecognized_keys":
        return `พบคีย์ที่ไม่รู้จัก: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `คีย์ไม่ถูกต้องใน ${issue2.origin}`;
      case "invalid_union":
        return "ข้อมูลไม่ถูกต้อง: ไม่ตรงกับรูปแบบยูเนียนที่กำหนดไว้";
      case "invalid_element":
        return `ข้อมูลไม่ถูกต้องใน ${issue2.origin}`;
      default:
        return `ข้อมูลไม่ถูกต้อง`;
    }
  };
};
function th_default() {
  return {
    localeError: error38()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/tr.js
var parsedType7 = (data) => {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "NaN" : "number";
    }
    case "object": {
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
        return data.constructor.name;
      }
    }
  }
  return t;
};
var error39 = () => {
  const Sizable = {
    string: { unit: "karakter", verb: "olmalı" },
    file: { unit: "bayt", verb: "olmalı" },
    array: { unit: "öğe", verb: "olmalı" },
    set: { unit: "öğe", verb: "olmalı" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const Nouns = {
    regex: "girdi",
    email: "e-posta adresi",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO tarih ve saat",
    date: "ISO tarih",
    time: "ISO saat",
    duration: "ISO süre",
    ipv4: "IPv4 adresi",
    ipv6: "IPv6 adresi",
    cidrv4: "IPv4 aralığı",
    cidrv6: "IPv6 aralığı",
    base64: "base64 ile şifrelenmiş metin",
    base64url: "base64url ile şifrelenmiş metin",
    json_string: "JSON dizesi",
    e164: "E.164 sayısı",
    jwt: "JWT",
    template_literal: "Şablon dizesi"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Geçersiz değer: beklenen ${issue2.expected}, alınan ${parsedType7(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Geçersiz değer: beklenen ${stringifyPrimitive(issue2.values[0])}`;
        return `Geçersiz seçenek: aşağıdakilerden biri olmalı: ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Çok büyük: beklenen ${issue2.origin ?? "değer"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "öğe"}`;
        return `Çok büyük: beklenen ${issue2.origin ?? "değer"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Çok küçük: beklenen ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        return `Çok küçük: beklenen ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Geçersiz metin: "${_issue.prefix}" ile başlamalı`;
        if (_issue.format === "ends_with")
          return `Geçersiz metin: "${_issue.suffix}" ile bitmeli`;
        if (_issue.format === "includes")
          return `Geçersiz metin: "${_issue.includes}" içermeli`;
        if (_issue.format === "regex")
          return `Geçersiz metin: ${_issue.pattern} desenine uymalı`;
        return `Geçersiz ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Geçersiz sayı: ${issue2.divisor} ile tam bölünebilmeli`;
      case "unrecognized_keys":
        return `Tanınmayan anahtar${issue2.keys.length > 1 ? "lar" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} içinde geçersiz anahtar`;
      case "invalid_union":
        return "Geçersiz değer";
      case "invalid_element":
        return `${issue2.origin} içinde geçersiz değer`;
      default:
        return `Geçersiz değer`;
    }
  };
};
function tr_default() {
  return {
    localeError: error39()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/uk.js
var error40 = () => {
  const Sizable = {
    string: { unit: "символів", verb: "матиме" },
    file: { unit: "байтів", verb: "матиме" },
    array: { unit: "елементів", verb: "матиме" },
    set: { unit: "елементів", verb: "матиме" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType8 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "число";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "масив";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "вхідні дані",
    email: "адреса електронної пошти",
    url: "URL",
    emoji: "емодзі",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "дата та час ISO",
    date: "дата ISO",
    time: "час ISO",
    duration: "тривалість ISO",
    ipv4: "адреса IPv4",
    ipv6: "адреса IPv6",
    cidrv4: "діапазон IPv4",
    cidrv6: "діапазон IPv6",
    base64: "рядок у кодуванні base64",
    base64url: "рядок у кодуванні base64url",
    json_string: "рядок JSON",
    e164: "номер E.164",
    jwt: "JWT",
    template_literal: "вхідні дані"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Неправильні вхідні дані: очікується ${issue2.expected}, отримано ${parsedType8(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Неправильні вхідні дані: очікується ${stringifyPrimitive(issue2.values[0])}`;
        return `Неправильна опція: очікується одне з ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Занадто велике: очікується, що ${issue2.origin ?? "значення"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "елементів"}`;
        return `Занадто велике: очікується, що ${issue2.origin ?? "значення"} буде ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Занадто мале: очікується, що ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Занадто мале: очікується, що ${issue2.origin} буде ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Неправильний рядок: повинен починатися з "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Неправильний рядок: повинен закінчуватися на "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Неправильний рядок: повинен містити "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Неправильний рядок: повинен відповідати шаблону ${_issue.pattern}`;
        return `Неправильний ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Неправильне число: повинно бути кратним ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Нерозпізнаний ключ${issue2.keys.length > 1 ? "і" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Неправильний ключ у ${issue2.origin}`;
      case "invalid_union":
        return "Неправильні вхідні дані";
      case "invalid_element":
        return `Неправильне значення у ${issue2.origin}`;
      default:
        return `Неправильні вхідні дані`;
    }
  };
};
function uk_default() {
  return {
    localeError: error40()
  };
}

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ua.js
function ua_default() {
  return uk_default();
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/ur.js
var error41 = () => {
  const Sizable = {
    string: { unit: "حروف", verb: "ہونا" },
    file: { unit: "بائٹس", verb: "ہونا" },
    array: { unit: "آئٹمز", verb: "ہونا" },
    set: { unit: "آئٹمز", verb: "ہونا" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType8 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "نمبر";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "آرے";
        }
        if (data === null) {
          return "نل";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "ان پٹ",
    email: "ای میل ایڈریس",
    url: "یو آر ایل",
    emoji: "ایموجی",
    uuid: "یو یو آئی ڈی",
    uuidv4: "یو یو آئی ڈی وی 4",
    uuidv6: "یو یو آئی ڈی وی 6",
    nanoid: "نینو آئی ڈی",
    guid: "جی یو آئی ڈی",
    cuid: "سی یو آئی ڈی",
    cuid2: "سی یو آئی ڈی 2",
    ulid: "یو ایل آئی ڈی",
    xid: "ایکس آئی ڈی",
    ksuid: "کے ایس یو آئی ڈی",
    datetime: "آئی ایس او ڈیٹ ٹائم",
    date: "آئی ایس او تاریخ",
    time: "آئی ایس او وقت",
    duration: "آئی ایس او مدت",
    ipv4: "آئی پی وی 4 ایڈریس",
    ipv6: "آئی پی وی 6 ایڈریس",
    cidrv4: "آئی پی وی 4 رینج",
    cidrv6: "آئی پی وی 6 رینج",
    base64: "بیس 64 ان کوڈڈ سٹرنگ",
    base64url: "بیس 64 یو آر ایل ان کوڈڈ سٹرنگ",
    json_string: "جے ایس او این سٹرنگ",
    e164: "ای 164 نمبر",
    jwt: "جے ڈبلیو ٹی",
    template_literal: "ان پٹ"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `غلط ان پٹ: ${issue2.expected} متوقع تھا، ${parsedType8(issue2.input)} موصول ہوا`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `غلط ان پٹ: ${stringifyPrimitive(issue2.values[0])} متوقع تھا`;
        return `غلط آپشن: ${joinValues(issue2.values, "|")} میں سے ایک متوقع تھا`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `بہت بڑا: ${issue2.origin ?? "ویلیو"} کے ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "عناصر"} ہونے متوقع تھے`;
        return `بہت بڑا: ${issue2.origin ?? "ویلیو"} کا ${adj}${issue2.maximum.toString()} ہونا متوقع تھا`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `بہت چھوٹا: ${issue2.origin} کے ${adj}${issue2.minimum.toString()} ${sizing.unit} ہونے متوقع تھے`;
        }
        return `بہت چھوٹا: ${issue2.origin} کا ${adj}${issue2.minimum.toString()} ہونا متوقع تھا`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `غلط سٹرنگ: "${_issue.prefix}" سے شروع ہونا چاہیے`;
        }
        if (_issue.format === "ends_with")
          return `غلط سٹرنگ: "${_issue.suffix}" پر ختم ہونا چاہیے`;
        if (_issue.format === "includes")
          return `غلط سٹرنگ: "${_issue.includes}" شامل ہونا چاہیے`;
        if (_issue.format === "regex")
          return `غلط سٹرنگ: پیٹرن ${_issue.pattern} سے میچ ہونا چاہیے`;
        return `غلط ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `غلط نمبر: ${issue2.divisor} کا مضاعف ہونا چاہیے`;
      case "unrecognized_keys":
        return `غیر تسلیم شدہ کی${issue2.keys.length > 1 ? "ز" : ""}: ${joinValues(issue2.keys, "، ")}`;
      case "invalid_key":
        return `${issue2.origin} میں غلط کی`;
      case "invalid_union":
        return "غلط ان پٹ";
      case "invalid_element":
        return `${issue2.origin} میں غلط ویلیو`;
      default:
        return `غلط ان پٹ`;
    }
  };
};
function ur_default() {
  return {
    localeError: error41()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/vi.js
var error42 = () => {
  const Sizable = {
    string: { unit: "ký tự", verb: "có" },
    file: { unit: "byte", verb: "có" },
    array: { unit: "phần tử", verb: "có" },
    set: { unit: "phần tử", verb: "có" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType8 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "số";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "mảng";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "đầu vào",
    email: "địa chỉ email",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ngày giờ ISO",
    date: "ngày ISO",
    time: "giờ ISO",
    duration: "khoảng thời gian ISO",
    ipv4: "địa chỉ IPv4",
    ipv6: "địa chỉ IPv6",
    cidrv4: "dải IPv4",
    cidrv6: "dải IPv6",
    base64: "chuỗi mã hóa base64",
    base64url: "chuỗi mã hóa base64url",
    json_string: "chuỗi JSON",
    e164: "số E.164",
    jwt: "JWT",
    template_literal: "đầu vào"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Đầu vào không hợp lệ: mong đợi ${issue2.expected}, nhận được ${parsedType8(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Đầu vào không hợp lệ: mong đợi ${stringifyPrimitive(issue2.values[0])}`;
        return `Tùy chọn không hợp lệ: mong đợi một trong các giá trị ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Quá lớn: mong đợi ${issue2.origin ?? "giá trị"} ${sizing.verb} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "phần tử"}`;
        return `Quá lớn: mong đợi ${issue2.origin ?? "giá trị"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Quá nhỏ: mong đợi ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Quá nhỏ: mong đợi ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Chuỗi không hợp lệ: phải bắt đầu bằng "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Chuỗi không hợp lệ: phải kết thúc bằng "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Chuỗi không hợp lệ: phải bao gồm "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Chuỗi không hợp lệ: phải khớp với mẫu ${_issue.pattern}`;
        return `${Nouns[_issue.format] ?? issue2.format} không hợp lệ`;
      }
      case "not_multiple_of":
        return `Số không hợp lệ: phải là bội số của ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Khóa không được nhận dạng: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Khóa không hợp lệ trong ${issue2.origin}`;
      case "invalid_union":
        return "Đầu vào không hợp lệ";
      case "invalid_element":
        return `Giá trị không hợp lệ trong ${issue2.origin}`;
      default:
        return `Đầu vào không hợp lệ`;
    }
  };
};
function vi_default() {
  return {
    localeError: error42()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/zh-CN.js
var error43 = () => {
  const Sizable = {
    string: { unit: "字符", verb: "包含" },
    file: { unit: "字节", verb: "包含" },
    array: { unit: "项", verb: "包含" },
    set: { unit: "项", verb: "包含" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType8 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "非数字(NaN)" : "数字";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "数组";
        }
        if (data === null) {
          return "空值(null)";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "输入",
    email: "电子邮件",
    url: "URL",
    emoji: "表情符号",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO日期时间",
    date: "ISO日期",
    time: "ISO时间",
    duration: "ISO时长",
    ipv4: "IPv4地址",
    ipv6: "IPv6地址",
    cidrv4: "IPv4网段",
    cidrv6: "IPv6网段",
    base64: "base64编码字符串",
    base64url: "base64url编码字符串",
    json_string: "JSON字符串",
    e164: "E.164号码",
    jwt: "JWT",
    template_literal: "输入"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `无效输入：期望 ${issue2.expected}，实际接收 ${parsedType8(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `无效输入：期望 ${stringifyPrimitive(issue2.values[0])}`;
        return `无效选项：期望以下之一 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `数值过大：期望 ${issue2.origin ?? "值"} ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "个元素"}`;
        return `数值过大：期望 ${issue2.origin ?? "值"} ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `数值过小：期望 ${issue2.origin} ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `数值过小：期望 ${issue2.origin} ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `无效字符串：必须以 "${_issue.prefix}" 开头`;
        if (_issue.format === "ends_with")
          return `无效字符串：必须以 "${_issue.suffix}" 结尾`;
        if (_issue.format === "includes")
          return `无效字符串：必须包含 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `无效字符串：必须满足正则表达式 ${_issue.pattern}`;
        return `无效${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `无效数字：必须是 ${issue2.divisor} 的倍数`;
      case "unrecognized_keys":
        return `出现未知的键(key): ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `${issue2.origin} 中的键(key)无效`;
      case "invalid_union":
        return "无效输入";
      case "invalid_element":
        return `${issue2.origin} 中包含无效值(value)`;
      default:
        return `无效输入`;
    }
  };
};
function zh_CN_default() {
  return {
    localeError: error43()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/zh-TW.js
var error44 = () => {
  const Sizable = {
    string: { unit: "字元", verb: "擁有" },
    file: { unit: "位元組", verb: "擁有" },
    array: { unit: "項目", verb: "擁有" },
    set: { unit: "項目", verb: "擁有" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType8 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "number";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "array";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "輸入",
    email: "郵件地址",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO 日期時間",
    date: "ISO 日期",
    time: "ISO 時間",
    duration: "ISO 期間",
    ipv4: "IPv4 位址",
    ipv6: "IPv6 位址",
    cidrv4: "IPv4 範圍",
    cidrv6: "IPv6 範圍",
    base64: "base64 編碼字串",
    base64url: "base64url 編碼字串",
    json_string: "JSON 字串",
    e164: "E.164 數值",
    jwt: "JWT",
    template_literal: "輸入"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `無效的輸入值：預期為 ${issue2.expected}，但收到 ${parsedType8(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `無效的輸入值：預期為 ${stringifyPrimitive(issue2.values[0])}`;
        return `無效的選項：預期為以下其中之一 ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `數值過大：預期 ${issue2.origin ?? "值"} 應為 ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "個元素"}`;
        return `數值過大：預期 ${issue2.origin ?? "值"} 應為 ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `數值過小：預期 ${issue2.origin} 應為 ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `數值過小：預期 ${issue2.origin} 應為 ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `無效的字串：必須以 "${_issue.prefix}" 開頭`;
        }
        if (_issue.format === "ends_with")
          return `無效的字串：必須以 "${_issue.suffix}" 結尾`;
        if (_issue.format === "includes")
          return `無效的字串：必須包含 "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `無效的字串：必須符合格式 ${_issue.pattern}`;
        return `無效的 ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `無效的數字：必須為 ${issue2.divisor} 的倍數`;
      case "unrecognized_keys":
        return `無法識別的鍵值${issue2.keys.length > 1 ? "們" : ""}：${joinValues(issue2.keys, "、")}`;
      case "invalid_key":
        return `${issue2.origin} 中有無效的鍵值`;
      case "invalid_union":
        return "無效的輸入值";
      case "invalid_element":
        return `${issue2.origin} 中有無效的值`;
      default:
        return `無效的輸入值`;
    }
  };
};
function zh_TW_default() {
  return {
    localeError: error44()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/locales/yo.js
var error45 = () => {
  const Sizable = {
    string: { unit: "àmi", verb: "ní" },
    file: { unit: "bytes", verb: "ní" },
    array: { unit: "nkan", verb: "ní" },
    set: { unit: "nkan", verb: "ní" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const parsedType8 = (data) => {
    const t = typeof data;
    switch (t) {
      case "number": {
        return Number.isNaN(data) ? "NaN" : "nọ́mbà";
      }
      case "object": {
        if (Array.isArray(data)) {
          return "akopọ";
        }
        if (data === null) {
          return "null";
        }
        if (Object.getPrototypeOf(data) !== Object.prototype && data.constructor) {
          return data.constructor.name;
        }
      }
    }
    return t;
  };
  const Nouns = {
    regex: "ẹ̀rọ ìbáwọlé",
    email: "àdírẹ́sì ìmẹ́lì",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "àkókò ISO",
    date: "ọjọ́ ISO",
    time: "àkókò ISO",
    duration: "àkókò tó pé ISO",
    ipv4: "àdírẹ́sì IPv4",
    ipv6: "àdírẹ́sì IPv6",
    cidrv4: "àgbègbè IPv4",
    cidrv6: "àgbègbè IPv6",
    base64: "ọ̀rọ̀ tí a kọ́ ní base64",
    base64url: "ọ̀rọ̀ base64url",
    json_string: "ọ̀rọ̀ JSON",
    e164: "nọ́mbà E.164",
    jwt: "JWT",
    template_literal: "ẹ̀rọ ìbáwọlé"
  };
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type":
        return `Ìbáwọlé aṣìṣe: a ní láti fi ${issue2.expected}, àmọ̀ a rí ${parsedType8(issue2.input)}`;
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Ìbáwọlé aṣìṣe: a ní láti fi ${stringifyPrimitive(issue2.values[0])}`;
        return `Àṣàyàn aṣìṣe: yan ọ̀kan lára ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Tó pọ̀ jù: a ní láti jẹ́ pé ${issue2.origin ?? "iye"} ${sizing.verb} ${adj}${issue2.maximum} ${sizing.unit}`;
        return `Tó pọ̀ jù: a ní láti jẹ́ ${adj}${issue2.maximum}`;
      }
      case "too_small": {
        const adj = issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Kéré ju: a ní láti jẹ́ pé ${issue2.origin} ${sizing.verb} ${adj}${issue2.minimum} ${sizing.unit}`;
        return `Kéré ju: a ní láti jẹ́ ${adj}${issue2.minimum}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with")
          return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ bẹ̀rẹ̀ pẹ̀lú "${_issue.prefix}"`;
        if (_issue.format === "ends_with")
          return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ parí pẹ̀lú "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ ní "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Ọ̀rọ̀ aṣìṣe: gbọ́dọ̀ bá àpẹẹrẹ mu ${_issue.pattern}`;
        return `Aṣìṣe: ${Nouns[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Nọ́mbà aṣìṣe: gbọ́dọ̀ jẹ́ èyà pípín ti ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Bọtìnì àìmọ̀: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Bọtìnì aṣìṣe nínú ${issue2.origin}`;
      case "invalid_union":
        return "Ìbáwọlé aṣìṣe";
      case "invalid_element":
        return `Iye aṣìṣe nínú ${issue2.origin}`;
      default:
        return "Ìbáwọlé aṣìṣe";
    }
  };
};
function yo_default() {
  return {
    localeError: error45()
  };
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/registries.js
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      if (this._idmap.has(meta.id)) {
        throw new Error(`ID ${meta.id} already exists in the registry`);
      }
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
var globalRegistry = /* @__PURE__ */ registry();
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/api.js
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
function _coercedString(Class2, params) {
  return new Class2({
    type: "string",
    coerce: true,
    ...normalizeParams(params)
  });
}
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
var TimePrecision = {
  Any: null,
  Minute: -1,
  Second: 0,
  Millisecond: 3,
  Microsecond: 6
};
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _coercedNumber(Class2, params) {
  return new Class2({
    type: "number",
    coerce: true,
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _float32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float32",
    ...normalizeParams(params)
  });
}
function _float64(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "float64",
    ...normalizeParams(params)
  });
}
function _int32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "int32",
    ...normalizeParams(params)
  });
}
function _uint32(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "uint32",
    ...normalizeParams(params)
  });
}
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _coercedBoolean(Class2, params) {
  return new Class2({
    type: "boolean",
    coerce: true,
    ...normalizeParams(params)
  });
}
function _bigint(Class2, params) {
  return new Class2({
    type: "bigint",
    ...normalizeParams(params)
  });
}
function _coercedBigint(Class2, params) {
  return new Class2({
    type: "bigint",
    coerce: true,
    ...normalizeParams(params)
  });
}
function _int64(Class2, params) {
  return new Class2({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "int64",
    ...normalizeParams(params)
  });
}
function _uint64(Class2, params) {
  return new Class2({
    type: "bigint",
    check: "bigint_format",
    abort: false,
    format: "uint64",
    ...normalizeParams(params)
  });
}
function _symbol(Class2, params) {
  return new Class2({
    type: "symbol",
    ...normalizeParams(params)
  });
}
function _undefined2(Class2, params) {
  return new Class2({
    type: "undefined",
    ...normalizeParams(params)
  });
}
function _null2(Class2, params) {
  return new Class2({
    type: "null",
    ...normalizeParams(params)
  });
}
function _any(Class2) {
  return new Class2({
    type: "any"
  });
}
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
function _void(Class2, params) {
  return new Class2({
    type: "void",
    ...normalizeParams(params)
  });
}
function _date(Class2, params) {
  return new Class2({
    type: "date",
    ...normalizeParams(params)
  });
}
function _coercedDate(Class2, params) {
  return new Class2({
    type: "date",
    coerce: true,
    ...normalizeParams(params)
  });
}
function _nan(Class2, params) {
  return new Class2({
    type: "nan",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _positive(params) {
  return _gt(0, params);
}
function _negative(params) {
  return _lt(0, params);
}
function _nonpositive(params) {
  return _lte(0, params);
}
function _nonnegative(params) {
  return _gte(0, params);
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxSize(maximum, params) {
  return new $ZodCheckMaxSize({
    check: "max_size",
    ...normalizeParams(params),
    maximum
  });
}
function _minSize(minimum, params) {
  return new $ZodCheckMinSize({
    check: "min_size",
    ...normalizeParams(params),
    minimum
  });
}
function _size(size, params) {
  return new $ZodCheckSizeEquals({
    check: "size_equals",
    ...normalizeParams(params),
    size
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _property(property, schema, params) {
  return new $ZodCheckProperty({
    check: "property",
    property,
    schema,
    ...normalizeParams(params)
  });
}
function _mime(types, params) {
  return new $ZodCheckMimeType({
    check: "mime_type",
    mime: types,
    ...normalizeParams(params)
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _union(Class2, options, params) {
  return new Class2({
    type: "union",
    options,
    ...normalizeParams(params)
  });
}
function _discriminatedUnion(Class2, discriminator, options, params) {
  return new Class2({
    type: "union",
    options,
    discriminator,
    ...normalizeParams(params)
  });
}
function _intersection(Class2, left, right) {
  return new Class2({
    type: "intersection",
    left,
    right
  });
}
function _tuple(Class2, items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new Class2({
    type: "tuple",
    items,
    rest,
    ...normalizeParams(params)
  });
}
function _record(Class2, keyType, valueType, params) {
  return new Class2({
    type: "record",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
function _map(Class2, keyType, valueType, params) {
  return new Class2({
    type: "map",
    keyType,
    valueType,
    ...normalizeParams(params)
  });
}
function _set(Class2, valueType, params) {
  return new Class2({
    type: "set",
    valueType,
    ...normalizeParams(params)
  });
}
function _enum(Class2, values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new Class2({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
function _nativeEnum(Class2, entries, params) {
  return new Class2({
    type: "enum",
    entries,
    ...normalizeParams(params)
  });
}
function _literal(Class2, value, params) {
  return new Class2({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...normalizeParams(params)
  });
}
function _file(Class2, params) {
  return new Class2({
    type: "file",
    ...normalizeParams(params)
  });
}
function _transform(Class2, fn) {
  return new Class2({
    type: "transform",
    transform: fn
  });
}
function _optional(Class2, innerType) {
  return new Class2({
    type: "optional",
    innerType
  });
}
function _nullable(Class2, innerType) {
  return new Class2({
    type: "nullable",
    innerType
  });
}
function _default(Class2, innerType, defaultValue) {
  return new Class2({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
    }
  });
}
function _nonoptional(Class2, innerType, params) {
  return new Class2({
    type: "nonoptional",
    innerType,
    ...normalizeParams(params)
  });
}
function _success(Class2, innerType) {
  return new Class2({
    type: "success",
    innerType
  });
}
function _catch(Class2, innerType, catchValue) {
  return new Class2({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
function _pipe(Class2, in_, out) {
  return new Class2({
    type: "pipe",
    in: in_,
    out
  });
}
function _readonly(Class2, innerType) {
  return new Class2({
    type: "readonly",
    innerType
  });
}
function _templateLiteral(Class2, parts, params) {
  return new Class2({
    type: "template_literal",
    parts,
    ...normalizeParams(params)
  });
}
function _lazy(Class2, getter) {
  return new Class2({
    type: "lazy",
    getter
  });
}
function _promise(Class2, innerType) {
  return new Class2({
    type: "promise",
    innerType
  });
}
function _custom(Class2, fn, _params) {
  const norm = normalizeParams(_params);
  norm.abort ?? (norm.abort = true);
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...norm
  });
  return schema;
}
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  });
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
function _stringbool(Classes, _params) {
  const params = normalizeParams(_params);
  let truthyArray = params.truthy ?? ["true", "1", "yes", "on", "y", "enabled"];
  let falsyArray = params.falsy ?? ["false", "0", "no", "off", "n", "disabled"];
  if (params.case !== "sensitive") {
    truthyArray = truthyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
    falsyArray = falsyArray.map((v) => typeof v === "string" ? v.toLowerCase() : v);
  }
  const truthySet = new Set(truthyArray);
  const falsySet = new Set(falsyArray);
  const _Codec = Classes.Codec ?? $ZodCodec;
  const _Boolean = Classes.Boolean ?? $ZodBoolean;
  const _String = Classes.String ?? $ZodString;
  const stringSchema = new _String({ type: "string", error: params.error });
  const booleanSchema = new _Boolean({ type: "boolean", error: params.error });
  const codec = new _Codec({
    type: "pipe",
    in: stringSchema,
    out: booleanSchema,
    transform: (input, payload) => {
      let data = input;
      if (params.case !== "sensitive")
        data = data.toLowerCase();
      if (truthySet.has(data)) {
        return true;
      } else if (falsySet.has(data)) {
        return false;
      } else {
        payload.issues.push({
          code: "invalid_value",
          expected: "stringbool",
          values: [...truthySet, ...falsySet],
          input: payload.value,
          inst: codec,
          continue: false
        });
        return {};
      }
    },
    reverseTransform: (input, _payload) => {
      if (input === true) {
        return truthyArray[0] || "true";
      } else {
        return falsyArray[0] || "false";
      }
    },
    error: params.error
  });
  return codec;
}
function _stringFormat(Class2, format, fnOrRegex, _params = {}) {
  const params = normalizeParams(_params);
  const def = {
    ...normalizeParams(_params),
    check: "string_format",
    type: "string",
    format,
    fn: typeof fnOrRegex === "function" ? fnOrRegex : (val) => fnOrRegex.test(val),
    ...params
  };
  if (fnOrRegex instanceof RegExp) {
    def.pattern = fnOrRegex;
  }
  const inst = new Class2(def);
  return inst;
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/to-json-schema.js
class JSONSchemaGenerator {
  constructor(params) {
    this.counter = 0;
    this.metadataRegistry = params?.metadata ?? globalRegistry;
    this.target = params?.target ?? "draft-2020-12";
    this.unrepresentable = params?.unrepresentable ?? "throw";
    this.override = params?.override ?? (() => {});
    this.io = params?.io ?? "output";
    this.seen = new Map;
  }
  process(schema, _params = { path: [], schemaPath: [] }) {
    var _a;
    const def = schema._zod.def;
    const formatMap = {
      guid: "uuid",
      url: "uri",
      datetime: "date-time",
      json_string: "json-string",
      regex: ""
    };
    const seen = this.seen.get(schema);
    if (seen) {
      seen.count++;
      const isCycle = _params.schemaPath.includes(schema);
      if (isCycle) {
        seen.cycle = _params.path;
      }
      return seen.schema;
    }
    const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
    this.seen.set(schema, result);
    const overrideSchema = schema._zod.toJSONSchema?.();
    if (overrideSchema) {
      result.schema = overrideSchema;
    } else {
      const params = {
        ..._params,
        schemaPath: [..._params.schemaPath, schema],
        path: _params.path
      };
      const parent = schema._zod.parent;
      if (parent) {
        result.ref = parent;
        this.process(parent, params);
        this.seen.get(parent).isParent = true;
      } else {
        const _json = result.schema;
        switch (def.type) {
          case "string": {
            const json = _json;
            json.type = "string";
            const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
            if (typeof minimum === "number")
              json.minLength = minimum;
            if (typeof maximum === "number")
              json.maxLength = maximum;
            if (format) {
              json.format = formatMap[format] ?? format;
              if (json.format === "")
                delete json.format;
            }
            if (contentEncoding)
              json.contentEncoding = contentEncoding;
            if (patterns && patterns.size > 0) {
              const regexes = [...patterns];
              if (regexes.length === 1)
                json.pattern = regexes[0].source;
              else if (regexes.length > 1) {
                result.schema.allOf = [
                  ...regexes.map((regex) => ({
                    ...this.target === "draft-7" || this.target === "draft-4" || this.target === "openapi-3.0" ? { type: "string" } : {},
                    pattern: regex.source
                  }))
                ];
              }
            }
            break;
          }
          case "number": {
            const json = _json;
            const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
            if (typeof format === "string" && format.includes("int"))
              json.type = "integer";
            else
              json.type = "number";
            if (typeof exclusiveMinimum === "number") {
              if (this.target === "draft-4" || this.target === "openapi-3.0") {
                json.minimum = exclusiveMinimum;
                json.exclusiveMinimum = true;
              } else {
                json.exclusiveMinimum = exclusiveMinimum;
              }
            }
            if (typeof minimum === "number") {
              json.minimum = minimum;
              if (typeof exclusiveMinimum === "number" && this.target !== "draft-4") {
                if (exclusiveMinimum >= minimum)
                  delete json.minimum;
                else
                  delete json.exclusiveMinimum;
              }
            }
            if (typeof exclusiveMaximum === "number") {
              if (this.target === "draft-4" || this.target === "openapi-3.0") {
                json.maximum = exclusiveMaximum;
                json.exclusiveMaximum = true;
              } else {
                json.exclusiveMaximum = exclusiveMaximum;
              }
            }
            if (typeof maximum === "number") {
              json.maximum = maximum;
              if (typeof exclusiveMaximum === "number" && this.target !== "draft-4") {
                if (exclusiveMaximum <= maximum)
                  delete json.maximum;
                else
                  delete json.exclusiveMaximum;
              }
            }
            if (typeof multipleOf === "number")
              json.multipleOf = multipleOf;
            break;
          }
          case "boolean": {
            const json = _json;
            json.type = "boolean";
            break;
          }
          case "bigint": {
            if (this.unrepresentable === "throw") {
              throw new Error("BigInt cannot be represented in JSON Schema");
            }
            break;
          }
          case "symbol": {
            if (this.unrepresentable === "throw") {
              throw new Error("Symbols cannot be represented in JSON Schema");
            }
            break;
          }
          case "null": {
            if (this.target === "openapi-3.0") {
              _json.type = "string";
              _json.nullable = true;
              _json.enum = [null];
            } else
              _json.type = "null";
            break;
          }
          case "any": {
            break;
          }
          case "unknown": {
            break;
          }
          case "undefined": {
            if (this.unrepresentable === "throw") {
              throw new Error("Undefined cannot be represented in JSON Schema");
            }
            break;
          }
          case "void": {
            if (this.unrepresentable === "throw") {
              throw new Error("Void cannot be represented in JSON Schema");
            }
            break;
          }
          case "never": {
            _json.not = {};
            break;
          }
          case "date": {
            if (this.unrepresentable === "throw") {
              throw new Error("Date cannot be represented in JSON Schema");
            }
            break;
          }
          case "array": {
            const json = _json;
            const { minimum, maximum } = schema._zod.bag;
            if (typeof minimum === "number")
              json.minItems = minimum;
            if (typeof maximum === "number")
              json.maxItems = maximum;
            json.type = "array";
            json.items = this.process(def.element, { ...params, path: [...params.path, "items"] });
            break;
          }
          case "object": {
            const json = _json;
            json.type = "object";
            json.properties = {};
            const shape = def.shape;
            for (const key in shape) {
              json.properties[key] = this.process(shape[key], {
                ...params,
                path: [...params.path, "properties", key]
              });
            }
            const allKeys = new Set(Object.keys(shape));
            const requiredKeys = new Set([...allKeys].filter((key) => {
              const v = def.shape[key]._zod;
              if (this.io === "input") {
                return v.optin === undefined;
              } else {
                return v.optout === undefined;
              }
            }));
            if (requiredKeys.size > 0) {
              json.required = Array.from(requiredKeys);
            }
            if (def.catchall?._zod.def.type === "never") {
              json.additionalProperties = false;
            } else if (!def.catchall) {
              if (this.io === "output")
                json.additionalProperties = false;
            } else if (def.catchall) {
              json.additionalProperties = this.process(def.catchall, {
                ...params,
                path: [...params.path, "additionalProperties"]
              });
            }
            break;
          }
          case "union": {
            const json = _json;
            const options = def.options.map((x, i) => this.process(x, {
              ...params,
              path: [...params.path, "anyOf", i]
            }));
            json.anyOf = options;
            break;
          }
          case "intersection": {
            const json = _json;
            const a = this.process(def.left, {
              ...params,
              path: [...params.path, "allOf", 0]
            });
            const b = this.process(def.right, {
              ...params,
              path: [...params.path, "allOf", 1]
            });
            const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
            const allOf = [
              ...isSimpleIntersection(a) ? a.allOf : [a],
              ...isSimpleIntersection(b) ? b.allOf : [b]
            ];
            json.allOf = allOf;
            break;
          }
          case "tuple": {
            const json = _json;
            json.type = "array";
            const prefixPath = this.target === "draft-2020-12" ? "prefixItems" : "items";
            const restPath = this.target === "draft-2020-12" ? "items" : this.target === "openapi-3.0" ? "items" : "additionalItems";
            const prefixItems = def.items.map((x, i) => this.process(x, {
              ...params,
              path: [...params.path, prefixPath, i]
            }));
            const rest = def.rest ? this.process(def.rest, {
              ...params,
              path: [...params.path, restPath, ...this.target === "openapi-3.0" ? [def.items.length] : []]
            }) : null;
            if (this.target === "draft-2020-12") {
              json.prefixItems = prefixItems;
              if (rest) {
                json.items = rest;
              }
            } else if (this.target === "openapi-3.0") {
              json.items = {
                anyOf: prefixItems
              };
              if (rest) {
                json.items.anyOf.push(rest);
              }
              json.minItems = prefixItems.length;
              if (!rest) {
                json.maxItems = prefixItems.length;
              }
            } else {
              json.items = prefixItems;
              if (rest) {
                json.additionalItems = rest;
              }
            }
            const { minimum, maximum } = schema._zod.bag;
            if (typeof minimum === "number")
              json.minItems = minimum;
            if (typeof maximum === "number")
              json.maxItems = maximum;
            break;
          }
          case "record": {
            const json = _json;
            json.type = "object";
            if (this.target === "draft-7" || this.target === "draft-2020-12") {
              json.propertyNames = this.process(def.keyType, {
                ...params,
                path: [...params.path, "propertyNames"]
              });
            }
            json.additionalProperties = this.process(def.valueType, {
              ...params,
              path: [...params.path, "additionalProperties"]
            });
            break;
          }
          case "map": {
            if (this.unrepresentable === "throw") {
              throw new Error("Map cannot be represented in JSON Schema");
            }
            break;
          }
          case "set": {
            if (this.unrepresentable === "throw") {
              throw new Error("Set cannot be represented in JSON Schema");
            }
            break;
          }
          case "enum": {
            const json = _json;
            const values = getEnumValues(def.entries);
            if (values.every((v) => typeof v === "number"))
              json.type = "number";
            if (values.every((v) => typeof v === "string"))
              json.type = "string";
            json.enum = values;
            break;
          }
          case "literal": {
            const json = _json;
            const vals = [];
            for (const val of def.values) {
              if (val === undefined) {
                if (this.unrepresentable === "throw") {
                  throw new Error("Literal `undefined` cannot be represented in JSON Schema");
                }
              } else if (typeof val === "bigint") {
                if (this.unrepresentable === "throw") {
                  throw new Error("BigInt literals cannot be represented in JSON Schema");
                } else {
                  vals.push(Number(val));
                }
              } else {
                vals.push(val);
              }
            }
            if (vals.length === 0) {} else if (vals.length === 1) {
              const val = vals[0];
              json.type = val === null ? "null" : typeof val;
              if (this.target === "draft-4" || this.target === "openapi-3.0") {
                json.enum = [val];
              } else {
                json.const = val;
              }
            } else {
              if (vals.every((v) => typeof v === "number"))
                json.type = "number";
              if (vals.every((v) => typeof v === "string"))
                json.type = "string";
              if (vals.every((v) => typeof v === "boolean"))
                json.type = "string";
              if (vals.every((v) => v === null))
                json.type = "null";
              json.enum = vals;
            }
            break;
          }
          case "file": {
            const json = _json;
            const file = {
              type: "string",
              format: "binary",
              contentEncoding: "binary"
            };
            const { minimum, maximum, mime } = schema._zod.bag;
            if (minimum !== undefined)
              file.minLength = minimum;
            if (maximum !== undefined)
              file.maxLength = maximum;
            if (mime) {
              if (mime.length === 1) {
                file.contentMediaType = mime[0];
                Object.assign(json, file);
              } else {
                json.anyOf = mime.map((m) => {
                  const mFile = { ...file, contentMediaType: m };
                  return mFile;
                });
              }
            } else {
              Object.assign(json, file);
            }
            break;
          }
          case "transform": {
            if (this.unrepresentable === "throw") {
              throw new Error("Transforms cannot be represented in JSON Schema");
            }
            break;
          }
          case "nullable": {
            const inner = this.process(def.innerType, params);
            if (this.target === "openapi-3.0") {
              result.ref = def.innerType;
              _json.nullable = true;
            } else {
              _json.anyOf = [inner, { type: "null" }];
            }
            break;
          }
          case "nonoptional": {
            this.process(def.innerType, params);
            result.ref = def.innerType;
            break;
          }
          case "success": {
            const json = _json;
            json.type = "boolean";
            break;
          }
          case "default": {
            this.process(def.innerType, params);
            result.ref = def.innerType;
            _json.default = JSON.parse(JSON.stringify(def.defaultValue));
            break;
          }
          case "prefault": {
            this.process(def.innerType, params);
            result.ref = def.innerType;
            if (this.io === "input")
              _json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
            break;
          }
          case "catch": {
            this.process(def.innerType, params);
            result.ref = def.innerType;
            let catchValue;
            try {
              catchValue = def.catchValue(undefined);
            } catch {
              throw new Error("Dynamic catch values are not supported in JSON Schema");
            }
            _json.default = catchValue;
            break;
          }
          case "nan": {
            if (this.unrepresentable === "throw") {
              throw new Error("NaN cannot be represented in JSON Schema");
            }
            break;
          }
          case "template_literal": {
            const json = _json;
            const pattern = schema._zod.pattern;
            if (!pattern)
              throw new Error("Pattern not found in template literal");
            json.type = "string";
            json.pattern = pattern.source;
            break;
          }
          case "pipe": {
            const innerType = this.io === "input" ? def.in._zod.def.type === "transform" ? def.out : def.in : def.out;
            this.process(innerType, params);
            result.ref = innerType;
            break;
          }
          case "readonly": {
            this.process(def.innerType, params);
            result.ref = def.innerType;
            _json.readOnly = true;
            break;
          }
          case "promise": {
            this.process(def.innerType, params);
            result.ref = def.innerType;
            break;
          }
          case "optional": {
            this.process(def.innerType, params);
            result.ref = def.innerType;
            break;
          }
          case "lazy": {
            const innerType = schema._zod.innerType;
            this.process(innerType, params);
            result.ref = innerType;
            break;
          }
          case "custom": {
            if (this.unrepresentable === "throw") {
              throw new Error("Custom types cannot be represented in JSON Schema");
            }
            break;
          }
          case "function": {
            if (this.unrepresentable === "throw") {
              throw new Error("Function types cannot be represented in JSON Schema");
            }
            break;
          }
          default: {}
        }
      }
    }
    const meta = this.metadataRegistry.get(schema);
    if (meta)
      Object.assign(result.schema, meta);
    if (this.io === "input" && isTransforming(schema)) {
      delete result.schema.examples;
      delete result.schema.default;
    }
    if (this.io === "input" && result.schema._prefault)
      (_a = result.schema).default ?? (_a.default = result.schema._prefault);
    delete result.schema._prefault;
    const _result = this.seen.get(schema);
    return _result.schema;
  }
  emit(schema, _params) {
    const params = {
      cycles: _params?.cycles ?? "ref",
      reused: _params?.reused ?? "inline",
      external: _params?.external ?? undefined
    };
    const root = this.seen.get(schema);
    if (!root)
      throw new Error("Unprocessed schema. This is a bug in Zod.");
    const makeURI = (entry) => {
      const defsSegment = this.target === "draft-2020-12" ? "$defs" : "definitions";
      if (params.external) {
        const externalId = params.external.registry.get(entry[0])?.id;
        const uriGenerator = params.external.uri ?? ((id2) => id2);
        if (externalId) {
          return { ref: uriGenerator(externalId) };
        }
        const id = entry[1].defId ?? entry[1].schema.id ?? `schema${this.counter++}`;
        entry[1].defId = id;
        return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
      }
      if (entry[1] === root) {
        return { ref: "#" };
      }
      const uriPrefix = `#`;
      const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
      const defId = entry[1].schema.id ?? `__schema${this.counter++}`;
      return { defId, ref: defUriPrefix + defId };
    };
    const extractToDef = (entry) => {
      if (entry[1].schema.$ref) {
        return;
      }
      const seen = entry[1];
      const { ref, defId } = makeURI(entry);
      seen.def = { ...seen.schema };
      if (defId)
        seen.defId = defId;
      const schema2 = seen.schema;
      for (const key in schema2) {
        delete schema2[key];
      }
      schema2.$ref = ref;
    };
    if (params.cycles === "throw") {
      for (const entry of this.seen.entries()) {
        const seen = entry[1];
        if (seen.cycle) {
          throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
        }
      }
    }
    for (const entry of this.seen.entries()) {
      const seen = entry[1];
      if (schema === entry[0]) {
        extractToDef(entry);
        continue;
      }
      if (params.external) {
        const ext = params.external.registry.get(entry[0])?.id;
        if (schema !== entry[0] && ext) {
          extractToDef(entry);
          continue;
        }
      }
      const id = this.metadataRegistry.get(entry[0])?.id;
      if (id) {
        extractToDef(entry);
        continue;
      }
      if (seen.cycle) {
        extractToDef(entry);
        continue;
      }
      if (seen.count > 1) {
        if (params.reused === "ref") {
          extractToDef(entry);
          continue;
        }
      }
    }
    const flattenRef = (zodSchema, params2) => {
      const seen = this.seen.get(zodSchema);
      const schema2 = seen.def ?? seen.schema;
      const _cached = { ...schema2 };
      if (seen.ref === null) {
        return;
      }
      const ref = seen.ref;
      seen.ref = null;
      if (ref) {
        flattenRef(ref, params2);
        const refSchema = this.seen.get(ref).schema;
        if (refSchema.$ref && (params2.target === "draft-7" || params2.target === "draft-4" || params2.target === "openapi-3.0")) {
          schema2.allOf = schema2.allOf ?? [];
          schema2.allOf.push(refSchema);
        } else {
          Object.assign(schema2, refSchema);
          Object.assign(schema2, _cached);
        }
      }
      if (!seen.isParent)
        this.override({
          zodSchema,
          jsonSchema: schema2,
          path: seen.path ?? []
        });
    };
    for (const entry of [...this.seen.entries()].reverse()) {
      flattenRef(entry[0], { target: this.target });
    }
    const result = {};
    if (this.target === "draft-2020-12") {
      result.$schema = "https://json-schema.org/draft/2020-12/schema";
    } else if (this.target === "draft-7") {
      result.$schema = "http://json-schema.org/draft-07/schema#";
    } else if (this.target === "draft-4") {
      result.$schema = "http://json-schema.org/draft-04/schema#";
    } else if (this.target === "openapi-3.0") {} else {
      console.warn(`Invalid target: ${this.target}`);
    }
    if (params.external?.uri) {
      const id = params.external.registry.get(schema)?.id;
      if (!id)
        throw new Error("Schema is missing an `id` property");
      result.$id = params.external.uri(id);
    }
    Object.assign(result, root.def);
    const defs = params.external?.defs ?? {};
    for (const entry of this.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        defs[seen.defId] = seen.def;
      }
    }
    if (params.external) {} else {
      if (Object.keys(defs).length > 0) {
        if (this.target === "draft-2020-12") {
          result.$defs = defs;
        } else {
          result.definitions = defs;
        }
      }
    }
    try {
      return JSON.parse(JSON.stringify(result));
    } catch (_err) {
      throw new Error("Error converting schema to JSON.");
    }
  }
}
function toJSONSchema(input, _params) {
  if (input instanceof $ZodRegistry) {
    const gen2 = new JSONSchemaGenerator(_params);
    const defs = {};
    for (const entry of input._idmap.entries()) {
      const [_, schema] = entry;
      gen2.process(schema);
    }
    const schemas = {};
    const external = {
      registry: input,
      uri: _params?.uri,
      defs
    };
    for (const entry of input._idmap.entries()) {
      const [key, schema] = entry;
      schemas[key] = gen2.emit(schema, {
        ..._params,
        external
      });
    }
    if (Object.keys(defs).length > 0) {
      const defsSegment = gen2.target === "draft-2020-12" ? "$defs" : "definitions";
      schemas.__shared = {
        [defsSegment]: defs
      };
    }
    return { schemas };
  }
  const gen = new JSONSchemaGenerator(_params);
  gen.process(input);
  return gen.emit(input, _params);
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const schema = _schema;
  const def = schema._zod.def;
  switch (def.type) {
    case "string":
    case "number":
    case "bigint":
    case "boolean":
    case "date":
    case "symbol":
    case "undefined":
    case "null":
    case "any":
    case "unknown":
    case "never":
    case "void":
    case "literal":
    case "enum":
    case "nan":
    case "file":
    case "template_literal":
      return false;
    case "array": {
      return isTransforming(def.element, ctx);
    }
    case "object": {
      for (const key in def.shape) {
        if (isTransforming(def.shape[key], ctx))
          return true;
      }
      return false;
    }
    case "union": {
      for (const option of def.options) {
        if (isTransforming(option, ctx))
          return true;
      }
      return false;
    }
    case "intersection": {
      return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
    }
    case "tuple": {
      for (const item of def.items) {
        if (isTransforming(item, ctx))
          return true;
      }
      if (def.rest && isTransforming(def.rest, ctx))
        return true;
      return false;
    }
    case "record": {
      return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
    }
    case "map": {
      return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
    }
    case "set": {
      return isTransforming(def.valueType, ctx);
    }
    case "promise":
    case "optional":
    case "nonoptional":
    case "nullable":
    case "readonly":
      return isTransforming(def.innerType, ctx);
    case "lazy":
      return isTransforming(def.getter(), ctx);
    case "default": {
      return isTransforming(def.innerType, ctx);
    }
    case "prefault": {
      return isTransforming(def.innerType, ctx);
    }
    case "custom": {
      return false;
    }
    case "transform": {
      return true;
    }
    case "pipe": {
      return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
    }
    case "success": {
      return false;
    }
    case "catch": {
      return false;
    }
    case "function": {
      return false;
    }
    default:
  }
  throw new Error(`Unknown schema type: ${def.type}`);
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/core/json-schema.js
var exports_json_schema = {};
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/classic/iso.js
var exports_iso = {};
__export(exports_iso, {
  time: () => time2,
  duration: () => duration2,
  datetime: () => datetime2,
  date: () => date2,
  ZodISOTime: () => ZodISOTime,
  ZodISODuration: () => ZodISODuration,
  ZodISODateTime: () => ZodISODateTime,
  ZodISODate: () => ZodISODate
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue2) => {
        inst.issues.push(issue2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    addIssues: {
      value: (issues2) => {
        inst.issues.push(...issues2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodError = $constructor("ZodError", initializer2);
var ZodRealError = $constructor("ZodError", initializer2, {
  Parent: Error
});

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/classic/parse.js
var parse4 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode2 = /* @__PURE__ */ _encode(ZodRealError);
var decode2 = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync2 = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync2 = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode2 = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode2 = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync2 = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync2 = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/classic/schemas.js
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.check = (...checks2) => {
    return inst.clone(exports_util.mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...checks2.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }));
  };
  inst.clone = (def2, params) => clone(inst, def2, params);
  inst.brand = () => inst;
  inst.register = (reg, meta) => {
    reg.add(inst, meta);
    return inst;
  };
  inst.parse = (data, params) => parse4(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode2(inst, data, params);
  inst.decode = (data, params) => decode2(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync2(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync2(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode2(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode2(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync2(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync2(inst, data, params);
  inst.refine = (check, params) => inst.check(refine(check, params));
  inst.superRefine = (refinement) => inst.check(superRefine(refinement));
  inst.overwrite = (fn) => inst.check(_overwrite(fn));
  inst.optional = () => optional(inst);
  inst.nullable = () => nullable(inst);
  inst.nullish = () => optional(nullable(inst));
  inst.nonoptional = (params) => nonoptional(inst, params);
  inst.array = () => array(inst);
  inst.or = (arg) => union([inst, arg]);
  inst.and = (arg) => intersection(inst, arg);
  inst.transform = (tx) => pipe(inst, transform(tx));
  inst.default = (def2) => _default2(inst, def2);
  inst.prefault = (def2) => prefault(inst, def2);
  inst.catch = (params) => _catch2(inst, params);
  inst.pipe = (target) => pipe(inst, target);
  inst.readonly = () => readonly(inst);
  inst.describe = (description) => {
    const cl = inst.clone();
    globalRegistry.add(cl, { description });
    return cl;
  };
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  inst.meta = (...args) => {
    if (args.length === 0) {
      return globalRegistry.get(inst);
    }
    const cl = inst.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  };
  inst.isOptional = () => inst.safeParse(undefined).success;
  inst.isNullable = () => inst.safeParse(null).success;
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  inst.regex = (...args) => inst.check(_regex(...args));
  inst.includes = (...args) => inst.check(_includes(...args));
  inst.startsWith = (...args) => inst.check(_startsWith(...args));
  inst.endsWith = (...args) => inst.check(_endsWith(...args));
  inst.min = (...args) => inst.check(_minLength(...args));
  inst.max = (...args) => inst.check(_maxLength(...args));
  inst.length = (...args) => inst.check(_length(...args));
  inst.nonempty = (...args) => inst.check(_minLength(1, ...args));
  inst.lowercase = (params) => inst.check(_lowercase(params));
  inst.uppercase = (params) => inst.check(_uppercase(params));
  inst.trim = () => inst.check(_trim());
  inst.normalize = (...args) => inst.check(_normalize(...args));
  inst.toLowerCase = () => inst.check(_toLowerCase());
  inst.toUpperCase = () => inst.check(_toUpperCase());
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function email2(params) {
  return _email(ZodEmail, params);
}
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function guid2(params) {
  return _guid(ZodGUID, params);
}
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function uuid2(params) {
  return _uuid(ZodUUID, params);
}
function uuidv4(params) {
  return _uuidv4(ZodUUID, params);
}
function uuidv6(params) {
  return _uuidv6(ZodUUID, params);
}
function uuidv7(params) {
  return _uuidv7(ZodUUID, params);
}
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return _url(ZodURL, params);
}
function httpUrl(params) {
  return _url(ZodURL, {
    protocol: /^https?$/,
    hostname: exports_regexes.domain,
    ...exports_util.normalizeParams(params)
  });
}
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function emoji2(params) {
  return _emoji2(ZodEmoji, params);
}
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function nanoid2(params) {
  return _nanoid(ZodNanoID, params);
}
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cuid3(params) {
  return _cuid(ZodCUID, params);
}
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cuid22(params) {
  return _cuid2(ZodCUID2, params);
}
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ulid2(params) {
  return _ulid(ZodULID, params);
}
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function xid2(params) {
  return _xid(ZodXID, params);
}
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ksuid2(params) {
  return _ksuid(ZodKSUID, params);
}
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ipv42(params) {
  return _ipv4(ZodIPv4, params);
}
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function ipv62(params) {
  return _ipv6(ZodIPv6, params);
}
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cidrv42(params) {
  return _cidrv4(ZodCIDRv4, params);
}
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function cidrv62(params) {
  return _cidrv6(ZodCIDRv6, params);
}
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base642(params) {
  return _base64(ZodBase64, params);
}
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function base64url2(params) {
  return _base64url(ZodBase64URL, params);
}
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function e1642(params) {
  return _e164(ZodE164, params);
}
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function jwt(params) {
  return _jwt(ZodJWT, params);
}
var ZodCustomStringFormat = /* @__PURE__ */ $constructor("ZodCustomStringFormat", (inst, def) => {
  $ZodCustomStringFormat.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function stringFormat(format, fnOrRegex, _params = {}) {
  return _stringFormat(ZodCustomStringFormat, format, fnOrRegex, _params);
}
function hostname2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hostname", exports_regexes.hostname, _params);
}
function hex2(_params) {
  return _stringFormat(ZodCustomStringFormat, "hex", exports_regexes.hex, _params);
}
function hash(alg, params) {
  const enc = params?.enc ?? "hex";
  const format = `${alg}_${enc}`;
  const regex = exports_regexes[format];
  if (!regex)
    throw new Error(`Unrecognized hash format: ${format}`);
  return _stringFormat(ZodCustomStringFormat, format, regex, params);
}
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.int = (params) => inst.check(int(params));
  inst.safe = (params) => inst.check(int(params));
  inst.positive = (params) => inst.check(_gt(0, params));
  inst.nonnegative = (params) => inst.check(_gte(0, params));
  inst.negative = (params) => inst.check(_lt(0, params));
  inst.nonpositive = (params) => inst.check(_lte(0, params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  inst.step = (value, params) => inst.check(_multipleOf(value, params));
  inst.finite = () => inst;
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
function float32(params) {
  return _float32(ZodNumberFormat, params);
}
function float64(params) {
  return _float64(ZodNumberFormat, params);
}
function int32(params) {
  return _int32(ZodNumberFormat, params);
}
function uint32(params) {
  return _uint32(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodBigInt = /* @__PURE__ */ $constructor("ZodBigInt", (inst, def) => {
  $ZodBigInt.init(inst, def);
  ZodType.init(inst, def);
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.gt = (value, params) => inst.check(_gt(value, params));
  inst.gte = (value, params) => inst.check(_gte(value, params));
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.lt = (value, params) => inst.check(_lt(value, params));
  inst.lte = (value, params) => inst.check(_lte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  inst.positive = (params) => inst.check(_gt(BigInt(0), params));
  inst.negative = (params) => inst.check(_lt(BigInt(0), params));
  inst.nonpositive = (params) => inst.check(_lte(BigInt(0), params));
  inst.nonnegative = (params) => inst.check(_gte(BigInt(0), params));
  inst.multipleOf = (value, params) => inst.check(_multipleOf(value, params));
  const bag = inst._zod.bag;
  inst.minValue = bag.minimum ?? null;
  inst.maxValue = bag.maximum ?? null;
  inst.format = bag.format ?? null;
});
function bigint2(params) {
  return _bigint(ZodBigInt, params);
}
var ZodBigIntFormat = /* @__PURE__ */ $constructor("ZodBigIntFormat", (inst, def) => {
  $ZodBigIntFormat.init(inst, def);
  ZodBigInt.init(inst, def);
});
function int64(params) {
  return _int64(ZodBigIntFormat, params);
}
function uint64(params) {
  return _uint64(ZodBigIntFormat, params);
}
var ZodSymbol = /* @__PURE__ */ $constructor("ZodSymbol", (inst, def) => {
  $ZodSymbol.init(inst, def);
  ZodType.init(inst, def);
});
function symbol(params) {
  return _symbol(ZodSymbol, params);
}
var ZodUndefined = /* @__PURE__ */ $constructor("ZodUndefined", (inst, def) => {
  $ZodUndefined.init(inst, def);
  ZodType.init(inst, def);
});
function _undefined3(params) {
  return _undefined2(ZodUndefined, params);
}
var ZodNull = /* @__PURE__ */ $constructor("ZodNull", (inst, def) => {
  $ZodNull.init(inst, def);
  ZodType.init(inst, def);
});
function _null3(params) {
  return _null2(ZodNull, params);
}
var ZodAny = /* @__PURE__ */ $constructor("ZodAny", (inst, def) => {
  $ZodAny.init(inst, def);
  ZodType.init(inst, def);
});
function any() {
  return _any(ZodAny);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodVoid = /* @__PURE__ */ $constructor("ZodVoid", (inst, def) => {
  $ZodVoid.init(inst, def);
  ZodType.init(inst, def);
});
function _void2(params) {
  return _void(ZodVoid, params);
}
var ZodDate = /* @__PURE__ */ $constructor("ZodDate", (inst, def) => {
  $ZodDate.init(inst, def);
  ZodType.init(inst, def);
  inst.min = (value, params) => inst.check(_gte(value, params));
  inst.max = (value, params) => inst.check(_lte(value, params));
  const c = inst._zod.bag;
  inst.minDate = c.minimum ? new Date(c.minimum) : null;
  inst.maxDate = c.maximum ? new Date(c.maximum) : null;
});
function date3(params) {
  return _date(ZodDate, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst.element = def.element;
  inst.min = (minLength, params) => inst.check(_minLength(minLength, params));
  inst.nonempty = (params) => inst.check(_minLength(1, params));
  inst.max = (maxLength, params) => inst.check(_maxLength(maxLength, params));
  inst.length = (len, params) => inst.check(_length(len, params));
  inst.unwrap = () => inst.element;
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
function keyof(schema) {
  const shape = schema._zod.def.shape;
  return _enum2(Object.keys(shape));
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  exports_util.defineLazy(inst, "shape", () => {
    return def.shape;
  });
  inst.keyof = () => _enum2(Object.keys(inst._zod.def.shape));
  inst.catchall = (catchall) => inst.clone({ ...inst._zod.def, catchall });
  inst.passthrough = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.loose = () => inst.clone({ ...inst._zod.def, catchall: unknown() });
  inst.strict = () => inst.clone({ ...inst._zod.def, catchall: never() });
  inst.strip = () => inst.clone({ ...inst._zod.def, catchall: undefined });
  inst.extend = (incoming) => {
    return exports_util.extend(inst, incoming);
  };
  inst.safeExtend = (incoming) => {
    return exports_util.safeExtend(inst, incoming);
  };
  inst.merge = (other) => exports_util.merge(inst, other);
  inst.pick = (mask) => exports_util.pick(inst, mask);
  inst.omit = (mask) => exports_util.omit(inst, mask);
  inst.partial = (...args) => exports_util.partial(ZodOptional, inst, args[0]);
  inst.required = (...args) => exports_util.required(ZodNonOptional, inst, args[0]);
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...exports_util.normalizeParams(params)
  };
  return new ZodObject(def);
}
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...exports_util.normalizeParams(params)
  });
}
function looseObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: unknown(),
    ...exports_util.normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...exports_util.normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...exports_util.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodTuple = /* @__PURE__ */ $constructor("ZodTuple", (inst, def) => {
  $ZodTuple.init(inst, def);
  ZodType.init(inst, def);
  inst.rest = (rest) => inst.clone({
    ...inst._zod.def,
    rest
  });
});
function tuple(items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new ZodTuple({
    type: "tuple",
    items,
    rest,
    ...exports_util.normalizeParams(params)
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...exports_util.normalizeParams(params)
  });
}
function partialRecord(keyType, valueType, params) {
  const k = clone(keyType);
  k._zod.values = undefined;
  return new ZodRecord({
    type: "record",
    keyType: k,
    valueType,
    ...exports_util.normalizeParams(params)
  });
}
var ZodMap = /* @__PURE__ */ $constructor("ZodMap", (inst, def) => {
  $ZodMap.init(inst, def);
  ZodType.init(inst, def);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function map(keyType, valueType, params) {
  return new ZodMap({
    type: "map",
    keyType,
    valueType,
    ...exports_util.normalizeParams(params)
  });
}
var ZodSet = /* @__PURE__ */ $constructor("ZodSet", (inst, def) => {
  $ZodSet.init(inst, def);
  ZodType.init(inst, def);
  inst.min = (...args) => inst.check(_minSize(...args));
  inst.nonempty = (params) => inst.check(_minSize(1, params));
  inst.max = (...args) => inst.check(_maxSize(...args));
  inst.size = (...args) => inst.check(_size(...args));
});
function set(valueType, params) {
  return new ZodSet({
    type: "set",
    valueType,
    ...exports_util.normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum2(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...exports_util.normalizeParams(params)
  });
}
function nativeEnum(entries, params) {
  return new ZodEnum({
    type: "enum",
    entries,
    ...exports_util.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...exports_util.normalizeParams(params)
  });
}
var ZodFile = /* @__PURE__ */ $constructor("ZodFile", (inst, def) => {
  $ZodFile.init(inst, def);
  ZodType.init(inst, def);
  inst.min = (size, params) => inst.check(_minSize(size, params));
  inst.max = (size, params) => inst.check(_maxSize(size, params));
  inst.mime = (types, params) => inst.check(_mime(Array.isArray(types) ? types : [types], params));
});
function file(params) {
  return _file(ZodFile, params);
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(exports_util.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(exports_util.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
function nullish2(innerType) {
  return optional(nullable(innerType));
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default2(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : exports_util.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : exports_util.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...exports_util.normalizeParams(params)
  });
}
var ZodSuccess = /* @__PURE__ */ $constructor("ZodSuccess", (inst, def) => {
  $ZodSuccess.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function success(innerType) {
  return new ZodSuccess({
    type: "success",
    innerType
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch2(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodNaN = /* @__PURE__ */ $constructor("ZodNaN", (inst, def) => {
  $ZodNaN.init(inst, def);
  ZodType.init(inst, def);
});
function nan(params) {
  return _nan(ZodNaN, params);
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodCodec = /* @__PURE__ */ $constructor("ZodCodec", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodCodec.init(inst, def);
});
function codec(in_, out, params) {
  return new ZodCodec({
    type: "pipe",
    in: in_,
    out,
    transform: params.decode,
    reverseTransform: params.encode
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodTemplateLiteral = /* @__PURE__ */ $constructor("ZodTemplateLiteral", (inst, def) => {
  $ZodTemplateLiteral.init(inst, def);
  ZodType.init(inst, def);
});
function templateLiteral(parts, params) {
  return new ZodTemplateLiteral({
    type: "template_literal",
    parts,
    ...exports_util.normalizeParams(params)
  });
}
var ZodLazy = /* @__PURE__ */ $constructor("ZodLazy", (inst, def) => {
  $ZodLazy.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.getter();
});
function lazy(getter) {
  return new ZodLazy({
    type: "lazy",
    getter
  });
}
var ZodPromise = /* @__PURE__ */ $constructor("ZodPromise", (inst, def) => {
  $ZodPromise.init(inst, def);
  ZodType.init(inst, def);
  inst.unwrap = () => inst._zod.def.innerType;
});
function promise(innerType) {
  return new ZodPromise({
    type: "promise",
    innerType
  });
}
var ZodFunction = /* @__PURE__ */ $constructor("ZodFunction", (inst, def) => {
  $ZodFunction.init(inst, def);
  ZodType.init(inst, def);
});
function _function(params) {
  return new ZodFunction({
    type: "function",
    input: Array.isArray(params?.input) ? tuple(params?.input) : params?.input ?? array(unknown()),
    output: params?.output ?? unknown()
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
});
function check(fn) {
  const ch = new $ZodCheck({
    check: "custom"
  });
  ch._zod.check = fn;
  return ch;
}
function custom(fn, _params) {
  return _custom(ZodCustom, fn ?? (() => true), _params);
}
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn) {
  return _superRefine(fn);
}
function _instanceof(cls, params = {
  error: `Input not instance of ${cls.name}`
}) {
  const inst = new ZodCustom({
    type: "custom",
    check: "custom",
    fn: (data) => data instanceof cls,
    abort: true,
    ...exports_util.normalizeParams(params)
  });
  inst._zod.bag.Class = cls;
  return inst;
}
var stringbool = (...args) => _stringbool({
  Codec: ZodCodec,
  Boolean: ZodBoolean,
  String: ZodString
}, ...args);
function json(params) {
  const jsonSchema = lazy(() => {
    return union([string2(params), number2(), boolean2(), _null3(), array(jsonSchema), record(string2(), jsonSchema)]);
  });
  return jsonSchema;
}
function preprocess(fn, schema) {
  return pipe(transform(fn), schema);
}
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/classic/compat.js
var ZodIssueCode = {
  invalid_type: "invalid_type",
  too_big: "too_big",
  too_small: "too_small",
  invalid_format: "invalid_format",
  not_multiple_of: "not_multiple_of",
  unrecognized_keys: "unrecognized_keys",
  invalid_union: "invalid_union",
  invalid_key: "invalid_key",
  invalid_element: "invalid_element",
  invalid_value: "invalid_value",
  custom: "custom"
};
function setErrorMap(map2) {
  config({
    customError: map2
  });
}
function getErrorMap() {
  return config().customError;
}
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/classic/coerce.js
var exports_coerce = {};
__export(exports_coerce, {
  string: () => string3,
  number: () => number3,
  date: () => date4,
  boolean: () => boolean3,
  bigint: () => bigint3
});
function string3(params) {
  return _coercedString(ZodString, params);
}
function number3(params) {
  return _coercedNumber(ZodNumber, params);
}
function boolean3(params) {
  return _coercedBoolean(ZodBoolean, params);
}
function bigint3(params) {
  return _coercedBigint(ZodBigInt, params);
}
function date4(params) {
  return _coercedDate(ZodDate, params);
}

// ../node_modules/.bun/zod@4.1.12/node_modules/zod/v4/classic/external.js
config(en_default());
// ../viewer/src/protocol/wire.ts
var uint = exports_external.number().int().nonnegative();
function pairing(item) {
  return exports_external.object({ lhs: item.optional(), rhs: item.optional() });
}
var fileRef = exports_external.object({ path: exports_external.string(), oid: exports_external.string(), mode: exports_external.string() });
var visibility = exports_external.object({
  collapsed: exports_external.boolean().default(false),
  label: exports_external.string().default("")
});
var problem = exports_external.object({ code: exports_external.string(), message: exports_external.string() });
var fileChange = exports_external.object({
  file: pairing(fileRef),
  status: exports_external.enum(["added", "deleted", "modified", "renamed", "copied", "type_changed"]),
  tags: exports_external.array(exports_external.string()).default([])
});
var snapshot = exports_external.discriminatedUnion("type", [
  exports_external.object({ type: exports_external.literal("revision"), rev: exports_external.string() }),
  exports_external.object({ type: exports_external.literal("index") }),
  exports_external.object({ type: exports_external.literal("working_tree") }),
  exports_external.object({ type: exports_external.literal("empty_tree") }),
  exports_external.object({ type: exports_external.literal("path"), path: exports_external.string() })
]);
var sourcePos = exports_external.object({ line: uint, column: uint });
var span = exports_external.object({ line: uint, start_column: uint, end_column: uint });
var syntaxSpan = span.extend({ capture: exports_external.string() });
var regionBase = exports_external.object({
  id: uint,
  fold_state_id: uint,
  start: sourcePos,
  end: sourcePos,
  tags: exports_external.array(exports_external.string()).default([]),
  visibility: visibility.default({ collapsed: false, label: "" })
});
var region = exports_external.lazy(() => exports_external.discriminatedUnion("kind", [
  regionBase.extend({ kind: exports_external.literal("leaf"), alignment_id: uint, pair: uint.optional(), changed: exports_external.array(span).default([]) }).transform((leaf) => ({ ...leaf, children: [] })),
  regionBase.extend({
    kind: exports_external.literal("fold"),
    children: exports_external.array(region),
    indent: sourcePos,
    syntax: exports_external.object({ start: sourcePos, end: sourcePos }).optional()
  }).transform((fold) => ({ ...fold, changed: [] }))
]));
var source = exports_external.object({
  text: exports_external.string(),
  syntax: exports_external.array(syntaxSpan).default([]),
  root: region
});
var lineCounts = exports_external.object({ added: uint, removed: uint });
var stats = exports_external.object({
  textual: lineCounts,
  visible: lineCounts,
  fallback: problem.optional()
});
var diff = exports_external.discriminatedUnion("type", [
  exports_external.object({ type: exports_external.literal("text"), lhs: source.optional(), rhs: source.optional(), stats }),
  exports_external.object({
    type: exports_external.literal("binary"),
    lhs: exports_external.object({ size: uint }).optional(),
    rhs: exports_external.object({ size: uint }).optional()
  })
]);
var fileEvent = exports_external.object({
  type: exports_external.literal("file"),
  file: pairing(fileRef),
  diff: diff.optional(),
  error: problem.optional()
});
var eventSchema = exports_external.discriminatedUnion("type", [
  exports_external.object({
    type: exports_external.literal("start"),
    version: exports_external.literal(3),
    lhs: snapshot,
    rhs: snapshot,
    files: exports_external.array(fileChange)
  }),
  fileEvent,
  exports_external.object({ type: exports_external.literal("complete"), succeeded: uint, failed: uint, aborted: problem.optional() })
]);
var fileIdentity = (file2) => JSON.stringify([file2.lhs?.path ?? null, file2.rhs?.path ?? null]);
var filePath = (file2) => file2.rhs?.path ?? file2.lhs?.path ?? "";
function fileVisibility(file2) {
  return file2.diff?.type === "text" ? (file2.diff.rhs ?? file2.diff.lhs).root.visibility : { collapsed: false, label: "" };
}

// ../viewer/src/protocol/store.ts
class DiffStore {
  value = {
    comparison: null,
    inventory: [],
    files: [],
    failures: [],
    loaded: 0,
    errors: [],
    complete: false
  };
  slots = new Map;
  notification;
  notify() {
    if (this.notification !== undefined || this.listeners.size === 0)
      return;
    this.notification = setTimeout(() => {
      this.notification = undefined;
      this.listeners.forEach((listener) => listener());
    }, 16);
  }
  listeners = new Set;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.value;
  accept(event) {
    if (event.type === "start") {
      this.slots = new Map(event.files.map((entry, index) => [fileIdentity(entry.file), index]));
      this.value = {
        ...this.value,
        comparison: { lhs: event.lhs, rhs: event.rhs },
        inventory: event.files,
        files: event.files.map(() => {
          return;
        }),
        failures: event.files.map(() => {
          return;
        })
      };
    }
    if (event.type === "file") {
      const slot = this.slots.get(fileIdentity(event.file));
      if (slot === undefined)
        throw new Error(`${filePath(event.file)} is not in the manifest`);
      if (this.value.files[slot] || this.value.failures[slot])
        throw new Error(`${filePath(event.file)} arrived twice`);
      if (event.diff) {
        const files = [...this.value.files];
        files[slot] = { ...event, diff: event.diff };
        this.value = { ...this.value, files, loaded: this.value.loaded + 1 };
      } else if (event.error) {
        const failures = [...this.value.failures];
        failures[slot] = event.error.message;
        this.value = {
          ...this.value,
          failures,
          errors: [...this.value.errors, `${filePath(event.file)}: ${event.error.message}`]
        };
      }
    }
    if (event.type === "complete")
      this.value = {
        ...this.value,
        complete: true,
        errors: event.aborted ? [...this.value.errors, `diffr stopped early: ${event.aborted.message}`] : this.value.errors
      };
    this.notify();
  }
  fail(error46) {
    this.value = {
      ...this.value,
      complete: true,
      errors: [...this.value.errors, String(error46)]
    };
    this.notify();
  }
}

// ../viewer/src/protocol/events.ts
async function* parseDiffEvents(texts) {
  let buffer = "", complete = false;
  function parse6(line) {
    if (line.length > 128 * 1024 * 1024)
      throw new Error("diffr event exceeds 128 MiB");
    const event = eventSchema.parse(JSON.parse(line));
    if (event.type === "complete")
      complete = true;
    return event;
  }
  for await (const text of texts) {
    buffer += text;
    let end;
    while ((end = buffer.indexOf(`
`)) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim())
        yield parse6(line);
    }
    if (buffer.length > 128 * 1024 * 1024)
      throw new Error("diffr event exceeds 128 MiB");
  }
  if (buffer.trim())
    yield parse6(buffer);
  if (!complete)
    throw new Error("Incomplete diffr stream");
}

// src/args.ts
function splitArgs(text) {
  const args = [];
  let current = "", quote, started = false;
  for (const char of text) {
    if (quote) {
      if (char === quote)
        quote = undefined;
      else
        current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started)
        args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote)
    throw new Error(`Unclosed ${quote} in: ${text}`);
  if (started)
    args.push(current);
  return args;
}

// src/protocol.ts
var action = exports_external.union([
  exports_external.strictObject({ fold: exports_external.number().int(), file: exports_external.number().int() }),
  exports_external.strictObject({ viewedFile: exports_external.number().int() }),
  exports_external.strictObject({ file: exports_external.number().int() }),
  exports_external.strictObject({ jump: exports_external.number().int() }),
  exports_external.strictObject({ dir: exports_external.string() }),
  exports_external.strictObject({ scrub: exports_external.number().int() }),
  exports_external.strictObject({ layout: exports_external.literal(true) }),
  exports_external.strictObject({ help: exports_external.literal(true) }),
  exports_external.strictObject({ pick: exports_external.number().int() }),
  exports_external.strictObject({ files: exports_external.literal(true) })
]);
var hover = exports_external.union([
  exports_external.strictObject({ file: exports_external.number().int(), id: exports_external.number().int(), armed: exports_external.boolean() }),
  exports_external.strictObject({ file: exports_external.number().int(), header: exports_external.literal(true) })
]);
var keyPress = exports_external.object({
  key: exports_external.string(),
  ctrl: exports_external.literal(true).optional(),
  shift: exports_external.literal(true).optional(),
  meta: exports_external.literal(true).optional()
});
var input = exports_external.union([
  exports_external.strictObject({ act: action, alt: exports_external.literal(true).optional() }),
  exports_external.strictObject({ press: keyPress }),
  exports_external.strictObject({ select: exports_external.strictObject({ x: exports_external.number().int(), y: exports_external.number().int(), extend: exports_external.literal(true).optional() }) })
]);
var post = exports_external.strictObject({
  instance: exports_external.string(),
  inputs: exports_external.array(exports_external.tuple([exports_external.number().int(), input])),
  hover: hover.nullable().optional()
});
var parsePost = (data) => post.parse(data);

// ../viewer/src/document/counts.ts
var zero = { added: 0, removed: 0 };
var add = (a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed });
function blockBar(counts, blocks = 5) {
  const total = counts.added + counts.removed;
  if (total === 0)
    return Array.from({ length: blocks }, () => "neutral");
  let green = Math.floor(blocks * counts.added / total);
  let red = Math.floor(blocks * counts.removed / total);
  if (counts.added > 0 && green === 0)
    green = 1;
  if (counts.removed > 0 && red === 0)
    red = 1;
  while (green + red > blocks) {
    if (green >= red)
      green--;
    else
      red--;
  }
  return [
    ...Array.from({ length: green }, () => "added"),
    ...Array.from({ length: red }, () => "removed"),
    ...Array.from({ length: blocks - green - red }, () => "neutral")
  ];
}
function snapshotLabel(snapshot2) {
  switch (snapshot2.type) {
    case "revision":
      return /^[0-9a-f]{40}$/.test(snapshot2.rev) ? snapshot2.rev.slice(0, 7) : snapshot2.rev;
    case "index":
      return "index";
    case "working_tree":
      return "working tree";
    case "empty_tree":
      return "empty tree";
    case "path":
      return snapshot2.path;
  }
}
var comparisonLabel = (lhs, rhs) => `${snapshotLabel(lhs)}…${snapshotLabel(rhs)}`;

// ../viewer/src/document/fileTree.ts
function buildFileTree(files) {
  const roots = [];
  const directories = new Map;
  files.forEach((file2, fileIndex) => {
    const path = filePath(file2.file);
    const parts = path.split("/").filter(Boolean);
    let children = roots, prefix = "";
    parts.forEach((name, i) => {
      prefix += "/" + name;
      if (i === parts.length - 1) {
        children.push({ key: `file:${fileIndex}`, name, fileIndex, children: [] });
      } else {
        let dir = directories.get(prefix);
        if (!dir) {
          dir = { key: prefix, name, children: [] };
          directories.set(prefix, dir);
          children.push(dir);
        }
        children = dir.children;
      }
    });
  });
  const sort = (nodes) => {
    nodes.sort((a, b) => Number(a.fileIndex !== undefined) - Number(b.fileIndex !== undefined) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
function flattenFileTree(nodes, closed, depth = 0) {
  return nodes.flatMap((node) => [
    { node, depth },
    ...node.fileIndex === undefined && !closed.has(node.key) ? flattenFileTree(node.children, closed, depth + 1) : []
  ]);
}
function parentDirectories(file2) {
  const parts = filePath(file2.file).split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => "/" + parts.slice(0, i + 1).join("/"));
}
function lineCounts2(file2) {
  if (file2.diff.type === "binary")
    return { textual: { added: 0, removed: 0 }, visible: { added: 0, removed: 0 } };
  return { textual: file2.diff.stats.textual, visible: file2.diff.stats.visible, fallback: file2.diff.stats.fallback };
}

// ../viewer/src/terminal/sanitize.ts
var controlCodeRegex = /[\x00-\x1f\x7f-\x9f]/;
var sevenBitControlStrings = /\x1b(?:\][\s\S]*?(?:\x07|\x1b\\|\x9c)|[PX^_][\s\S]*?(?:\x1b\\|\x9c)|\[[0-?]*[ -/]*[@-~])/g;
var c1ControlStrings = /[\x90\x98\x9d\x9e\x9f][\s\S]*?(?:\x07|\x1b\\|\x9c)/g;
var c1Csi = /\x9b[0-?]*[ -/]*[@-~]/g;
var controlCharacters = /[\x00-\x08\x0a-\x1f\x7f-\x9f]/g;
function sanitizeTerminalLine(text) {
  if (!controlCodeRegex.test(text)) {
    return text;
  }
  return text.replace(sevenBitControlStrings, "").replace(c1ControlStrings, "").replace(c1Csi, "").replace(controlCharacters, "");
}
function sanitizeTerminalSpans(spans) {
  let sanitized = null;
  for (let index = 0;index < spans.length; index += 1) {
    const span2 = spans[index];
    const text = sanitizeTerminalLine(span2.text);
    if (text === span2.text && text.length > 0) {
      sanitized?.push(span2);
      continue;
    }
    sanitized ??= spans.slice(0, index);
    if (text.length > 0) {
      sanitized.push({ ...span2, text });
    }
  }
  return sanitized ?? spans;
}

// ../node_modules/.bun/get-east-asian-width@1.4.0/node_modules/get-east-asian-width/lookup.js
function isAmbiguous(x) {
  return x === 161 || x === 164 || x === 167 || x === 168 || x === 170 || x === 173 || x === 174 || x >= 176 && x <= 180 || x >= 182 && x <= 186 || x >= 188 && x <= 191 || x === 198 || x === 208 || x === 215 || x === 216 || x >= 222 && x <= 225 || x === 230 || x >= 232 && x <= 234 || x === 236 || x === 237 || x === 240 || x === 242 || x === 243 || x >= 247 && x <= 250 || x === 252 || x === 254 || x === 257 || x === 273 || x === 275 || x === 283 || x === 294 || x === 295 || x === 299 || x >= 305 && x <= 307 || x === 312 || x >= 319 && x <= 322 || x === 324 || x >= 328 && x <= 331 || x === 333 || x === 338 || x === 339 || x === 358 || x === 359 || x === 363 || x === 462 || x === 464 || x === 466 || x === 468 || x === 470 || x === 472 || x === 474 || x === 476 || x === 593 || x === 609 || x === 708 || x === 711 || x >= 713 && x <= 715 || x === 717 || x === 720 || x >= 728 && x <= 731 || x === 733 || x === 735 || x >= 768 && x <= 879 || x >= 913 && x <= 929 || x >= 931 && x <= 937 || x >= 945 && x <= 961 || x >= 963 && x <= 969 || x === 1025 || x >= 1040 && x <= 1103 || x === 1105 || x === 8208 || x >= 8211 && x <= 8214 || x === 8216 || x === 8217 || x === 8220 || x === 8221 || x >= 8224 && x <= 8226 || x >= 8228 && x <= 8231 || x === 8240 || x === 8242 || x === 8243 || x === 8245 || x === 8251 || x === 8254 || x === 8308 || x === 8319 || x >= 8321 && x <= 8324 || x === 8364 || x === 8451 || x === 8453 || x === 8457 || x === 8467 || x === 8470 || x === 8481 || x === 8482 || x === 8486 || x === 8491 || x === 8531 || x === 8532 || x >= 8539 && x <= 8542 || x >= 8544 && x <= 8555 || x >= 8560 && x <= 8569 || x === 8585 || x >= 8592 && x <= 8601 || x === 8632 || x === 8633 || x === 8658 || x === 8660 || x === 8679 || x === 8704 || x === 8706 || x === 8707 || x === 8711 || x === 8712 || x === 8715 || x === 8719 || x === 8721 || x === 8725 || x === 8730 || x >= 8733 && x <= 8736 || x === 8739 || x === 8741 || x >= 8743 && x <= 8748 || x === 8750 || x >= 8756 && x <= 8759 || x === 8764 || x === 8765 || x === 8776 || x === 8780 || x === 8786 || x === 8800 || x === 8801 || x >= 8804 && x <= 8807 || x === 8810 || x === 8811 || x === 8814 || x === 8815 || x === 8834 || x === 8835 || x === 8838 || x === 8839 || x === 8853 || x === 8857 || x === 8869 || x === 8895 || x === 8978 || x >= 9312 && x <= 9449 || x >= 9451 && x <= 9547 || x >= 9552 && x <= 9587 || x >= 9600 && x <= 9615 || x >= 9618 && x <= 9621 || x === 9632 || x === 9633 || x >= 9635 && x <= 9641 || x === 9650 || x === 9651 || x === 9654 || x === 9655 || x === 9660 || x === 9661 || x === 9664 || x === 9665 || x >= 9670 && x <= 9672 || x === 9675 || x >= 9678 && x <= 9681 || x >= 9698 && x <= 9701 || x === 9711 || x === 9733 || x === 9734 || x === 9737 || x === 9742 || x === 9743 || x === 9756 || x === 9758 || x === 9792 || x === 9794 || x === 9824 || x === 9825 || x >= 9827 && x <= 9829 || x >= 9831 && x <= 9834 || x === 9836 || x === 9837 || x === 9839 || x === 9886 || x === 9887 || x === 9919 || x >= 9926 && x <= 9933 || x >= 9935 && x <= 9939 || x >= 9941 && x <= 9953 || x === 9955 || x === 9960 || x === 9961 || x >= 9963 && x <= 9969 || x === 9972 || x >= 9974 && x <= 9977 || x === 9979 || x === 9980 || x === 9982 || x === 9983 || x === 10045 || x >= 10102 && x <= 10111 || x >= 11094 && x <= 11097 || x >= 12872 && x <= 12879 || x >= 57344 && x <= 63743 || x >= 65024 && x <= 65039 || x === 65533 || x >= 127232 && x <= 127242 || x >= 127248 && x <= 127277 || x >= 127280 && x <= 127337 || x >= 127344 && x <= 127373 || x === 127375 || x === 127376 || x >= 127387 && x <= 127404 || x >= 917760 && x <= 917999 || x >= 983040 && x <= 1048573 || x >= 1048576 && x <= 1114109;
}
function isFullWidth(x) {
  return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
}
function isWide(x) {
  return x >= 4352 && x <= 4447 || x === 8986 || x === 8987 || x === 9001 || x === 9002 || x >= 9193 && x <= 9196 || x === 9200 || x === 9203 || x === 9725 || x === 9726 || x === 9748 || x === 9749 || x >= 9776 && x <= 9783 || x >= 9800 && x <= 9811 || x === 9855 || x >= 9866 && x <= 9871 || x === 9875 || x === 9889 || x === 9898 || x === 9899 || x === 9917 || x === 9918 || x === 9924 || x === 9925 || x === 9934 || x === 9940 || x === 9962 || x === 9970 || x === 9971 || x === 9973 || x === 9978 || x === 9981 || x === 9989 || x === 9994 || x === 9995 || x === 10024 || x === 10060 || x === 10062 || x >= 10067 && x <= 10069 || x === 10071 || x >= 10133 && x <= 10135 || x === 10160 || x === 10175 || x === 11035 || x === 11036 || x === 11088 || x === 11093 || x >= 11904 && x <= 11929 || x >= 11931 && x <= 12019 || x >= 12032 && x <= 12245 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12353 && x <= 12438 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12773 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 42124 || x >= 42128 && x <= 42182 || x >= 43360 && x <= 43388 || x >= 44032 && x <= 55203 || x >= 63744 && x <= 64255 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 94176 && x <= 94180 || x >= 94192 && x <= 94198 || x >= 94208 && x <= 101589 || x >= 101631 && x <= 101662 || x >= 101760 && x <= 101874 || x >= 110576 && x <= 110579 || x >= 110581 && x <= 110587 || x === 110589 || x === 110590 || x >= 110592 && x <= 110882 || x === 110898 || x >= 110928 && x <= 110930 || x === 110933 || x >= 110948 && x <= 110951 || x >= 110960 && x <= 111355 || x >= 119552 && x <= 119638 || x >= 119648 && x <= 119670 || x === 126980 || x === 127183 || x === 127374 || x >= 127377 && x <= 127386 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x === 127568 || x === 127569 || x >= 127584 && x <= 127589 || x >= 127744 && x <= 127776 || x >= 127789 && x <= 127797 || x >= 127799 && x <= 127868 || x >= 127870 && x <= 127891 || x >= 127904 && x <= 127946 || x >= 127951 && x <= 127955 || x >= 127968 && x <= 127984 || x === 127988 || x >= 127992 && x <= 128062 || x === 128064 || x >= 128066 && x <= 128252 || x >= 128255 && x <= 128317 || x >= 128331 && x <= 128334 || x >= 128336 && x <= 128359 || x === 128378 || x === 128405 || x === 128406 || x === 128420 || x >= 128507 && x <= 128591 || x >= 128640 && x <= 128709 || x === 128716 || x >= 128720 && x <= 128722 || x >= 128725 && x <= 128728 || x >= 128732 && x <= 128735 || x === 128747 || x === 128748 || x >= 128756 && x <= 128764 || x >= 128992 && x <= 129003 || x === 129008 || x >= 129292 && x <= 129338 || x >= 129340 && x <= 129349 || x >= 129351 && x <= 129535 || x >= 129648 && x <= 129660 || x >= 129664 && x <= 129674 || x >= 129678 && x <= 129734 || x === 129736 || x >= 129741 && x <= 129756 || x >= 129759 && x <= 129770 || x >= 129775 && x <= 129784 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
}

// ../node_modules/.bun/get-east-asian-width@1.4.0/node_modules/get-east-asian-width/index.js
function validate(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// ../node_modules/.bun/ansi-regex@6.4.0/node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? undefined : "g");
}

// ../node_modules/.bun/strip-ansi@7.1.2/node_modules/strip-ansi/index.js
var regex = ansiRegex();
function stripAnsi(string4) {
  if (typeof string4 !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string4}\``);
  }
  return string4.replace(regex, "");
}

// ../node_modules/.bun/string-width@8.1.0/node_modules/string-width/index.js
var segmenter = new Intl.Segmenter;
var zeroWidthClusterRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
var leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
var rgiEmojiRegex = /^\p{RGI_Emoji}$/v;
function baseVisible(segment) {
  return segment.replace(leadingNonPrintingRegex, "");
}
function isZeroWidthCluster(segment) {
  return zeroWidthClusterRegex.test(segment);
}
function trailingHalfwidthWidth(segment, eastAsianWidthOptions) {
  let extra = 0;
  if (segment.length > 1) {
    for (const char of segment.slice(1)) {
      if (char >= "＀" && char <= "￯") {
        extra += eastAsianWidth(char.codePointAt(0), eastAsianWidthOptions);
      }
    }
  }
  return extra;
}
function stringWidth(input2, options = {}) {
  if (typeof input2 !== "string" || input2.length === 0) {
    return 0;
  }
  const {
    ambiguousIsNarrow = true,
    countAnsiEscapeCodes = false
  } = options;
  let string4 = input2;
  if (!countAnsiEscapeCodes) {
    string4 = stripAnsi(string4);
  }
  if (string4.length === 0) {
    return 0;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment } of segmenter.segment(string4)) {
    if (isZeroWidthCluster(segment)) {
      continue;
    }
    if (rgiEmojiRegex.test(segment)) {
      width += 2;
      continue;
    }
    const codePoint = baseVisible(segment).codePointAt(0);
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
    width += trailingHalfwidthWidth(segment, eastAsianWidthOptions);
  }
  return width;
}

// ../viewer/src/terminal/text.ts
var printableAsciiRegex = /^[\u0020-\u007E]*$/;
function isPrintableAsciiText(text) {
  return printableAsciiRegex.test(text);
}
var graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme"
});
function textClusters(text) {
  return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
}
var zeroWidthScalarRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]$/u;
var emojiModifierRegex = /^\p{Emoji_Modifier}$/u;
var regionalIndicatorRegex = /^\p{Regional_Indicator}$/u;
function isGraphemePrepend(codePoint) {
  return codePoint >= 1536 && codePoint <= 1541 || codePoint === 1757 || codePoint === 1807 || codePoint >= 2192 && codePoint <= 2193 || codePoint === 2274 || codePoint === 3406 || codePoint === 69821 || codePoint === 69837 || codePoint >= 70082 && codePoint <= 70083 || codePoint === 71999 || codePoint === 72001 || codePoint === 72250 || codePoint >= 72324 && codePoint <= 72329 || codePoint === 73030 || codePoint === 73474;
}
function isCommonIndependentScalar(codePoint) {
  return codePoint >= 32 && codePoint <= 126 || codePoint >= 12288 && codePoint <= 12329 || codePoint >= 12353 && codePoint <= 12438 || codePoint >= 12445 && codePoint <= 12543 || codePoint >= 13312 && codePoint <= 40959 || codePoint >= 44032 && codePoint <= 55203 || codePoint >= 63744 && codePoint <= 64255 || codePoint >= 65281 && codePoint <= 65376 || codePoint >= 65504 && codePoint <= 65510;
}
function scalarRequiresGraphemeComposition(scalar, codePoint) {
  if (isCommonIndependentScalar(codePoint)) {
    return false;
  }
  return zeroWidthScalarRegex.test(scalar) || emojiModifierRegex.test(scalar) || regionalIndicatorRegex.test(scalar) || isGraphemePrepend(codePoint) || codePoint === 3635 || codePoint === 3763 || codePoint === 65438 || codePoint === 65439 || codePoint >= 4352 && codePoint <= 4607 || codePoint >= 43360 && codePoint <= 43391 || codePoint >= 55216 && codePoint <= 55295;
}
function measureSimpleSanitizedTextWidth(text) {
  let width = 0;
  for (const scalar of text) {
    const codePoint = scalar.codePointAt(0);
    if (scalarRequiresGraphemeComposition(scalar, codePoint)) {
      return null;
    }
    width += eastAsianWidth(codePoint);
  }
  return width;
}
var CLUSTER_WIDTH_CACHE_MAX_ENTRIES = 256;
var CLUSTER_WIDTH_CACHE_MAX_KEY_CODE_UNITS = 64;

class BoundedClusterWidthCache {
  maxEntries;
  maxKeyCodeUnits;
  #entries = new Map;
  constructor(maxEntries, maxKeyCodeUnits) {
    this.maxEntries = maxEntries;
    this.maxKeyCodeUnits = maxKeyCodeUnits;
  }
  get(cluster) {
    return this.#entries.get(cluster);
  }
  set(cluster, width) {
    if (cluster.length > this.maxKeyCodeUnits) {
      return;
    }
    this.#entries.set(cluster, width);
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined)
        break;
      this.#entries.delete(oldest);
    }
  }
  get size() {
    return this.#entries.size;
  }
}
var cachedClusterWidths = new BoundedClusterWidthCache(CLUSTER_WIDTH_CACHE_MAX_ENTRIES, CLUSTER_WIDTH_CACHE_MAX_KEY_CODE_UNITS);
function measureCachedClusterWidth(cluster) {
  const cached2 = cachedClusterWidths.get(cluster);
  if (cached2 !== undefined) {
    return cached2;
  }
  const width = stringWidth(cluster);
  cachedClusterWidths.set(cluster, width);
  return width;
}
function measureClusterWidth(cluster) {
  if (cluster.length === 1 && cluster.charCodeAt(0) >= 32 && cluster.charCodeAt(0) <= 126) {
    return 1;
  }
  const codePoint = cluster.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  const scalarUnitLength = codePoint > 65535 ? 2 : 1;
  if (cluster.length === scalarUnitLength) {
    return zeroWidthScalarRegex.test(cluster) ? 0 : eastAsianWidth(codePoint);
  }
  return measureCachedClusterWidth(cluster);
}
function repeatedSingleUnitChar(text) {
  if (text.length < 2) {
    return null;
  }
  const unit = text.charCodeAt(0);
  if (unit >= 55296 && unit <= 57343) {
    return null;
  }
  for (let index = 1;index < text.length; index += 1) {
    if (text.charCodeAt(index) !== unit) {
      return null;
    }
  }
  return text[0] ?? null;
}
function measureSanitizedTextWidth(text) {
  if (printableAsciiRegex.test(text)) {
    return text.length;
  }
  const repeatedChar = repeatedSingleUnitChar(text);
  if (repeatedChar !== null) {
    const codePoint = repeatedChar.codePointAt(0);
    const charWidth = measureClusterWidth(repeatedChar);
    if (charWidth > 0 && !scalarRequiresGraphemeComposition(repeatedChar, codePoint)) {
      return charWidth * text.length;
    }
  }
  const simpleWidth = measureSimpleSanitizedTextWidth(text);
  if (simpleWidth !== null) {
    return simpleWidth;
  }
  let width = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    width += measureClusterWidth(segment);
  }
  return width;
}
function measureTextWidth(text) {
  return measureSanitizedTextWidth(sanitizeTerminalLine(text));
}
function wrapSanitizedTextByWidth(safeText, lineWidth, firstLineWidth = lineWidth, firstLineHasContent = false) {
  const fullWidth = Math.max(0, lineWidth);
  if (fullWidth === 0 || safeText.length === 0) {
    return [];
  }
  const chunks = [];
  let remaining = Math.max(0, Math.min(firstLineWidth, fullWidth));
  let startsNewLine = false;
  if (printableAsciiRegex.test(safeText)) {
    let offset = 0;
    while (offset < safeText.length) {
      if (remaining === 0) {
        remaining = fullWidth;
        startsNewLine = true;
      }
      const chunkWidth2 = Math.min(remaining, safeText.length - offset);
      chunks.push({
        text: safeText.slice(offset, offset + chunkWidth2),
        width: chunkWidth2,
        startsNewLine
      });
      offset += chunkWidth2;
      remaining -= chunkWidth2;
      startsNewLine = false;
    }
    return chunks;
  }
  let chunkText = "";
  let chunkWidth = 0;
  let existingLineHasContent = firstLineHasContent;
  const flushChunk = () => {
    if (chunkText.length === 0) {
      return;
    }
    chunks.push({ text: chunkText, width: chunkWidth, startsNewLine });
    chunkText = "";
    chunkWidth = 0;
    startsNewLine = false;
  };
  const initialRemaining = remaining;
  const appendCluster = (cluster, clusterWidth) => {
    if (clusterWidth > remaining) {
      const rowAlreadyStarted = existingLineHasContent || remaining < fullWidth || chunkText.length > 0;
      flushChunk();
      remaining = fullWidth;
      startsNewLine = rowAlreadyStarted;
      existingLineHasContent = false;
      if (clusterWidth > fullWidth) {
        if (rowAlreadyStarted) {
          chunks.push({ text: "", width: 0, startsNewLine: true });
        }
        startsNewLine = false;
        return true;
      }
    }
    chunkText += cluster;
    chunkWidth += clusterWidth;
    remaining -= clusterWidth;
    return true;
  };
  let simpleScalars = true;
  for (const scalar of safeText) {
    const codePoint = scalar.codePointAt(0);
    if (scalarRequiresGraphemeComposition(scalar, codePoint)) {
      simpleScalars = false;
      break;
    }
    if (!appendCluster(scalar, eastAsianWidth(codePoint))) {
      flushChunk();
      return chunks;
    }
  }
  if (simpleScalars) {
    flushChunk();
    return chunks;
  }
  chunks.length = 0;
  remaining = initialRemaining;
  startsNewLine = false;
  chunkText = "";
  existingLineHasContent = firstLineHasContent;
  chunkWidth = 0;
  for (const cluster of textClusters(safeText)) {
    if (!appendCluster(cluster, measureClusterWidth(cluster))) {
      break;
    }
  }
  flushChunk();
  return chunks;
}
function sliceTextByWidth(text, offset, width) {
  return sliceSanitizedTextByWidth(sanitizeTerminalLine(text), offset, width);
}
function sliceSanitizedTextByWidth(safeText, offset, width) {
  const startOffset = Math.max(0, offset);
  const maxWidth = Math.max(0, width);
  if (maxWidth === 0) {
    return { text: "", width: 0 };
  }
  if (printableAsciiRegex.test(safeText)) {
    const sliced = safeText.slice(startOffset, startOffset + maxWidth);
    return { text: sliced, width: sliced.length };
  }
  let scalarCursor = 0;
  let scalarUsedWidth = 0;
  let scalarVisibleText = "";
  let simpleScalars = true;
  for (const scalar of safeText) {
    const codePoint = scalar.codePointAt(0);
    if (scalarRequiresGraphemeComposition(scalar, codePoint)) {
      simpleScalars = false;
      break;
    }
    const scalarWidth = eastAsianWidth(codePoint);
    const scalarStart = scalarCursor;
    const scalarEnd = scalarCursor + scalarWidth;
    scalarCursor = scalarEnd;
    if (scalarEnd <= startOffset) {
      continue;
    }
    if (scalarStart < startOffset) {
      const hiddenCellWidth = Math.min(scalarEnd, startOffset + maxWidth) - startOffset;
      if (hiddenCellWidth > 0) {
        scalarVisibleText += " ".repeat(hiddenCellWidth);
        scalarUsedWidth += hiddenCellWidth;
      }
      continue;
    }
    if (scalarUsedWidth + scalarWidth > maxWidth) {
      return { text: scalarVisibleText, width: scalarUsedWidth };
    }
    scalarVisibleText += scalar;
    scalarUsedWidth += scalarWidth;
  }
  if (simpleScalars) {
    return { text: scalarVisibleText, width: scalarUsedWidth };
  }
  let cursor = 0;
  let usedWidth = 0;
  let visibleText = "";
  for (const cluster of textClusters(safeText)) {
    const clusterWidth = measureClusterWidth(cluster);
    const clusterStart = cursor;
    const clusterEnd = cursor + clusterWidth;
    cursor = clusterEnd;
    if (clusterEnd <= startOffset) {
      continue;
    }
    if (clusterStart < startOffset) {
      const hiddenCellWidth = Math.min(clusterEnd, startOffset + maxWidth) - startOffset;
      if (hiddenCellWidth > 0) {
        visibleText += " ".repeat(hiddenCellWidth);
        usedWidth += hiddenCellWidth;
      }
      continue;
    }
    if (usedWidth + clusterWidth > maxWidth) {
      break;
    }
    visibleText += cluster;
    usedWidth += clusterWidth;
  }
  return { text: visibleText, width: usedWidth };
}

// ../viewer/src/document/regions.ts
function foldTint(id, side, paired) {
  if (paired.has(id))
    return "neutral";
  return side ? "inserted" : "removed";
}
function pairedIds(diff2) {
  const { leaves, folds } = flatten(diff2);
  const alignments = leaves.map((side) => new Set(side.map((leaf) => leaf.alignmentId)));
  const states = [0, 1].map((side) => new Set([...leaves[side], ...folds[side]].map((region2) => region2.foldStateId)));
  return [0, 1].map((side) => {
    const other = side ? 0 : 1;
    return new Set([
      ...leaves[side].filter((leaf) => alignments[other].has(leaf.alignmentId)).map((leaf) => leaf.id),
      ...folds[side].filter((fold) => states[other].has(fold.foldStateId)).map((fold) => fold.id)
    ]);
  });
}
var sourceLines = (text) => text === "" ? [] : text.replace(/\n$/, "").split(`
`);
var encoder = new TextEncoder;
function byteColumn(text, byte) {
  const prefix = new TextDecoder().decode(encoder.encode(text).slice(0, byte));
  let column = 0;
  for (const part of prefix.split(/(\t)/))
    column += part === "\t" ? 4 - column % 4 : measureTextWidth(part);
  return column;
}
function leafLines(region2) {
  return [region2.start.line, region2.end.column === 0 ? region2.end.line : region2.end.line + 1];
}
function flattenSide(source2, side) {
  const lines = sourceLines(source2.text);
  const leaves = [];
  const folds = [];
  const visit = (region2, ancestors, parentColumn) => {
    if (region2.kind === "leaf") {
      const [startLine, endLine] = leafLines(region2);
      const changed = new Map;
      for (const span2 of region2.changed)
        changed.set(span2.line, [...changed.get(span2.line) ?? [], span2]);
      leaves.push({
        id: region2.id,
        alignmentId: region2.alignment_id,
        foldStateId: region2.fold_state_id,
        side,
        startLine,
        endLine,
        changed,
        tags: region2.tags,
        collapsed: region2.visibility.collapsed,
        label: region2.visibility.label,
        parentColumn
      });
      return;
    }
    const { start, end } = region2;
    const hideEnd = end.column > 0 && encoder.encode(lines[end.line].trimEnd()).length <= end.column;
    const fold = {
      id: region2.id,
      foldStateId: region2.fold_state_id,
      side,
      startLine: start.line,
      lastHidden: end.line - (hideEnd ? 0 : 1),
      label: region2.visibility.label,
      tags: region2.tags,
      collapsed: region2.visibility.collapsed,
      nested: [],
      syntax: region2.syntax,
      parentColumn
    };
    for (const ancestor of ancestors)
      ancestor.nested.push(fold.foldStateId);
    folds.push(fold);
    const indent = lines[region2.indent.line];
    if (indent === undefined)
      throw new Error(`Fold ${region2.id} indents past the end of its file`);
    for (const child of region2.children)
      visit(child, [...ancestors, fold], byteColumn(indent, region2.indent.column));
  };
  for (const region2 of source2.root.children)
    visit(region2, [], 0);
  return { leaves, folds };
}
function flatten(diff2) {
  const lhs = diff2.lhs ? flattenSide(diff2.lhs, 0) : { leaves: [], folds: [] };
  const rhs = diff2.rhs ? flattenSide(diff2.rhs, 1) : { leaves: [], folds: [] };
  return { leaves: [lhs.leaves, rhs.leaves], folds: [lhs.folds, rhs.folds] };
}
function defaultCollapsed(diff2) {
  const ids = new Set;
  const { leaves, folds } = flatten(diff2);
  for (const item of [...leaves.flat(), ...folds.flat()])
    if (item.collapsed)
      ids.add(item.foldStateId);
  return ids;
}
function foldIds(diff2) {
  const { folds, leaves } = flatten(diff2);
  return [...new Set([...folds.flat().map((fold) => fold.foldStateId), ...leaves.flat().filter(foldableLeaf).map((l) => l.foldStateId)])];
}
function nestedIds(diff2, id) {
  const { folds, leaves } = flatten(diff2);
  const members = folds.flat().filter((f) => f.foldStateId === id);
  if (members.length)
    return [...new Set(members.flatMap((f) => f.nested))].filter((n) => n !== id);
  if (!leaves.flat().some((leaf) => leaf.foldStateId === id))
    throw new Error(`Unknown region ${id}`);
  return [];
}
function gapIds(diff2) {
  const sides = [diff2.lhs?.root.children ?? [], diff2.rhs?.root.children ?? []];
  const walk = (regions, visit) => {
    for (const region2 of regions) {
      visit(region2);
      walk(region2.children, visit);
    }
  };
  const paired = pairedIds(diff2);
  const changed = new Set;
  for (const regions of sides)
    walk(regions, (region2) => {
      if (region2.kind === "leaf" && region2.changed.length)
        changed.add(region2.alignment_id);
    });
  const gaps = new Set;
  sides.forEach((regions, side) => {
    const unchanged = (region2) => region2.kind === "leaf" ? paired[side].has(region2.id) && !changed.has(region2.alignment_id) : region2.children.every(unchanged);
    walk(regions, (region2) => {
      if (region2.visibility.collapsed && region2.tags.length === 0 && paired[side].has(region2.id) && unchanged(region2))
        gaps.add(region2.fold_state_id);
    });
  });
  return [...gaps];
}
function hidingIds(diff2, side, line, collapsed) {
  const { leaves, folds } = flatten(diff2);
  const ids = new Set;
  for (const fold of folds[side]) {
    const inline = fold.syntax && !fold.label.includes(`
`);
    const last = inline ? Math.max(fold.lastHidden, fold.syntax.end.line) : fold.lastHidden;
    if (collapsed.has(fold.foldStateId) && fold.startLine <= line && line <= last)
      ids.add(fold.foldStateId);
  }
  for (const leaf of leaves[side])
    if (collapsed.has(leaf.foldStateId) && leaf.startLine <= line && line < leaf.endLine)
      ids.add(leaf.foldStateId);
  return [...ids];
}
function hiddenLines(folds, collapsed) {
  const hidden = new Set;
  for (const fold of folds) {
    if (!collapsed.has(fold.foldStateId))
      continue;
    for (let line = fold.startLine;line <= fold.lastHidden; line++)
      hidden.add(line);
  }
  return hidden;
}
function collapsedFolds(folds, collapsed) {
  const rows = new Map;
  const collapsedFirst = [...folds].filter((fold) => collapsed.has(fold.foldStateId)).sort((a, b) => a.startLine - b.startLine || b.lastHidden - a.lastHidden);
  let covered = -1;
  for (const fold of collapsedFirst) {
    if (fold.startLine <= covered)
      continue;
    rows.set(fold.startLine, fold);
    covered = fold.lastHidden;
  }
  return rows;
}
var foldableLeaf = (leaf) => leaf.collapsed || leaf.label !== "";
function foldHeaders(folds, leaves, collapsed, paired) {
  const headers = new Map;
  for (const leaf of leaves)
    if (foldableLeaf(leaf))
      headers.set(leaf.startLine, {
        id: leaf.foldStateId,
        label: leaf.label,
        collapsed: collapsed.has(leaf.foldStateId),
        tint: foldTint(leaf.id, leaf.side, paired)
      });
  const byLine = new Map;
  for (const fold of folds) {
    if (collapsed.has(fold.foldStateId))
      continue;
    const header = fold.syntax?.start.line ?? fold.startLine;
    byLine.set(header, [...byLine.get(header) ?? [], fold]);
  }
  for (const [line, sharing] of byLine) {
    const scopes = sharing.filter((fold2) => fold2.syntax?.start.line === line);
    const fold = [...scopes.length ? scopes : sharing].sort((a, b) => b.lastHidden - a.lastHidden)[0];
    headers.set(line, {
      id: fold.foldStateId,
      label: fold.label,
      collapsed: false,
      tint: foldTint(fold.id, fold.side, paired)
    });
  }
  return headers;
}

// ../viewer/src/document/search.ts
var caseSensitive = (pattern) => pattern !== pattern.toLowerCase();
function occurrences(text, pattern) {
  if (!pattern)
    return [];
  const exact = caseSensitive(pattern);
  const haystack = exact ? text : text.toLowerCase(), needle = exact ? pattern : pattern.toLowerCase();
  const ranges = [];
  for (let at = haystack.indexOf(needle);at >= 0; at = haystack.indexOf(needle, at + needle.length))
    ranges.push([at, at + needle.length]);
  return ranges;
}

// ../node_modules/.bun/fuzzysort@4.0.2/node_modules/fuzzysort/fuzzysort.js
function single(search, target) {
  if (!search || !target)
    return null;
  let query = getQuery(search);
  if (!isPrepared(target))
    target = getPrepared(target);
  if ((query.bitflags & target._bitflags) !== query.bitflags)
    return null;
  let result = !query.hasSpace && query.lowerCodes.length === 2 ? algorithm2(query, target) : algorithm(query, target);
  return result && materialize(result);
}
function go(search, targets, options) {
  if (targets instanceof SnapshotTargets)
    return goSnapshot(search, targets, options);
  let key = options?.key;
  let keys = !key && options?.keys;
  let firstTarget = targets[0];
  if (!key && !keys && typeof firstTarget === "object" && firstTarget !== null && !isPrepared(firstTarget)) {
    throw new Error("fuzzysort: key or keys is required when searching object targets");
  }
  if (!search)
    return all(targets, options);
  let query = getQuery(search);
  if (keys)
    return goKeys(query, targets, options);
  let searchBitflags = query.bitflags;
  let twoChar = !query.hasSpace && query.lowerCodes.length === 2;
  let threshold = denormalizeScore(options?.threshold ?? 0.5);
  let limit = getLimit(options);
  let scoreFn = options?.scoreFn;
  let resultCount = 0;
  let limited = 0;
  let getter = key && makeGetter(key);
  for (let i = 0;i < targets.length; i++) {
    let obj = targets[i];
    let target = key ? getter === null ? obj[key] : getter(obj) : obj;
    if (!target)
      continue;
    if (!isPrepared(target))
      target = getPrepared(target);
    if ((searchBitflags & target._bitflags) !== searchBitflags)
      continue;
    let result = twoChar ? algorithm2(query, target) : algorithm(query, target);
    if (result === null)
      continue;
    let resultScore = result._score;
    if (scoreFn) {
      result = materialize(result, key ? obj : undefined);
      resultScore = scoreFn(result);
      if (!resultScore)
        continue;
      result._score = resultScore = denormalizeScore(resultScore);
    }
    if (resultScore < threshold)
      continue;
    let room = resultCount < limit;
    if (room)
      resultCount++;
    else {
      limited++;
      if (resultScore <= heap.peek()._score)
        continue;
    }
    if (!scoreFn)
      result = materialize(result, key ? obj : undefined);
    room ? heap.add(result) : heap.replaceTop(result);
  }
  return finishResults(resultCount, limited);
}
function highlight(result, open = "<b>", close = "</b>", threshold = 0.5) {
  let callback = typeof open === "function" ? open : null;
  let target = result.target;
  if (result._bestKeyScore !== undefined && normalizeScore(result._score) < normalizeScore(result._bestKeyScore) * threshold)
    return callback ? [target] : target;
  let raw = result._indexes;
  let indexes = raw === undefined ? result.indexes : raw.slice(0, raw.len ?? raw.length).sort((a, b) => a - b);
  if (!indexes.length)
    return callback ? [target] : target;
  let output = callback ? [] : "";
  let lastIndex = 0;
  let matchI = 0;
  for (let i = 0;i < indexes.length; ) {
    let start = indexes[i++];
    let end = start + 1;
    while (indexes[i] === end) {
      i++;
      end++;
    }
    let before = target.slice(lastIndex, start);
    let match = target.slice(start, end);
    if (callback)
      output.push(before, callback(match, matchI++));
    else
      output += before + open + match + close;
    lastIndex = end;
  }
  if (callback)
    output.push(target.slice(lastIndex));
  else
    output += target.slice(lastIndex);
  return output;
}
function score(result) {
  let value = result.score;
  return value === undefined ? normalizeScore(result._score) : value;
}
function remap(mappings) {
  for (let char in mappings) {
    remappings[char] = mappings[char];
    if (char.charCodeAt(0) < 128)
      customAsciiRemappings = true;
  }
  cleanup();
}
function prepare(target) {
  return prepTarget(target);
}
function snapshot2(targets, options) {
  return new SnapshotTargets(targets, options);
}
function cleanup() {
  targetCache.clear();
  searchCache.clear();
  heap.clear();
  simpleMatch = [];
  strictMatch = [];
  seen = [];
  seenAt = [];
  changes = [];
  partials = [];
  spaceScores = [];
  partIndexes = [];
  winnerIndexes = [];
  winnerScores = [];
  winnerKeys = [];
  keyTargets = [];
  keyResults = [];
  candidateBitOffsets = [];
  seenGeneration = 0;
}
function goSnapshotValues(search, snapshot3, options, singleChar) {
  let targets = snapshot3._targets;
  let objects = snapshot3._objects;
  let threshold = denormalizeScore(options?.threshold ?? 0.5);
  let limit = getLimit(options);
  let scoreFn = options?.scoreFn;
  let searchLen = search.lowerCodes.length;
  let shortSearch = !search.hasSpace && searchLen <= 3;
  let twoChar = !search.hasSpace && searchLen === 2;
  let rows = snapshot3._candidateRows;
  let rowsLength = snapshot3._candidateLength;
  let matchedRows = snapshot3._rows;
  let matchedCount = 0;
  let resultCount = 0;
  let limited = 0;
  for (let n = 0;n < rowsLength; n++) {
    let i = rows === null ? n : rows[n];
    let target = targets[i];
    if (target === noTarget || (search.bitflags & target._bitflags) !== search.bitflags)
      continue;
    let targetShort = shortSearch && target.target.length < 65535;
    let cutoff = !scoreFn && threshold === -INF && resultCount >= limit ? heap.peek()._score : -INF;
    let result;
    if (singleChar && targetShort)
      result = algorithm1(search, target, snapshot3._first, i);
    else if (twoChar && targetShort) {
      let start = snapshot3._offsets[i];
      let end = snapshot3._offsets[i + 1];
      result = algorithm2(search, target, snapshot3._beginnings, start, end, cutoff);
    } else if (twoChar)
      result = algorithm2(search, target, null, 0, 0, cutoff);
    else if (targetShort) {
      let start = snapshot3._offsets[i];
      let end = snapshot3._offsets[i + 1];
      result = algorithm(search, target, false, false, false, true, snapshot3._beginnings, start, end, cutoff);
    } else
      result = algorithm(search, target, false, false, false, true, null, 0, 0, cutoff);
    if (result === null)
      continue;
    matchedRows[matchedCount++] = i;
    if (result === prunedMatch) {
      limited++;
      continue;
    }
    let resultScore = result._score;
    if (scoreFn) {
      result = materialize(result, objects?.[i]);
      resultScore = scoreFn(result);
      if (!resultScore)
        continue;
      result._score = resultScore = denormalizeScore(resultScore);
    }
    if (resultScore < threshold)
      continue;
    let room = resultCount < limit;
    if (room)
      resultCount++;
    else {
      limited++;
      if (resultScore <= heap.peek()._score)
        continue;
    }
    if (objects && !scoreFn)
      result = materialize(result, objects[i]);
    room ? heap.add(result) : heap.replaceTop(result);
  }
  snapshot3._matchedRowsLen = matchedCount;
  return finishResults(resultCount, limited, !objects && !scoreFn && materialize);
}
function goSnapshot(search, snapshot3, options) {
  if (options?.key || options?.keys)
    throw new Error("fuzzysort: key/keys must be provided to snapshot(), not go()");
  snapshot3._finish();
  if (!search)
    return allSnapshot(snapshot3, options);
  let query = getQuery(search);
  let backtrack = snapshot3._backtrack(query, options);
  if (backtrack)
    return backtrack;
  snapshot3._beginSearch(query);
  try {
    let results;
    if (snapshot3._mode < 2) {
      let searchLen = query.lowerCodes.length;
      let code = query.lowerCodes[0];
      let singleChar = searchLen === 1 && code >= 97 && code <= 122;
      results = goSnapshotValues(query, snapshot3, options, singleChar);
    } else
      results = goKeys(query, snapshot3._objects, options, snapshot3);
    snapshot3._endSearch(query);
    snapshot3._remember(query, results, options);
    return results;
  } catch (error46) {
    snapshot3._resetSearch();
    throw error46;
  }
}
function goKeys(query, objects, options, snapshot3) {
  let indexed = snapshot3 !== undefined;
  let keys = indexed ? null : options.keys;
  let getters = indexed ? null : keys.map(makeGetter);
  let targets = indexed ? snapshot3._targets : null;
  let keysLength = indexed ? snapshot3._keysLength : keys.length;
  let searchBitflags = query.bitflags;
  let hasSpace = query.hasSpace;
  let spaceCount = query.parts.length;
  let threshold = denormalizeScore(options?.threshold ?? 0.5);
  let limit = getLimit(options);
  let searchLen = query.lowerCodes.length;
  let short = indexed && !hasSpace && searchLen <= 3;
  let twoChar = !hasSpace && searchLen === 2;
  let code = query.lowerCodes[0];
  let singleChar = short && searchLen === 1 && code >= 97 && code <= 122;
  let scoreFn = options?.scoreFn;
  let deferMaterialization = indexed && !scoreFn && (limit !== INF || threshold > -INF);
  let rows = indexed ? snapshot3._candidateRows : null;
  let rowsLength = indexed ? snapshot3._candidateLength : objects.length;
  let matchedRows = indexed ? snapshot3._rows : null;
  let matchedCount = 0;
  let resultCount = 0;
  let limited = 0;
  outer:
    for (let n = 0;n < rowsLength; n++) {
      let i = rows === null ? n : rows[n];
      let row = i * keysLength;
      if (indexed) {
        if ((searchBitflags & snapshot3._bitflags[i]) !== searchBitflags)
          continue;
      } else {
        let obj = objects[i];
        let keysBitflags = 0;
        for (let k = 0;k < keysLength; k++) {
          let target = getters[k] === null ? obj[keys[k]] : getters[k](obj);
          if (!target)
            target = noTarget;
          else if (!isPrepared(target))
            target = getPrepared(target);
          keyTargets[k] = target;
          keysBitflags |= target._bitflags;
        }
        if ((searchBitflags & keysBitflags) !== searchBitflags)
          continue;
      }
      if (hasSpace)
        for (let s = 0;s < spaceCount; s++) {
          spaceScores[s] = winnerScores[s] = -INF;
          winnerKeys[s] = -1;
        }
      for (let k = 0;k < keysLength; k++) {
        let target = indexed ? targets[row + k] : keyTargets[k];
        if (target === noTarget) {
          keyResults[k] = noTarget;
          continue;
        }
        if (hasSpace && indexed) {
          let possible = false;
          for (let s = 0;s < spaceCount; s++) {
            let partBitflags = query.parts[s].bitflags;
            if ((partBitflags & target._bitflags) === partBitflags) {
              possible = true;
              break;
            }
          }
          if (!possible) {
            keyResults[k] = noTarget;
            continue;
          }
        } else if (!hasSpace && (searchBitflags & target._bitflags) !== searchBitflags) {
          keyResults[k] = noTarget;
          continue;
        }
        let match;
        if (indexed) {
          let valueRow = row + k;
          let targetShort = short && target.target.length < 65535;
          if (singleChar && targetShort)
            match = algorithm1(query, target, snapshot3._first, valueRow);
          else if (twoChar && targetShort) {
            let start = snapshot3._offsets[valueRow];
            let end = snapshot3._offsets[valueRow + 1];
            match = algorithm2(query, target, snapshot3._beginnings, start, end);
          } else if (twoChar)
            match = algorithm2(query, target);
          else if (targetShort) {
            let start = snapshot3._offsets[valueRow];
            let end = snapshot3._offsets[valueRow + 1];
            match = algorithm(query, target, false, false, false, true, snapshot3._beginnings, start, end);
          } else
            match = algorithm(query, target, false, hasSpace);
        } else
          match = twoChar ? algorithm2(query, target) : algorithm(query, target, false, hasSpace);
        if (match === null) {
          keyResults[k] = noTarget;
          continue;
        }
        keyResults[k] = deferMaterialization ? match : materialize(match);
        if (hasSpace) {
          mergePartScores(spaceCount);
          for (let s = 0;s < spaceCount; s++) {
            let partScore = partials[s];
            if (partScore <= winnerScores[s])
              continue;
            winnerScores[s] = partScore;
            winnerKeys[s] = k;
            let source2 = partIndexes[s];
            let winner = winnerIndexes[s] ||= [];
            winner.length = source2.length;
            for (let j = 0;j < source2.length; j++)
              winner[j] = source2[j];
          }
        }
      }
      if (hasSpace) {
        for (let s = 0;s < spaceCount; s++)
          if (winnerKeys[s] !== -1) {
            appendIndexes(keyResults[winnerKeys[s]]._indexes, winnerIndexes[s]);
          }
      }
      let resultScore;
      if (hasSpace) {
        resultScore = 0;
        for (let s = 0;s < spaceCount; s++) {
          let partScore = spaceScores[s];
          if (partScore === -INF)
            continue outer;
          resultScore += partScore;
        }
      } else {
        resultScore = mergeScores(keyResults, keysLength);
        if (resultScore === -INF)
          continue;
      }
      if (indexed)
        matchedRows[matchedCount++] = i;
      let result = deferMaterialization ? null : captureKeysResult(keyResults, keysLength, objects[i], resultScore, hasSpace);
      if (scoreFn) {
        resultScore = scoreFn(result);
        if (!resultScore)
          continue;
        result._score = resultScore = denormalizeScore(resultScore);
      }
      if (resultScore < threshold)
        continue;
      let room = resultCount < limit;
      if (room)
        resultCount++;
      else {
        limited++;
        if (resultScore <= heap.peek()._score)
          continue;
      }
      if (result === null)
        result = captureKeysResult(keyResults, keysLength, objects[i], resultScore, hasSpace);
      room ? heap.add(result) : heap.replaceTop(result);
    }
  if (indexed)
    snapshot3._matchedRowsLen = matchedCount;
  return finishResults(resultCount, limited, deferMaterialization && materializeKeys);
}
function allSnapshot(snapshot3, options) {
  let results = [];
  let targets = snapshot3._targets;
  let objects = snapshot3._objects;
  let keysLength = snapshot3._keysLength;
  let total = keysLength === undefined ? targets.length : objects.length;
  results.total = total;
  let limit = getLimit(options);
  for (let i = 0, length = Math.min(total, limit);i < length; i++) {
    if (keysLength === undefined) {
      results.push(newResult(targets[i].target, -INF, objects?.[i]));
      continue;
    }
    let row = i * keysLength;
    for (let k = 0;k < keysLength; k++) {
      let target = targets[row + k];
      keyResults[k] = target === noTarget ? noTarget : newResult(target.target, -INF);
    }
    results.push(captureKeysResult(keyResults, keysLength, objects[i], -INF));
  }
  return results;
}
function all(targets, options) {
  let results = [];
  results.total = targets.length;
  let limit = getLimit(options);
  let key = options?.key;
  let keys = !key && options?.keys;
  if (keys) {
    let getters = keys.map(makeGetter);
    for (let obj of targets) {
      for (let k = keys.length - 1;k >= 0; k--) {
        let target = getters[k] === null ? obj[keys[k]] : getters[k](obj);
        if (!target)
          keyResults[k] = noTarget;
        else {
          if (!isPrepared(target))
            target = getPrepared(target);
          target._score = -INF;
          target._indexes.len = 0;
          keyResults[k] = target;
        }
      }
      results.push(captureKeysResult(keyResults, keys.length, obj, -INF));
      if (results.length >= limit)
        break;
    }
    return results;
  }
  let getter = key && makeGetter(key);
  for (let obj of targets) {
    let target = key ? getter === null ? obj[key] : getter(obj) : obj;
    if (target == null)
      continue;
    if (!isPrepared(target))
      target = getPrepared(target);
    if (key)
      target = newResult(target.target, -INF, obj);
    else {
      target._score = -INF;
      target._indexes.len = 0;
    }
    results.push(target);
    if (results.length >= limit)
      break;
  }
  return results;
}
function finishResults(length, limited, transform2) {
  if (!length)
    return noResults;
  let results = new Array(length);
  for (let i = length - 1;i >= 0; i--) {
    let result = heap.poll();
    if (transform2)
      result = transform2(result);
    if (result instanceof KeysResult && !result._partWinners)
      markBestKeyScore(result);
    results[i] = result;
  }
  results.total = length + limited;
  return results;
}
function materializeKeys(result) {
  for (let k = 0;k < result.length; k++)
    if (result[k] !== noTarget)
      result[k] = materialize(result[k]);
  return result;
}
function algorithm1(search, target, firstTable, row) {
  let matchI = target._targetLower.indexOf(search._lower);
  if (matchI === -1)
    return null;
  let beginning = firstTable[row * 26 + search.lowerCodes[0] - 97];
  let strict = beginning !== 0;
  if (strict)
    matchI = beginning - 1;
  let score2 = matchI === 0 ? 0 : -matchI * matchI * 0.2;
  if (!strict)
    score2 *= 1000;
  else if (target._beginningsLen > 24)
    score2 *= (target._beginningsLen - 24) * 10;
  target._score = score2 - target._targetLowerCodes.length + 1;
  target._indexes[0] = matchI;
  target._indexes.len = 1;
  return target;
}
function algorithm2(search, target, beginnings = null, start = 0, end = 0, cutoff = -INF) {
  let targetCodes = target._targetLowerCodes;
  let targetLen = targetCodes.length;
  let firstCode = search.lowerCodes[0];
  let secondCode = search.lowerCodes[1];
  let first = 0;
  while (targetCodes[first] !== firstCode)
    if (++first >= targetLen)
      return null;
  let second = first + 1;
  while (targetCodes[second] !== secondCode)
    if (++second >= targetLen)
      return null;
  if (cutoff !== -INF && scoreCeiling(2, targetLen) <= cutoff)
    return prunedMatch;
  if (beginnings === null) {
    beginnings = target._beginnings;
    if (beginnings === null)
      target._beginnings = beginnings = makeBeginnings(target);
    end = beginnings.length;
  }
  let substringI = target._targetLower.indexOf(search._lower, first);
  let substring = substringI !== -1;
  let low = lowerBound(beginnings, start, end, substringI);
  let substringStart = substring && low < end && beginnings[low] === substringI;
  let strict = substringStart && substringI === first;
  if (!strict) {
    let firstBeginning = start;
    while (firstBeginning < end && beginnings[firstBeginning] < first)
      firstBeginning++;
    for (let backtracks = 0;firstBeginning < end; ) {
      let strictFirst = beginnings[firstBeginning];
      if (targetCodes[strictFirst] !== firstCode) {
        firstBeginning++;
        continue;
      }
      let consecutive = strictFirst + 1;
      if (targetCodes[consecutive] === secondCode) {
        first = strictFirst;
        second = consecutive;
        strict = true;
        break;
      }
      let secondBeginning = firstBeginning + 1;
      while (secondBeginning < end && beginnings[secondBeginning] <= consecutive)
        secondBeginning++;
      while (secondBeginning < end && targetCodes[beginnings[secondBeginning]] !== secondCode)
        secondBeginning++;
      if (secondBeginning < end) {
        first = strictFirst;
        second = beginnings[secondBeginning];
        strict = true;
        break;
      }
      if (++backtracks > 200)
        break;
      firstBeginning++;
    }
  }
  if (substring && !substringStart) {
    while (low < end && beginnings[low] <= substringI)
      low++;
    for (;low < end; low++) {
      let index = beginnings[low];
      if (targetCodes[index] === firstCode && targetCodes[index + 1] === secondCode) {
        substringI = index;
        substringStart = true;
        break;
      }
    }
  }
  if (substring && (!strict || substringStart)) {
    first = substringI;
    second = substringI + 1;
  }
  let resultScore = second - first === 1 ? 0 : first - second * 2 - 11;
  if (first)
    resultScore -= first * first * 0.2;
  if (!strict)
    resultScore *= 1000;
  else if (end - start > 24)
    resultScore *= (end - start - 24) * 10;
  let lengthPenalty = (targetLen - 2) / 2;
  resultScore -= lengthPenalty;
  if (substring)
    resultScore /= 5;
  if (substringStart)
    resultScore /= 5;
  resultScore -= lengthPenalty;
  let substringEnd = substring && second === first + 1 && (second + 1 === targetLen || isBeginning(beginnings, start, end, second + 1));
  target._score = substringEnd ? resultScore + Math.min(4, -resultScore / 2) : resultScore;
  target._indexes[0] = first;
  target._indexes[1] = second;
  target._indexes.len = 2;
  return target;
}
function algorithm(search, target, spaces = false, partial2 = false, changed = false, singleMatch = true, beginnings = null, start = 0, end = 0, cutoff = -INF) {
  if (!spaces && search.hasSpace)
    return algorithmSpaces(search, target, partial2);
  let searchCodes = search.lowerCodes;
  let targetCodes = target._targetLowerCodes;
  let searchLen = searchCodes.length;
  let targetLen = targetCodes.length;
  let searchCode = searchCodes[0];
  let searchI = 0;
  let targetI = 0;
  for (;; ) {
    if (searchCode === targetCodes[targetI]) {
      simpleMatch[searchI] = targetI;
      if (++searchI === searchLen)
        break;
      searchCode = searchCodes[searchI];
    }
    if (++targetI >= targetLen)
      return null;
  }
  if (cutoff !== -INF && searchLen > 1 && scoreCeiling(searchLen, targetLen) <= cutoff)
    return prunedMatch;
  if (searchLen === 1 && !changed && singleMatch) {
    let matchI;
    let strict2;
    if (target._singleMatchCode === searchCode) {
      matchI = target._singleMatchIndex;
      strict2 = target._singleMatchStrict;
    } else if (target._nextBeginningIndexes !== null) {
      let next2 = target._nextBeginningIndexes;
      targetI = simpleMatch[0] === 0 ? 0 : next2[simpleMatch[0] - 1];
      while (targetI < targetLen && searchCode !== targetCodes[targetI])
        targetI = next2[targetI];
      strict2 = targetI < targetLen;
      matchI = strict2 ? targetI : simpleMatch[0];
    } else {
      prepareSingleMatch(target, searchCode, simpleMatch[0]);
      matchI = target._singleMatchIndex;
      strict2 = target._singleMatchStrict;
    }
    let resultScore = matchI === 0 ? 0 : -matchI * matchI * 0.2;
    if (!strict2)
      resultScore *= 1000;
    else if (target._beginningsLen > 24)
      resultScore *= (target._beginningsLen - 24) * 10;
    target._score = resultScore - (targetLen - 1);
    target._indexes[0] = matchI;
    target._indexes.len = 1;
    return target;
  }
  searchI = 0;
  let strict = false;
  let strictLen = 0;
  let next = target._nextBeginningIndexes;
  if (beginnings === null && next === null)
    next = target._nextBeginningIndexes = makeNextBeginnings(target);
  let beginningLen = beginnings === null ? changed ? 0 : target._beginningsLen : end - start;
  if (!beginningLen) {
    beginningLen = 1;
    for (let i = next[0];i < targetLen; i = next[i])
      beginningLen++;
    if (!changed)
      target._beginningsLen = beginningLen;
  }
  let substringI = searchLen <= 1 ? -1 : target._targetLower.indexOf(search._lower, simpleMatch[0]);
  let isSubstring = substringI !== -1;
  let substringStart = isSubstring && (substringI === 0 || (beginnings ? isBeginning(beginnings, start, end, substringI) : next[substringI - 1] === substringI));
  if (substringStart && substringI === simpleMatch[0])
    strict = true;
  else {
    targetI = simpleMatch[0] === 0 ? 0 : beginnings ? nextBeginning(beginnings, start, end, simpleMatch[0] - 1, targetLen) : next[simpleMatch[0] - 1];
    let backtracks = 0;
    if (targetI !== targetLen)
      for (;; ) {
        if (targetI >= targetLen) {
          if (searchI <= 0 || ++backtracks > 200)
            break;
          searchI--;
          let previous = strictMatch[--strictLen];
          targetI = beginnings ? nextBeginning(beginnings, start, end, previous, targetLen) : next[previous];
        } else if (searchCodes[searchI] === targetCodes[targetI]) {
          strictMatch[strictLen++] = targetI;
          if (++searchI === searchLen) {
            strict = true;
            break;
          }
          targetI++;
        } else
          targetI = beginnings ? nextBeginning(beginnings, start, end, targetI, targetLen) : next[targetI];
      }
  }
  if (isSubstring && !substringStart) {
    if (beginnings) {
      for (let b = start;b < end; b++) {
        let i = beginnings[b];
        if (i <= substringI)
          continue;
        let s = 0;
        for (;s < searchLen && searchCodes[s] === targetCodes[i + s]; s++)
          ;
        if (s === searchLen) {
          substringI = i;
          substringStart = true;
          break;
        }
      }
    } else
      for (let i = 0;i < next.length; i = next[i]) {
        if (i <= substringI)
          continue;
        let s = 0;
        for (;s < searchLen && searchCodes[s] === targetCodes[i + s]; s++)
          ;
        if (s === searchLen) {
          substringI = i;
          substringStart = true;
          break;
        }
      }
  }
  let matches;
  if (!strict) {
    if (isSubstring)
      for (let i = 0;i < searchLen; i++)
        simpleMatch[i] = substringI + i;
    matches = simpleMatch;
  } else if (substringStart) {
    for (let i = 0;i < searchLen; i++)
      simpleMatch[i] = substringI + i;
    matches = simpleMatch;
  } else
    matches = strictMatch;
  let matchEnd = matches[searchLen - 1] + 1;
  let substringEnd = isSubstring && matchEnd - matches[0] === searchLen && (matchEnd === targetLen || (beginnings ? isBeginning(beginnings, start, end, matchEnd) : next[matchEnd - 1] === matchEnd));
  target._score = calculateScore(matches, searchLen, targetLen, strict, beginningLen, isSubstring, substringStart, substringEnd);
  for (let i = 0;i < searchLen; i++)
    target._indexes[i] = matches[i];
  target._indexes.len = searchLen;
  return target;
}
function mergePartScores(length) {
  for (let i = 0;i < length; i++) {
    let partial2 = partials[i];
    let best = spaceScores[i];
    if (partial2 > -1000 && best > -INF)
      best = Math.max(best, (best + partial2) / 4);
    spaceScores[i] = Math.max(best, partial2);
  }
}
function appendIndexes(indexes, additions) {
  let length = indexes.len;
  outer:
    for (let i = 0;i < additions.length; i++) {
      let index = additions[i];
      for (let j = 0;j < length; j++)
        if (indexes[j] === index)
          continue outer;
      indexes[length++] = index;
    }
  indexes.len = length;
}
function mergeScores(results, length) {
  let total = -INF;
  for (let i = 0;i < length; i++) {
    let score2 = results[i]._score;
    if (score2 > -1000 && total > -INF)
      total = Math.max(total, (total + score2) / 4);
    if (score2 > total)
      total = score2;
  }
  return total;
}
function calculateScore(matches, searchLen, targetLen, strict, beginningLen, substring, substringStart, substringEnd) {
  let score2 = 0;
  let groups = 0;
  for (let i = 1;i < searchLen; i++)
    if (matches[i] - matches[i - 1] !== 1) {
      score2 -= matches[i];
      groups++;
    }
  let unmatchedDistance = matches[searchLen - 1] - matches[0] - (searchLen - 1);
  score2 -= (12 + unmatchedDistance) * groups;
  if (matches[0] !== 0)
    score2 -= matches[0] * matches[0] * 0.2;
  if (!strict)
    score2 *= 1000;
  else if (beginningLen > 24)
    score2 *= (beginningLen - 24) * 10;
  let lengthPenalty = (targetLen - searchLen) / 2;
  score2 -= lengthPenalty;
  let substringBonus = 1 + searchLen * searchLen;
  if (substring)
    score2 /= substringBonus;
  if (substringStart)
    score2 /= substringBonus;
  score2 -= lengthPenalty;
  return substringEnd ? score2 + Math.min(4, -score2 / 2) : score2;
}
function algorithmSpaces(search, target, partial2) {
  let seenLen = 0;
  let generation = ++seenGeneration;
  let score2 = 0;
  let result = null;
  let previousFirst = 0;
  let searches = search.parts;
  let changesLen = 0;
  let matched = false;
  for (let i = 0;i < searches.length; i++) {
    partials[i] = -INF;
    if (partial2)
      (partIndexes[i] ||= []).length = 0;
    result = algorithm(searches[i], target, false, false, changesLen !== 0, false);
    if (result === null) {
      if (partial2)
        continue;
      resetBeginnings(target, changesLen);
      return null;
    }
    matched = true;
    if (i < searches.length - 1) {
      let indexes = result._indexes;
      let consecutive = true;
      for (let j = 0;j < indexes.len - 1; j++)
        if (indexes[j + 1] - indexes[j] !== 1) {
          consecutive = false;
          break;
        }
      if (consecutive) {
        let beginning = indexes[indexes.len - 1] + 1;
        let previous = target._nextBeginningIndexes[beginning - 1];
        for (let j = beginning - 1;j >= 0 && target._nextBeginningIndexes[j] === previous; j--) {
          target._nextBeginningIndexes[j] = beginning;
          changes[changesLen * 2] = j;
          changes[changesLen * 2 + 1] = previous;
          changesLen++;
        }
      }
    }
    if (partial2) {
      let indexes = partIndexes[i];
      indexes.length = result._indexes.len;
      for (let j = 0;j < indexes.length; j++)
        indexes[j] = result._indexes[j];
    }
    let partScore = result._score / searches.length;
    score2 += partScore;
    partials[i] = partScore;
    if (result._indexes[0] < previousFirst)
      score2 -= (previousFirst - result._indexes[0]) * 2;
    previousFirst = result._indexes[0];
    if (!partial2)
      for (let j = 0;j < result._indexes.len; j++) {
        let index = result._indexes[j];
        if (seenAt[index] === generation)
          continue;
        seenAt[index] = generation;
        seen[seenLen++] = index;
      }
  }
  if (partial2 && !matched)
    return null;
  resetBeginnings(target, changesLen);
  if (target._bitflags & SPACE_BIT) {
    let spacedResult = algorithm(search, target, true);
    if (spacedResult !== null && spacedResult._score > score2) {
      if (partial2) {
        let searchFrom = 0;
        for (let i = 0;i < searches.length; i++) {
          partials[i] = spacedResult._score / searches.length;
          let part = searches[i]._lower;
          let searchI = search._lower.indexOf(part, searchFrom);
          let indexes = partIndexes[i];
          indexes.length = part.length;
          for (let j = 0;j < part.length; j++)
            indexes[j] = spacedResult._indexes[searchI + j];
          searchFrom = searchI + part.length;
        }
        if (spacedResult._score < GOOD_PART_SCORE)
          spacedResult._indexes.len = 0;
      }
      return spacedResult;
    }
  }
  if (partial2) {
    result = target;
    let targetLower = target._targetLower;
    for (let i = 1;i < searches.length; i++) {
      let previous = partIndexes[i - 1];
      if (!previous.length || !partIndexes[i].length)
        continue;
      let previousEnd = previous[previous.length - 1] + 1;
      let at = previousEnd;
      let code;
      while ((code = targetLower.charCodeAt(at)) === 32 || code >= 9 && code <= 13)
        at++;
      let part = searches[i]._lower;
      if (!targetLower.startsWith(part, at))
        continue;
      for (let j = previousEnd;j < at; j++)
        previous.push(j);
      let indexes = partIndexes[i];
      indexes.length = part.length;
      for (let j = 0;j < part.length; j++)
        indexes[j] = at + j;
    }
    result._indexes.len = 0;
    for (let i = 0;i < searches.length; i++)
      if (partials[i] * searches.length >= GOOD_PART_SCORE) {
        appendIndexes(result._indexes, partIndexes[i]);
      }
  } else {
    for (let i = 0;i < seenLen; i++)
      result._indexes[i] = seen[i];
    result._indexes.len = seenLen;
  }
  result._score = score2;
  return result;
}
function resetBeginnings(target, changesLen) {
  for (let i = changesLen - 1;i >= 0; i--) {
    target._nextBeginningIndexes[changes[i * 2]] = changes[i * 2 + 1];
  }
}

class SnapshotTargets {
  constructor(targets, options) {
    this._mode = options?.keys ? 2 : options?.key ? 1 : 0;
    this._keys = this._mode === 2 ? options.keys.slice() : [options?.key];
    this._input = targets.slice();
    this._index = 0;
    this._done = false;
    this._error = null;
    this._scheduled = null;
    if (targets.length === 0)
      this._finish();
    else
      this._schedule();
  }
  _schedule() {
    if (this._scheduled !== null)
      return;
    this._scheduled = scheduleTask((deadline) => {
      this._scheduled = null;
      this._run(deadline);
    });
  }
  _cancel() {
    if (this._scheduled !== null)
      this._scheduled();
    this._scheduled = null;
  }
  _initialize() {
    if (this._targets)
      return;
    let keysLength = this._mode === 2 ? this._keys.length : 1;
    let valueCount = this._input.length * keysLength;
    let rowCount = this._input.length;
    this._targets = new Array(valueCount);
    this._first = new Uint16Array(valueCount * 26);
    this._offsets = new Uint32Array(valueCount + 1);
    this._buildingBeginnings = [];
    this._rowCount = rowCount;
    this._rowWords = rowCount + 31 >> 5;
    this._rowBits = new Uint32Array(this._rowWords * 32);
    this._rows = new Uint32Array(rowCount);
    this._lastRowsLen = 0;
    this._matchedRowsLen = 0;
    this._lastQuery = null;
    this._candidateRows = null;
    this._candidateLength = rowCount;
    this._history = [];
    if (this._mode) {
      this._objects = this._input;
      this._getters = this._keys.map(makeGetter);
    }
    if (this._mode === 2) {
      this._keysLength = keysLength;
      this._bitflags = new Int32Array(rowCount);
    }
  }
  _run(deadline) {
    if (this._done || this._error)
      return;
    let end = Date.now() + 4;
    let hasTime = () => deadline && !deadline.didTimeout ? deadline.timeRemaining() > 1 : Date.now() < end;
    try {
      this._initialize();
      do
        this._prepareOne();
      while (this._index < this._input.length && hasTime());
      if (this._index === this._input.length)
        this._complete();
      else
        this._schedule();
    } catch (error46) {
      this._error = error46;
      this._done = true;
    }
  }
  _indexRow(row, bitflags) {
    let flags = bitflags >>> 0;
    let word = row >> 5;
    let mask = 1 << (row & 31);
    let words = this._rowWords;
    let bits = this._rowBits;
    while (flags) {
      let lowest = flags & -flags;
      let bit = 31 - Math.clz32(lowest);
      bits[bit * words + word] |= mask;
      flags = (flags & flags - 1) >>> 0;
    }
  }
  _prepareOne() {
    let i = this._index++;
    let mode = this._mode;
    let obj = this._input[i];
    let keysLength = mode === 2 ? this._keysLength : 1;
    let bitflags = 0;
    for (let k = 0;k < keysLength; k++) {
      let value = mode === 0 ? obj : this._getters[k] === null ? obj[this._keys[k]] : this._getters[k](obj);
      let row = mode === 2 ? i * keysLength + k : i;
      let prepared = this._targets[row] = value ? prepTarget(value) : noTarget;
      if (prepared !== noTarget)
        indexBeginnings(prepared, this._first, row, this._buildingBeginnings);
      this._offsets[row + 1] = this._buildingBeginnings.length;
      bitflags |= prepared._bitflags;
    }
    if (mode === 2)
      this._bitflags[i] = bitflags;
    this._indexRow(i, bitflags);
  }
  _complete() {
    this._beginnings = Uint16Array.from(this._buildingBeginnings);
    this._buildingBeginnings = this._input = this._getters = this._keys = null;
    this._done = true;
  }
  _bitOffsets(bitflags) {
    let offsetsLen = 0;
    let words = this._rowWords;
    for (let bit = 0;bit < 32; bit++)
      if (bitflags & 1 << bit)
        candidateBitOffsets[offsetsLen++] = bit * words;
    return offsetsLen;
  }
  _matchRows(bitflags, fill = false, stop = INF) {
    let offsetsLen = this._bitOffsets(bitflags);
    if (!offsetsLen) {
      if (fill) {
        this._candidateRows = null;
        this._candidateLength = this._rowCount;
      }
      return this._rowCount;
    }
    let bits = this._rowBits;
    let words = this._rowWords;
    let rowsLen = 0;
    for (let word = 0;word < words; word++) {
      let matches = bits[candidateBitOffsets[0] + word];
      for (let i = 1;i < offsetsLen && matches; i++)
        matches &= bits[candidateBitOffsets[i] + word];
      if (!fill) {
        rowsLen += bitCount(matches);
        if (rowsLen >= stop)
          return rowsLen;
        continue;
      }
      while (matches) {
        let lowest = matches & -matches;
        this._rows[rowsLen++] = (word << 5) + 31 - Math.clz32(lowest);
        matches = (matches & matches - 1) >>> 0;
      }
    }
    if (fill) {
      this._candidateRows = this._rows;
      this._candidateLength = rowsLen;
    }
    return rowsLen;
  }
  _beginSearch(query) {
    this._matchedRowsLen = 0;
    let previousQuery = this._lastQuery;
    let previousLength = this._lastRowsLen;
    this._lastQuery = null;
    let bitflags = query.bitflags >>> 0;
    if (previousQuery !== null && query._lower.startsWith(previousQuery)) {
      let staticCount = this._matchRows(bitflags, false, previousLength);
      if (previousLength <= staticCount) {
        this._candidateRows = this._rows;
        this._candidateLength = previousLength;
        return;
      }
    }
    this._matchRows(bitflags, true);
  }
  _endSearch(query) {
    this._lastRowsLen = this._matchedRowsLen;
    this._matchedRowsLen = 0;
    this._lastQuery = query._lower || null;
    this._candidateRows = null;
    this._candidateLength = 0;
  }
  _backtrack(query, options) {
    let history = this._history;
    if (history.length < 2 || options?.scoreFn || options?.threshold !== undefined)
      return null;
    let limit = getLimit(options);
    if (limit === INF)
      return null;
    let current = history[history.length - 1];
    let value = query._lower;
    if (current.query === value && current.limit === limit && current.results)
      return copyResults(current.results);
    if (value.length >= current.query.length || !current.query.startsWith(value))
      return null;
    let i = history.length - 2;
    while (i >= 0 && history[i].query.length > value.length)
      i--;
    let entry = history[i];
    if (!entry || entry.query !== value || entry.limit !== limit)
      return null;
    history.length = i + 1;
    if (!entry.results)
      return null;
    this._resetSearch();
    return copyResults(entry.results);
  }
  _remember(query, results, options) {
    let history = this._history;
    let limit = getLimit(options);
    if (options?.scoreFn || options?.threshold !== undefined || limit === INF || results.length > 256) {
      history.length = 0;
      return;
    }
    let value = query._lower;
    let last = history[history.length - 1];
    if (last && !value.startsWith(last.query))
      history.length = 0;
    else if (last?.query === value && last.limit === limit)
      history.pop();
    history.push({ query: value, limit, results: value.length <= 32 ? copyResults(results) : null });
  }
  _resetSearch() {
    this._lastQuery = null;
    this._lastRowsLen = this._matchedRowsLen = this._candidateLength = 0;
    this._candidateRows = null;
  }
  _finish() {
    if (this._error)
      throw this._error;
    if (this._done)
      return;
    this._cancel();
    try {
      this._initialize();
      while (this._index < this._input.length)
        this._prepareOne();
      this._complete();
    } catch (error46) {
      this._error = error46;
      this._done = true;
      throw error46;
    }
  }
}
function copyResult(result) {
  if (result === noTarget)
    return noTarget;
  if (result instanceof KeysResult) {
    let copy2 = result.map(copyResult);
    copy2.obj = result.obj;
    copy2._score = result._score;
    if (result._partWinners)
      copy2._partWinners = true;
    return copy2;
  }
  let copy = materialize(result, result.obj);
  if (result._bestKeyScore !== undefined)
    copy._bestKeyScore = result._bestKeyScore;
  let indexes = result._indexes;
  copy._indexes = indexes.slice(0, indexes.len ?? indexes.length);
  copy._indexes.len = copy._indexes.length;
  return copy;
}
function copyResults(results) {
  let copies = results.map(copyResult);
  copies.total = results.total;
  return copies;
}
function prepTarget(target) {
  if (isPrepared(target))
    target = target.target;
  else if (typeof target === "number")
    target = "" + target;
  else if (typeof target !== "string")
    target = "";
  let info = lowerInfo(target);
  return newResult(target, -INF, null, info._lower, info.lowerCodes, info.bitflags);
}
function prepQuery(search) {
  if (typeof search === "number")
    search = "" + search;
  else if (typeof search !== "string")
    search = "";
  search = remapChars(search).trim();
  let info = lowerInfoRemapped(search);
  info.bitflags &= ~SPACE_BIT;
  info.parts = info.hasSpace ? [...new Set(info._lower.split(/\s+/))].map(prepQuery) : [];
  return info;
}
function getPrepared(target) {
  if (target.length > 999)
    return prepTarget(target);
  let prepared = targetCache.get(target);
  if (prepared === undefined)
    targetCache.set(target, prepared = prepTarget(target));
  return prepared;
}
function getQuery(search) {
  if (search.length > 999)
    return prepQuery(search);
  let prepared = searchCache.get(search);
  if (prepared === undefined) {
    if (searchCache.size >= 512)
      searchCache.clear();
    searchCache.set(search, prepared = prepQuery(search));
  }
  return prepared;
}
function scanBeginnings(prepared, visit) {
  let target = remapChars(prepared.target);
  let wasUpper = false;
  let wasAlnum = false;
  let count = 0;
  for (let i = 0;i < target.length; i++) {
    let code = target.charCodeAt(i);
    let upper = code >= 65 && code <= 90;
    let alnum = upper || code >= 97 && code <= 122 || code >= 48 && code <= 57;
    let beginning = upper && !wasUpper || !wasAlnum || !alnum;
    wasUpper = upper;
    wasAlnum = alnum;
    if (beginning) {
      count++;
      visit(i);
    }
  }
  prepared._beginningsLen = count;
}
function indexBeginnings(prepared, firstTable, row, packed) {
  if (prepared.target.length >= 65535)
    return;
  let target = remapChars(prepared.target);
  let lowerCodes = prepared._targetLowerCodes;
  let offset = row * 26;
  let wasUpper = false;
  let wasAlnum = false;
  let count = 0;
  for (let i = 0;i < target.length; i++) {
    let code = target.charCodeAt(i);
    let upper = code >= 65 && code <= 90;
    let alnum = upper || code >= 97 && code <= 122 || code >= 48 && code <= 57;
    let beginning = upper && !wasUpper || !wasAlnum || !alnum;
    wasUpper = upper;
    wasAlnum = alnum;
    if (!beginning)
      continue;
    count++;
    packed.push(i);
    code = lowerCodes[i];
    if (code >= 97 && code <= 122) {
      let slot = offset + code - 97;
      if (firstTable[slot] === 0)
        firstTable[slot] = i + 1;
    }
  }
  prepared._beginningsLen = count;
}
function prepareSingleMatch(prepared, searchCode, fallbackIndex) {
  let matchI = fallbackIndex;
  let strict = false;
  scanBeginnings(prepared, (i) => {
    if (!strict && searchCode === prepared._targetLowerCodes[i]) {
      matchI = i;
      strict = true;
    }
  });
  prepared._singleMatchCode = searchCode;
  prepared._singleMatchIndex = matchI;
  prepared._singleMatchStrict = strict;
}
function makeBeginnings(prepared) {
  let beginnings = [];
  scanBeginnings(prepared, (i) => beginnings.push(i));
  return beginnings;
}
function makeNextBeginnings(prepared) {
  let next = [];
  let fill = 0;
  scanBeginnings(prepared, (i) => {
    for (;fill < i; fill++)
      next[fill] = i;
  });
  for (;fill < prepared.target.length; fill++)
    next[fill] = prepared.target.length;
  return next;
}
function remapCharacter(char) {
  let remapped = remappings[char];
  if (remapped !== undefined)
    return remapped;
  if (char.charCodeAt(0) < 128)
    return char;
  remapped = char.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return remapped.length === 1 ? remapped : char;
}
function remapChars(value) {
  if (customAsciiRemappings)
    return value.replace(/[\s\S]/g, remapCharacter);
  return /[^\x00-\x7F]|[\\"`]/.test(value) ? value.replace(/[^\x00-\x7F]|[\\"`]/g, remapCharacter) : value;
}
function lowerInfo(value) {
  return lowerInfoRemapped(remapChars(value));
}
function lowerInfoRemapped(value) {
  let lower = value.toLowerCase();
  let lowerCodes = [];
  let bitflags = 0;
  let hasSpace = false;
  for (let i = 0;i < lower.length; i++) {
    let code = lowerCodes[i] = lower.charCodeAt(i);
    if (code === 32) {
      hasSpace = true;
      bitflags |= SPACE_BIT;
      continue;
    }
    let bit = code >= 97 && code <= 122 ? code - 97 : code >= 48 && code <= 57 ? 26 : code <= 127 ? 30 : 31;
    bitflags |= 1 << bit;
  }
  return { lowerCodes, bitflags, hasSpace, _lower: lower };
}

class Result {
  get ["indexes"]() {
    return this._indexes.slice(0, this._indexes.len).sort((a, b) => a - b);
  }
  set ["indexes"](value) {
    this._indexes = value;
  }
  ["highlight"](open, close, threshold) {
    return highlight(this, open, close, threshold);
  }
  get ["score"]() {
    return normalizeScore(this._score);
  }
}

class KeysResult extends Array {
  get ["score"]() {
    return normalizeScore(this._score);
  }
}
function newResult(target, score2 = -INF, obj = null, lower = "", lowerCodes = null, bitflags = 0) {
  let result = new Result;
  result.target = target;
  result.obj = obj;
  result._score = score2;
  result._indexes = [];
  result._targetLower = lower;
  result._targetLowerCodes = lowerCodes;
  result._nextBeginningIndexes = null;
  result._beginnings = null;
  result._beginningsLen = 0;
  result._singleMatchCode = result._singleMatchIndex = -1;
  result._singleMatchStrict = false;
  result._bitflags = bitflags;
  return result;
}
function materialize(prepared, obj = null) {
  let result = new Result;
  result.target = prepared.target;
  result.obj = obj;
  result._score = prepared._score;
  result._indexes = prepared._indexes;
  return result;
}
function markBestKeyScore(result) {
  let best = -INF;
  for (let i = 0;i < result.length; i++)
    if (result[i] !== noTarget && result[i]._score > best)
      best = result[i]._score;
  for (let i = 0;i < result.length; i++)
    if (result[i] !== noTarget)
      result[i]._bestKeyScore = best;
  return result;
}
function captureKeysResult(matches, keysLength, obj, score2, partWinners = false) {
  let result = new KeysResult(keysLength);
  for (let k = 0;k < keysLength; k++)
    result[k] = matches[k];
  result.obj = obj;
  result._score = score2;
  if (partWinners)
    result._partWinners = true;
  return result;
}
var normalizeScore = (value) => value === -INF ? 0 : value > 1 ? value : Math.E ** (((-value + 1) ** 0.04307 - 1) * -2);
var denormalizeScore = (value) => value === 0 ? -INF : value > 1 ? value : 1 - Math.pow(Math.log(value) / -2 + 1, 1 / 0.04307);
var GOOD_PART_SCORE = denormalizeScore(0.5);
var isPrepared = (value) => typeof value === "object" && typeof value?._bitflags === "number";
function makeGetter(key) {
  if (typeof key === "function")
    return key;
  let path = Array.isArray(key) ? key : typeof key === "string" && key.includes(".") ? key.split(".") : null;
  if (path === null)
    return null;
  return (obj) => {
    if (path !== key) {
      let direct = obj[key];
      if (direct !== undefined)
        return direct;
    }
    for (let i = 0;obj && i < path.length; i++)
      obj = obj[path[i]];
    return obj;
  };
}
function scoreCeiling(searchLen, targetLen) {
  let lengthPenalty = (targetLen - searchLen) / 2;
  let bonus = 1 + searchLen * searchLen;
  let score2 = -lengthPenalty - lengthPenalty / (bonus * bonus);
  return score2 + Math.min(4, -score2 / 2);
}
function bitCount(value) {
  value -= value >>> 1 & 1431655765;
  value = (value & 858993459) + (value >>> 2 & 858993459);
  return (value + (value >>> 4) & 252645135) * 16843009 >>> 24;
}
function lowerBound(values, start, end, value) {
  while (start < end) {
    let middle = start + end >> 1;
    if (values[middle] < value)
      start = middle + 1;
    else
      end = middle;
  }
  return start;
}
function nextBeginning(indexes, start, end, index, targetLen) {
  let next = lowerBound(indexes, start, end, index + 1);
  return next < end ? indexes[next] : targetLen;
}
function isBeginning(indexes, start, end, index) {
  let found = lowerBound(indexes, start, end, index);
  return found < end && indexes[found] === index;
}
function getLimit(options) {
  return (options?.limit ?? 10) || INF;
}
function scheduleTask(run) {
  let id;
  if (typeof requestIdleCallback === "function") {
    id = requestIdleCallback(run, { timeout: 100 });
    return () => typeof cancelIdleCallback === "function" && cancelIdleCallback(id);
  }
  if (typeof setImmediate === "function") {
    id = setImmediate(run);
    return () => typeof clearImmediate === "function" && clearImmediate(id);
  }
  id = setTimeout(run);
  return () => clearTimeout(id);
}
function createHeap() {
  let items = [];
  let length = 0;
  function down() {
    let index = 0;
    let item = items[0];
    for (let child = 1;child < length; child = 1 + index * 2) {
      let right = child + 1;
      index = right < length && items[right]._score < items[child]._score ? right : child;
      items[index - 1 >> 1] = items[index];
    }
    for (let parent = index - 1 >> 1;index > 0 && item._score < items[parent]._score; parent = (index = parent) - 1 >> 1) {
      items[index] = items[parent];
    }
    items[index] = item;
  }
  return {
    add(item) {
      let index = length++;
      for (let parent = index - 1 >> 1;index > 0 && item._score < items[parent]._score; parent = (index = parent) - 1 >> 1) {
        items[index] = items[parent];
      }
      items[index] = item;
    },
    poll() {
      if (!length)
        return;
      let root = items[0];
      let last = items[--length];
      items[length] = undefined;
      if (length) {
        items[0] = last;
        down();
      }
      return root;
    },
    peek() {
      return length ? items[0] : undefined;
    },
    replaceTop(item) {
      items[0] = item;
      down();
    },
    clear() {
      items.length = length = 0;
    }
  };
}
var INF = Infinity;
var SPACE_BIT = 1 << 27;
var noResults = [];
noResults.total = 0;
var targetCache = new Map;
var searchCache = new Map;
var simpleMatch = [];
var strictMatch = [];
var seen = [];
var seenAt = [];
var changes = [];
var partials = [];
var spaceScores = [];
var partIndexes = [];
var winnerIndexes = [];
var winnerScores = [];
var winnerKeys = [];
var keyTargets = [];
var keyResults = [];
var candidateBitOffsets = [];
var seenGeneration = 0;
var remappings = {};
var remapFrom = "\\\"`‘’‚‛“”„‟«»‹›‐–—−⁄∕…øØłŁđĐðÐıħĦŧŦ";
var remapTo = "/''''''''''''''----//.oOlLdDdDihHtT";
for (let i = 0;i < remapFrom.length; i++)
  remappings[remapFrom[i]] = remapTo[i];
var customAsciiRemappings = false;
var heap = createHeap();
var noTarget = prepTarget("");
var prunedMatch = {};
var fuzzysort_default = { single, go, highlight, score, remap, prepare, snapshot: snapshot2, cleanup };

// ../viewer/src/document/pick.ts
var prepared = new WeakMap;
function preparedPaths(inventory) {
  let paths = prepared.get(inventory);
  if (!paths) {
    paths = inventory.map((change) => fuzzysort_default.prepare(filePath(change.file)));
    prepared.set(inventory, paths);
  }
  return paths;
}
function rankFiles(inventory, order, query, viewed) {
  const paths = preparedPaths(inventory);
  const picks = query ? fuzzysort_default.go(query, order, { key: (index) => paths[index], limit: 0, threshold: 0 }).map((result) => ({ fileIndex: result.obj, path: result.target, indexes: result.indexes })) : order.map((index) => ({ fileIndex: index, path: paths[index].target, indexes: [] }));
  return [...picks.filter((pick2) => !viewed(pick2.fileIndex)), ...picks.filter((pick2) => viewed(pick2.fileIndex))];
}

// ../viewer/src/terminal/spans.ts
function sameStyle(a, b) {
  const left = a, right = b;
  for (const key in left)
    if (key !== "text" && left[key] !== right[key])
      return false;
  for (const key in right)
    if (key !== "text" && left[key] !== right[key])
      return false;
  return true;
}
function appendSpan(target, span2) {
  const previous = target.at(-1);
  if (previous && sameStyle(previous, span2)) {
    previous.text += span2.text;
  } else {
    target.push(span2);
  }
}
function mergeCrossSpanGraphemes(spans) {
  const normalized = [];
  const text = spans.map((span2) => span2.text).join("");
  let sourceIndex = 0;
  let sourceEnd = spans[0]?.text.length ?? 0;
  let cursor = 0;
  for (const cluster of textClusters(text)) {
    while (cursor >= sourceEnd && sourceIndex < spans.length - 1) {
      sourceIndex += 1;
      sourceEnd += spans[sourceIndex]?.text.length ?? 0;
    }
    const source2 = spans[sourceIndex];
    if (source2) {
      appendSpan(normalized, { ...source2, text: cluster });
    }
    cursor += cluster.length;
  }
  return normalized;
}
function sliceSpansWindow(spans, offset, width) {
  if (width <= 0) {
    return {
      spans: [],
      usedWidth: 0
    };
  }
  const sliced = [];
  let remainingOffset = Math.max(0, offset);
  let remaining = width;
  let usedWidth = 0;
  for (const span2 of spans) {
    if (remaining <= 0) {
      break;
    }
    const spanWidth = measureSanitizedTextWidth(span2.text);
    if (spanWidth === 0) {
      appendSpan(sliced, { ...span2 });
      continue;
    }
    if (remainingOffset >= spanWidth) {
      remainingOffset -= spanWidth;
      continue;
    }
    if (remainingOffset === 0 && spanWidth <= remaining) {
      appendSpan(sliced, { ...span2 });
      remaining -= spanWidth;
      usedWidth += spanWidth;
      continue;
    }
    const visible = sliceSanitizedTextByWidth(span2.text, remainingOffset, remaining);
    remainingOffset = 0;
    if (visible.text.length === 0) {
      continue;
    }
    const nextSpan = {
      ...span2,
      text: visible.text
    };
    appendSpan(sliced, nextSpan);
    remaining -= visible.width;
    usedWidth += visible.width;
  }
  return {
    spans: sliced,
    usedWidth
  };
}
var SINGLE_PASS_WRAP_LINE_THRESHOLD = 8;
function wrapSpans(spans, width) {
  if (width <= 0) {
    return [[]];
  }
  const lines = [[]];
  let current = lines[0];
  let remaining = width;
  const safeSpans = sanitizeTerminalSpans(spans);
  let plannedSpans = safeSpans;
  let hasCompositionSensitiveSpan = false;
  let simpleSpanWidths = [];
  for (const span2 of safeSpans) {
    const spanWidth = measureSimpleSanitizedTextWidth(span2.text);
    simpleSpanWidths.push(spanWidth);
    hasCompositionSensitiveSpan ||= spanWidth === null;
  }
  if (safeSpans.length > 1 && hasCompositionSensitiveSpan) {
    plannedSpans = mergeCrossSpanGraphemes(safeSpans);
    simpleSpanWidths = plannedSpans.map((span2) => measureSimpleSanitizedTextWidth(span2.text));
  }
  for (let spanIndex = 0;spanIndex < plannedSpans.length; spanIndex += 1) {
    const span2 = plannedSpans[spanIndex];
    const simpleSpanWidth = simpleSpanWidths[spanIndex] ?? null;
    const spanWidth = simpleSpanWidth ?? measureSanitizedTextWidth(span2.text);
    if (spanWidth === 0) {
      appendSpan(current, { ...span2 });
      continue;
    }
    if (spanWidth > width * SINGLE_PASS_WRAP_LINE_THRESHOLD || simpleSpanWidth === null || width === 1 && !isPrintableAsciiText(span2.text)) {
      for (const chunk of wrapSanitizedTextByWidth(span2.text, width, remaining, current.length > 0)) {
        if (chunk.startsNewLine) {
          current = [];
          lines.push(current);
          remaining = width;
        }
        if (chunk.text.length > 0) {
          appendSpan(current, { ...span2, text: chunk.text });
        }
        remaining -= chunk.width;
      }
      continue;
    }
    let offset = 0;
    while (offset < spanWidth) {
      if (remaining <= 0) {
        current = [];
        lines.push(current);
        remaining = width;
      }
      const visible = sliceSanitizedTextByWidth(span2.text, offset, remaining);
      if (visible.width === 0) {
        if (current.length > 0 || remaining < width) {
          current = [];
          lines.push(current);
          remaining = width;
        }
        const forced = sliceSanitizedTextByWidth(span2.text, offset, width);
        if (forced.width === 0) {
          break;
        }
        const nextSpan2 = {
          ...span2,
          text: forced.text
        };
        current.push(nextSpan2);
        offset += forced.width;
        remaining = Math.max(0, width - forced.width);
        continue;
      }
      const nextSpan = {
        ...span2,
        text: visible.text
      };
      appendSpan(current, nextSpan);
      offset += visible.width;
      remaining -= visible.width;
    }
  }
  return lines;
}

// ../viewer/src/document/rows.ts
function foldBackground(theme, tint) {
  return tint === "inserted" ? theme.addition : tint === "removed" ? theme.deletion : tint === "modified" ? theme.modification : theme.bg;
}
function captureColor(capture, theme) {
  return theme.syntax(capture) ?? theme.fg;
}
function lineSpans(text, syntax, changed, side, theme) {
  const bytes = new TextEncoder().encode(text), decoder = new TextDecoder("utf-8", { fatal: true });
  const bounds = new Set([0, bytes.length]);
  for (const span2 of [...syntax, ...changed]) {
    bounds.add(span2.start_column);
    bounds.add(span2.end_column);
  }
  const sorted = [...bounds].sort((a, b) => a - b);
  const wordBg = side === "left" ? theme.deleteWord : theme.addWord;
  const spans = [];
  for (let i = 0;i + 1 < sorted.length; i++) {
    const start = sorted[i], end = sorted[i + 1];
    const capture = syntax.filter((s) => s.start_column <= start && s.end_column >= end).sort((a, b) => a.end_column - a.start_column - (b.end_column - b.start_column))[0];
    const emphasized = changed.some((s) => s.start_column <= start && s.end_column >= end);
    spans.push({
      text: decoder.decode(bytes.slice(start, end)),
      fg: capture ? captureColor(capture.capture, theme) : theme.fg,
      bg: emphasized ? wordBg : undefined
    });
  }
  let column = 0;
  return spans.map((span2) => ({
    ...span2,
    text: span2.text.split("\t").map((part, index) => {
      const padding = index ? " ".repeat(4 - column % 4) : "";
      column += padding.length + measureTextWidth(part);
      return padding + part;
    }).join("")
  }));
}
var empty = { kind: "empty", sign: " ", spans: [] };
function byLine(spans) {
  const result = new Map;
  for (const span2 of spans)
    result.set(span2.line, [...result.get(span2.line) ?? [], span2]);
  return result;
}
function placeholderRows(fileIndex, label) {
  return [
    { key: `${fileIndex}:load`, fileIndex, label: "Load diff", loadDiff: true },
    { key: `${fileIndex}:why`, fileIndex, label: label || "Hidden by default" }
  ];
}
function rowsForFile(file2, fileIndex, layout, theme, collapsed = new Set) {
  const d = file2.diff;
  const rows = [{ key: `${fileIndex}:header`, fileIndex, label: filePath(file2.file) }];
  if (d.type === "binary")
    return [...rows, { key: `${fileIndex}:binary`, fileIndex, label: "Binary file" }];
  const texts = [sourceLines(d.lhs?.text ?? ""), sourceLines(d.rhs?.text ?? "")];
  const syntax = [byLine(d.lhs?.syntax ?? []), byLine(d.rhs?.syntax ?? [])];
  const { leaves, folds } = flatten(d);
  const hidden = [hiddenLines(folds[0], collapsed), hiddenLines(folds[1], collapsed)];
  const bands = folds.map((side) => collapsedFolds(side, collapsed));
  const quoted = bands.map((sideBands) => {
    const result = new Map;
    for (const fold of sideBands.values())
      if (fold.syntax && fold.label.includes(`
`) && fold.syntax.start.line < fold.startLine)
        result.set(fold.syntax.start.line, fold);
    return result;
  });
  const isQuoted = (region2) => quoted[region2.side].get(region2.syntax?.start.line ?? -1) === region2;
  const inline = bands.map((sideBands, side) => {
    const result = new Map;
    for (const fold of sideBands.values()) {
      if (!fold.syntax || fold.label.includes(`
`))
        continue;
      sideBands.delete(fold.startLine);
      result.set(fold.syntax.start.line, fold);
      for (let line = fold.syntax.start.line + 1;line <= fold.syntax.end.line; line++)
        hidden[side].add(line);
    }
    return result;
  });
  const paired = pairedIds(d);
  const headers = [foldHeaders(folds[0], leaves[0], collapsed, paired[0]), foldHeaders(folds[1], leaves[1], collapsed, paired[1])];
  const guides = folds.map((side, index) => {
    const lines = new Map;
    for (const fold of side) {
      if (!fold.syntax || collapsed.has(fold.foldStateId))
        continue;
      const opener = texts[index][fold.syntax.start.line];
      const column = byteColumn(opener, opener.length - opener.trimStart().length);
      for (let line = fold.syntax.start.line + 1;line <= fold.syntax.end.line; line++)
        lines.set(line, [...lines.get(line) ?? [], { column, id: fold.foldStateId }]);
    }
    return lines;
  });
  const scopes = folds.map((side) => {
    const lines = new Map;
    for (const fold of side) {
      if (!fold.syntax || collapsed.has(fold.foldStateId))
        continue;
      for (let line = fold.syntax.start.line;line <= fold.syntax.end.line; line++)
        lines.set(line, [...lines.get(line) ?? [], fold]);
    }
    return lines;
  });
  const scopeOf = (side, line) => {
    const around = scopes[side].get(line) ?? [];
    const extent = (fold) => fold.syntax.end.line - fold.syntax.start.line;
    const inner = around.reduce((best, fold) => !best || extent(fold) < extent(best) || extent(fold) === extent(best) && fold.syntax.start.column > best.syntax.start.column ? fold : best, undefined);
    return {
      scope: inner?.foldStateId,
      body: around.filter((fold) => fold.syntax.start.line < line && line < fold.syntax.end.line).map((fold) => fold.foldStateId)
    };
  };
  const quotedEnds = quoted.map((side) => {
    const lines = new Map;
    for (const fold of side.values())
      for (const line of [fold.syntax.start.line, fold.syntax.end.line])
        lines.set(line, [...lines.get(line) ?? [], fold]);
    return lines;
  });
  const withBraces = (spans, side, line) => {
    let result = spans;
    for (const fold of [...scopes[side].get(line) ?? [], ...quotedEnds[side].get(line) ?? []]) {
      const { start, end } = fold.syntax, text = texts[side][line];
      if (start.line === line && start.column > 0)
        result = markBrace(result, byteColumn(text, start.column - 1), fold.foldStateId);
      if (end.line === line)
        result = markBrace(result, byteColumn(text, end.column), fold.foldStateId);
    }
    return result;
  };
  const tintOf = (region2) => foldTint(region2.id, region2.side, paired[region2.side]);
  const labelOf = (region2) => region2.label || lineCount("lastHidden" in region2 ? region2.lastHidden - region2.startLine + 1 : region2.endLine - region2.startLine);
  const alignments = leaves.map((side) => new Set(side.map((leaf) => leaf.alignmentId)));
  const isChanged = (leaf, line) => leaf.changed.has(line) || !alignments[leaf.side ? 0 : 1].has(leaf.alignmentId);
  const spanned = new Set(leaves.flat().filter((leaf) => leaf.changed.size).map((leaf) => leaf.alignmentId));
  const collapsedTint = (region2) => {
    const tint = tintOf(region2);
    if (tint !== "neutral")
      return { tint, note: "" };
    const last = "lastHidden" in region2 ? region2.lastHidden : region2.endLine - 1;
    const inside = leaves[region2.side].filter((leaf) => leaf.endLine > region2.startLine && leaf.startLine <= last);
    let count = 0;
    for (const leaf of inside)
      for (let line = Math.max(leaf.startLine, region2.startLine);line <= Math.min(leaf.endLine - 1, last); line++)
        if (isChanged(leaf, line))
          count++;
    if (!count && !inside.some((leaf) => spanned.has(leaf.alignmentId)))
      return { tint, note: "" };
    return { tint: "modified", note: count ? ` · ${lineCount(count)} changed` : "" };
  };
  const placeholder = (text, tint) => ({ text, fg: theme.foldPlaceholder, bg: foldBackground(theme, tint) });
  const caches = [new Map, new Map];
  const spansOf = (side, line, leaf) => {
    let spans = caches[side].get(line);
    if (!spans) {
      spans = lineSpans(texts[side][line], syntax[side].get(line) ?? [], leaf.changed.get(line) ?? [], side ? "right" : "left", theme);
      caches[side].set(line, spans);
    }
    return spans;
  };
  const cell = (leaf, line, side) => {
    if (line === null || leaf === null)
      return empty;
    let spans = withBraces(spansOf(side, line, leaf), side, line);
    let fold = headers[side].get(line);
    const opens = quoted[side].get(line);
    if (opens)
      fold = { id: opens.foldStateId, label: opens.label, collapsed: true, tint: collapsedTint(opens).tint };
    const folded = inline[side].get(line);
    if (folded) {
      const { start, end } = folded.syntax;
      const closer = texts[side][end.line];
      const suffix = lineSpans(closer, syntax[side].get(end.line) ?? [], [], side ? "right" : "left", theme);
      const label = labelOf(folded).replace(/\n/g, " · ");
      const { tint, note } = collapsedTint(folded);
      spans = [
        ...sliceSpansWindow(spans, 0, byteColumn(texts[side][line], start.column)).spans,
        placeholder(` ⋯ ${label}${note} `, tint),
        ...sliceSpansWindow(suffix, byteColumn(closer, end.column), Infinity).spans
      ];
      fold = { id: folded.foldStateId, label: folded.label, collapsed: true, tint };
    }
    const changed = isChanged(leaf, line);
    return {
      kind: changed ? side ? "addition" : "deletion" : "context",
      sign: changed ? side ? "+" : "-" : " ",
      lineNumber: line + 1,
      spans: withGuides(spans, guides[side].get(line) ?? [], theme),
      fold,
      ...scopeOf(side, line)
    };
  };
  let pendingOld = [], pendingNew = [];
  const flush = () => {
    rows.push(...pendingOld, ...pendingNew);
    pendingOld = [];
    pendingNew = [];
  };
  const band = (region2) => {
    const { tint, note } = collapsedTint(region2);
    const multiline = region2.label.includes(`
`);
    const body = texts[region2.side][region2.startLine];
    const enclosing = guides[region2.side].get(region2.startLine) ?? [];
    const label = {
      kind: "context",
      sign: " ",
      band: tint,
      foldLabel: true,
      labelOf: region2.foldStateId,
      ...scopeOf(region2.side, region2.startLine)
    };
    if (isQuoted(region2)) {
      const opener = texts[region2.side][region2.syntax.start.line];
      const rail = { column: byteColumn(opener, opener.length - opener.trimStart().length), id: region2.foldStateId };
      const lead2 = (text) => withGuides([
        { text: " ".repeat(byteColumn(body, body.length - body.trimStart().length)) },
        placeholder(text, tint)
      ], [...enclosing, rail], theme);
      const [header2, ...labels2] = region2.label.split(`
`).map((text, i) => ({ ...label, spans: lead2(i ? text : `${text}${note}`) }));
      return { header: header2, labels: labels2 };
    }
    const lead = (text) => withGuides([{ text: " ".repeat(region2.parentColumn) }, placeholder(text, tint)], enclosing, theme);
    const header = {
      kind: "context",
      sign: " ",
      band: tint,
      spans: lead(`⋯${multiline ? "" : " " + labelOf(region2)}${note}`),
      fold: { id: region2.foldStateId, label: region2.label, collapsed: true, tint },
      ...scopeOf(region2.side, region2.startLine)
    };
    const labels = multiline ? region2.label.split(`
`).map((text) => ({ ...label, spans: lead(text) })) : [];
    return { header, labels };
  };
  const collapsedRow = (kind, leftRegion, rightRegion) => {
    flush();
    const key = `${fileIndex}:${kind}:${(leftRegion ?? rightRegion).id}`;
    const left = leftRegion && band(leftRegion), right = rightRegion && band(rightRegion);
    if (layout === "unified") {
      const shown = right ?? left;
      rows.push({ key, fileIndex, cell: shown.header });
      shown.labels.forEach((cell2, i) => rows.push({ key: `${key}:label:${i}`, fileIndex, cell: cell2 }));
      return;
    }
    rows.push({ key, fileIndex, left: left?.header ?? empty, right: right?.header ?? empty });
    for (let i = 0;i < Math.max(left?.labels.length ?? 0, right?.labels.length ?? 0); i++)
      rows.push({ key: `${key}:label:${i}`, fileIndex, left: left?.labels[i] ?? empty, right: right?.labels[i] ?? empty });
  };
  const emit = (l, r, left, right) => {
    const key = `${fileIndex}:${l ?? "_"}:${r ?? "_"}`;
    const folded = (line, leaf, side) => line === null ? leaf !== null && collapsed.has(leaf.foldStateId) : hidden[side].has(line);
    const [leftFolded, rightFolded] = [folded(l, left, 0), folded(r, right, 1)];
    if (leftFolded)
      l = null;
    if (rightFolded)
      r = null;
    if (l === null && r === null)
      return;
    const a = cell(left, l, 0), b = cell(right, r, 1);
    if (layout === "split") {
      rows.push({ key, fileIndex, left: a, right: b });
      return;
    }
    if (l !== null && r !== null && a.kind === "context" && b.kind === "context") {
      flush();
      rows.push({ key, fileIndex, cell: {
        kind: "context",
        sign: " ",
        oldLineNumber: l + 1,
        newLineNumber: r + 1,
        fold: b.fold ?? a.fold,
        scope: b.scope,
        body: b.body,
        spans: b.spans
      } });
      return;
    }
    if (l !== null) {
      const removed = a.kind === "deletion" || !rightFolded;
      pendingOld.push({ key: `${key}:old`, fileIndex, cell: {
        kind: removed ? "deletion" : "context",
        sign: removed ? "-" : " ",
        oldLineNumber: l + 1,
        fold: a.fold,
        scope: a.scope,
        body: a.body,
        spans: a.spans
      } });
    }
    if (r !== null) {
      const added = b.kind === "addition" || !leftFolded;
      pendingNew.push({ key: `${key}:new`, fileIndex, cell: {
        kind: added ? "addition" : "context",
        sign: added ? "+" : " ",
        newLineNumber: r + 1,
        fold: b.fold,
        scope: b.scope,
        body: b.body,
        spans: b.spans
      } });
    }
  };
  const leafRows = (left, right) => {
    const leftFold = left && bands[0].get(left.startLine), rightFold = right && bands[1].get(right.startLine);
    if (leftFold || rightFold)
      collapsedRow("fold", leftFold ?? null, rightFold ?? null);
    const leftGap = left && collapsed.has(left.foldStateId) ? left : null;
    const rightGap = right && collapsed.has(right.foldStateId) ? right : null;
    const shown = (gap, side) => gap && !hidden[side].has(gap.startLine) ? gap : null;
    if (shown(leftGap, 0) || shown(rightGap, 1))
      collapsedRow("gap", shown(leftGap, 0), shown(rightGap, 1));
    const leftLines = left && !leftGap ? left.endLine - left.startLine : 0;
    const rightLines = right && !rightGap ? right.endLine - right.startLine : 0;
    for (let i = 0;i < Math.max(leftLines, rightLines); i++)
      emit(i < leftLines ? left.startLine + i : null, i < rightLines ? right.startLine + i : null, left, right);
  };
  const rightIndex = new Map(leaves[1].map((leaf, index) => [leaf.alignmentId, index]));
  let cursor = 0;
  const flushRight = (until) => {
    for (;cursor < until; cursor++)
      leafRows(null, leaves[1][cursor]);
  };
  for (const left of leaves[0]) {
    const partner = rightIndex.get(left.alignmentId);
    if (partner === undefined) {
      leafRows(left, null);
      continue;
    }
    flushRight(partner);
    leafRows(left, leaves[1][partner]);
    cursor = partner + 1;
  }
  flushRight(leaves[1].length);
  flush();
  return markHunks(rows);
}
function markHunks(rows) {
  let inHunk = false;
  for (const row of rows) {
    const changed = row.cell ? row.cell.kind !== "context" : row.left !== undefined && (row.left.kind !== "context" || row.right.kind !== "context");
    if (changed && !inHunk)
      row.hunkStart = true;
    inHunk = changed;
  }
  return rows;
}
var lineCount = (count) => `${count} line${count === 1 ? "" : "s"}`;
function markBrace(spans, column, id) {
  const at = sliceSpansWindow(spans, column, 1).spans;
  if (!at.length)
    return spans;
  return [
    ...sliceSpansWindow(spans, 0, column).spans,
    ...at.map((span2) => ({ ...span2, brace: id })),
    ...sliceSpansWindow(spans, column + 1, Infinity).spans
  ];
}
function withGuides(spans, guides, theme) {
  let result = spans;
  for (const { column, id } of guides) {
    const text = result.map((s) => s.text).join("");
    const width = measureTextWidth(text);
    if (width <= column)
      result = [...result, { text: " ".repeat(column + 1 - width) }];
    const at = sliceSpansWindow(result, column, 1).spans;
    if (!at.every((s) => /^\s*$/.test(s.text)))
      continue;
    result = [
      ...sliceSpansWindow(result, 0, column).spans,
      { text: "│", fg: theme.guide, guide: id },
      ...sliceSpansWindow(result, column + 1, Infinity).spans
    ];
  }
  return result;
}

// ../viewer/src/viewport/geometry.ts
function measureRows(rows, width, wrap, horizontalOffset, maxLine) {
  const digits = String(maxLine).length;
  const gutter = digits + 4, unifiedGutter = digits * 2 + 5;
  const leftWidth = Math.floor((width - 1) / 2), rightWidth = width - leftWidth - 1;
  const measure = (spans, available) => {
    if (!spans)
      return [];
    return wrap ? wrapSpans(spans, Math.max(1, available)) : [
      sliceSpansWindow(spans, horizontalOffset, Math.max(1, available)).spans
    ];
  };
  let top = 0;
  const measured = rows.map((row) => {
    const left = measure(row.left?.spans, leftWidth - gutter), right = measure(row.right?.spans, rightWidth - gutter);
    const cell = measure(row.cell?.spans, width - unifiedGutter);
    const height = Math.max(1, left.length, right.length, cell.length);
    const result = { row, top, height, left, right, cell };
    top += height;
    return result;
  });
  return { rows: measured, height: top, leftWidth, rightWidth, gutter, unifiedGutter };
}
function visibleRows(geometry, top, height) {
  const rows = geometry.rows, bottom = top + Math.max(0, height);
  let start = 0, end = rows.length;
  while (start < end) {
    const mid = start + end >>> 1;
    if (rows[mid].top + rows[mid].height > top)
      end = mid;
    else
      start = mid + 1;
  }
  end = start;
  while (end < rows.length && rows[end].top < bottom)
    end++;
  return rows.slice(start, end);
}
function sourceLine(row, side) {
  return side === "right" ? row.right?.lineNumber ?? row.cell?.newLineNumber : row.left?.lineNumber ?? row.cell?.oldLineNumber;
}
var rowFold = (row) => row.cell?.fold ?? row.right?.fold ?? row.left?.fold;
function positionAt(geometry, top) {
  const item = visibleRows(geometry, top, 1)[0];
  if (!item)
    return null;
  const row = item.row, right = sourceLine(row, "right");
  return {
    key: row.key,
    fileIndex: row.fileIndex,
    offset: top - item.top,
    fold: rowFold(row)?.id,
    side: right === undefined ? "left" : "right",
    line: right ?? sourceLine(row, "left")
  };
}
function positionTop(geometry, position) {
  if (!position)
    return 0;
  const at = (row) => row.top + Math.min(position.offset, row.height - 1);
  const same = geometry.rows.find((r) => r.row.key === position.key);
  if (same)
    return at(same);
  const file2 = geometry.rows.filter((r) => r.row.fileIndex === position.fileIndex);
  const folded = position.fold !== undefined && file2.find((r) => [r.row.left?.fold?.id, r.row.right?.fold?.id, r.row.cell?.fold?.id].includes(position.fold));
  if (folded)
    return at(folded);
  const line = position.line;
  const next = line !== undefined && file2.find((r) => (sourceLine(r.row, position.side) ?? -1) >= line);
  return (next || file2[0]).top;
}

// ../viewer/src/viewer.ts
class Viewer {
  store;
  theme;
  splitColumns;
  mode = "auto";
  wrap = false;
  position = null;
  horizontal = 0;
  hover = null;
  closed = new Map;
  collapsed = new Map;
  pendingZ = false;
  viewed = new Set;
  prompt = null;
  search = null;
  promptCount;
  picker = null;
  openRows = new WeakMap;
  rowCache = new WeakMap;
  revision = 0;
  measured;
  size;
  listeners = new Set;
  version = 0;
  constructor(store, theme, splitColumns) {
    this.store = store;
    this.theme = theme;
    this.splitColumns = splitColumns;
    store.subscribe(() => this.emit());
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getVersion = () => this.version;
  emit() {
    this.version++;
    this.listeners.forEach((listener) => listener());
  }
  reshape() {
    this.revision++;
    this.emit();
  }
  get snapshot() {
    return this.store.getSnapshot();
  }
  get chording() {
    return this.pendingZ;
  }
  isClosed(index, file2) {
    return this.closed.get(index) ?? fileVisibility(file2).collapsed;
  }
  foldsOf(index, diff2) {
    return this.collapsed.get(index) ?? defaultCollapsed(diff2);
  }
  fileOrder(snapshot3) {
    return flattenFileTree(buildFileTree(snapshot3.inventory), new Set).flatMap(({ node }) => node.fileIndex === undefined ? [] : [node.fileIndex]);
  }
  documentRows(snapshot3, layout) {
    const { inventory, files, failures } = snapshot3;
    const perFile = this.fileOrder(snapshot3).map((index) => {
      const file2 = files[index];
      if (!file2) {
        const failure = failures[index];
        const status = failure ?? (snapshot3.complete ? "File did not load" : "Computing diff…");
        return [
          { key: `${index}:header`, fileIndex: index, label: filePath(inventory[index].file) },
          ...["", status, "", ""].map((label, line) => ({
            key: `${index}:pending:${line}`,
            fileIndex: index,
            label,
            pending: line === 1 && !failure && !snapshot3.complete
          }))
        ];
      }
      const folds = file2.diff.type === "text" ? this.foldsOf(index, file2.diff) : new Set;
      const key = `${index}:${layout}:${this.theme.name}:${[...folds].sort((a, b) => a - b).join(",")}`;
      let cached2 = this.rowCache.get(file2);
      if (cached2?.key !== key) {
        cached2 = { key, rows: rowsForFile(file2, index, layout, this.theme, folds) };
        this.rowCache.set(file2, cached2);
      }
      if (!this.isClosed(index, file2))
        return cached2.rows;
      return fileVisibility(file2).collapsed ? [cached2.rows[0], ...placeholderRows(index, fileVisibility(file2).label)] : cached2.rows.slice(0, 1);
    });
    const all2 = [];
    for (const fileRows of perFile) {
      const last = all2.at(-1);
      if (last && !last.key.endsWith(":header") && last.label !== "")
        all2.push({ key: `${last.fileIndex}:end`, fileIndex: last.fileIndex, label: "" });
      all2.push(...fileRows);
    }
    for (const [i, error46] of snapshot3.errors.entries())
      all2.push({ key: `error:${i}`, fileIndex: -1, label: error46 });
    return all2;
  }
  lay(size) {
    this.size = size;
    const snapshot3 = this.snapshot;
    const { columns: contentWidth, rows: viewportHeight } = size;
    const layout = this.mode === "auto" ? contentWidth >= this.splitColumns ? "split" : "unified" : this.mode;
    const key = `${this.revision}:${layout}:${contentWidth}:${this.wrap}:${this.horizontal}`;
    if (this.measured?.key !== key || this.measured.snapshot !== snapshot3) {
      const rows2 = this.documentRows(snapshot3, layout);
      const maxLine = Math.max(1, ...snapshot3.files.flatMap((file2) => file2?.diff.type === "text" ? [file2.diff.lhs, file2.diff.rhs].map((source2) => source2 ? sourceLines(source2.text).length : 0) : []));
      this.measured = { key, snapshot: snapshot3, rows: rows2, geometry: measureRows(rows2, contentWidth, this.wrap, this.horizontal, maxLine) };
    }
    const { rows, geometry } = this.measured;
    const lastFileTop = geometry.rows.findLast((r) => r.row.key.endsWith(":header"))?.top ?? 0;
    const maxScroll = Math.max(lastFileTop, geometry.height - viewportHeight + 1);
    const top = Math.min(positionTop(geometry, this.position), maxScroll);
    const viewport = visibleRows(geometry, top, viewportHeight);
    const currentFile = viewport[0]?.row.fileIndex ?? 0;
    const sticky = !!viewport.length && !viewport[0].row.key.endsWith(":header");
    const thumbHeight = Math.max(1, Math.floor(viewportHeight * viewportHeight / Math.max(viewportHeight, geometry.height)));
    const thumbTop = maxScroll ? Math.round(top / maxScroll * (viewportHeight - thumbHeight)) : 0;
    return {
      size,
      snapshot: snapshot3,
      theme: this.theme,
      layout,
      wrap: this.wrap,
      horizontal: this.horizontal,
      hover: this.hover,
      rows,
      geometry,
      top,
      maxScroll,
      viewport,
      currentFile,
      sticky,
      thumb: { top: thumbTop, height: thumbHeight }
    };
  }
  current() {
    if (!this.size)
      throw new Error("The viewer has not been laid out yet");
    return this.lay(this.size);
  }
  scrollTo(value) {
    const at = this.current();
    this.position = positionAt(at.geometry, Math.max(0, Math.min(at.maxScroll, value)));
    this.emit();
  }
  move(amount) {
    this.scrollTo(this.current().top + amount);
  }
  scrub(row) {
    const at = this.current();
    this.scrollTo(Math.round(Math.max(0, Math.min(1, row / Math.max(1, at.size.rows - 1))) * at.maxScroll));
  }
  jump(index) {
    const row = this.current().geometry.rows.find((r) => r.row.fileIndex === index);
    if (!row)
      throw new Error(`File ${index} has no rows`);
    this.scrollTo(row.top);
  }
  toggleFile(index) {
    const file2 = this.snapshot.files[index];
    if (!file2)
      return;
    this.setClosed(index, !this.isClosed(index, file2));
    this.reshape();
  }
  setClosed(index, closed) {
    const at = this.current();
    const header = at.geometry.rows.find((r) => r.row.key === `${index}:header`);
    if (header.top < at.top)
      this.position = { key: header.row.key, fileIndex: index, offset: 0, side: "right" };
    this.closed.set(index, closed);
  }
  isViewed(index) {
    const diff2 = this.snapshot.files[index]?.diff;
    const markable = diff2?.type === "text" && diff2.stats.visible.added + diff2.stats.visible.removed > 0;
    return markable ? this.viewed.has(index) : undefined;
  }
  viewedFiles() {
    let viewed = 0, total = 0;
    this.snapshot.files.forEach((_, index) => {
      const state = this.isViewed(index);
      if (state === undefined)
        return;
      total++;
      if (state)
        viewed++;
    });
    return { viewed, total };
  }
  toggleViewedFile(index) {
    const state = this.isViewed(index);
    if (state === undefined)
      return;
    if (state)
      this.viewed.delete(index);
    else
      this.viewed.add(index);
    this.setClosed(index, !state);
    this.reshape();
  }
  get picking() {
    return this.picker !== null;
  }
  pickerState() {
    if (!this.picker)
      return;
    const { inventory } = this.snapshot;
    const picks = rankFiles(inventory, this.fileOrder(this.snapshot), this.picker.query, (index) => this.isViewed(index) === true);
    return { query: this.picker.query, cursor: Math.min(this.picker.cursor, Math.max(0, picks.length - 1)), picks, total: inventory.length };
  }
  pickFile(index) {
    this.picker = null;
    const file2 = this.snapshot.files[index];
    if (file2 && this.isClosed(index, file2)) {
      this.closed.set(index, false);
      this.revision++;
    }
    this.jump(index);
  }
  typePicker(key) {
    const picker = this.picker, name = key.key;
    if (name === "escape" || key.ctrl && (name === "c" || name === "g"))
      this.picker = null;
    else if (name === "return" || name === "enter") {
      const state = this.pickerState(), pick2 = state.picks[state.cursor];
      if (pick2)
        return this.pickFile(pick2.fileIndex);
      this.picker = null;
    } else if (name === "up" || key.ctrl && name === "p")
      picker.cursor = Math.max(0, picker.cursor - 1);
    else if (name === "down" || key.ctrl && name === "n")
      picker.cursor += 1;
    else if (name === "backspace")
      this.picker = { query: picker.query.slice(0, -1), cursor: 0 };
    else if (!key.ctrl && !key.meta) {
      const text = name === "space" ? " " : name;
      if ([...text].length !== 1)
        return;
      this.picker = { query: picker.query + text, cursor: 0 };
    } else
      return;
    this.emit();
  }
  get prompting() {
    return this.prompt !== null;
  }
  searchState() {
    if (this.prompt !== null) {
      const snapshot3 = this.snapshot;
      if (this.promptCount?.pattern !== this.prompt || this.promptCount.snapshot !== snapshot3)
        this.promptCount = { pattern: this.prompt, snapshot: snapshot3, count: this.findMatches(this.prompt).length };
      return { prompt: this.prompt, count: this.promptCount.count };
    }
    if (!this.search)
      return;
    const { pattern, matches, at } = this.search;
    return { pattern, at: at + 1, total: matches.length, files: new Set(matches.map((match) => match.fileIndex)).size };
  }
  highlight(fileIndex, key, side) {
    const pattern = this.prompt ?? this.search?.pattern;
    if (!pattern)
      return;
    const on = this.prompt === null && this.search ? this.search.matches[this.search.at] : undefined;
    return { pattern, current: !!on && on.fileIndex === fileIndex && on.key === key && on.side === side };
  }
  allOpenRows(index, file2, layout) {
    let cached2 = this.openRows.get(file2);
    if (cached2?.layout !== layout) {
      cached2 = { layout, rows: rowsForFile(file2, index, layout, this.theme, new Set) };
      this.openRows.set(file2, cached2);
    }
    return cached2.rows;
  }
  findMatches(pattern) {
    const { files, inventory } = this.snapshot;
    const layout = this.current().layout;
    const matches = [];
    for (const index of this.fileOrder(this.snapshot)) {
      for (const _ of occurrences(filePath(inventory[index].file), pattern))
        matches.push({ fileIndex: index, key: `${index}:header`, side: "right" });
      const file2 = files[index];
      if (!file2)
        continue;
      for (const row of this.allOpenRows(index, file2, layout)) {
        const cells = row.cell ? [[row.cell.newLineNumber === undefined ? "left" : "right", row.cell, row.cell.newLineNumber ?? row.cell.oldLineNumber]] : [["left", row.left, row.left?.lineNumber], ["right", row.right, row.right?.lineNumber]];
        for (const [side, cell, line] of cells) {
          if (!cell || line === undefined)
            continue;
          for (const _ of occurrences(cell.spans.map((span2) => span2.text).join(""), pattern))
            matches.push({ fileIndex: index, key: row.key, side, line });
        }
      }
    }
    return matches;
  }
  placeOf(order, layout, fileIndex, key, side, line) {
    const file2 = this.snapshot.files[fileIndex];
    const rows = file2 ? this.allOpenRows(fileIndex, file2, layout) : [];
    const lineOf = (row2) => side === "left" ? row2.left?.lineNumber ?? row2.cell?.oldLineNumber : row2.right?.lineNumber ?? row2.cell?.newLineNumber;
    let row = rows.findIndex((r) => r.key === key);
    if (row < 0 && line !== undefined)
      row = rows.findIndex((r) => (lineOf(r) ?? -1) >= line);
    return order.indexOf(fileIndex) * 1e7 + Math.max(0, row);
  }
  commitSearch(pattern) {
    this.prompt = null;
    if (!pattern)
      return this.emit();
    const snapshot3 = this.snapshot, matches = this.findMatches(pattern);
    this.search = { pattern, matches, at: -1, snapshot: snapshot3 };
    if (!matches.length)
      return this.emit();
    const at = this.current(), top = positionAt(at.geometry, at.top);
    const order = this.fileOrder(snapshot3);
    const from = top ? this.placeOf(order, at.layout, top.fileIndex, top.key, top.side, top.line) : 0;
    const next = matches.findIndex((match) => this.placeOf(order, at.layout, match.fileIndex, match.key, match.side, match.line) >= from);
    this.search.at = next < 0 ? 0 : next;
    this.goTo(matches[this.search.at]);
  }
  stepMatch(direction) {
    const search = this.search;
    if (!search)
      return;
    if (search.snapshot !== this.snapshot) {
      const on = search.matches[search.at];
      search.matches = this.findMatches(search.pattern);
      search.snapshot = this.snapshot;
      search.at = on ? search.matches.findIndex((m) => m.fileIndex === on.fileIndex && m.key === on.key && m.side === on.side) : -1;
    }
    const total = search.matches.length;
    if (!total)
      return this.emit();
    search.at = (search.at + direction + total) % total;
    this.goTo(search.matches[search.at]);
  }
  goTo(match) {
    const file2 = this.snapshot.files[match.fileIndex];
    if (file2 && match.line !== undefined) {
      if (this.isClosed(match.fileIndex, file2))
        this.closed.set(match.fileIndex, false);
      if (file2.diff.type === "text") {
        const hiding = hidingIds(file2.diff, match.side === "left" ? 0 : 1, match.line - 1, this.foldsOf(match.fileIndex, file2.diff));
        if (hiding.length)
          this.setFolds(match.fileIndex, file2.diff, hiding, false);
      }
    }
    this.position = { key: match.key, fileIndex: match.fileIndex, offset: 0, side: match.side, line: match.line };
    this.reshape();
  }
  type(key) {
    const name = key.key, prompt = this.prompt;
    if (name === "return" || name === "enter")
      return this.commitSearch(prompt);
    if (name === "escape" || key.ctrl && (name === "c" || name === "g"))
      this.prompt = null;
    else if (name === "backspace")
      this.prompt = prompt ? prompt.slice(0, -1) : null;
    else if (!key.ctrl && !key.meta) {
      const text = name === "space" ? " " : name;
      if ([...text].length !== 1)
        return;
      this.prompt = prompt + text;
    } else
      return;
    this.emit();
  }
  setFolds(fileIndex, diff2, ids, collapse) {
    const next = new Set(this.foldsOf(fileIndex, diff2));
    const close = collapse === "toggle" ? !next.has(ids[0]) : collapse;
    for (const id of ids)
      if (close)
        next.add(id);
      else
        next.delete(id);
    this.collapsed.set(fileIndex, next);
  }
  setFold(fileIndex, id, collapse, recursive) {
    const diff2 = this.snapshot.files[fileIndex]?.diff;
    if (diff2?.type !== "text")
      throw new Error(`File ${fileIndex} has no folds`);
    this.setFolds(fileIndex, diff2, recursive ? [id, ...nestedIds(diff2, id)] : [id], collapse);
    this.reshape();
  }
  textDiffs() {
    return this.snapshot.files.flatMap((file2, index) => file2?.diff.type === "text" ? [{ index, diff: file2.diff }] : []);
  }
  toggleContext() {
    const textDiffs = this.textDiffs();
    const opened = textDiffs.some(({ index, diff: diff2 }) => gapIds(diff2).some((id) => !this.foldsOf(index, diff2).has(id)));
    textDiffs.forEach(({ index, diff: diff2 }) => this.setFolds(index, diff2, gapIds(diff2), opened));
    this.reshape();
  }
  foldAll(collapse) {
    this.textDiffs().forEach(({ index, diff: diff2 }) => this.setFolds(index, diff2, foldIds(diff2), collapse));
    this.reshape();
  }
  navigate(direction, matches) {
    const at = this.current();
    const headers = at.geometry.rows.filter((r) => matches(r.row));
    const target = direction > 0 ? headers.find((r) => r.top > at.top) : headers.findLast((r) => r.top < at.top);
    if (target)
      this.scrollTo(target.top);
  }
  navigateHunk(direction) {
    this.navigate(direction, (row) => !!row.hunkStart);
  }
  navigateFold(direction) {
    this.navigate(direction, (row) => !!rowFold(row));
  }
  foldCommand(command) {
    if (command === "R")
      return this.foldAll(false);
    if (command === "M")
      return this.foldAll(true);
    if (command === "j")
      return this.navigateFold(1);
    if (command === "k")
      return this.navigateFold(-1);
    const at = this.current();
    const current = visibleRows(at.geometry, at.top, 1)[0]?.row;
    const fold = current && rowFold(current);
    if (!current || !fold)
      return;
    const recursive = command === command.toUpperCase();
    const letter = command.toLowerCase();
    if (letter === "a")
      this.setFold(current.fileIndex, fold.id, "toggle", recursive);
    else if (letter === "o")
      this.setFold(current.fileIndex, fold.id, false, recursive);
    else if (letter === "c")
      this.setFold(current.fileIndex, fold.id, true, recursive);
  }
  toggleLayout() {
    this.mode = this.current().layout === "split" ? "unified" : "split";
    this.reshape();
  }
  toggleWrap() {
    this.wrap = !this.wrap;
    this.emit();
  }
  setTheme(theme) {
    this.theme = theme;
    this.reshape();
  }
  toggleTheme() {
    this.setTheme(this.theme.isLight ? dark : light);
  }
  pan(columns) {
    this.horizontal = Math.max(0, this.horizontal + columns);
    this.emit();
  }
  setHover(hover2) {
    if (JSON.stringify(hover2) === JSON.stringify(this.hover))
      return;
    this.hover = hover2;
    this.emit();
  }
  toggleTopFile() {
    const at = this.current();
    const current = visibleRows(at.geometry, at.top, 1)[0];
    if (current && current.row.fileIndex >= 0)
      this.toggleFile(current.row.fileIndex);
  }
  press(key) {
    const at = this.current();
    const page = at.size.rows, half = Math.max(1, Math.floor(at.size.rows / 2));
    const name = key.key;
    if (this.picker) {
      this.typePicker(key);
      return true;
    }
    if (this.prompt !== null) {
      this.type(key);
      return true;
    }
    if (this.pendingZ) {
      this.pendingZ = false;
      if (!key.ctrl && !key.meta && name.length === 1 && "aocAOCRMjk".includes(name))
        this.foldCommand(name);
      return true;
    }
    if (key.meta)
      return false;
    if (key.ctrl) {
      if (name === "d")
        this.move(half);
      else if (name === "u")
        this.move(-half);
      else if (name === "f")
        this.move(page);
      else if (name === "b")
        this.move(-page);
      else if (name === "p") {
        this.picker = { query: "", cursor: 0 };
        this.emit();
      } else
        return false;
      return true;
    }
    switch (name) {
      case "d":
        this.move(half);
        break;
      case "u":
        this.move(-half);
        break;
      case " ":
      case "space":
        this.move(key.shift ? -page : page);
        break;
      case "pagedown":
      case "f":
        this.move(page);
        break;
      case "pageup":
      case "b":
        this.move(-page);
        break;
      case "down":
      case "j":
        this.move(1);
        break;
      case "up":
      case "k":
        this.move(-1);
        break;
      case "g":
      case "home":
        this.scrollTo(0);
        break;
      case "G":
      case "end":
        this.scrollTo(at.maxScroll);
        break;
      case "right":
      case "l":
        this.pan(key.shift ? 16 : 4);
        break;
      case "L":
        this.pan(16);
        break;
      case "left":
      case "h":
        this.pan(key.shift ? -16 : -4);
        break;
      case "H":
        this.pan(-16);
        break;
      case "]":
        this.navigateHunk(1);
        break;
      case "[":
        this.navigateHunk(-1);
        break;
      case "s":
        this.toggleLayout();
        break;
      case "w":
        this.toggleWrap();
        break;
      case "c":
        this.toggleContext();
        break;
      case "t":
        this.toggleTheme();
        break;
      case "z":
        this.pendingZ = true;
        break;
      case "return":
      case "enter":
        this.toggleTopFile();
        break;
      case "V":
        if (at.currentFile >= 0)
          this.toggleViewedFile(at.currentFile);
        break;
      case "/":
        this.prompt = "";
        this.emit();
        break;
      case "n":
        this.stepMatch(1);
        break;
      case "N":
        this.stepMatch(-1);
        break;
      default:
        return false;
    }
    return true;
  }
}

// ../viewer/src/viewport/cell.ts
function lightMatches(spans, lit, theme) {
  const ranges = occurrences(spans.map((span2) => span2.text).join(""), lit.pattern);
  if (!ranges.length)
    return spans;
  const result = [];
  let offset = 0;
  for (const span2 of spans) {
    const end = offset + span2.text.length;
    let cut = offset;
    for (const [from, to] of ranges) {
      if (to <= cut || from >= end)
        continue;
      const start = Math.max(from, cut), stop = Math.min(to, end);
      if (start > cut)
        result.push({ ...span2, text: span2.text.slice(cut - offset, start - offset) });
      result.push({
        ...span2,
        text: span2.text.slice(start - offset, stop - offset),
        bg: lit.current ? theme.searchCurrent : theme.searchMatch,
        fg: lit.current ? theme.bg : span2.fg
      });
      cut = stop;
    }
    if (cut < end)
      result.push({ ...span2, text: span2.text.slice(cut - offset) });
    offset = end;
  }
  return result;
}
function litRuns(text, fg, bg, lit, theme) {
  const spans = lit ? lightMatches([{ text, fg, bg }], lit, theme) : [{ text, fg, bg }];
  return spans.map((span2) => ({ text: span2.text, fg: span2.fg ?? fg, bg: span2.bg ?? bg }));
}
var viewedBox = (viewed) => viewed ? "[✓]" : "[ ]";
var viewedHint = (viewed) => ` ${viewed ? "Unmark viewed" : "Mark as viewed"} · V `;
function chevron(fold) {
  if (!fold)
    return " ";
  return fold.collapsed ? "▸" : "▾";
}
function planCell(value, spans, width, unified, { theme, geometry, visualLine, focus, selected = false, read = false, search }) {
  const fold = value.fold;
  const washed = focus?.armed && value.body?.includes(focus.id);
  const changed = value.kind === "addition" || value.kind === "deletion";
  const bg = selected ? theme.highlight : value.kind === "addition" ? read ? theme.readAddition : theme.addition : value.kind === "deletion" ? read ? theme.readDeletion : theme.deletion : washed ? theme.focusWash : theme.bg;
  if (read && changed)
    spans = spans.map((span2) => ({ ...span2, fg: theme.muted, bg: undefined }));
  if (search)
    spans = lightMatches(spans, search, theme);
  const digits = geometry.gutter - 4;
  const number4 = (n) => `${visualLine ? "" : n ?? ""}`.padStart(digits);
  const numbers = unified ? ` ${number4(value.oldLineNumber)} ${number4(value.newLineNumber)} ` : ` ${number4("lineNumber" in value ? value.lineNumber : undefined)} `;
  const gutterWidth = unified ? geometry.unifiedGutter : geometry.gutter;
  const available = Math.max(1, width - gutterWidth);
  const used = Math.min(available, spans.reduce((n, s) => n + measureTextWidth(s.text), 0));
  const rest = available - used;
  const painted = value.band && rest > 0 ? [...spans, {
    text: (value.fold ? "  " + "┄".repeat(rest) : " ".repeat(rest)).slice(0, rest),
    fg: theme.guide,
    bg: foldBackground(theme, value.band)
  }] : spans;
  const chevronFg = fold && fold.id === focus?.id ? theme.accent : fold?.collapsed ? theme.muted : theme.guide;
  const chevronColumn = numbers.length, codeColumn = chevronColumn + 2;
  const runs = [
    { text: numbers, fg: theme.muted, bg },
    { text: visualLine ? " " : chevron(fold), fg: chevronFg, bg },
    { text: " ", fg: theme.fg, bg }
  ];
  const hits = [], hovers = [];
  if (fold && !visualLine) {
    hits.push([chevronColumn, chevronColumn + 1, fold.id]);
    hovers.push([chevronColumn, chevronColumn + 1, { id: fold.id, armed: true }]);
  }
  let column = codeColumn;
  for (const span2 of painted) {
    const rail = span2.guide !== undefined && span2.guide === focus?.id;
    const brace = span2.brace !== undefined && span2.brace === focus?.id;
    const text = rail && focus.armed ? span2.text.replace(/│/g, "┃") : span2.text;
    const cells = measureTextWidth(text);
    runs.push({
      text,
      fg: rail || brace ? theme.accent : span2.fg ?? theme.fg,
      bg: brace && focus.armed ? theme.focusBrace : selected ? bg : span2.bg ?? bg
    });
    if (span2.guide !== undefined) {
      hits.push([column, column + cells, span2.guide]);
      hovers.push([column, column + cells, { id: span2.guide, armed: true }]);
    }
    column += cells;
  }
  if (column < width)
    runs.push({ text: " ".repeat(width - column), fg: theme.fg, bg });
  const opens = fold?.collapsed ? fold.id : value.labelOf;
  if (opens !== undefined) {
    hits.push([codeColumn, width, opens]);
    hovers.push([codeColumn, width, { id: opens, armed: true }]);
  }
  if (value.scope !== undefined)
    hovers.push([0, width, { id: value.scope, armed: false }]);
  return { bg, runs, hits, hovers };
}

// ../viewer/src/viewport/picker.ts
function exactly(runs, width, bg) {
  const result = [];
  let room = width;
  for (const run of runs) {
    if (room <= 0)
      break;
    const cells = measureTextWidth(run.text);
    result.push(cells <= room ? run : { ...run, text: sliceTextByWidth(run.text, 0, room).text });
    room -= Math.min(cells, room);
  }
  if (room > 0)
    result.push({ text: " ".repeat(room), fg: bg, bg });
  return result;
}
function pickerLines(state, width, height, theme, counts, viewed, closeHint) {
  const bg = theme.chrome;
  const room = Math.max(1, Math.min(state.picks.length, height - 2));
  const first = Math.max(0, Math.min(state.cursor - room + 1, state.picks.length - room));
  const count = `${state.picks.length} of ${state.total} changed files `;
  const lines = [{ runs: exactly([
    { text: " ".repeat(Math.max(0, width - measureTextWidth(count))), fg: bg, bg },
    { text: count, fg: theme.muted, bg }
  ], width, bg) }];
  for (const [offset, pick2] of state.picks.slice(first, first + room).entries()) {
    const cursor = first + offset === state.cursor, rowBg = cursor ? theme.highlight : bg;
    const read = viewed(pick2.fileIndex), tally = counts(pick2.fileIndex);
    const right = read ? [{ text: "✓ ", fg: theme.accent, bg: rowBg }] : tally ? [{ text: `+${tally.added} `, fg: theme.addedText, bg: rowBg }, { text: `−${tally.removed} `, fg: theme.removedText, bg: rowBg }] : [{ text: " ", fg: rowBg, bg: rowBg }];
    const rightWidth = right.reduce((n, run) => n + measureTextWidth(run.text), 0);
    const room2 = Math.max(1, width - 2 - rightWidth - 1);
    let path = sanitizeTerminalLine(pick2.path), shift = 0;
    if (measureTextWidth(path) > room2) {
      shift = path.length - (room2 - 1);
      path = `…${path.slice(shift)}`;
      shift -= 1;
    }
    const matched = new Set(pick2.indexes.map((index) => index - shift));
    const nameStart = path.lastIndexOf("/") + 1;
    const runs = [{ text: cursor ? "▸ " : "  ", fg: theme.accent, bg: rowBg }];
    [...path].forEach((char, index) => {
      const fg = matched.has(index) ? theme.accent : read ? theme.muted : index < nameStart ? theme.fileHeaderDir : theme.fg;
      const bold = matched.has(index) && !read;
      const last = runs.at(-1);
      if (last.fg === fg && !!last.bold === bold && runs.length > 1)
        last.text += char;
      else
        runs.push({ text: char, fg, bg: rowBg, bold });
    });
    const used = runs.reduce((n, run) => n + measureTextWidth(run.text), 0);
    runs.push({ text: " ".repeat(Math.max(0, width - used - rightWidth)), fg: rowBg, bg: rowBg }, ...right);
    lines.push({ runs: exactly(runs, width, rowBg), pick: pick2.fileIndex });
  }
  const hint = `⏎ open · ↑↓ or ctrl-n/p move · ${closeHint} `;
  const typed = [
    { text: "› ", fg: theme.accent, bg },
    { text: state.query, fg: theme.fg, bg },
    { text: " ", fg: theme.bg, bg: theme.fg }
  ];
  const typedWidth = typed.reduce((n, run) => n + measureTextWidth(run.text), 0);
  lines.push({ runs: exactly([
    ...typed,
    { text: " ".repeat(Math.max(1, width - typedWidth - measureTextWidth(hint))), fg: bg, bg },
    { text: hint, fg: theme.muted, bg }
  ], width, bg) });
  return lines;
}

// ../viewer/src/document/selection.ts
function selectionBounds(rows, selection) {
  if (!selection)
    return [-1, -1];
  const a = rows.findIndex((r) => r.key === selection.anchor), b = rows.findIndex((r) => r.key === selection.end);
  return a < 0 || b < 0 ? [-1, -1] : [Math.min(a, b), Math.max(a, b)];
}
var lineNumber = (row, side) => side === "left" ? row.left?.lineNumber ?? row.cell?.oldLineNumber : row.right?.lineNumber ?? row.cell?.newLineNumber;
function whereToFind(version2) {
  switch (version2.type) {
    case "working_tree":
      return "";
    case "index":
      return " in the git index (staged)";
    case "revision":
    case "path":
      return ` at ${snapshotLabel(version2)}`;
    case "empty_tree":
      throw new Error("The empty tree has no source to copy");
  }
}
function agentReference(files, comparison, rows, selection) {
  const [a, b] = selectionBounds(rows, selection);
  const ranges = new Map;
  for (const row of rows.slice(a < 0 ? rows.length : a, b + 1)) {
    const n = lineNumber(row, selection.side);
    if (n === undefined)
      continue;
    const range = ranges.get(row.fileIndex);
    ranges.set(row.fileIndex, range ? [Math.min(range[0], n), Math.max(range[1], n)] : [n, n]);
  }
  const left = selection.side === "left";
  return [...ranges].map(([fileIndex, [start, end]]) => {
    const file2 = files[fileIndex];
    const source2 = file2?.diff.type === "text" ? left ? file2.diff.lhs : file2.diff.rhs : undefined;
    const path = left ? file2?.file.lhs?.path : file2?.file.rhs?.path;
    if (!source2 || path === undefined)
      throw new Error(`File ${fileIndex} has no ${selection.side} source to copy`);
    const code = sourceLines(source2.text).slice(start - 1, end).join(`
`);
    const fence = "`".repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((run) => run[0].length + 1)));
    const language = /\.([^./]+)$/.exec(path)?.[1] ?? "";
    const lines = start === end ? `${start}` : `${start}-${end}`;
    const where = whereToFind(left ? comparison.lhs : comparison.rhs);
    return `${path}:${lines}${where}
${fence}${language}
${code}
${fence}`;
  }).join(`

`);
}
function copySelection(files, rows, selection) {
  const [a, b] = selectionBounds(rows, selection), seen2 = new Set, result = [];
  const sources = new Map;
  for (const row of rows.slice(a < 0 ? rows.length : a, b + 1)) {
    const n = lineNumber(row, selection.side);
    if (n === undefined)
      continue;
    const key = `${row.fileIndex}:${n}`;
    if (seen2.has(key))
      continue;
    seen2.add(key);
    const diff2 = files[row.fileIndex]?.diff;
    if (!diff2 || diff2.type !== "text")
      continue;
    const source2 = selection.side === "left" ? diff2.lhs : diff2.rhs;
    if (!source2)
      continue;
    let lines = sources.get(row.fileIndex);
    if (!lines) {
      lines = source2.text.split(`
`);
      sources.set(row.fileIndex, lines);
    }
    result.push(lines[n - 1]);
  }
  return result.join(`
`);
}

// src/paint.ts
var fit = (text, width) => sliceTextByWidth(text, 0, width).text;

class Colors {
  list = [];
  index = new Map;
  of(color) {
    let at = this.index.get(color);
    if (at === undefined) {
      at = this.list.push(color) - 1;
      this.index.set(color, at);
    }
    return at;
  }
}

class LineBuilder {
  colors;
  bg;
  segments = [];
  hits = [];
  hovers = [];
  width = 0;
  constructor(colors, bg) {
    this.colors = colors;
    this.bg = bg;
  }
  text(text, fg, bg = this.bg, bold = false) {
    if (!text)
      return this;
    const segment = [text, this.colors.of(fg), this.colors.of(bg)];
    if (bold)
      segment.push(1);
    const last = this.segments.at(-1);
    if (last && last[1] === segment[1] && last[2] === segment[2] && last[3] === segment[3])
      last[0] += text;
    else
      this.segments.push(segment);
    this.width += measureTextWidth(text);
    return this;
  }
  fill(to, bg = this.bg) {
    return to > this.width ? this.text(" ".repeat(to - this.width), bg, bg) : this;
  }
  hit(from, to, act) {
    if (to > from)
      this.hits.push([from, to, act]);
    return this;
  }
  hover(from, to, hover2) {
    if (to > from)
      this.hovers.push([from, to, hover2]);
    return this;
  }
  cut(width) {
    let room = width;
    const segments = [];
    for (const segment of this.segments) {
      if (room <= 0)
        break;
      const cells = measureTextWidth(segment[0]);
      segments.push(cells <= room ? segment : [fit(segment[0], room), ...segment.slice(1)]);
      room -= cells;
    }
    this.segments.splice(0, this.segments.length, ...segments);
    this.width = Math.min(this.width, width);
    return this;
  }
  line(width) {
    this.fill(width).cut(width);
    const line = { bg: this.colors.of(this.bg), segments: this.segments };
    if (this.hits.length)
      line.hits = this.hits;
    if (this.hovers.length)
      line.hovers = this.hovers;
    return line;
  }
}
function paintCell(line, value, spans, width, unified, { fileIndex, ...options }) {
  const start = line.width;
  const plan = planCell(value, spans, width, unified, options);
  for (const run of plan.runs)
    line.text(run.text, run.fg, run.bg);
  for (const [from, to, id] of plan.hits)
    line.hit(start + from, start + to, { fold: id, file: fileIndex });
  for (const [from, to, focus] of plan.hovers)
    line.hover(start + from, start + to, { file: fileIndex, ...focus });
}

// src/frame.ts
var SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
var KEYS = [
  ["j k · d u · space b", "scroll a line, half a page, a page"],
  ["g G", "first file, last line"],
  ["h l · H L", "pan sideways, faster"],
  ["[ ]", "previous, next change"],
  ["za zo zc · zA zO zC", "toggle, open, close the top fold; deep"],
  ["zM zR · zj zk", "fold all, unfold all; next, previous fold"],
  ["c", "show or hide unchanged context"],
  ["/ · n N", "search; next, previous match"],
  ["ctrl-p", "go to a changed file"],
  ["\\ · ⌘B · ☰ files", "the file tree"],
  ["V · a header's box", "mark a file viewed"],
  ["drag · y · Y", "select lines; copy them; copy them for an agent"],
  ["s · w · t", "split or unified; wrap; theme"],
  ["?", "this list"],
  ["q", "close the pane"]
];
var KEYS_BUTTON = " ? keys ";
var SPLIT_COLUMNS = 180;
var TREE_MIN_COLUMNS = 120;

class Pane {
  store;
  viewer;
  message = "";
  size;
  showTree;
  closedDirectories = new Set;
  treeScroll = 0;
  treeFollows;
  selection = null;
  selecting = false;
  cellsAt = new Map;
  helpView = false;
  filesView = false;
  treeCursor = 0;
  constructor(store, theme) {
    this.store = store;
    this.viewer = new Viewer(store, theme, SPLIT_COLUMNS);
  }
  subscribe(listener) {
    return this.viewer.subscribe(listener);
  }
  hover(hover2) {
    this.viewer.setHover(hover2);
  }
  input(input2) {
    if ("act" in input2)
      this.act(input2.act, input2.alt === true);
    else if ("select" in input2)
      this.select(input2.select);
    else
      return this.press(input2.press);
    return {};
  }
  copied(what, refusal) {
    this.message = refusal ? `Not copied: ${refusal}` : `Copied ${what}`;
  }
  select({ x, y, extend: extend2 }) {
    const cell = this.cellsAt.get(y);
    if (!extend2) {
      this.selecting = !!cell;
      this.selection = cell ? { anchor: cell.key, end: cell.key, side: cell.side(x) } : null;
    } else if (this.selecting && this.selection && cell)
      this.selection = { ...this.selection, end: cell.key };
  }
  act(action2, recursive) {
    this.message = "";
    this.selecting = false;
    if ("fold" in action2)
      this.viewer.setFold(action2.file, action2.fold, "toggle", recursive);
    else if ("viewedFile" in action2)
      this.viewer.toggleViewedFile(action2.viewedFile);
    else if ("file" in action2)
      this.viewer.toggleFile(action2.file);
    else if ("jump" in action2)
      this.goToFile(action2.jump);
    else if ("dir" in action2)
      this.toggleDirectory(action2.dir);
    else if ("scrub" in action2)
      this.viewer.scrub(action2.scrub);
    else if ("files" in action2)
      this.toggleFiles();
    else if ("pick" in action2)
      this.viewer.pickFile(action2.pick);
    else if ("help" in action2)
      this.helpView = !this.helpView;
    else
      this.viewer.toggleLayout();
  }
  press(key) {
    if (this.viewer.prompting || this.viewer.picking) {
      this.viewer.press(key);
      return {};
    }
    const plain = !key.ctrl && !key.meta;
    if (plain && key.key === "q")
      return { close: true };
    this.message = "";
    if (this.helpView) {
      this.helpView = false;
      return {};
    }
    if (plain && key.key === "?") {
      this.helpView = true;
      return {};
    }
    if (!this.size)
      throw new Error("The pane has not been drawn yet");
    const files = plain && key.key === "\\" || key.meta && key.key === "b";
    if (this.filesView) {
      if (files)
        this.toggleFiles();
      else
        this.pressFiles(key.key);
      return {};
    }
    if (plain && (key.key === "y" || key.key === "Y"))
      return this.copy(key.key === "Y");
    if (files)
      this.toggleFiles();
    else {
      const chord = this.viewer.chording;
      this.viewer.press(key);
      if (!chord && plain && (key.key === "s" || key.key === "c"))
        this.selection = null;
    }
    return {};
  }
  narrow(size) {
    return size.columns < TREE_MIN_COLUMNS;
  }
  treeRows() {
    return flattenFileTree(buildFileTree(this.store.getSnapshot().inventory), this.closedDirectories);
  }
  toggleFiles() {
    if (!this.size)
      throw new Error("The pane has not been drawn yet");
    if (!this.narrow(this.size)) {
      this.showTree = !(this.showTree ?? true);
      return;
    }
    this.filesView = !this.filesView;
    if (this.filesView) {
      const { currentFile } = this.viewer.lay(this.layoutSize(this.size));
      this.treeCursor = Math.max(0, this.treeRows().findIndex((row) => row.node.fileIndex === currentFile));
    }
  }
  pressFiles(name) {
    const rows = this.treeRows();
    if (name === "j" || name === "down")
      this.treeCursor = Math.min(rows.length - 1, this.treeCursor + 1);
    else if (name === "k" || name === "up")
      this.treeCursor = Math.max(0, this.treeCursor - 1);
    else if (name === "return" || name === "enter") {
      const node = rows[this.treeCursor]?.node;
      if (!node)
        return;
      if (node.fileIndex === undefined)
        this.toggleDirectory(node.key);
      else
        this.goToFile(node.fileIndex);
    }
  }
  toggleDirectory(key) {
    if (this.closedDirectories.has(key))
      this.closedDirectories.delete(key);
    else
      this.closedDirectories.add(key);
  }
  goToFile(index) {
    this.viewer.jump(index);
    this.filesView = false;
  }
  copy(forAgent) {
    if (!this.selection) {
      this.message = "Drag across lines to select them first";
      return {};
    }
    const { snapshot: snapshot3, rows } = this.viewer.lay(this.layoutSize(this.size));
    if (!snapshot3.comparison)
      throw new Error("A selection exists before diffr named the comparison");
    const text = forAgent ? agentReference(snapshot3.files, snapshot3.comparison, rows, this.selection) : copySelection(snapshot3.files, rows, this.selection);
    if (!text) {
      this.message = "The selection holds no source lines";
      return {};
    }
    return { copy: { text, what: forAgent ? "for agent" : "source lines" } };
  }
  scroll(by, wheelColumn) {
    if (this.filesView)
      return this.pressFiles(by < 0 ? "up" : "down");
    if (wheelColumn === undefined)
      return this.viewer.move(by);
    if (!this.size)
      throw new Error("The pane has not been drawn yet");
    if (wheelColumn >= this.sidebar(this.size))
      return this.viewer.move(by * 3);
    const treeRows = flattenFileTree(buildFileTree(this.store.getSnapshot().inventory), this.closedDirectories);
    this.treeScroll = Math.max(0, Math.min(Math.max(0, treeRows.length - this.bodyRows(this.size)), this.treeScroll + by * 3));
  }
  sidebar(size) {
    return !this.narrow(size) && (this.showTree ?? true) ? Math.max(16, Math.min(28, size.columns - 40)) : 0;
  }
  bodyRows(size) {
    return Math.max(1, size.rows - 2);
  }
  layoutSize(size) {
    return { columns: Math.max(10, size.columns - this.sidebar(size) - 1), rows: this.bodyRows(size) };
  }
  frame(size) {
    this.size = size;
    const viewer = this.viewer;
    const sidebar = this.sidebar(size);
    const contentWidth = this.layoutSize(size).columns;
    const at = viewer.lay(this.layoutSize(size));
    const { snapshot: snapshot3, theme, hover: hover2, horizontal, layout, geometry, top, viewport, currentFile, sticky, thumb } = at;
    const viewportHeight = at.size.rows;
    const { inventory, files, failures } = snapshot3;
    const colors = new Colors;
    const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length];
    const statusGlyph = (index) => failures[index] || snapshot3.complete ? "!" : spinner;
    const treeMark = (index) => viewer.isViewed(index) ? "✓" : " ";
    const counts = files.map((file2) => file2 && lineCounts2(file2));
    const title = new LineBuilder(colors, theme.chrome);
    const loaded = counts.filter((c) => c !== undefined);
    const visible = loaded.reduce((sum, c) => add(sum, c.visible), zero);
    const button = " ☰ files ";
    title.hit(0, measureTextWidth(button), { files: true }).text(button, this.filesView ? theme.bg : theme.accent, this.filesView ? theme.accent : theme.chrome);
    title.text(` ${snapshot3.comparison ? comparisonLabel(snapshot3.comparison.lhs, snapshot3.comparison.rhs) : "diffr"}`, theme.fg).text(` · ${inventory.length} files · `, theme.muted).text(`+${visible.added}`, theme.addedText).text(` −${visible.removed}`, theme.removedText).text(snapshot3.complete ? " " : "… ", theme.muted);
    for (const block of blockBar(visible))
      title.text(block === "neutral" ? "□" : "■", block === "added" ? theme.addedText : block === "removed" ? theme.removedText : theme.muted);
    const badge = `${horizontal ? `  ⇠ col ${horizontal + 1}` : ""}  ${layout} [s] `;
    title.cut(size.columns - measureTextWidth(badge)).fill(size.columns - measureTextWidth(badge), theme.chrome);
    title.hit(title.width, title.width + measureTextWidth(badge), { layout: true }).text(badge, theme.accent);
    const lines = [title.line(size.columns)];
    const currentPath = inventory[currentFile];
    if (currentPath && this.treeFollows !== currentFile)
      parentDirectories(currentPath).forEach((path) => this.closedDirectories.delete(path));
    const treeRows = flattenFileTree(buildFileTree(inventory), this.closedDirectories);
    const treeIndex = treeRows.findIndex((r) => r.node.fileIndex === currentFile);
    if (treeIndex >= 0 && this.treeFollows !== currentFile)
      this.treeScroll = treeIndex < this.treeScroll ? treeIndex : treeIndex >= this.treeScroll + viewportHeight ? treeIndex - viewportHeight + 1 : this.treeScroll;
    this.treeFollows = currentFile;
    const treeTop = Math.min(this.treeScroll, Math.max(0, treeRows.length - viewportHeight));
    const fileHeader = (line, fileIndex) => {
      const file2 = files[fileIndex], count = counts[fileIndex]?.visible;
      const path = sanitizeTerminalLine(filePath(inventory[fileIndex].file));
      const shown = !!file2 && !!count;
      const start = line.width;
      const state = shown ? viewer.isViewed(fileIndex) : undefined, viewed = state === true;
      const tally = shown && !viewed ? [` +${count.added}`, ` −${count.removed}`] : [];
      const box = state === undefined ? "" : ` ${viewedBox(state)}`;
      const hint = state !== undefined && hover2 && "header" in hover2 && hover2.file === fileIndex ? viewedHint(state) : "";
      const statsWidth = shown ? measureTextWidth(tally.join("") + (hint && ` ${hint}`) + box) + 1 : 0;
      const pathWidth = Math.max(1, contentWidth - statsWidth - 1);
      const glyph = shown ? viewer.isClosed(fileIndex, file2) ? "▸" : "▾" : statusGlyph(fileIndex);
      const directory = fit(`${glyph} ${path.slice(0, path.lastIndexOf("/") + 1)}`, pathWidth);
      const name = fit(path.slice(path.lastIndexOf("/") + 1), Math.max(0, pathWidth - measureTextWidth(directory)));
      const lit = viewer.highlight(fileIndex, `${fileIndex}:header`, "right");
      line.text("▌", viewed ? theme.muted : theme.accent, theme.fileHeader);
      for (const run of litRuns(directory, viewed ? theme.muted : theme.fileHeaderDir, theme.fileHeader, lit, theme))
        line.text(run.text, run.fg, run.bg);
      for (const run of litRuns(name, viewed ? theme.muted : shown ? theme.fg : theme.fileHeaderDir, theme.fileHeader, lit, theme))
        line.text(run.text, run.fg, run.bg, !viewed);
      line.fill(start + 1 + pathWidth, theme.fileHeader);
      if (tally.length)
        line.text(tally[0], theme.addedText, theme.fileHeader).text(tally[1], theme.removedText, theme.fileHeader);
      if (hint)
        line.text(" ", theme.fg, theme.fileHeader).text(hint, theme.bg, theme.accent);
      if (state !== undefined) {
        line.hit(line.width, line.width + measureTextWidth(box), { viewedFile: fileIndex });
        line.hover(line.width, line.width + measureTextWidth(box), { file: fileIndex, header: true });
        line.text(box, viewed ? theme.accent : theme.fg, theme.fileHeader);
      }
      line.fill(start + contentWidth, theme.fileHeader);
      if (shown)
        line.hit(start, start + contentWidth, { file: fileIndex });
    };
    this.cellsAt.clear();
    const rowIndex = new Map(at.rows.map((row, index) => [row.key, index]));
    const [selectionStart, selectionEnd] = selectionBounds(at.rows, this.selection);
    const selectedSide = (key) => {
      const index = rowIndex.get(key);
      return index >= selectionStart && index <= selectionEnd ? this.selection.side : undefined;
    };
    const body = [];
    for (const measured of viewport) {
      const row = measured.row;
      for (let visualLine = Math.max(0, top - measured.top);visualLine < measured.height && measured.top + visualLine < top + viewportHeight - (sticky ? 1 : 0); visualLine++) {
        if (row.key.endsWith(":header"))
          body.push((line) => fileHeader(line, row.fileIndex));
        else if (row.label !== undefined)
          body.push((line) => {
            const start = line.width;
            const label = row.pending ? `    ${spinner} ${row.label}` : row.loadDiff ? `    ${row.label}` : row.label;
            line.text(fit(sanitizeTerminalLine(label), contentWidth), row.loadDiff ? theme.accent : theme.muted, theme.bg);
            if (row.loadDiff)
              line.hit(start, start + contentWidth, { file: row.fileIndex });
            line.fill(start + contentWidth, theme.bg);
          });
        else
          body.push((line, y) => {
            const focus = hover2?.file === row.fileIndex && "id" in hover2 ? hover2 : undefined;
            const paint = { theme, geometry, fileIndex: row.fileIndex, visualLine, focus, read: viewer.isViewed(row.fileIndex) === true };
            const selected = selectedSide(row.key);
            if (row.cell) {
              const side = row.cell.newLineNumber === undefined ? "left" : "right";
              this.cellsAt.set(y + 1, { key: row.key, side: () => side });
              paintCell(line, row.cell, measured.cell[visualLine] ?? [], geometry.leftWidth + geometry.rightWidth + 1, true, { ...paint, selected: selected === side, search: viewer.highlight(row.fileIndex, row.key, side) });
            } else {
              paintCell(line, row.left, measured.left[visualLine] ?? [], geometry.leftWidth, false, { ...paint, selected: selected === "left", search: viewer.highlight(row.fileIndex, row.key, "left") });
              const divider = line.width;
              this.cellsAt.set(y + 1, { key: row.key, side: (x) => x < divider ? "left" : "right" });
              line.text("│", theme.muted, theme.bg);
              paintCell(line, row.right, measured.right[visualLine] ?? [], geometry.rightWidth, false, { ...paint, selected: selected === "right", search: viewer.highlight(row.fileIndex, row.key, "right") });
            }
          });
      }
    }
    if (currentFile >= 0 && sticky)
      body.unshift((line) => fileHeader(line, currentFile));
    if (!body.length)
      body.push((line) => line.text(snapshot3.complete ? "No changed files" : `${spinner} Starting comparison…`, theme.muted, theme.bg));
    if (this.helpView) {
      const keyWidth = Math.max(...KEYS.map(([keys]) => measureTextWidth(keys))) + 4;
      for (let y = 0;y < viewportHeight; y++) {
        const line = new LineBuilder(colors, theme.bg), entry = KEYS[y];
        line.hit(0, size.columns, { help: true });
        if (entry)
          line.text(`  ${entry[0]}`, theme.accent).fill(keyWidth).text(entry[1], theme.fg);
        lines.push(line.line(size.columns));
      }
    } else if (this.filesView) {
      this.treeCursor = Math.min(this.treeCursor, Math.max(0, treeRows.length - 1));
      this.treeScroll = this.treeCursor < this.treeScroll ? this.treeCursor : this.treeCursor >= this.treeScroll + viewportHeight ? this.treeCursor - viewportHeight + 1 : this.treeScroll;
      for (let y = 0;y < viewportHeight; y++) {
        const line = new LineBuilder(colors, theme.bg), index = this.treeScroll + y, entry = treeRows[index];
        if (entry) {
          const { node, depth } = entry, file2 = node.fileIndex;
          const cursor = index === this.treeCursor, bg = cursor ? theme.highlight : theme.bg;
          const read2 = file2 !== undefined && viewer.isViewed(file2) === true;
          const count = file2 === undefined || read2 ? undefined : counts[file2]?.visible;
          const tally = count ? [` +${count.added}`, ` −${count.removed} `] : [" "];
          const label = "  ".repeat(depth) + (file2 === undefined ? this.closedDirectories.has(node.key) ? "▸ " : "▾ " : `${files[file2] ? treeMark(file2) : statusGlyph(file2)} `) + node.name;
          const width = size.columns - 2 - measureTextWidth(tally.join(""));
          line.text(cursor ? "▸ " : "  ", theme.accent, bg).text(fit(sanitizeTerminalLine(label), width), file2 === currentFile ? theme.accent : file2 === undefined || read2 ? theme.muted : theme.fg, bg, file2 === currentFile).fill(2 + width, bg);
          if (count)
            line.text(tally[0], theme.addedText, bg).text(tally[1], theme.removedText, bg);
          line.fill(size.columns, bg);
          line.hit(0, size.columns, file2 === undefined ? { dir: node.key } : { jump: file2 });
        }
        lines.push(line.line(size.columns));
      }
    }
    for (let y = 0;y < (this.filesView || this.helpView ? 0 : viewportHeight); y++) {
      const line = new LineBuilder(colors, theme.bg);
      if (sidebar > 0) {
        const entry = treeRows[treeTop + y];
        if (entry) {
          const { node, depth } = entry;
          const current = node.fileIndex === currentFile;
          const label = "  ".repeat(depth) + (node.fileIndex === undefined ? this.closedDirectories.has(node.key) ? "▸ " : "▾ " : `▤ ${files[node.fileIndex] ? treeMark(node.fileIndex) : statusGlyph(node.fileIndex)} `) + node.name;
          const read2 = node.fileIndex !== undefined && viewer.isViewed(node.fileIndex) === true;
          line.text(fit(sanitizeTerminalLine(label), sidebar - 1), current ? theme.accent : node.fileIndex === undefined || read2 ? theme.muted : theme.fg, current ? theme.highlight : theme.bg);
          line.fill(sidebar - 1, current ? theme.highlight : theme.bg);
          line.hit(0, sidebar - 1, node.fileIndex === undefined ? { dir: node.key } : { jump: node.fileIndex });
        }
        line.fill(sidebar - 1).text("│", theme.muted);
      }
      body[y]?.(line, y);
      line.fill(sidebar + contentWidth);
      const onThumb = y >= thumb.top && y < thumb.top + thumb.height;
      line.hit(line.width, line.width + 1, { scrub: y }).text(" ", theme.muted, onThumb ? theme.muted : theme.bg);
      lines.push(line.line(size.columns));
    }
    const picker = viewer.pickerState();
    if (picker) {
      const drawn = pickerLines(picker, size.columns, Math.min(10, viewportHeight), theme, (index) => counts[index]?.visible, (index) => viewer.isViewed(index) === true, "ctrl-c close");
      lines.splice(lines.length - drawn.length, drawn.length, ...drawn.map(({ runs, pick: pick2 }) => {
        const line = new LineBuilder(colors, theme.chrome);
        if (pick2 !== undefined)
          line.hit(0, size.columns, { pick: pick2 });
        for (const run of runs)
          line.text(run.text, run.fg, run.bg, run.bold);
        return line.line(size.columns);
      }));
    }
    const status = new LineBuilder(colors, theme.bg);
    const errors3 = snapshot3.errors.length ? `${snapshot3.errors.length} errors  ` : "";
    const read = viewer.viewedFiles();
    const found = viewer.searchState();
    if (found && "prompt" in found)
      status.text(fit(`/${found.prompt}▏ · ${found.count} matches · ⏎ go · ctrl-c cancel`, size.columns), theme.fg);
    else {
      const searched = !found ? "" : `/${found.pattern} · ${found.total ? `match ${found.at} of ${found.total} in ${found.files} files · n/N` : "no matches"} · `;
      const order = flattenFileTree(buildFileTree(inventory), new Set).flatMap(({ node }) => node.fileIndex === undefined ? [] : [node.fileIndex]);
      const name = inventory[currentFile] ? filePath(inventory[currentFile].file).split("/").at(-1) : undefined;
      const where = name === undefined ? "" : `${name} · file ${order.indexOf(currentFile) + 1} of ${order.length} · ${at.maxScroll ? Math.round(top / at.maxScroll * 100) : 100}% · `;
      const loading = snapshot3.complete ? "" : `${snapshot3.loaded}/${inventory.length} loaded… `;
      const keys = this.filesView ? " j/k move · ⏎ open · \\ or ⌘B back" : " [/] hunks · / search · ctrl-p files · \\ or ⌘B tree · V viewed · drag selects · y/Y copy";
      const room = size.columns - measureTextWidth(KEYS_BUTTON);
      const text = `${this.message ? `${this.message} · ` : ""}${searched}${this.filesView ? "" : where}${read.viewed}/${read.total} viewed ${loading}${errors3}${keys}`;
      status.text(measureTextWidth(text) > room ? `${fit(text, room - 1)}…` : text, theme.muted).fill(room);
      status.hit(room, size.columns, { help: true }).text(KEYS_BUTTON, this.helpView ? theme.bg : theme.accent, this.helpView ? theme.accent : theme.bg);
    }
    lines.push(status.line(size.columns));
    return { colors: colors.list, fg: colors.of(theme.fg), lines, hover: hover2 };
  }
}

// src/register.tsx
var PANE = "diffr";
var BAND = 16;
async function loadTheme($, binary) {
  const shown = await $.process.run([binary, "config", "show", "--json"]);
  if (shown.exitCode !== 0)
    throw new Error(shown.stderr || `${binary} config show exited with status ${shown.exitCode}`);
  const config2 = themeConfig(JSON.parse(shown.stdout));
  return config2.path ? paletteFromHelix(parseHelixTheme(await $.fs.read(config2.path), config2.path)) : loadBundledTheme(config2.name);
}
async function pump(store, child) {
  let stderr = "";
  async function* stdout() {
    for await (const chunk of child) {
      if (chunk.stream === "stdout")
        yield chunk.text;
      else
        stderr = (stderr + chunk.text).slice(-16384);
    }
  }
  try {
    for await (const event of parseDiffEvents(stdout()))
      store.accept(event);
  } catch (error46) {
    store.fail(stderr ? `${error46}
${stderr}` : error46);
  }
}
function register(on, options) {
  const binary = options.diffr;
  if (typeof binary !== "string")
    throw new Error(`The diffr option must be a string, not ${typeof binary}`);
  let pane;
  let child;
  const acks = new Map;
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "diffr",
      description: "Review a diff with diffr",
      argumentHint: "[revisions or paths, as for diffr]"
    });
    return next(e);
  });
  on("command.run", { command: "diffr" }, async ($, e) => {
    const args = splitArgs(e.args);
    let theme;
    try {
      theme = await loadTheme($, binary);
    } catch (error46) {
      return { text: `diffr could not start: ${error46 instanceof Error ? error46.message : String(error46)}` };
    }
    child?.return({ code: null, signal: null });
    const store = new DiffStore;
    pane = new Pane(store, theme);
    pane.subscribe(() => $.ui.invalidate("ui.render"));
    child = $.process.spawn({ argv: [binary, "--format", "ndjson", "--syntax", ...args] });
    pump(store, child);
    await $.ui.open({
      id: PANE,
      title: ["diffr", ...args].join(" "),
      focus: true,
      columns: Math.floor(e.presentation.columns * 0.6)
    });
    return { text: `Opened diffr ${e.args} in a pane.`.replace("  ", " ") };
  });
  on("ui.render", { component: "Pane", requestId: "diffr" }, async ($, e) => {
    if (e.surface !== "terminal" && e.surface !== "desktop") {
      const { Text: Text2 } = $.ui.resolve(e);
      return /* @__PURE__ */ h(Text2, {
        dimColor: true
      }, "The diffr pane draws in the terminal and the desktop app.");
    }
    const { Box, Text, Client } = $.ui.resolve(e);
    if (!pane)
      return /* @__PURE__ */ h(Text, {
        dimColor: true
      }, "Run /diffr to open a comparison.");
    const columns = e.props.bodyColumns, rows = e.props.scroll.bodyRows;
    const frame = pane.frame({ columns, rows });
    const bands = Array.from({ length: Math.ceil(frame.lines.length / BAND) }, (_, i) => frame.lines.slice(i * BAND, (i + 1) * BAND));
    return /* @__PURE__ */ h(Box, {
      flexDirection: "column",
      width: columns
    }, bands.map((lines, i) => /* @__PURE__ */ h(Client, {
      key: `diff-${i}`,
      module: "./view.js",
      props: { ...frame, lines, offset: i * BAND, acks: Object.fromEntries(acks) },
      width: columns,
      height: lines.length
    })));
  });
  on("ui.message", async ($, e) => {
    if (e.requestId !== PANE || !pane)
      return {};
    const post2 = parsePost(e.data);
    if (post2.hover !== undefined)
      pane.hover(post2.hover);
    for (const [seq, input2] of post2.inputs) {
      if (seq <= (acks.get(post2.instance) ?? 0))
        continue;
      acks.set(post2.instance, seq);
      const outcome = pane.input(input2);
      if (outcome.close) {
        await $.ui.close({ id: PANE });
        return {};
      }
      if (outcome.copy) {
        const copied = await $.ui.copy({ text: outcome.copy.text, surface: e.surface });
        pane.copied(outcome.copy.what, copied.isCopied ? undefined : copied.reason);
      }
    }
    $.ui.invalidate("ui.render");
    return {};
  });
  on("ui.scroll", { requestId: "diffr" }, async ($, e) => {
    if (!pane)
      return {};
    pane.scroll(e.by, e.pointer?.column);
    $.ui.invalidate("ui.render");
    return {};
  });
}
export {
  register
};
