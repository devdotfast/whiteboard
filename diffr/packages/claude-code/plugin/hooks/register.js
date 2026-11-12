var __defProp = Object.defineProperty;
var __export = (target, all2) => {
  for (var name in all2)
    __defProp(target, name, { get: all2[name], enumerable: true });
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
  const palette = /* @__PURE__ */ new Map();
  const rawPalette = raw.palette;
  if (rawPalette && typeof rawPalette === "object")
    for (const [key, value] of Object.entries(rawPalette)) {
      if (typeof value !== "string") throw new Error(`Theme ${name}: palette entry ${key} is not a colour`);
      palette.set(key, value);
    }
  const styles = /* @__PURE__ */ new Map();
  for (const [scope, value] of Object.entries(raw)) {
    if (scope === "palette" || scope === "inherits") continue;
    if (typeof value === "string") styles.set(scope, { fg: value, modifiers: [] });
    else if (value && typeof value === "object") {
      const style = value;
      styles.set(scope, { fg: style.fg, bg: style.bg, modifiers: style.modifiers ?? [] });
    } else throw new Error(`Theme ${name}: scope ${scope} has an unsupported value`);
  }
  if (typeof raw.inherits === "string")
    throw new Error(`Theme ${name} inherits from ${raw.inherits}; inherited themes are not supported`);
  return { name, styles, palette };
}
function colorOf(theme, value) {
  const fromPalette = theme.palette.get(value);
  if (fromPalette !== void 0) return colorOf(theme, fromPalette);
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  const named2 = ansi[value];
  if (named2) return named2;
  throw new Error(`Theme ${theme.name}: unknown colour ${value}`);
}
function scopeStyle(theme, scope) {
  const parts = scope.split(".");
  while (parts.length) {
    const style = theme.styles.get(parts.join("."));
    if (style) return style;
    parts.pop();
  }
  return void 0;
}
var scopeFg = (theme, scope) => {
  const style = scopeStyle(theme, scope);
  return style?.fg === void 0 ? void 0 : colorOf(theme, style.fg);
};
var scopeBg = (theme, scope) => {
  const style = scopeStyle(theme, scope);
  return style?.bg === void 0 ? void 0 : colorOf(theme, style.bg);
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
  if (!bg || !fg) throw new Error(`Theme ${theme.name} lacks ui.background or ui.text`);
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
    selection: mix(bg, ansi["light-blue"], 0.35),
    addition: mix(bg, plus, 0.12),
    deletion: mix(bg, minus, 0.12),
    modification: mix(bg, delta, 0.12),
    readAddition: mix(bg, plus, 0.06),
    readDeletion: mix(bg, minus, 0.06),
    searchMatch: mix(bg, accent, 0.4),
    searchCurrent: scopeFg(theme, "warning") ?? delta,
    searchCurrentText: isLight ? fg : bg,
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
  if (!theme || typeof theme.name !== "string" || theme.path !== null && theme.path !== void 0 && typeof theme.path !== "string")
    throw new Error("diffr config show did not include a theme section");
  return { name: theme.name, path: theme.path ?? null };
}

// ../../../node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string3, ptr) {
  let lines = string3.slice(0, ptr).split(/\r?\n/);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string3, line, column) {
  let lines = string3.split(/\r?\n/);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class _TomlError extends Error {
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
  /** @internal */
  static x(message, ctx, ptr) {
    throw new _TomlError(message, { toml: ctx.s, ptr: ptr ?? ctx.p });
  }
};

// ../../../node_modules/smol-toml/dist/primitive.js
function parseString(ctx) {
  let startPtr = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      TomlError.x("control characters are not allowed in strings", ctx);
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state) {
        let s = ctx.s.slice(sliceStart, ctx.p);
        parsed = parsed ? parsed + s : s;
      }
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let errPtr = ctx.p++ - 1;
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            TomlError.x("invalid non-hex character in unicode escape", ctx);
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          TomlError.x("invalid unicode escape", ctx, errPtr);
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p--;
        state = 0;
      } else if (isMultiline && (c === 32 || c === 9)) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          TomlError.x("unrecognised escape sequence", ctx);
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2)
        TomlError.x("invalid escape: only line-ending whitespace may be escaped", ctx, sliceStart);
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  TomlError.x("unfinished string", ctx, startPtr);
}

// ../../../node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[Tt ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date2, fasttype, unsafeDelim) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    let c;
    if (typeof date2 === "string") {
      if (fasttype)
        prep: {
          if (fasttype < 3) {
            if (+date2.slice(11, 13) > 23) {
              date2 = "";
              break prep;
            }
            if (fasttype === 2) {
              offset = null;
              date2 += "Z";
            } else if ((c = date2.charCodeAt(date2.length - 1)) !== 90 && c !== 122) {
              offset = date2.slice(date2.length - 6);
            }
            if (unsafeDelim)
              date2 = date2.slice(0, 10) + "T" + date2.slice(11);
          } else if (fasttype === 4) {
            date2 = +date2.slice(0, 2) > 23 ? "" : `0000-01-01T${date2}Z`;
          }
          hasDate = fasttype !== 4;
          hasTime = fasttype !== 3;
        }
      else {
        let match = date2.match(DATE_TIME_RE);
        if (match) {
          if (!match[1]) {
            hasDate = false;
            date2 = `0000-01-01T${date2}`;
          }
          hasTime = !!match[2];
          hasTime && date2[10] === " " && (date2 = date2.replace(" ", "T"));
          if (match[2] && +match[2] > 23) {
            date2 = "";
          } else {
            offset = match[3] || null;
            if (!offset && hasTime)
              date2 += "Z";
          }
        } else {
          date2 = "";
        }
      }
    }
    super(date2);
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
    if (this.#offset === "Z" || this.#offset === "z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date2 = new _TomlDate(jsDate);
    date2.#offset = offset;
    return date2;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date2 = new _TomlDate(jsDate);
    date2.#offset = null;
    return date2;
  }
  static wrapAsLocalDate(jsDate) {
    let date2 = new _TomlDate(jsDate);
    date2.#hasTime = false;
    date2.#offset = null;
    return date2;
  }
  static wrapAsLocalTime(jsDate) {
    let date2 = new _TomlDate(jsDate);
    date2.#hasDate = false;
    date2.#offset = null;
    return date2;
  }
};

// ../../../node_modules/smol-toml/dist/extract.js
function isDigit(char, base = 10) {
  return base === 16 ? char > 47 && char < 58 || char > 64 && char < 71 || char > 96 && char < 103 : char > 47 && char < 48 + base;
}
function isEndOfValue(char, delim) {
  return char === 32 || char === 9 || char === 10 || char === 13 || // Structure end or next value delimiter
  delim && (char === delim || char === 44) || // Comment
  char === 35;
}
function extractValue(ctx, end) {
  let errPtr = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p);
  if (c === 91 || c === 123) {
    ctx.d-- || TomlError.x("document contains excessively nested structures. aborting.", ctx);
    let value = c === 91 ? parseArray(ctx) : parseInlineTable(ctx);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      TomlError.x("invalid value", ctx, errPtr);
    return ctx.p++, true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      TomlError.x("invalid value", ctx, errPtr);
    return ctx.p++, false;
  }
  if (c === 43 || c === 45) {
    return parseNumber(ctx, ctx.p, ctx.s.charCodeAt(++ctx.p), 44 - c, end);
  }
  if (ctx.s.charCodeAt(ctx.p + 4) === 45 && ctx.s.charCodeAt(ctx.p + 7) === 45) {
    return parseDate(ctx, c, end);
  }
  if (ctx.s.charCodeAt(ctx.p + 2) === 58) {
    return parseTime(ctx, c, end);
  }
  return parseNumber(ctx, ctx.p, c, 0, end);
}
function parseNumber(ctx, startPtr, startChr, sign, endChr) {
  let c = startChr;
  let state = 0;
  let hasUnderscores = false;
  if (c === 105) {
    if (ctx.s.charCodeAt(++ctx.p) !== 110 || ctx.s.charCodeAt(++ctx.p) !== 102)
      TomlError.x("invalid value", ctx, startPtr);
    return ctx.p++, (sign || 1) / 0;
  }
  if (c === 110) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 110)
      TomlError.x("invalid value", ctx, startPtr);
    return ctx.p++, NaN;
  }
  if (c === 48) {
    if (++ctx.p >= ctx.s.length || isEndOfValue(c = ctx.s.charCodeAt(ctx.p), endChr))
      return ctx.bi === true ? 0n : 0;
    if (!sign) {
      if (c === 120)
        return parseIntegerBaseN(ctx, startPtr, 16, endChr);
      else if (c === 98)
        return parseIntegerBaseN(ctx, startPtr, 2, endChr);
      else if (c === 111)
        return parseIntegerBaseN(ctx, startPtr, 8, endChr);
    }
    if (c === 46)
      state = 2;
    else if (c === 101 || c === 69)
      state = 4;
    else
      TomlError.x("illegal leading zero", ctx, startPtr);
  } else if (!isDigit(c))
    TomlError.x("invalid value", ctx, startPtr);
  while (++ctx.p < ctx.s.length && (c = ctx.s.charCodeAt(ctx.p), !isEndOfValue(c, endChr))) {
    if (!state)
      state = 1;
    if (c === 95) {
      if (!(state & 1))
        TomlError.x("illegal underscore", ctx);
      state += 11;
      hasUnderscores = true;
    } else if (state === 1 && c === 46)
      state = 2;
    else if ((state === 1 || state === 3) && (c === 101 || c === 69))
      state = 4;
    else if (state === 4 && (c === 43 || c === 45)) {
    } else if (!isDigit(c))
      TomlError.x(`illegal character in numeric literal`, ctx);
    else if (state > 9)
      state -= 11;
    else if (!(state & 1))
      state++;
  }
  if (!state) {
    let val = (startChr - 48) * (sign || 1);
    return ctx.bi === true ? BigInt(val) : val;
  }
  if (!(state & 1))
    TomlError.x("unfinished numeric value", ctx, startPtr);
  let str = ctx.s.slice(startPtr, ctx.p);
  if (hasUnderscores)
    str = str.replaceAll("_", "");
  return state > 1 ? parseFloat(str) : parseInteger(ctx, str, 10, startPtr);
}
function parseIntegerBaseN(ctx, startPtr, base, endChr) {
  let c, underscore = 1;
  while (++ctx.p < ctx.s.length && (c = ctx.s.charCodeAt(ctx.p), !isEndOfValue(c, endChr))) {
    if (c === 95) {
      if (underscore & 1)
        TomlError.x("illegal underscore", ctx);
      underscore = 3;
    } else if (!isDigit(c, base))
      TomlError.x(`illegal character in numeric literal`, ctx);
    else if (underscore & 1)
      underscore--;
  }
  if (underscore & 1)
    TomlError.x("unfinished numeric value", ctx);
  let str = ctx.s.slice(startPtr + 2, ctx.p);
  if (underscore)
    str = str.replaceAll("_", "");
  return parseInteger(ctx, str, base, startPtr);
}
function parseInteger(ctx, str, base, startPtr) {
  if (ctx.bi !== true)
    int: {
      let val = parseInt(str, base);
      if (!Number.isSafeInteger(val)) {
        if (ctx.bi)
          break int;
        TomlError.x("integer value cannot be represented losslessly", ctx, startPtr);
      }
      return val;
    }
  return base === 10 ? BigInt(str) : BigInt((base === 2 ? "0b" : base === 8 ? "0o" : "0x") + str);
}
function parseDate(ctx, c, endChr) {
  let startPtr = ctx.p++, unsafeSeparator;
  if (!isDigit(c) || !isDigit(ctx.s.charCodeAt(ctx.p++)) || !isDigit(ctx.s.charCodeAt(ctx.p++)) || !isDigit(ctx.s.charCodeAt(ctx.p++))) {
    return parseNumber(ctx, ctx.p = startPtr, c, 0, endChr);
  }
  ctx.p += 5;
  if (!isDigit(ctx.s.charCodeAt(ctx.p++)))
    TomlError.x("invalid date-time: date part is malformed", ctx, startPtr);
  if (ctx.p >= ctx.s.length || ((c = ctx.s.charCodeAt(ctx.p)) !== 32 || (unsafeSeparator = true, !isDigit(ctx.s.charCodeAt(ctx.p + 1)))) && c !== 84 && c !== 116) {
    let t2 = ctx.s.slice(startPtr, ctx.p);
    return readDate(ctx, t2, 3, false, startPtr);
  }
  if (ctx.s.charCodeAt(ctx.p += 3) !== 58)
    TomlError.x("invalid date-time: time part is malformed", ctx, startPtr);
  if (ctx.s.charCodeAt(ctx.p += 3) === 58)
    ctx.p += 3;
  if (ctx.s.charCodeAt(ctx.p) === 46)
    while (isDigit(ctx.s.charCodeAt(++ctx.p)))
      ;
  if (c = ctx.s.charCodeAt(ctx.p)) {
    if (c === 90 || c === 122) {
      let t2 = ctx.s.slice(startPtr, ++ctx.p);
      return readDate(ctx, t2, 1, unsafeSeparator, startPtr, "[+00:00]");
    }
    if (c === 43 || c === 45) {
      let t2 = ctx.s.slice(startPtr, ctx.p += 6);
      return readDate(ctx, t2, 1, unsafeSeparator, startPtr, !ctx.ld && "[" + ctx.s.slice(ctx.p - 6, ctx.p) + "]");
    }
  }
  let t = ctx.s.slice(startPtr, ctx.p);
  return readDate(ctx, t, 2, unsafeSeparator, startPtr);
}
function parseTime(ctx, c, endChr) {
  let start = ctx.p;
  if (!isDigit(c) || !isDigit(ctx.s.charCodeAt(++ctx.p))) {
    return parseNumber(ctx, --ctx.p, c, 0, endChr);
  }
  if (ctx.s.charCodeAt(ctx.p += 4) === 58)
    ctx.p += 3;
  if (ctx.s.charCodeAt(ctx.p) === 46)
    while (isDigit(ctx.s.charCodeAt(++ctx.p)))
      ;
  let t = ctx.s.slice(start, ctx.p);
  return readDate(ctx, t, 4, false, start);
}
function readDate(ctx, str, type, unsafeDelim, errPtr, temporalSuffix) {
  if (ctx.ld) {
    let date2 = new TomlDate(str, type, unsafeDelim);
    if (!date2.isValid())
      TomlError.x("invalid date", ctx, errPtr);
    return date2;
  }
  try {
    if (temporalSuffix)
      str += temporalSuffix;
    switch (type) {
      case 1:
        return Temporal.ZonedDateTime.from(str);
      case 2:
        return Temporal.PlainDateTime.from(str);
      case 3:
        return Temporal.PlainDate.from(str);
      case 4:
        return Temporal.PlainTime.from(str);
    }
  } catch (e) {
    TomlError.x(e instanceof Error ? e.message : "" + e, ctx, errPtr);
  }
}

// ../../../node_modules/smol-toml/dist/util.js
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      TomlError.x("control characters are not allowed in comments", ctx);
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (ctx.p < ctx.s.length) {
    while (ctx.p < ctx.s.length && ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}

// ../../../node_modules/smol-toml/dist/struct.js
function parseKey(ctx, end = 61) {
  let startPtr;
  let state = 0;
  let parsed = [];
  let sliceStart;
  let c = ctx.s.charCodeAt(startPtr = ctx.p);
  do {
    if (c === end) {
      if (!state)
        TomlError.x("unexpected end of key", ctx);
      if (state === 1)
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
      return ctx.p++, parsed;
    } else if (c === 46) {
      if (!state)
        TomlError.x("illegal empty bare key", ctx);
      if (state === 1)
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
      state = 0;
    } else if (!state && (c === 34 || c === 39)) {
      if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2))
        TomlError.x("illegal quoted key: multiline strings are not allowed", ctx);
      parsed.push(parseString(ctx));
      state = 2;
      ctx.p--;
    } else if (c === 32 || c === 9) {
      if (state === 1) {
        parsed.push(ctx.s.slice(sliceStart, ctx.p));
        state = 2;
      }
    } else if (state === 2 || c < 48 && c !== 45 || c > 57 && c < 65 || c > 90 && c < 97 && c !== 95 || c > 122) {
      TomlError.x("illegal character in key", ctx);
    } else if (!state) {
      state = 1;
      sliceStart = ctx.p;
    }
  } while (c = ctx.s.charCodeAt(++ctx.p));
  TomlError.x("incomplete key-value: cannot find end of key", ctx, startPtr);
}
function parseInlineTable(ctx) {
  let startPtr = ctx.p++;
  let res = /* @__PURE__ */ Object.create(null);
  let seen2 = /* @__PURE__ */ new Set();
  let c;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let errPtr = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen2.has(t[k]))) {
        TomlError.x("trying to redefine an already defined value", ctx, errPtr);
      }
      let unsafe = k === "__proto__";
      if (ctx.uk && (unsafe || k === "constructor")) {
        t = ctx.uk !== 1 && TomlError.x("document contains an unsafe property", ctx, errPtr);
        break;
      }
      if (!hasOwn && unsafe) {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      TomlError.x("trying to redefine an already defined value", ctx, errPtr);
    }
    skipVoid(ctx, true, true);
    let value = extractValue(
      ctx,
      125
      /* } */
    );
    if (t && typeof (t[k] = value) === "object")
      seen2.add(value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44)
      TomlError.x("expected comma or end of structure", ctx, ctx.p - 1);
  }
  TomlError.x("unfinished table", ctx, startPtr);
}
function parseArray(ctx) {
  let startPtr = ctx.p++;
  let res = [];
  let c;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(
      ctx,
      93
      /* ] */
    ));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44)
      TomlError.x("expected comma or end of structure", ctx, ctx.p - 1);
  }
  TomlError.x("unfinished array", ctx, startPtr);
}

// ../../../node_modules/smol-toml/dist/parse.js
function peekTable(ctx, key, table, meta2, type) {
  let t = table;
  let m = meta2;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
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
      let unsafe = k === "__proto__";
      if (ctx.uk && (unsafe || k === "constructor"))
        return false;
      if (unsafe) {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: /* @__PURE__ */ Object.create(null)
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
    t[k].push(t = /* @__PURE__ */ Object.create(null));
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: /* @__PURE__ */ Object.create(null) };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = /* @__PURE__ */ Object.create(null);
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function validateTablePeek(ctx, peek, ptr) {
  if (peek === null || ctx.uk === 2)
    TomlError.x(peek === null ? "trying to redefine an already defined table or value" : "document contains an unsafe property", ctx, ptr);
}
function parse(toml, options = {}) {
  let ctx = {
    s: toml,
    p: 0,
    d: options.maxDepth ?? 1e3,
    bi: options.integersAsBigInt ?? false,
    ld: options.useLegacyDate ?? true,
    uk: options.unsafeKeyBehaviour === "throw" ? 2 : options.unsafeKeyBehaviour === "drop" ? 1 : 0
  };
  let res = /* @__PURE__ */ Object.create(null);
  let meta2 = /* @__PURE__ */ Object.create(null);
  let tmp;
  let skipping = false;
  let tbl = res;
  let m = meta2;
  if (toml.charCodeAt(0) === 65279)
    ctx.p++;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      skipping = false;
      let k = parseKey(
        ctx,
        93
        /* ] */
      );
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p) !== 93) {
          TomlError.x("expected end of table array declaration", ctx);
        }
        ctx.p++;
      }
      let p = peekTable(
        ctx,
        k,
        res,
        meta2,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        validateTablePeek(ctx, p, tmp);
        skipping = true;
      } else {
        m = p[2];
        tbl = p[1];
      }
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        ctx,
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p && !skipping)
        validateTablePeek(ctx, p, tmp);
      skipVoid(ctx, true, true);
      let v = extractValue(ctx, void 0);
      if (p && !skipping)
        p[1][p[0]] = v;
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && (tmp !== 13 || toml.charCodeAt(ctx.p + 1) !== 10)) {
      TomlError.x("each key-value declaration must be followed by an end-of-line", ctx);
    }
    skipVoid(ctx);
  }
  return res;
}

// ../../../node_modules/smol-toml/dist/stringify.js
var HAS_WELLFORMED = !!"".isWellFormed;

// ../viewer/themes/onedark.toml
var onedark_default = '# Author : Gokul Soumya <gokulps15@gmail.com>\n\n"tag" = { fg = "red" }\n"attribute" = { fg = "yellow" }\n"comment" = { fg = "comment-gray", modifiers = ["italic"] }\n"constant" = { fg = "cyan" }\n"constant.numeric" = { fg = "gold" }\n"constant.builtin" = { fg = "gold" }\n"constant.character.escape" = { fg = "gold" }\n"constructor" = { fg = "blue" }\n"function" = { fg = "blue" }\n"function.builtin" = { fg = "blue" }\n"function.macro" = { fg = "purple" }\n"keyword" = { fg = "red" }\n"keyword.control" = { fg = "purple" }\n"keyword.control.import" = { fg = "red" }\n"keyword.directive" = { fg = "purple" }\n"keyword.storage" = { fg = "purple" }\n"label" = { fg = "purple" }\n"namespace" = { fg = "blue" }\n"operator" = { fg = "purple" }\n"keyword.operator" = { fg = "purple" }\n"special" = { fg = "blue" }\n"string" = { fg = "green" }\n"type" = { fg = "yellow" }\n"variable" = { fg = "white" }\n"variable.builtin" = { fg = "blue" }\n"variable.parameter" = { fg = "red" }\n"variable.other.member" = { fg = "red" }\n"punctuation" = { fg = "white" }\n"punctuation.special" = { fg = "purple" }\n\n"markup.heading" = { fg = "red" }\n"markup.raw.inline" = { fg = "green" }\n"markup.bold" = { fg = "gold", modifiers = ["bold"] }\n"markup.italic" = { fg = "purple", modifiers = ["italic"] }\n"markup.strikethrough" = { modifiers = ["crossed_out"] }\n"markup.list" = { fg = "red" }\n"markup.quote" = { fg = "yellow" }\n"markup.link.url" = { fg = "cyan", modifiers = ["underlined"]}\n"markup.link.text" = { fg = "purple" }\n\n"diff.plus" = "green"\n"diff.delta" = "gold"\n"diff.minus" = "red"\n\n"diagnostic.info".underline = { color = "blue", style = "curl" } \n"diagnostic.hint".underline = { color = "green", style = "curl" } \n"diagnostic.warning".underline = { color = "yellow", style = "curl" } \n"diagnostic.error".underline = { color = "red", style = "curl" } \n"diagnostic.unnecessary" = { modifiers = ["dim"] }\n"diagnostic.deprecated" = { modifiers = ["crossed_out"] }\n"info" = { fg = "blue", modifiers = ["bold"] }\n"hint" = { fg = "green", modifiers = ["bold"] }\n"warning" = { fg = "yellow", modifiers = ["bold"] }\n"error" = { fg = "red", modifiers = ["bold"] }\n\n"ui.background" = { bg = "black" }\n"ui.virtual" = { fg = "faint-gray" }\n"ui.virtual.indent-guide" = { fg = "faint-gray" }\n"ui.virtual.whitespace" = { fg = "light-gray" }\n"ui.virtual.ruler" = { bg = "gray" }\n"ui.virtual.inlay-hint" = { fg = "light-gray" }\n"ui.virtual.jump-label" = { fg = "light-gray", modifiers = ["bold"] }\n\n"ui.cursor" = { fg = "white", modifiers = ["reversed"] }\n"ui.cursor.primary" = { fg = "white", modifiers = ["reversed"] }\n"ui.cursor.match" = { fg = "blue", modifiers = ["underlined"]}\n\n"ui.selection" = { bg = "faint-gray" }\n"ui.selection.primary" = { bg = "light-gray" }\n"ui.cursorline.primary" = { bg = "light-black" }\n\n"ui.highlight" = { bg = "gray" }\n"ui.highlight.frameline" = { bg = "#97202a" }\n\n"ui.linenr" = { fg = "linenr" }\n"ui.linenr.selected" = { fg = "white" }\n\n"ui.statusline" = { fg = "white", bg = "light-black" }\n"ui.statusline.inactive" = { fg = "light-gray", bg = "light-black" }\n"ui.statusline.normal" = { fg = "light-black", bg = "blue", modifiers = ["bold"] }\n"ui.statusline.insert" = { fg = "light-black", bg = "green", modifiers = ["bold"] }\n"ui.statusline.select" = { fg = "light-black", bg = "purple", modifiers = ["bold"] }\n\n"ui.bufferline" = { fg = "light-gray", bg = "light-black" }\n"ui.bufferline.active" = { fg = "light-black", bg = "blue", underline = { color = "light-black", style = "line" } }\n"ui.bufferline.background" = { bg = "light-black" }\n\n"ui.text" = { fg = "white" }\n"ui.text.directory" = { fg = "blue" }\n"ui.text.focus" = { fg = "white", bg = "light-black", modifiers = ["bold"] }\n\n"ui.help" = { fg = "white", bg = "gray" }\n"ui.popup" = { bg = "gray" }\n"ui.window" = { fg = "gray" }\n"ui.menu" = { fg = "white", bg = "gray" }\n"ui.menu.selected" = { fg = "black", bg = "blue" }\n"ui.menu.scroll" = { fg = "white", bg = "light-gray" }\n\n"ui.debug" = { fg = "red" }\n\n[palette]\n\nyellow = "#E5C07B"\nblue = "#61AFEF"\nred = "#E06C75"\npurple = "#C678DD"\ngreen = "#98C379"\ngold = "#D19A66"\ncyan = "#56B6C2"\nwhite = "#ABB2BF"\nblack = "#282C34"\nlight-black = "#2C323C"\ngray = "#3E4452"\nfaint-gray = "#3B4048"\nlight-gray = "#5C6370"\ncomment-gray = "#C8CED8"\nlinenr = "#687184"\n';

// ../viewer/themes/onelight.toml
var onelight_default = '# Author : erasin<erasinoo@gmail.com>\n\n"attribute" = { fg = "yellow" }\n"label" = { fg = "cyan" }\n"operator" = { fg = "red" }\n"tag" = { fg = "cyan" }\n"special" = { fg = "deep-purple" }\n"property" = { fg = "purple" }\n"constructor" = { fg = "blue" }\n"namespace" = { fg = "blue" }\n"module" = { fg = "blue" }\n\n"type" = { fg = "gold" }\n"type.builtin" = { fg = "yellow" }\n"type.enum" = { fg = "cyan" }\n"type.enum.variant" = { fg = "cyan" }\n\n"constant" = { fg = "cyan", modifiers = ["bold"] }\n"constant.builtin" = { fg = "deep-purple" }\n"constant.builtin.boolean" = { fg = "purple" , modifiers = ["bold"]}\n"constant.character" = { fg = "green" }\n"constant.character.escape" = { fg = "brown" , modifiers = ["bold"]}\n"constant.numeric" = { fg = "brown" , modifiers = ["bold"]}\n"constant.numeric.integer" = { fg = "brown" , modifiers = ["bold"]}\n"constant.numeric.float" = { fg = "brown" , modifiers = ["bold"]}\n\n"string" = { fg = "green" }\n"string.regexp" = { fg = "purple" }\n"string.special" = { fg = "green" }\n"string.special.path" = { fg = "blue" }\n"string.special.url" = { fg = "light-blue" }\n"string.special.symbol" = { fg = "pink" }\n\n"comment" = { fg = "grey", modifiers = ["italic"] }\n"comment.line" = { fg = "grey", modifiers = ["italic"] }\n"comment.line.documentation" = { fg = "grey", modifiers = ["italic"] }\n"comment.block" = { fg = "grey", modifiers = ["italic"] }\n"comment.block.documentation" = { fg = "grey", modifiers = ["italic"] }\n\n# "variable" = { fg = "black" }\n"variable.builtin" = { fg = "light-blue" }\n"variable.parameter" = { fg = "red" }\n"variable.other" = { fg = "pink" }\n"variable.other.member" = { fg = "pink" }\n\n"punctuation" = { fg = "black" }\n"punctuation.delimiter" = { fg = "purple" }\n"punctuation.bracket" = { fg = "brown" }\n"punctuation.special" = { fg = "brown" }\n\n"keyword" = { fg = "purple" }\n"keyword.control" = { fg = "purple" }\n"keyword.control.conditional" = { fg = "red", modifiers = ["bold"] }\n"keyword.control.repeat" = { fg = "pink", modifiers = ["bold"] }\n"keyword.control.import" = { fg = "red" }\n"keyword.control.return" = { fg = "deep-purple", modifiers = ["bold"] }\n"keyword.control.exception" = { fg = "purple" }\n"keyword.operator" = { fg = "red" }\n"keyword.directive" = { fg = "deep-purple" }\n"keyword.function" = { fg = "purple" }\n"keyword.storage" = { fg = "purple" }\n"keyword.storage.type" = { fg = "purple" }\n"keyword.storage.modifier" = { fg = "purple", modifiers = ["bold"] }\n\n"function" = { fg = "blue" }\n"function.builtin" = { fg = "cyan" }\n"function.method" = { fg = "light-blue" }\n"function.macro" = { fg = "pink", modifiers = ["bold"] }\n"function.special" = { fg = "cyan" }\n\n"markup.heading" = { fg = "red" }\n"markup.heading.marker" = { fg = "red" }\n"markup.heading.1" = { fg = "red", modifiers = ["bold"] }\n"markup.heading.2" = { fg = "gold", modifiers = [\n  "bold",\n], underline = { style = "line" } }\n"markup.heading.3" = { fg = "yellow", modifiers = ["bold"] }\n"markup.heading.4" = { fg = "green", modifiers = ["bold"] }\n"markup.heading.5" = { fg = "blue", modifiers = ["bold"] }\n"markup.heading.6" = { fg = "purple", modifiers = ["bold"] }\n"markup.list" = { fg = "light-blue" }\n"markup.list.unnumbered" = { fg = "light-blue" }\n"markup.list.numbered" = { fg = "light-blue" }\n"markup.list.checked" = { fg = "green" }\n"markup.list.unchecked" = { fg = "blue" }\n"markup.bold" = { fg = "yellow", modifiers = ["bold"] }\n"markup.italic" = { fg = "purple", modifiers = ["italic"] }\n"markup.strikethrough" = { fg = "red", modifiers = ["crossed_out"] }\n"markup.link" = { fg = "light-blue" }\n"markup.link.url" = { fg = "cyan", modifiers = ["underlined"] }\n"markup.link.text" = { fg = "light-blue" }\n"markup.quote" = { fg = "grey" }\n"markup.raw" = { fg = "brown" }\n"markup.raw.inline" = { fg = "green" }\n"markup.raw.block" = { fg = "brown" }\n\n"diff" = { fg = "red" }\n"diff.plus" = { fg = "green" }\n"diff.minus" = { fg = "red" }\n"diff.delta" = { fg = "cyan" }\n"diff.delta.moved" = { fg = "cyan" }\n"diff.delta.conflict" = {fg = "blue"}\n\n"ui.background" = { bg = "white" }\n"ui.background.separator" = { bg = "white" }\n\n"ui.cursor" = { fg = "white", bg = "grey" }\n"ui.cursor.normal" = { fg = "white", bg = "grey" }\n"ui.cursor.insert" = { fg = "white", bg = "grey" }\n"ui.cursor.select" = { fg = "white", bg = "grey" }\n"ui.cursor.match" = { bg = "grey-300", modifiers = ["bold"] }\n"ui.cursor.primary" = { fg = "white", bg = "black" }\n"ui.cursor.primary.normal" = { fg = "white", bg = "black" }\n"ui.cursor.primary.insert" = { fg = "red", bg = "black" }\n"ui.cursor.primary.select" = { fg = "white", bg = "black" }\n\n"ui.gutter" = { fg = "grey-500" }\n"ui.gutter.selected" = { fg = "black" }\n\n"ui.linenr" = { fg = "grey-500" }\n"ui.linenr.selected" = { fg = "black", modifiers = ["bold"] }\n\n"ui.statusline" = { fg = "black", bg = "grey-300" }\n"ui.statusline.inactive" = { fg = "grey", bg = "grey-200" }\n"ui.statusline.normal" = { fg = "grey-300", bg = "light-blue" }\n"ui.statusline.insert" = { fg = "grey-300", bg = "green" }\n"ui.statusline.select" = { fg = "grey-300", bg = "purple" }\n\n"ui.popup" = { fg = "black", bg = "grey-200" }\n"ui.popup.info" = { fg = "black", bg = "grey-200" }\n"ui.window" = { fg = "grey-500", bg = "grey-100" }\n"ui.help" = { fg = "black", bg = "grey-200" }\n\n"ui.text" = { fg = "black" }\n"ui.text.focus" = { fg = "red", bg = "grey-300", modifiers = ["bold"] }\n"ui.text.inactive" = { fg = "grey" }\n"ui.text.info" = { fg = "black" }\n"ui.text.directory" = { fg = "blue", underline = { style = "line" } }\n\n"ui.virtual" = { fg = "grey-500" }\n"ui.virtual.ruler" = { bg = "grey-200" }\n"ui.virtual.wrap" = { fg = "grey-500" }\n"ui.virtual.whitespace" = { fg = "grey-400" }\n"ui.virtual.indent-guide" = { fg = "grey-500" }\n"ui.virtual.inlay-hint" = { fg = "grey-500" }\n"ui.virtual.inlay-hint.parameter" = { fg = "grey-500", modifiers = ["italic"] }\n"ui.virtual.inlay-hint.type" = { fg = "grey-500" }\n"ui.virtual.jump-label" = { fg = "black", bg = "grey-200", modifiers = ["bold" ] }\n\n"ui.menu" = { fg = "black", bg = "grey-300" }\n"ui.menu.selected" = { fg = "white", bg = "light-blue" }\n"ui.menu.scroll" = { fg = "light-blue", bg = "white" }\n\n"ui.selection" = { bg = "grey-300", modifiers = ["dim"] }\n"ui.selection.primary" = { bg = "grey-300" }\n\n"ui.cursorline.primary" = { fg = "white", bg = "grey-100" }\n"ui.cursorline.secondary" = { fg = "white", bg = "grey-200" }\n\n"ui.cursorcolumn.primary" = { fg = "white", bg = "grey-100" }\n"ui.cursorcolumn.secondary" = { fg = "white", bg = "grey-200" }\n\n"ui.highlight" = { bg = "grey-300" }\n\n"ui.picker.header" = { fg = "purple"}\n"ui.picker.header.column.active" = { fg = "blue"}\n\n"diagnostic.info" = { underline = { color = "blue", style = "dotted" } }\n"diagnostic.hint" = { underline = { color = "green", style = "dashed" } }\n"diagnostic.warning" = { underline = { color = "yellow", style = "curl" } }\n"diagnostic.error" = { underline = { color = "red", style = "curl" } }\n"diagnostic.unnecessary" = { modifiers = ["dim"] }\n"diagnostic.deprecated" = { modifiers = ["crossed_out"] }\n\n"info" = { fg = "blue", modifiers = ["bold"] }\n"hint" = { fg = "green", modifiers = ["bold"] }\n"warning" = { fg = "yellow", modifiers = ["bold"] }\n"error" = { fg = "red", modifiers = ["bold"] }\n\n"tabstop" = { modifiers = ["italic"], bg = "grey-300" }\n\n[palette]\nwhite = "#FAFAFA"\nyellow = "#FF6F00"\ngold = "#D35400"\nbrown = "#795548"\nblue = "#0061FF"\nlight-blue = "#0091EA"\nred = "#D50000"\npink = "#C2185B"\npurple = "#B500A9"\ndeep-purple = "#651FFF"\ngreen = "#24A443"\ncyan = "#0086C1"\nblack = "#282C34"\ngrey = "#5C6370"\ngrey-500 = "#9E9E9E"\ngrey-400 = "#BDBDBD"\ngrey-300 = "#E0E0E0"\ngrey-200 = "#EEEEEE"\ngrey-100 = "#F2F2F2"\n';

// ../viewer/themes/gruvbox.toml
var gruvbox_default = '# Author : Jakub Bartodziej <kubabartodziej@gmail.com>\n# The theme uses the gruvbox dark palette with standard contrast: github.com/morhetz/gruvbox\n\n"annotation" = { fg = "fg1" }\n\n"attribute" = { fg = "aqua1", modifiers = ["italic"] }\n\n"comment" = { fg = "gray", modifiers = ["italic"] }\n\n"constant" = { fg = "purple1" }\n"constant.character" = { fg = "aqua1" }\n"constant.character.escape" = { fg = "orange1" }\n"constant.macro" = { fg = "aqua1" }\n"constructor" = { fg = "purple1" }\n\n"definition" = { underline = { color = "aqua1" } }\n\n"diagnostic" = { underline = { color = "orange1", style = "curl" } }\n"diagnostic.deprecated" = { modifiers = ["crossed_out"] }\n"diagnostic.error" = { underline = { color = "red1", style = "curl" } }\n"diagnostic.hint" = { underline = { color = "blue1", style = "curl" } }\n"diagnostic.info" = { underline = { color = "aqua1", style = "curl" } }\n"diagnostic.warning" = { underline = { color = "yellow1", style = "curl" } }\n# "diagnostic.unnecessary" = { modifiers = ["dim"] }  # do not remove this for future resolving\n\n"error" = { fg = "red1" }\n"hint" = { fg = "blue1" }\n"info" = { fg = "aqua1" }\n"warning" = { fg = "yellow1" }\n\n"diff.delta" = { fg = "yellow1" }\n"diff.minus" = { fg = "red1" }\n"diff.plus" = { fg = "green1" }\n\n"function" = { fg = "green1" }\n"function.builtin" = { fg = "yellow1" }\n"function.macro" = { fg = "blue1" }\n\n"keyword" = { fg = "red1" }\n"keyword.control.import" = { fg = "aqua1" }\n\n"label" = { fg = "red1" }\n\n"markup.bold" = { modifiers = ["bold"] }\n"markup.heading" = "aqua1"\n"markup.italic" = { modifiers = ["italic"] }\n"markup.link.text" = "red1"\n"markup.link.url" = { fg = "green1", modifiers = ["underlined"] }\n"markup.raw" = "red1"\n"markup.strikethrough" = { modifiers = ["crossed_out"] }\n\n"module" = { fg = "aqua1" }\n\n"namespace" = { fg = "fg1" }\n\n"operator" = { fg = "purple1" }\n\n"punctuation" = { fg = "orange1" }\n\n"special" = { fg = "purple0" }\n\n"string" = { fg = "green1" }\n"string.regexp" = { fg = "orange1" }\n"string.special" = { fg = "orange1" }\n"string.symbol" = { fg = "yellow1" }\n\n"tag" = { fg = "aqua1" }\n\n"type" = { fg = "yellow1" }\n"type.enum.variant" = { modifiers = ["italic"] }\n\n"ui.background" = { bg = "bg0" }\n"ui.bufferline" = { fg = "fg1", bg = "bg1" }\n"ui.bufferline.active" = { fg = "bg0", bg = "yellow0" }\n"ui.bufferline.background" = { bg = "bg2" }\n\n"ui.cursor" = { fg = "bg1", bg = "bg2" }\n"ui.cursor.insert" = { fg = "bg1", bg = "blue0" }\n"ui.cursor.normal" = { fg = "bg1", bg = "gray" }\n"ui.cursor.select" = { fg = "bg1", bg = "orange0" }\n"ui.cursor.match" = { fg = "fg3", bg = "bg3" }\n\n"ui.cursor.primary" = { bg = "fg3", fg = "bg1" }\n"ui.cursor.primary.insert" = { fg = "bg1", bg = "blue1" }\n"ui.cursor.primary.normal" = { fg = "bg1", bg = "fg3" }\n"ui.cursor.primary.select" = { fg = "bg1", bg = "orange1" }\n\n"ui.cursorline" = { bg = "bg0_s" }\n"ui.cursorline.primary" = { bg = "bg1" }\n\n"ui.help" = { bg = "bg1", fg = "fg1" }\n"ui.linenr" = { fg = "bg3" }\n"ui.linenr.selected" = { fg = "yellow1" }\n"ui.menu" = { fg = "fg1", bg = "bg2" }\n"ui.menu.selected" = { fg = "green1", bg = "bg1", modifiers = ["bold"] }\n"ui.popup" = { bg = "bg1" }\n"ui.picker.header.column" = { underline.style = "line" }\n"ui.picker.header.column.active" = { modifiers = ["bold"], underline.style = "line" }\n"ui.selection" = { bg = "bg2" }\n"ui.selection.primary" = { bg = "bg3" }\n\n"ui.statusline" = { fg = "fg1", bg = "bg2" }\n"ui.statusline.inactive" = { fg = "fg4", bg = "bg2" }\n"ui.statusline.insert" = { fg = "bg1", bg = "blue1", modifiers = ["bold"] }\n"ui.statusline.normal" = { fg = "bg1", bg = "fg3", modifiers = ["bold"] }\n"ui.statusline.select" = { fg = "bg1", bg = "orange1", modifiers = ["bold"] }\n\n"ui.text" = { fg = "fg1" }\n"ui.text.focus" = { fg = "green1", bg="bg1" }\n"ui.text.directory" = { fg = "blue1" }\n"ui.virtual.inlay-hint" = { fg = "gray" }\n"ui.virtual.jump-label" = { fg = "purple0", modifiers = ["bold"] }\n"ui.virtual.ruler" = { bg = "bg1" }\n"ui.virtual.whitespace" = "bg2"\n"ui.virtual.wrap" = { fg = "bg2" }\n"ui.window" = { bg = "bg1" }\n\n"variable" = { fg = "fg1" }\n"variable.builtin" = { fg = "orange1", modifiers = ["italic"] }\n"variable.other.member" = { fg = "blue1" }\n"variable.parameter" = { fg = "blue1", modifiers = ["italic"] }\n\n\n[palette]\nbg0 = "#282828"   # main background\nbg0_s = "#32302f"\nbg1 = "#3c3836"\nbg2 = "#504945"\nbg3 = "#665c54"\nbg4 = "#7c6f64"\n\nfg0 = "#fbf1c7"\nfg1 = "#ebdbb2" # main foreground\nfg2 = "#d5c4a1"\nfg3 = "#bdae93"\nfg4 = "#a89984"\n\ngray = "#928374"\n\nred0 = "#cc241d"    # neutral\nred1 = "#fb4934"    # bright\ngreen0 = "#98971a"\ngreen1 = "#b8bb26"\nyellow0 = "#d79921"\nyellow1 = "#fabd2f"\nblue0 = "#458588"\nblue1 = "#83a598"\npurple0 = "#b16286"\npurple1 = "#d3869b"\naqua0 = "#689d6a"\naqua1 = "#8ec07c"\norange0 = "#d65d0e"\norange1 = "#fe8019"\n';

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

# \u80CC\u666F
# background
"ui.background" = { bg = "base03" }

"ui.virtual.whitespace" = { fg = "base01" }
"ui.virtual.inlay-hint" = { fg = "base01", modifiers = ["italic"] }
"ui.virtual.jump-label" = { fg = "red", modifiers = ["bold"] }

# \u884C\u53F7\u680F
# line number column
"ui.linenr" = { fg = "base0", bg = "base02" }
# \u5F53\u524D\u884C\u53F7\u680F
# current line number column
"ui.linenr.selected" = { fg = "blue", modifiers = ["bold"] }
# cursorline
"ui.cursorline" = { bg = "base0" }

# \u72B6\u6001\u680F
# status bar
"ui.statusline" = { fg = "base03", bg = "base0" }
"ui.statusline.normal" = { bg = "blue" }
"ui.statusline.insert" = { bg = "green" }
"ui.statusline.select" = { bg = "yellow" }

# \u975E\u6D3B\u52A8\u72B6\u6001\u680F
# inactive status bar
"ui.statusline.inactive" = { fg = "base1", bg = "base01" }

# \u8865\u5168\u7A97\u53E3, preview\u7A97\u53E3
# Completion window, preview window
"ui.popup" = { bg = "base02" }
# \u5F71\u54CD \u8865\u5168\u9009\u4E2D cmd\u5F39\u51FA\u4FE1\u606F\u9009\u4E2D
# Affect completion selection, cmd pop-up information selection
"ui.menu.selected" = { fg = "base02", bg = "base2"}
"ui.menu" = { fg = "base0", bg = "base02" }
# ??
"ui.window" = { fg = "base3" }
# \u547D\u4EE4\u884C \u8865\u5168\u7684\u5E2E\u52A9\u4FE1\u606F
# Command line completion help information
"ui.help" = { modifiers = ["reversed"] }

# \u5FEB\u6377\u952E\u7A97\u53E3 
# Shortcut window
"ui.popup.info" = { bg = "base1" }
# \u5FEB\u6377\u952E\u5B57\u4F53
# Shortcut font
"ui.text.info" = {fg = "base02", modifiers = ["bold"]}

# \u666E\u901Aui\u7684\u5B57\u4F53\u6837\u5F0F
# Normal ui font style
"ui.text" = { fg = "base1" }
# \u5F71\u54CD picker\u5217\u8868\u9009\u4E2D, \u5FEB\u6377\u952E\u5E2E\u52A9\u7A97\u53E3\u6587\u672C
# Affects picker list selection, shortcut key help window text
"ui.text.focus" = { fg = "blue", modifiers = ["bold"]}

# \u4E3B\u5149\u6807/selection
# main cursor/selection
"ui.cursor.primary" = { fg = "base03", bg = "base1" }
"ui.cursor.select" = { fg = "base02", bg = "cyan" }

"ui.cursorline.primary" = { bg = "base02" }
"ui.cursorline.secondary" = { bg = "base025" }

"ui.selection" = { bg = "base0175" }
"ui.selection.primary" = { bg = "base015" }

"ui.virtual.indent-guide" = { fg = "base02" }
"ui.virtual.ruler" = { bg = "base02" }

# normal\u6A21\u5F0F\u7684\u5149\u6807
# normal mode cursor
"ui.cursor" = {fg = "base02", bg = "cyan"}
"ui.cursor.insert" = {fg = "base03", bg = "base3"}
# \u5F53\u524D\u5149\u6807\u5339\u914D\u7684\u6807\u70B9\u7B26\u53F7
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

# \u6DF1\u8272 \u8D8A\u6765\u8D8A\u6DF1
# dark getting darker
base0    = '#657b83'
base1    = '#586e75'
base2    = '#073642'
base3    = '#002b36'

# \u6D45\u8272 \u8D8A\u4F86\u8D8A\u6D45
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
  if (!file) throw new Error(`Unknown theme ${name}; bundled themes: ${Object.keys(bundledThemes).join(", ")}`);
  return paletteFromHelix(parseHelixTheme(themeSources[file], name));
}
var dark = loadBundledTheme("default-dark");
var light = loadBundledTheme("default-light");

// ../../../node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  CONSTANT_CATCH: () => CONSTANT_CATCH,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  attachSchema: () => attachSchema,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  codePointLength: () => codePointLength,
  constantCatch: () => constantCatch,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  defineLazyInternal: () => defineLazyInternal,
  derived: () => derived,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  hide: () => hide,
  installLazyProp: () => installLazyProp,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  members: () => members,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  own: () => own,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  rawShape: () => rawShape,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  sizeCaps: () => sizeCaps,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  toZod: () => toZod,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function toZod() {
  return (schema) => schema;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
var Cached = class {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
};
function cached(getter) {
  return new Cached(getter);
}
function nullish(input2) {
  return input2 === null || input2 === void 0;
}
function cleanRegex(source2) {
  const start = source2.startsWith("^") ? 1 : 0;
  const end = source2.endsWith("$") ? source2.length - 1 : source2.length;
  return source2.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
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
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source2, keys, wrap) {
  const raw = sourceShape(source2);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source2._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source2) {
  for (const key of Reflect.ownKeys(source2)) {
    const desc = Object.getOwnPropertyDescriptor(source2, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source2[key]);
    else
      putProp(target, key, desc.value);
  }
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
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input2) {
  return input2.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
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
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
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
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
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
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
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
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
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
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class2, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class2 && ((value, key) => selected && !selected.has(key) ? value : new Class2({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class2, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => (
    // overwrite with non-optional
    selected && !selected.has(key) ? value : new Class2({ type: "nonoptional", innerType: value })
  ));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a3;
  for (let i = start; i < issues.length; i++) {
    (_a3 = issues[i]).schema ?? (_a3.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a3;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a3 = iss).schema ?? (_a3.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
function getSizableOrigin(input2) {
  if (input2 instanceof Set)
    return "set";
  if (input2 instanceof Map)
    return "map";
  if (input2 instanceof File)
    return "file";
  return "unknown";
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input2) {
  if (Array.isArray(input2))
    return "array";
  if (typeof input2 === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input2, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input: input2,
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
function base64ToUint8Array(base642) {
  const binaryString = atob(base642);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url2) {
  const base642 = base64url2.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base642.length % 4) % 4);
  return base64ToUint8Array(base642 + padding);
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
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Class = class {
  constructor(..._args) {
  }
};
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
// @__NO_SIDE_EFFECTS__
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}

// ../../../node_modules/zod/v4/core/core.js
var _a;
var _zodDesc = { value: void 0, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
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
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// ../../../node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: void 0, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error2.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error3, path = []) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue2));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node2 = curr[el];
            if (terminal) {
              node2._errors.push(mapper(issue2));
            }
            curr = node2;
            i++;
          }
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}

// ../../../node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error2;
  return {
    success: false,
    get error() {
      if (!error2) {
        error2 = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error2;
    },
    set error(e) {
      error2 = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = ((schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== void 0) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === void 0)
      return false;
  }
  return validateFallback(schema, value, _ctx);
});
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
var _encode = (_Err) => {
  const parse3 = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse3(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decode = (_Err) => {
  const parse3 = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse3(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _encodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync2(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync2(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};

// ../../../node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source2) {
  return new RegExp(`^${source2}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex2 = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex2;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts = ["Z"];
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../../../node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== void 0;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
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
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? (
      // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
      def.value !== BigInt(0) && payload.value % def.value === BigInt(0)
    ) : floatSafeRemainder(payload.value, def.value) === 0;
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
  inst._zod.check = (payload) => {
    const input2 = payload.value;
    if (isInt) {
      if (!Number.isInteger(input2)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input: input2,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input2)) {
        if (input2 > 0) {
          payload.issues.push({
            input: input2,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input: input2,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input2 < minimum) {
      payload.issues.push({
        origin: "number",
        input: input2,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input2 > maximum) {
      payload.issues.push({
        origin: "number",
        input: input2,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input2 = payload.value;
    const units = input2.length;
    const length = typeof input2 === "string" && units > def.maximum ? codePointLength(input2) : units;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input2);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input: input2,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input2 = payload.value;
    const units = input2.length;
    const length = typeof input2 === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input2) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input2);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input: input2,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input2 = payload.value;
    const units = input2.length;
    const length = typeof input2 === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input2) : units;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input2);
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
  var _a3, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
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
    (_b = inst._zod).check ?? (_b.check = () => {
    });
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
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
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
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../../node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  // the compiler catches a child's throw and keeps writing into this doc, so the indent has to unwind with it
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join("\n")}
};`);
    return factory(...Object.values(this.closed));
  }
};

// ../../../node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 6
};

// ../../../node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
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
          throw new $ZodAsyncError();
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
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
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
    if (v === void 0)
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
var URL_BAD_FORMAT = 1;
var URL_UNPARSEABLE = 2;
function canParseURL(input2) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input2);
    new URL(input2);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url.hostname);
}
function urlProtocolOk(url, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url = validateURL(trimmed, def);
      if (url === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url, def.protocol)) {
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
      payload.value = def.normalize ? url.href : stripTabAndNewline(trimmed);
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
  if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
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
});
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
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
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
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
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
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
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
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
function isValidJWT(token, algorithm3 = null) {
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
    if (algorithm3 && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm3))
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
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input2 = payload.value;
    if (typeof input2 === "number" && !Number.isNaN(input2) && Number.isFinite(input2)) {
      return payload;
    }
    const received = typeof input2 === "number" ? Number.isNaN(input2) ? "NaN" : !Number.isFinite(input2) ? String(input2) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input: input2,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
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
      } catch (_) {
      }
    const input2 = payload.value;
    if (typeof input2 === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input: input2,
      inst
    });
    return payload;
  };
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
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse3 = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse3(payload, ctx);
  };
}
var arraySize = (input2) => Array.isArray(input2) ? input2.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input2 = payload.value;
    if (!Array.isArray(input2)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input: input2,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, Array(input2.length), ctx) : Array(input2.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0; i < input2.length; i++) {
      const item = input2[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input2, optin, optout) {
  const isPresent = key in input2;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input2, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen2 = 0;
  for (const key in input2) {
    if (abortEarly && payload.issues.length !== seen2) {
      if (aborted(payload, seen2))
        break;
      seen2 = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input2[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input2, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input2, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input: input2,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
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
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input2 = payload.value;
    if (!isObject2(input2)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input: input2,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen2 = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen2) {
        if (aborted(payload, seen2))
          break;
        seen2 = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input2[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input2, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input2, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input2, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo2 = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo: memo2, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo2 ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== void 0;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
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
    const input2 = payload.value;
    if (!isObject2(input2)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input: input2,
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
      return handleCatchall([], input2, payload, ctx, value, inst, ctx?.abortEarly === true);
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
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
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
function discriminatorMap(def) {
  const map = /* @__PURE__ */ new Map();
  for (const option of def.options) {
    const values = option._zod.propValues?.[def.discriminator];
    if (!values || values.size === 0)
      throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
    for (const value of values) {
      if (map.has(value)) {
        if (value !== void 0)
          throw new Error(`Duplicate discriminator value "${String(value)}"`);
        map.set(value, null);
      } else {
        map.set(value, option);
      }
    }
  }
  return map;
}
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazyInternal(inst, "propValues", (zod) => {
    const propValues = {};
    let undefinedCount = 0;
    for (const option of zod.def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${zod.def.options.indexOf(option)}"`);
      if (pv[zod.def.discriminator]?.has(void 0))
        undefinedCount++;
      for (const [k, v] of Object.entries(pv)) {
        if (!Object.prototype.hasOwnProperty.call(propValues, k)) {
          assignProp(propValues, k, /* @__PURE__ */ new Set());
        }
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    if (!zod.def.unionFallback && undefinedCount > 1)
      propValues[zod.def.discriminator]?.delete(void 0);
    return propValues;
  });
  def.options.forEach((option, i) => {
    const propShape = rawShape(option._zod.def);
    if (propShape && !Object.prototype.hasOwnProperty.call(propShape, def.discriminator)) {
      throw new Error(`Invalid discriminated union option at index "${i}"`);
    }
  });
  const disc = cached(() => discriminatorMap(def));
  inst._zod.parse = (payload, ctx) => {
    const input2 = payload.value;
    if (!isObject(input2)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input: input2,
        inst
      });
      return payload;
    }
    const value = input2?.[def.discriminator];
    const opt = disc.value.get(value);
    if (opt && (value !== void 0 || ctx.direction !== "backward")) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()).filter((value2) => disc.value.get(value2) !== null),
      input: input2,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input2 = payload.value;
    const left = def.left._zod.run({ value: input2, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input2, issues: [] }, ctx);
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
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
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
    for (let index = 0; index < a.length; index++) {
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
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  const keyIssues = /* @__PURE__ */ new Map();
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodTuple = /* @__PURE__ */ $constructor("$ZodTuple", (inst, def) => {
  $ZodType.init(inst, def);
  const items = def.items;
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input2 = payload.value;
    if (!Array.isArray(input2)) {
      payload.issues.push({
        input: input2,
        inst,
        expected: "tuple",
        code: "invalid_type"
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, [], ctx) : [];
    const proms = [];
    const optinStart = getTupleOptStart(items, "optin");
    const optoutStart = getTupleOptStart(items, "optout");
    if (!def.rest) {
      if (input2.length < optinStart) {
        payload.issues.push({
          code: "too_small",
          minimum: optinStart,
          inclusive: true,
          input: input2,
          inst,
          origin: "array"
        });
        return payload;
      }
      if (input2.length > items.length) {
        payload.issues.push({
          code: "too_big",
          maximum: items.length,
          inclusive: true,
          input: input2,
          inst,
          origin: "array"
        });
      }
    }
    const itemResults = new Array(items.length);
    const abortEarly = def.rest ? ctx?.abortEarly : void 0;
    let itemAborted = false;
    for (let i = 0; i < items.length; i++) {
      const r = items[i]._zod.run({ value: input2[i], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((rr) => {
          itemResults[i] = rr;
        }));
      } else {
        itemResults[i] = r;
        if (abortEarly && !itemAborted && r.issues.length)
          itemAborted = aborted(r);
      }
    }
    if (def.rest && !itemAborted) {
      let i = items.length - 1;
      const rest = input2.slice(items.length);
      let seen2 = payload.issues.length;
      for (const el of rest) {
        if (abortEarly && payload.issues.length !== seen2) {
          if (aborted(payload, seen2))
            break;
          seen2 = payload.issues.length;
        }
        i++;
        const result = def.rest._zod.run({ value: el, issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((r) => handleTupleResult(r, payload, i)));
        } else {
          handleTupleResult(result, payload, i);
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input2, optoutStart));
    }
    return handleTupleResults(itemResults, payload, items, input2, optoutStart);
  };
});
function getTupleOptStart(items, key) {
  for (let i = items.length - 1; i >= 0; i--) {
    const omittable = key === "optin" ? items[i]._zod.optin !== void 0 : items[i]._zod.optout === "optional";
    if (!omittable)
      return i + 1;
  }
  return 0;
}
function handleTupleResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
function handleTupleResults(itemResults, final, items, input2, optoutStart) {
  for (let i = 0; i < items.length; i++) {
    const r = itemResults[i];
    const isPresent = i < input2.length;
    if (!isPresent && i >= optoutStart && items[i]._zod.optin === "optional") {
      final.value.length = i;
      break;
    }
    if (r.issues.length) {
      if (!isPresent && i >= optoutStart) {
        final.value.length = i;
        break;
      }
      final.issues.push(...prefixIssues(i, r.issues));
    }
    final.value[i] = r.value;
  }
  for (let i = final.value.length - 1; i >= input2.length; i--) {
    if (items[i]._zod.optout === "optional" && final.value[i] === void 0) {
      final.value.length = i;
    } else {
      break;
    }
  }
  return final;
}
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input2 = payload.value;
    if (valuesSet.has(input2)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input: input2,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input2 = payload.value;
    if (values.has(input2)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input: input2,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
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
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
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
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
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
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleCatchResult(payload, result2, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
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
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
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
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodLazy = /* @__PURE__ */ $constructor("$ZodLazy", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "innerType", () => {
    const d = def;
    if (!d._cachedInner)
      d._cachedInner = def.getter();
    return d._cachedInner;
  });
  defineLazyInternal(inst, "pattern", (zod) => zod.innerType?._zod?.pattern);
  defineLazyInternal(inst, "propValues", (zod) => zod.innerType?._zod?.propValues);
  defineLazyInternal(inst, "optin", (zod) => zod.innerType?._zod?.optin ?? void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.innerType?._zod?.optout ?? void 0);
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
    const input2 = payload.value;
    const r = def.fn(input2);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input2, inst));
    }
    handleRefineResult(r, payload, input2, inst);
    return;
  };
});
function handleRefineResult(result, payload, input2, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input: input2,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// ../../../node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
};
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap();
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve) {
  const cached2 = recursive.get(inst);
  if (cached2 !== void 0)
    return cached2 ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check2 = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge2 = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge2(raw ? shape(raw, true) : ASSUMED);
      check2(def.catchall);
      break;
    }
    case "array":
      check2(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check2(el);
      check2(def.rest);
      break;
    case "record":
    case "map":
      check2(def.keyType);
      check2(def.valueType);
      break;
    case "set":
      check2(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check2(el);
      break;
    case "intersection":
      check2(def.left);
      check2(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check2(def.innerType);
      break;
    case "pipe":
      check2(def.in);
      check2(def.out);
      break;
    case "function":
      check2(def.input);
      check2(def.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const inner = def._cachedInner ?? (resolve ? inst._zod.innerType : void 0);
      merge2(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      kind;
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check2(value);
        else if (Array.isArray(value))
          for (const el of value)
            check2(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = /* @__PURE__ */ new WeakMap();
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty2) {
    const bucket = handoff;
    if (!bucket)
      return empty2;
    handoff = void 0;
    const entry = { value: empty2, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty2;
  },
  guard(inst) {
    var _a3;
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError();
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a3;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === void 0) {
          const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input2 = payload.value;
        if (!isRef(input2))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input2);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = void 0;
        const entry = open.length > depth ? open.pop() : void 0;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}

// ../../../node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
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
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  function getTypeName(type, input2) {
    if (type === "number" && typeof input2 === "number" && !Number.isFinite(input2)) {
      return String(input2);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = getTypeName(issue2.expected);
        const receivedType = parsedType(issue2.input);
        const received = getTypeName(receivedType, issue2.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? ">=" : ">";
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
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts}`;
        }
        if (issue2.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
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
    localeError: error()
  };
}

// ../../../node_modules/zod/v4/core/registries.js
var _a2;
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta2 = _meta[0];
    this._map.set(schema, meta2);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.set(meta2.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta2 = this._map.get(schema);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.delete(meta2.id);
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
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;

// ../../../node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class2, params) {
  return new Class2(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
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
// @__NO_SIDE_EFFECTS__
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
// @__NO_SIDE_EFFECTS__
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
// @__NO_SIDE_EFFECTS__
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
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
// @__NO_SIDE_EFFECTS__
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class2, params) {
  return new Class2(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input2) => input2.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input2) => input2.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input2) => input2.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input2) => input2.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input2) => slugify(input2));
}
// @__NO_SIDE_EFFECTS__
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}

// ../../../node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source2 of sources) {
    for (const key of Reflect.ownKeys(source2)) {
      if (Object.prototype.propertyIsEnumerable.call(source2, key)) {
        assignProp(target, key, source2[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === void 0 || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen2 = ctx.seen.get(schema);
  if (seen2) {
    seen2.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen2.cycle = _params.path;
    }
    return seen2.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = void 0;
  ctx.sharedEmitDoneFor = void 0;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta2 = ctx.metadataRegistry.get(schema);
  if (meta2)
    assignProps(result.schema, meta2);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen2 = entry[1];
    const { ref, defId } = makeURI(entry);
    seen2.def = { ...seen2.schema };
    if (defId)
      seen2.defId = defId;
    const schema2 = seen2.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen2 = entry[1];
      if (seen2.cycle) {
        throw new Error(`Cycle detected: #/${seen2.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen2 = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen2.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen2.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members2) {
  const objects = [];
  for (const member of members2) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required2 = /* @__PURE__ */ new Set();
  for (const object2 of objects) {
    for (const key in object2.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen2) => JSON.stringify(seen2) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object2.required ?? [])
      required2.add(key);
  }
  const folded = { type: "object", properties };
  if (required2.size)
    folded.required = [...required2];
  if (objects.every((object2) => object2.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object2 of objects) {
      const constraint = undeclaredConstraint(object2);
      if (constraint && !constraints.some((seen2) => JSON.stringify(seen2) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union2 = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union2[k]));
    if (Object.keys(union2).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union2);
    const branches = union2[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen2 = ctx.seen.get(zodSchema);
    if (seen2.ref === null)
      return;
    const schema2 = seen2.def ?? seen2.schema;
    const _cached = { ...schema2 };
    const ref = seen2.ref;
    seen2.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        assignProps(schema2, refSchema);
      }
      assignProps(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen2.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = /* @__PURE__ */ new Map();
      for (const seen2 of ctx.seen.values()) {
        for (const json of [seen2.schema, seen2.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen2 = entry[1];
      if (seen2.def && seen2.defId) {
        if (seen2.def.id === seen2.defId)
          delete seen2.def.id;
        assignProp(defs, seen2.defId, seen2.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};

// ../../../node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === void 0 || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === void 0 || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
var exactPatterns = /* @__PURE__ */ new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex2) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex2.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = /* @__PURE__ */ new Set();
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== void 0)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {
};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === void 0) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {
  } else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
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
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
var tupleProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "array";
  const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
  const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
  const prefixItems = def.items.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, prefixPath, i]
  }));
  const rest = def.rest ? processSchema(def.rest, ctx, {
    ...params,
    path: [...params.path, restPath, ...ctx.target === "openapi-3.0" ? [def.items.length] : []]
  }) : null;
  let minItems = def.items.length;
  while (minItems > 0) {
    const item = def.items[minItems - 1];
    const optional2 = ctx.io === "input" ? inputOptin(item) !== void 0 : item._zod.optout === "optional";
    if (!optional2)
      break;
    minItems--;
  }
  const maxItems = def.items.length;
  const isClosed = !def.rest;
  if (ctx.target === "draft-2020-12") {
    json.prefixItems = prefixItems;
    if (isClosed) {
      json.items = false;
    } else if (rest) {
      json.items = rest;
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  } else if (ctx.target === "openapi-3.0") {
    json.items = {
      anyOf: prefixItems
    };
    if (rest) {
      json.items.anyOf.push(rest);
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  } else {
    json.items = prefixItems;
    if (isClosed) {
      json.additionalItems = false;
    } else if (rest) {
      json.additionalItems = rest;
    }
    if (minItems > 0)
      json.minItems = minItems;
    if (isClosed)
      json.maxItems = maxItems;
  }
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen2.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  seen2.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = /* @__PURE__ */ Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  seen2.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  seen2.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  seen2.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  seen2.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  seen2.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  seen2.ref = def.innerType;
};
var lazyProcessor = (schema, ctx, _json, params) => {
  const innerType = schema._zod.innerType;
  processSchema(innerType, ctx, params);
  const seen2 = ctx.seen.get(schema);
  seen2.ref = innerType;
};

// ../../../node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue2) => {
    self.issues.push(issue2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues2) => {
    self.issues.push(...issues2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, void 0, {
  Parent: Error
});

// ../../../node_modules/zod/v4/classic/parse.js
var parse2 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../../../node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(util_exports.mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta2) {
    reg.add(this, meta2);
    return this;
  },
  refine(check2, params) {
    return this.check(refine(check2, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(_overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
  get "~standard"() {
    return util_exports.hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    util_exports.own(this, "~standard", value);
  },
  parse: function _parse2(data, params) {
    return parse2(this, data, params, { callee: _parse2 });
  },
  parseAsync: async function _parseAsync2(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync2 });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  // `spa` is an alias: same function object as `safeParseAsync`, as before.
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    util_exports.own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode2(data, params) {
    return encode(this, data, params, { callee: _encode2 });
  },
  decode: function _decode2(data, params) {
    return decode(this, data, params, { callee: _decode2 });
  },
  encodeAsync: async function _encodeAsync2(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync2 });
  },
  decodeAsync: async function _decodeAsync2(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync2 });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  // Reads through to the registry on every access, so it must not cache.
  get description() {
    return globalRegistry.get(this)?.description;
  },
  // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
  get _def() {
    return this._zod.def;
  }
});
var _ZodString = /* @__PURE__ */ $constructor(
  "_ZodString",
  (inst, def) => {
    $ZodString.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  },
  /* @__PURE__ */ util_exports.derived({
    format: (inst) => aggregateChecks(inst).format ?? null,
    minLength: (inst) => aggregateChecks(inst).minimum ?? null,
    maxLength: (inst) => aggregateChecks(inst).maximum ?? null
  }, {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  })
);
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor(
  "ZodNumber",
  (inst, def) => {
    $ZodNumber.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
    inst.isFinite = true;
  },
  /* @__PURE__ */ util_exports.derived({
    minValue: (inst) => {
      const { minimum, exclusiveMinimum } = aggregateChecks(inst);
      return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
    },
    maxValue: (inst) => {
      const { maximum, exclusiveMaximum } = aggregateChecks(inst);
      return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
    },
    isInt: (inst) => {
      const { isInt, multipleOf } = aggregateChecks(inst);
      return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
    },
    format: (inst) => aggregateChecks(inst).format ?? null
  }, {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  })
);
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
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  util_exports.installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: void 0 }));
  },
  extend(incoming) {
    return util_exports.extend(this, incoming);
  },
  safeExtend(incoming) {
    return util_exports.safeExtend(this, incoming);
  },
  merge(other) {
    return util_exports.merge(this, other);
  },
  pick(mask) {
    return util_exports.pick(this, mask);
  },
  omit(mask) {
    return util_exports.omit(this, mask);
  },
  partial(...args) {
    return util_exports.partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return util_exports.partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return util_exports.required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
function strictObject(shape, params) {
  return new ZodObject({
    type: "object",
    shape,
    catchall: never(),
    ...util_exports.normalizeParams(params)
  });
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
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
    ...util_exports.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodTuple = /* @__PURE__ */ $constructor("ZodTuple", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTuple.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => tupleProcessor(inst, ctx, json, params);
}, {
  rest(rest) {
    return this.clone({
      ...this._zod.def,
      rest
    });
  },
  partial() {
    const def = this._zod.def;
    if (def.checks?.length)
      throw new Error(".partial() cannot be used on tuple schemas containing refinements");
    return this.clone({
      ...def,
      items: def.items.map((item) => new ZodOptional({ type: "optional", innerType: item }))
    });
  }
});
function tuple(items, _paramsOrRest, _params) {
  const hasRest = _paramsOrRest instanceof $ZodType;
  const params = hasRest ? _params : _paramsOrRest;
  const rest = hasRest ? _paramsOrRest : null;
  return new ZodTuple({
    type: "tuple",
    items,
    rest,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
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
      ...util_exports.normalizeParams(params),
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
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
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
    ...util_exports.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(util_exports.issue(_issue));
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
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : util_exports.constantCatch(catchValue)
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodLazy = /* @__PURE__ */ $constructor("ZodLazy", (inst, def) => {
  $ZodLazy.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => lazyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.getter();
});
function lazy(getter) {
  return new ZodLazy({
    type: "lazy",
    getter
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}

// ../viewer/src/protocol/wire.ts
var uint = number2().int().nonnegative();
function pairing(item) {
  return object({ lhs: item.optional(), rhs: item.optional() });
}
var fileRef = object({ path: string2(), oid: string2(), mode: string2() });
var visibility = object({
  collapsed: boolean2().default(false),
  label: string2().default("")
});
var problem = object({ code: string2(), message: string2() });
var fileChange = object({
  file: pairing(fileRef),
  status: _enum(["added", "deleted", "modified", "renamed", "copied", "type_changed"]),
  /** What the file is (`generated`, `vendored`, `docs`, `test`, or a `diffr-tags` attribute), sorted. */
  tags: array(string2()).default([])
});
var snapshot = discriminatedUnion("type", [
  object({ type: literal("revision"), rev: string2() }),
  object({ type: literal("index") }),
  object({ type: literal("working_tree") }),
  object({ type: literal("empty_tree") }),
  object({ type: literal("path"), path: string2() })
]);
var sourcePos = object({ line: uint, column: uint });
var span = object({ line: uint, start_column: uint, end_column: uint });
var syntaxSpan = span.extend({ capture: string2() });
var regionBase = object({
  id: uint,
  fold_state_id: uint,
  start: sourcePos,
  end: sourcePos,
  tags: array(string2()).default([]),
  visibility: visibility.default({ collapsed: false, label: "" })
});
var region = lazy(
  () => discriminatedUnion("kind", [
    regionBase.extend({ kind: literal("leaf"), alignment_id: uint, pair: uint.optional(), changed: array(span).default([]) }).transform((leaf) => ({ ...leaf, children: [] })),
    regionBase.extend({
      kind: literal("fold"),
      children: array(region),
      indent: sourcePos,
      syntax: object({ start: sourcePos, end: sourcePos }).optional()
    }).transform((fold) => ({ ...fold, changed: [] }))
  ])
);
var source = object({
  text: string2(),
  syntax: array(syntaxSpan).default([]),
  /** The whole file, as one fold. Both sides' roots share a fold_state_id; its visibility is the file's. */
  root: region
});
var lineCounts = object({ added: uint, removed: uint });
var stats = object({
  textual: lineCounts,
  /** Changed lines shown under diffr's default fold state; the frontend adjusts it as folds toggle. */
  visible: lineCounts,
  /** Present when tree-sitter did not run and this is a line diff. */
  fallback: problem.optional()
});
var diff = discriminatedUnion("type", [
  object({ type: literal("text"), lhs: source.optional(), rhs: source.optional(), stats }),
  object({
    type: literal("binary"),
    lhs: object({ size: uint }).optional(),
    rhs: object({ size: uint }).optional()
  })
]);
var fileEvent = object({
  type: literal("file"),
  file: pairing(fileRef),
  diff: diff.optional(),
  error: problem.optional()
});
var eventSchema = discriminatedUnion("type", [
  object({
    type: literal("start"),
    version: literal(3),
    lhs: snapshot,
    rhs: snapshot,
    files: array(fileChange)
  }),
  fileEvent,
  object({ type: literal("complete"), succeeded: uint, failed: uint, aborted: problem.optional() })
]);
var fileIdentity = (file) => JSON.stringify([file.lhs?.path ?? null, file.rhs?.path ?? null]);
var filePath = (file) => file.rhs?.path ?? file.lhs?.path ?? "";
function fileVisibility(file) {
  return file.diff?.type === "text" ? (file.diff.rhs ?? file.diff.lhs).root.visibility : { collapsed: false, label: "" };
}

// ../viewer/src/protocol/store.ts
var DiffStore = class {
  value = {
    comparison: null,
    inventory: [],
    files: [],
    failures: [],
    loaded: 0,
    errors: [],
    complete: false
  };
  slots = /* @__PURE__ */ new Map();
  notification;
  notify() {
    if (this.notification !== void 0 || this.listeners.size === 0) return;
    this.notification = setTimeout(() => {
      this.notification = void 0;
      this.listeners.forEach((listener) => listener());
    }, 16);
  }
  listeners = /* @__PURE__ */ new Set();
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
        files: event.files.map(() => void 0),
        failures: event.files.map(() => void 0)
      };
    }
    if (event.type === "file") {
      const slot = this.slots.get(fileIdentity(event.file));
      if (slot === void 0) throw new Error(`${filePath(event.file)} is not in the manifest`);
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
  fail(error2) {
    this.value = {
      ...this.value,
      complete: true,
      errors: [...this.value.errors, String(error2)]
    };
    this.notify();
  }
};

// ../viewer/src/protocol/events.ts
async function* parseDiffEvents(texts) {
  let buffer = "", complete = false;
  function parse3(line) {
    if (line.length > 128 * 1024 * 1024)
      throw new Error("diffr event exceeds 128 MiB");
    const event = eventSchema.parse(JSON.parse(line));
    if (event.type === "complete") complete = true;
    return event;
  }
  for await (const text of texts) {
    buffer += text;
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim()) yield parse3(line);
    }
    if (buffer.length > 128 * 1024 * 1024)
      throw new Error("diffr event exceeds 128 MiB");
  }
  if (buffer.trim()) yield parse3(buffer);
  if (!complete) throw new Error("Incomplete diffr stream");
}

// src/args.ts
function splitArgs(text) {
  const args = [];
  let current = "", quote, started = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = void 0;
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) throw new Error(`Unclosed ${quote} in: ${text}`);
  if (started) args.push(current);
  return args;
}

// src/protocol.ts
var action = union([
  strictObject({ fold: number2().int(), file: number2().int() }),
  /** A file header's viewed box. */
  strictObject({ viewedFile: number2().int() }),
  strictObject({ file: number2().int() }),
  strictObject({ jump: number2().int() }),
  strictObject({ dir: string2() }),
  /** A scrollbar row. */
  strictObject({ scrub: number2().int() }),
  strictObject({ layout: literal(true) }),
  /** The status line's ? keys, or any click on the key list: show or hide the list. */
  strictObject({ help: literal(true) }),
  /** A file in the Ctrl-P picker. */
  strictObject({ pick: number2().int() }),
  /** The title bar's files button: the tree, as a sidebar or in place of the diff. */
  strictObject({ files: literal(true) }),
  /** The selection bar's Add to chat button. */
  strictObject({ chat: literal(true) })
]);
var hover = union([
  strictObject({ file: number2().int(), id: number2().int(), armed: boolean2() }),
  strictObject({ file: number2().int(), header: literal(true) })
]);
var keyPress = object({
  key: string2(),
  ctrl: literal(true).optional(),
  shift: literal(true).optional(),
  meta: literal(true).optional()
});
var input = union([
  strictObject({ act: action, alt: literal(true).optional() }),
  strictObject({ press: keyPress }),
  /** A left press (or, with `extend`, a drag) at a pane cell: `y` counts from the frame's first line. */
  strictObject({ select: strictObject({ x: number2().int(), y: number2().int(), extend: literal(true).optional() }) })
]);
var post = strictObject({
  instance: string2(),
  inputs: array(tuple([number2().int(), input])),
  hover: hover.nullable().optional()
});
var parsePost = (data) => post.parse(data);

// ../viewer/src/document/counts.ts
var zero = { added: 0, removed: 0 };
var add = (a, b) => ({ added: a.added + b.added, removed: a.removed + b.removed });
function blockBar(counts, blocks = 5) {
  const total = counts.added + counts.removed;
  if (total === 0) return Array.from({ length: blocks }, () => "neutral");
  let green = Math.floor(blocks * counts.added / total);
  let red = Math.floor(blocks * counts.removed / total);
  if (counts.added > 0 && green === 0) green = 1;
  if (counts.removed > 0 && red === 0) red = 1;
  while (green + red > blocks) {
    if (green >= red) green--;
    else red--;
  }
  return [
    ...Array.from({ length: green }, () => "added"),
    ...Array.from({ length: red }, () => "removed"),
    ...Array.from({ length: blocks - green - red }, () => "neutral")
  ];
}
function snapshotLabel(snapshot3) {
  switch (snapshot3.type) {
    case "revision":
      return /^[0-9a-f]{40}$/.test(snapshot3.rev) ? snapshot3.rev.slice(0, 7) : snapshot3.rev;
    case "index":
      return "index";
    case "working_tree":
      return "working tree";
    case "empty_tree":
      return "empty tree";
    case "path":
      return snapshot3.path;
  }
}
var comparisonLabel = (lhs, rhs) => `${snapshotLabel(lhs)}\u2026${snapshotLabel(rhs)}`;

// ../viewer/src/document/fileTree.ts
function buildFileTree(files) {
  const roots = [];
  const directories = /* @__PURE__ */ new Map();
  files.forEach((file, fileIndex) => {
    const path = filePath(file.file);
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
    nodes.sort((a, b) => Number(a.fileIndex !== void 0) - Number(b.fileIndex !== void 0) || a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
function flattenFileTree(nodes, closed, depth = 0) {
  return nodes.flatMap((node2) => [
    { node: node2, depth },
    ...node2.fileIndex === void 0 && !closed.has(node2.key) ? flattenFileTree(node2.children, closed, depth + 1) : []
  ]);
}
function parentDirectories(file) {
  const parts = filePath(file.file).split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, i) => "/" + parts.slice(0, i + 1).join("/"));
}
function lineCounts2(file) {
  if (file.diff.type === "binary") return { textual: { added: 0, removed: 0 }, visible: { added: 0, removed: 0 } };
  return { textual: file.diff.stats.textual, visible: file.diff.stats.visible, fallback: file.diff.stats.fallback };
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
  for (let index = 0; index < spans.length; index += 1) {
    const span3 = spans[index];
    const text = sanitizeTerminalLine(span3.text);
    if (text === span3.text && text.length > 0) {
      sanitized?.push(span3);
      continue;
    }
    sanitized ??= spans.slice(0, index);
    if (text.length > 0) {
      sanitized.push({ ...span3, text });
    }
  }
  return sanitized ?? spans;
}

// ../../../node_modules/get-east-asian-width/lookup.js
function isAmbiguous(x) {
  return x === 161 || x === 164 || x === 167 || x === 168 || x === 170 || x === 173 || x === 174 || x >= 176 && x <= 180 || x >= 182 && x <= 186 || x >= 188 && x <= 191 || x === 198 || x === 208 || x === 215 || x === 216 || x >= 222 && x <= 225 || x === 230 || x >= 232 && x <= 234 || x === 236 || x === 237 || x === 240 || x === 242 || x === 243 || x >= 247 && x <= 250 || x === 252 || x === 254 || x === 257 || x === 273 || x === 275 || x === 283 || x === 294 || x === 295 || x === 299 || x >= 305 && x <= 307 || x === 312 || x >= 319 && x <= 322 || x === 324 || x >= 328 && x <= 331 || x === 333 || x === 338 || x === 339 || x === 358 || x === 359 || x === 363 || x === 462 || x === 464 || x === 466 || x === 468 || x === 470 || x === 472 || x === 474 || x === 476 || x === 593 || x === 609 || x === 708 || x === 711 || x >= 713 && x <= 715 || x === 717 || x === 720 || x >= 728 && x <= 731 || x === 733 || x === 735 || x >= 768 && x <= 879 || x >= 913 && x <= 929 || x >= 931 && x <= 937 || x >= 945 && x <= 961 || x >= 963 && x <= 969 || x === 1025 || x >= 1040 && x <= 1103 || x === 1105 || x === 8208 || x >= 8211 && x <= 8214 || x === 8216 || x === 8217 || x === 8220 || x === 8221 || x >= 8224 && x <= 8226 || x >= 8228 && x <= 8231 || x === 8240 || x === 8242 || x === 8243 || x === 8245 || x === 8251 || x === 8254 || x === 8308 || x === 8319 || x >= 8321 && x <= 8324 || x === 8364 || x === 8451 || x === 8453 || x === 8457 || x === 8467 || x === 8470 || x === 8481 || x === 8482 || x === 8486 || x === 8491 || x === 8531 || x === 8532 || x >= 8539 && x <= 8542 || x >= 8544 && x <= 8555 || x >= 8560 && x <= 8569 || x === 8585 || x >= 8592 && x <= 8601 || x === 8632 || x === 8633 || x === 8658 || x === 8660 || x === 8679 || x === 8704 || x === 8706 || x === 8707 || x === 8711 || x === 8712 || x === 8715 || x === 8719 || x === 8721 || x === 8725 || x === 8730 || x >= 8733 && x <= 8736 || x === 8739 || x === 8741 || x >= 8743 && x <= 8748 || x === 8750 || x >= 8756 && x <= 8759 || x === 8764 || x === 8765 || x === 8776 || x === 8780 || x === 8786 || x === 8800 || x === 8801 || x >= 8804 && x <= 8807 || x === 8810 || x === 8811 || x === 8814 || x === 8815 || x === 8834 || x === 8835 || x === 8838 || x === 8839 || x === 8853 || x === 8857 || x === 8869 || x === 8895 || x === 8978 || x >= 9312 && x <= 9449 || x >= 9451 && x <= 9547 || x >= 9552 && x <= 9587 || x >= 9600 && x <= 9615 || x >= 9618 && x <= 9621 || x === 9632 || x === 9633 || x >= 9635 && x <= 9641 || x === 9650 || x === 9651 || x === 9654 || x === 9655 || x === 9660 || x === 9661 || x === 9664 || x === 9665 || x >= 9670 && x <= 9672 || x === 9675 || x >= 9678 && x <= 9681 || x >= 9698 && x <= 9701 || x === 9711 || x === 9733 || x === 9734 || x === 9737 || x === 9742 || x === 9743 || x === 9756 || x === 9758 || x === 9792 || x === 9794 || x === 9824 || x === 9825 || x >= 9827 && x <= 9829 || x >= 9831 && x <= 9834 || x === 9836 || x === 9837 || x === 9839 || x === 9886 || x === 9887 || x === 9919 || x >= 9926 && x <= 9933 || x >= 9935 && x <= 9939 || x >= 9941 && x <= 9953 || x === 9955 || x === 9960 || x === 9961 || x >= 9963 && x <= 9969 || x === 9972 || x >= 9974 && x <= 9977 || x === 9979 || x === 9980 || x === 9982 || x === 9983 || x === 10045 || x >= 10102 && x <= 10111 || x >= 11094 && x <= 11097 || x >= 12872 && x <= 12879 || x >= 57344 && x <= 63743 || x >= 65024 && x <= 65039 || x === 65533 || x >= 127232 && x <= 127242 || x >= 127248 && x <= 127277 || x >= 127280 && x <= 127337 || x >= 127344 && x <= 127373 || x === 127375 || x === 127376 || x >= 127387 && x <= 127404 || x >= 917760 && x <= 917999 || x >= 983040 && x <= 1048573 || x >= 1048576 && x <= 1114109;
}
function isFullWidth(x) {
  return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
}
function isWide(x) {
  return x >= 4352 && x <= 4447 || x === 8986 || x === 8987 || x === 9001 || x === 9002 || x >= 9193 && x <= 9196 || x === 9200 || x === 9203 || x === 9725 || x === 9726 || x === 9748 || x === 9749 || x >= 9776 && x <= 9783 || x >= 9800 && x <= 9811 || x === 9855 || x >= 9866 && x <= 9871 || x === 9875 || x === 9889 || x === 9898 || x === 9899 || x === 9917 || x === 9918 || x === 9924 || x === 9925 || x === 9934 || x === 9940 || x === 9962 || x === 9970 || x === 9971 || x === 9973 || x === 9978 || x === 9981 || x === 9989 || x === 9994 || x === 9995 || x === 10024 || x === 10060 || x === 10062 || x >= 10067 && x <= 10069 || x === 10071 || x >= 10133 && x <= 10135 || x === 10160 || x === 10175 || x === 11035 || x === 11036 || x === 11088 || x === 11093 || x >= 11904 && x <= 11929 || x >= 11931 && x <= 12019 || x >= 12032 && x <= 12245 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12353 && x <= 12438 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12773 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 42124 || x >= 42128 && x <= 42182 || x >= 43360 && x <= 43388 || x >= 44032 && x <= 55203 || x >= 63744 && x <= 64255 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 94176 && x <= 94180 || x >= 94192 && x <= 94198 || x >= 94208 && x <= 101589 || x >= 101631 && x <= 101662 || x >= 101760 && x <= 101874 || x >= 110576 && x <= 110579 || x >= 110581 && x <= 110587 || x === 110589 || x === 110590 || x >= 110592 && x <= 110882 || x === 110898 || x >= 110928 && x <= 110930 || x === 110933 || x >= 110948 && x <= 110951 || x >= 110960 && x <= 111355 || x >= 119552 && x <= 119638 || x >= 119648 && x <= 119670 || x === 126980 || x === 127183 || x === 127374 || x >= 127377 && x <= 127386 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x === 127568 || x === 127569 || x >= 127584 && x <= 127589 || x >= 127744 && x <= 127776 || x >= 127789 && x <= 127797 || x >= 127799 && x <= 127868 || x >= 127870 && x <= 127891 || x >= 127904 && x <= 127946 || x >= 127951 && x <= 127955 || x >= 127968 && x <= 127984 || x === 127988 || x >= 127992 && x <= 128062 || x === 128064 || x >= 128066 && x <= 128252 || x >= 128255 && x <= 128317 || x >= 128331 && x <= 128334 || x >= 128336 && x <= 128359 || x === 128378 || x === 128405 || x === 128406 || x === 128420 || x >= 128507 && x <= 128591 || x >= 128640 && x <= 128709 || x === 128716 || x >= 128720 && x <= 128722 || x >= 128725 && x <= 128728 || x >= 128732 && x <= 128735 || x === 128747 || x === 128748 || x >= 128756 && x <= 128764 || x >= 128992 && x <= 129003 || x === 129008 || x >= 129292 && x <= 129338 || x >= 129340 && x <= 129349 || x >= 129351 && x <= 129535 || x >= 129648 && x <= 129660 || x >= 129664 && x <= 129674 || x >= 129678 && x <= 129734 || x === 129736 || x >= 129741 && x <= 129756 || x >= 129759 && x <= 129770 || x >= 129775 && x <= 129784 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
}

// ../../../node_modules/get-east-asian-width/index.js
function validate2(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate2(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// ../../../node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:(?:\\u001B\\]|\\u009D)[^\\u0007\\u001B\\u009C\\u009D]*${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? void 0 : "g");
}

// ../../../node_modules/strip-ansi/index.js
var regex = ansiRegex();
function stripAnsi(string3) {
  if (typeof string3 !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string3}\``);
  }
  if (!string3.includes("\x1B") && !string3.includes("\x9B")) {
    return string3;
  }
  return string3.replace(regex, "");
}

// ../viewer/node_modules/string-width/index.js
var segmenter = new Intl.Segmenter();
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
      if (char >= "\uFF00" && char <= "\uFFEF") {
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
  let string3 = input2;
  if (!countAnsiEscapeCodes) {
    string3 = stripAnsi(string3);
  }
  if (string3.length === 0) {
    return 0;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment } of segmenter.segment(string3)) {
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
var graphemeSegmenter = new Intl.Segmenter(void 0, {
  granularity: "grapheme"
});
function textClusters(text) {
  return Array.from(
    graphemeSegmenter.segment(text),
    (segment) => segment.segment
  );
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
var BoundedClusterWidthCache = class {
  constructor(maxEntries, maxKeyCodeUnits) {
    this.maxEntries = maxEntries;
    this.maxKeyCodeUnits = maxKeyCodeUnits;
  }
  maxEntries;
  maxKeyCodeUnits;
  #entries = /* @__PURE__ */ new Map();
  /** Return one cached width without changing the FIFO eviction order. */
  get(cluster) {
    return this.#entries.get(cluster);
  }
  /** Cache one eligible width and remove the oldest entry when the limit is exceeded. */
  set(cluster, width) {
    if (cluster.length > this.maxKeyCodeUnits) {
      return;
    }
    this.#entries.set(cluster, width);
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === void 0) break;
      this.#entries.delete(oldest);
    }
  }
  /** Return the number of retained cluster widths. */
  get size() {
    return this.#entries.size;
  }
};
var cachedClusterWidths = new BoundedClusterWidthCache(
  CLUSTER_WIDTH_CACHE_MAX_ENTRIES,
  CLUSTER_WIDTH_CACHE_MAX_KEY_CODE_UNITS
);
function measureCachedClusterWidth(cluster) {
  const cached2 = cachedClusterWidths.get(cluster);
  if (cached2 !== void 0) {
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
  if (codePoint === void 0) {
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
  for (let index = 1; index < text.length; index += 1) {
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
  if (paired.has(id)) return "neutral";
  return side ? "inserted" : "removed";
}
function pairedIds(diff2) {
  const { leaves, folds } = flatten(diff2);
  const alignments = leaves.map((side) => new Set(side.map((leaf) => leaf.alignmentId)));
  const states = [0, 1].map((side) => new Set([...leaves[side], ...folds[side]].map((region2) => region2.foldStateId)));
  return [0, 1].map((side) => {
    const other = side ? 0 : 1;
    return /* @__PURE__ */ new Set([
      ...leaves[side].filter((leaf) => alignments[other].has(leaf.alignmentId)).map((leaf) => leaf.id),
      ...folds[side].filter((fold) => states[other].has(fold.foldStateId)).map((fold) => fold.id)
    ]);
  });
}
var sourceLines = (text) => text === "" ? [] : text.replace(/\n$/, "").split("\n");
var encoder = new TextEncoder();
function byteColumn(text, byte) {
  const prefix = new TextDecoder().decode(encoder.encode(text).slice(0, byte));
  let column = 0;
  for (const part of prefix.split(/(\t)/)) column += part === "	" ? 4 - column % 4 : measureTextWidth(part);
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
      const changed = /* @__PURE__ */ new Map();
      for (const span3 of region2.changed) changed.set(span3.line, [...changed.get(span3.line) ?? [], span3]);
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
    for (const ancestor of ancestors) ancestor.nested.push(fold.foldStateId);
    folds.push(fold);
    const indent = lines[region2.indent.line];
    if (indent === void 0) throw new Error(`Fold ${region2.id} indents past the end of its file`);
    for (const child of region2.children) visit(child, [...ancestors, fold], byteColumn(indent, region2.indent.column));
  };
  for (const region2 of source2.root.children) visit(region2, [], 0);
  return { leaves, folds };
}
function flatten(diff2) {
  const lhs = diff2.lhs ? flattenSide(diff2.lhs, 0) : { leaves: [], folds: [] };
  const rhs = diff2.rhs ? flattenSide(diff2.rhs, 1) : { leaves: [], folds: [] };
  return { leaves: [lhs.leaves, rhs.leaves], folds: [lhs.folds, rhs.folds] };
}
function zipLeaves(leaves, visit) {
  const rightIndex = new Map(leaves[1].map((leaf, index) => [leaf.alignmentId, index]));
  let cursor = 0;
  const flushRight = (until) => {
    for (; cursor < until; cursor++) visit(null, leaves[1][cursor]);
  };
  for (const left of leaves[0]) {
    const partner = rightIndex.get(left.alignmentId);
    if (partner === void 0) {
      visit(left, null);
      continue;
    }
    flushRight(partner);
    visit(left, leaves[1][partner]);
    cursor = partner + 1;
  }
  flushRight(leaves[1].length);
}
function changedLine(leaves) {
  const alignments = leaves.map((side) => new Set(side.map((leaf) => leaf.alignmentId)));
  return (leaf, line) => leaf.changed.has(line) || !alignments[leaf.side ? 0 : 1].has(leaf.alignmentId);
}
function diffOrder(diff2) {
  const { leaves } = flatten(diff2);
  const isChanged = changedLine(leaves);
  const order = { lines: [], oldAt: /* @__PURE__ */ new Map(), newAt: /* @__PURE__ */ new Map(), oldBefore: [], newBefore: [] };
  let pendingOld = [], pendingNew = [];
  let olds = 0, news = 0;
  const push = (line) => {
    const index = order.lines.length;
    order.lines.push(line);
    order.oldBefore.push(olds);
    order.newBefore.push(news);
    if (line.old !== void 0) {
      order.oldAt.set(line.old, index);
      olds++;
    }
    if (line.new !== void 0) {
      order.newAt.set(line.new, index);
      news++;
    }
  };
  const flush = () => {
    for (const line of pendingOld) push(line);
    for (const line of pendingNew) push(line);
    pendingOld = [];
    pendingNew = [];
  };
  zipLeaves(leaves, (left, right) => {
    const leftLines = left ? left.endLine - left.startLine : 0, rightLines = right ? right.endLine - right.startLine : 0;
    for (let i = 0; i < Math.max(leftLines, rightLines); i++) {
      const l = i < leftLines ? left.startLine + i : null, r = i < rightLines ? right.startLine + i : null;
      if (l !== null && r !== null && !isChanged(left, l) && !isChanged(right, r)) {
        flush();
        push({ old: l + 1, new: r + 1 });
        continue;
      }
      if (l !== null) pendingOld.push({ old: l + 1 });
      if (r !== null) pendingNew.push({ new: r + 1 });
    }
  });
  flush();
  return order;
}
function defaultCollapsed(diff2) {
  const ids = /* @__PURE__ */ new Set();
  const { leaves, folds } = flatten(diff2);
  for (const item of [...leaves.flat(), ...folds.flat()]) if (item.collapsed) ids.add(item.foldStateId);
  return ids;
}
function foldIds(diff2) {
  const { folds, leaves } = flatten(diff2);
  return [.../* @__PURE__ */ new Set([...folds.flat().map((fold) => fold.foldStateId), ...leaves.flat().filter(foldableLeaf).map((l) => l.foldStateId)])];
}
function nestedIds(diff2, id) {
  const { folds, leaves } = flatten(diff2);
  const members2 = folds.flat().filter((f) => f.foldStateId === id);
  if (members2.length) return [...new Set(members2.flatMap((f) => f.nested))].filter((n) => n !== id);
  if (!leaves.flat().some((leaf) => leaf.foldStateId === id)) throw new Error(`Unknown region ${id}`);
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
  const changed = /* @__PURE__ */ new Set();
  for (const regions of sides)
    walk(regions, (region2) => {
      if (region2.kind === "leaf" && region2.changed.length) changed.add(region2.alignment_id);
    });
  const gaps = /* @__PURE__ */ new Set();
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
  const ids = /* @__PURE__ */ new Set();
  for (const fold of folds[side]) {
    const inline = fold.syntax && !fold.label.includes("\n");
    const last = inline ? Math.max(fold.lastHidden, fold.syntax.end.line) : fold.lastHidden;
    if (collapsed.has(fold.foldStateId) && fold.startLine <= line && line <= last) ids.add(fold.foldStateId);
  }
  for (const leaf of leaves[side])
    if (collapsed.has(leaf.foldStateId) && leaf.startLine <= line && line < leaf.endLine) ids.add(leaf.foldStateId);
  return [...ids];
}
function hiddenLines(folds, collapsed) {
  const hidden = /* @__PURE__ */ new Set();
  for (const fold of folds) {
    if (!collapsed.has(fold.foldStateId)) continue;
    for (let line = fold.startLine; line <= fold.lastHidden; line++) hidden.add(line);
  }
  return hidden;
}
function collapsedFolds(folds, collapsed) {
  const rows = /* @__PURE__ */ new Map();
  const collapsedFirst = [...folds].filter((fold) => collapsed.has(fold.foldStateId)).sort((a, b) => a.startLine - b.startLine || b.lastHidden - a.lastHidden);
  let covered = -1;
  for (const fold of collapsedFirst) {
    if (fold.startLine <= covered) continue;
    rows.set(fold.startLine, fold);
    covered = fold.lastHidden;
  }
  return rows;
}
var foldableLeaf = (leaf) => leaf.collapsed || leaf.label !== "";
function foldHeaders(folds, leaves, collapsed, paired) {
  const headers = /* @__PURE__ */ new Map();
  for (const leaf of leaves)
    if (foldableLeaf(leaf))
      headers.set(leaf.startLine, {
        id: leaf.foldStateId,
        label: leaf.label,
        collapsed: collapsed.has(leaf.foldStateId),
        tint: foldTint(leaf.id, leaf.side, paired)
      });
  const byLine2 = /* @__PURE__ */ new Map();
  for (const fold of folds) {
    if (collapsed.has(fold.foldStateId)) continue;
    const header = fold.syntax?.start.line ?? fold.startLine;
    byLine2.set(header, [...byLine2.get(header) ?? [], fold]);
  }
  for (const [line, sharing] of byLine2) {
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
  if (!pattern) return [];
  const exact = caseSensitive(pattern);
  const haystack = exact ? text : text.toLowerCase(), needle = exact ? pattern : pattern.toLowerCase();
  const ranges = [];
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length))
    ranges.push([at, at + needle.length]);
  return ranges;
}

// ../../../node_modules/fuzzysort/fuzzysort.js
function single(search, target) {
  if (!search || !target) return null;
  let query = getQuery(search);
  if (!isPrepared(target)) target = getPrepared(target);
  if ((query.bitflags & target._bitflags) !== query.bitflags) return null;
  let result = !query.hasSpace && query.lowerCodes.length === 2 ? algorithm2(query, target) : algorithm(query, target);
  return result && materialize(result);
}
function go(search, targets, options) {
  if (targets instanceof SnapshotTargets) return goSnapshot(search, targets, options);
  let key = options?.key;
  let keys = !key && options?.keys;
  let firstTarget = targets[0];
  if (!key && !keys && typeof firstTarget === "object" && firstTarget !== null && !isPrepared(firstTarget)) {
    throw new Error("fuzzysort: key or keys is required when searching object targets");
  }
  if (!search) return all(targets, options);
  let query = getQuery(search);
  if (keys) return goKeys(query, targets, options);
  let searchBitflags = query.bitflags;
  let twoChar = !query.hasSpace && query.lowerCodes.length === 2;
  let threshold = denormalizeScore(options?.threshold ?? 0.5);
  let limit = getLimit(options);
  let scoreFn = options?.scoreFn;
  let resultCount = 0;
  let limited = 0;
  let getter = key && makeGetter(key);
  for (let i = 0; i < targets.length; i++) {
    let obj = targets[i];
    let target = key ? getter === null ? obj[key] : getter(obj) : obj;
    if (!target) continue;
    if (!isPrepared(target)) target = getPrepared(target);
    if ((searchBitflags & target._bitflags) !== searchBitflags) continue;
    let result = twoChar ? algorithm2(query, target) : algorithm(query, target);
    if (result === null) continue;
    let resultScore = result._score;
    if (scoreFn) {
      result = materialize(result, key ? obj : void 0);
      resultScore = scoreFn(result);
      if (!resultScore) continue;
      result._score = resultScore = denormalizeScore(resultScore);
    }
    if (resultScore < threshold) continue;
    let room = resultCount < limit;
    if (room) resultCount++;
    else {
      limited++;
      if (resultScore <= heap.peek()._score) continue;
    }
    if (!scoreFn) result = materialize(result, key ? obj : void 0);
    room ? heap.add(result) : heap.replaceTop(result);
  }
  return finishResults(resultCount, limited);
}
function highlight(result, open2 = "<b>", close = "</b>", threshold = 0.5) {
  let callback = typeof open2 === "function" ? open2 : null;
  let target = result.target;
  if (result._bestKeyScore !== void 0 && normalizeScore(result._score) < normalizeScore(result._bestKeyScore) * threshold) return callback ? [target] : target;
  let raw = result._indexes;
  let indexes = raw === void 0 ? result.indexes : raw.slice(0, raw.len ?? raw.length).sort((a, b) => a - b);
  if (!indexes.length) return callback ? [target] : target;
  let output = callback ? [] : "";
  let lastIndex = 0;
  let matchI = 0;
  for (let i = 0; i < indexes.length; ) {
    let start = indexes[i++];
    let end = start + 1;
    while (indexes[i] === end) {
      i++;
      end++;
    }
    let before = target.slice(lastIndex, start);
    let match = target.slice(start, end);
    if (callback) output.push(before, callback(match, matchI++));
    else output += before + open2 + match + close;
    lastIndex = end;
  }
  if (callback) output.push(target.slice(lastIndex));
  else output += target.slice(lastIndex);
  return output;
}
function score(result) {
  let value = result.score;
  return value === void 0 ? normalizeScore(result._score) : value;
}
function remap(mappings) {
  for (let char in mappings) {
    remappings[char] = mappings[char];
    if (char.charCodeAt(0) < 128) customAsciiRemappings = true;
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
  for (let n = 0; n < rowsLength; n++) {
    let i = rows === null ? n : rows[n];
    let target = targets[i];
    if (target === noTarget || (search.bitflags & target._bitflags) !== search.bitflags) continue;
    let targetShort = shortSearch && target.target.length < 65535;
    let cutoff = !scoreFn && threshold === -INF && resultCount >= limit ? heap.peek()._score : -INF;
    let result;
    if (singleChar && targetShort) result = algorithm1(search, target, snapshot3._first, i);
    else if (twoChar && targetShort) {
      let start = snapshot3._offsets[i];
      let end = snapshot3._offsets[i + 1];
      result = algorithm2(search, target, snapshot3._beginnings, start, end, cutoff);
    } else if (twoChar) result = algorithm2(search, target, null, 0, 0, cutoff);
    else if (targetShort) {
      let start = snapshot3._offsets[i];
      let end = snapshot3._offsets[i + 1];
      result = algorithm(search, target, false, false, false, true, snapshot3._beginnings, start, end, cutoff);
    } else result = algorithm(search, target, false, false, false, true, null, 0, 0, cutoff);
    if (result === null) continue;
    matchedRows[matchedCount++] = i;
    if (result === prunedMatch) {
      limited++;
      continue;
    }
    let resultScore = result._score;
    if (scoreFn) {
      result = materialize(result, objects?.[i]);
      resultScore = scoreFn(result);
      if (!resultScore) continue;
      result._score = resultScore = denormalizeScore(resultScore);
    }
    if (resultScore < threshold) continue;
    let room = resultCount < limit;
    if (room) resultCount++;
    else {
      limited++;
      if (resultScore <= heap.peek()._score) continue;
    }
    if (objects && !scoreFn) result = materialize(result, objects[i]);
    room ? heap.add(result) : heap.replaceTop(result);
  }
  snapshot3._matchedRowsLen = matchedCount;
  return finishResults(resultCount, limited, !objects && !scoreFn && materialize);
}
function goSnapshot(search, snapshot3, options) {
  if (options?.key || options?.keys) throw new Error("fuzzysort: key/keys must be provided to snapshot(), not go()");
  snapshot3._finish();
  if (!search) return allSnapshot(snapshot3, options);
  let query = getQuery(search);
  let backtrack = snapshot3._backtrack(query, options);
  if (backtrack) return backtrack;
  snapshot3._beginSearch(query);
  try {
    let results;
    if (snapshot3._mode < 2) {
      let searchLen = query.lowerCodes.length;
      let code = query.lowerCodes[0];
      let singleChar = searchLen === 1 && code >= 97 && code <= 122;
      results = goSnapshotValues(query, snapshot3, options, singleChar);
    } else results = goKeys(query, snapshot3._objects, options, snapshot3);
    snapshot3._endSearch(query);
    snapshot3._remember(query, results, options);
    return results;
  } catch (error2) {
    snapshot3._resetSearch();
    throw error2;
  }
}
function goKeys(query, objects, options, snapshot3) {
  let indexed = snapshot3 !== void 0;
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
  outer: for (let n = 0; n < rowsLength; n++) {
    let i = rows === null ? n : rows[n];
    let row = i * keysLength;
    if (indexed) {
      if ((searchBitflags & snapshot3._bitflags[i]) !== searchBitflags) continue;
    } else {
      let obj = objects[i];
      let keysBitflags = 0;
      for (let k = 0; k < keysLength; k++) {
        let target = getters[k] === null ? obj[keys[k]] : getters[k](obj);
        if (!target) target = noTarget;
        else if (!isPrepared(target)) target = getPrepared(target);
        keyTargets[k] = target;
        keysBitflags |= target._bitflags;
      }
      if ((searchBitflags & keysBitflags) !== searchBitflags) continue;
    }
    if (hasSpace) for (let s = 0; s < spaceCount; s++) {
      spaceScores[s] = winnerScores[s] = -INF;
      winnerKeys[s] = -1;
    }
    for (let k = 0; k < keysLength; k++) {
      let target = indexed ? targets[row + k] : keyTargets[k];
      if (target === noTarget) {
        keyResults[k] = noTarget;
        continue;
      }
      if (hasSpace && indexed) {
        let possible = false;
        for (let s = 0; s < spaceCount; s++) {
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
        if (singleChar && targetShort) match = algorithm1(query, target, snapshot3._first, valueRow);
        else if (twoChar && targetShort) {
          let start = snapshot3._offsets[valueRow];
          let end = snapshot3._offsets[valueRow + 1];
          match = algorithm2(query, target, snapshot3._beginnings, start, end);
        } else if (twoChar) match = algorithm2(query, target);
        else if (targetShort) {
          let start = snapshot3._offsets[valueRow];
          let end = snapshot3._offsets[valueRow + 1];
          match = algorithm(query, target, false, false, false, true, snapshot3._beginnings, start, end);
        } else match = algorithm(query, target, false, hasSpace);
      } else match = twoChar ? algorithm2(query, target) : algorithm(query, target, false, hasSpace);
      if (match === null) {
        keyResults[k] = noTarget;
        continue;
      }
      keyResults[k] = deferMaterialization ? match : materialize(match);
      if (hasSpace) {
        mergePartScores(spaceCount);
        for (let s = 0; s < spaceCount; s++) {
          let partScore = partials[s];
          if (partScore <= winnerScores[s]) continue;
          winnerScores[s] = partScore;
          winnerKeys[s] = k;
          let source2 = partIndexes[s];
          let winner = winnerIndexes[s] ||= [];
          winner.length = source2.length;
          for (let j = 0; j < source2.length; j++) winner[j] = source2[j];
        }
      }
    }
    if (hasSpace) {
      for (let s = 0; s < spaceCount; s++) if (winnerKeys[s] !== -1) {
        appendIndexes(keyResults[winnerKeys[s]]._indexes, winnerIndexes[s]);
      }
    }
    let resultScore;
    if (hasSpace) {
      resultScore = 0;
      for (let s = 0; s < spaceCount; s++) {
        let partScore = spaceScores[s];
        if (partScore === -INF) continue outer;
        resultScore += partScore;
      }
    } else {
      resultScore = mergeScores(keyResults, keysLength);
      if (resultScore === -INF) continue;
    }
    if (indexed) matchedRows[matchedCount++] = i;
    let result = deferMaterialization ? null : captureKeysResult(keyResults, keysLength, objects[i], resultScore, hasSpace);
    if (scoreFn) {
      resultScore = scoreFn(result);
      if (!resultScore) continue;
      result._score = resultScore = denormalizeScore(resultScore);
    }
    if (resultScore < threshold) continue;
    let room = resultCount < limit;
    if (room) resultCount++;
    else {
      limited++;
      if (resultScore <= heap.peek()._score) continue;
    }
    if (result === null) result = captureKeysResult(keyResults, keysLength, objects[i], resultScore, hasSpace);
    room ? heap.add(result) : heap.replaceTop(result);
  }
  if (indexed) snapshot3._matchedRowsLen = matchedCount;
  return finishResults(resultCount, limited, deferMaterialization && materializeKeys);
}
function allSnapshot(snapshot3, options) {
  let results = [];
  let targets = snapshot3._targets;
  let objects = snapshot3._objects;
  let keysLength = snapshot3._keysLength;
  let total = keysLength === void 0 ? targets.length : objects.length;
  results.total = total;
  let limit = getLimit(options);
  for (let i = 0, length = Math.min(total, limit); i < length; i++) {
    if (keysLength === void 0) {
      results.push(newResult(targets[i].target, -INF, objects?.[i]));
      continue;
    }
    let row = i * keysLength;
    for (let k = 0; k < keysLength; k++) {
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
      for (let k = keys.length - 1; k >= 0; k--) {
        let target = getters[k] === null ? obj[keys[k]] : getters[k](obj);
        if (!target) keyResults[k] = noTarget;
        else {
          if (!isPrepared(target)) target = getPrepared(target);
          target._score = -INF;
          target._indexes.len = 0;
          keyResults[k] = target;
        }
      }
      results.push(captureKeysResult(keyResults, keys.length, obj, -INF));
      if (results.length >= limit) break;
    }
    return results;
  }
  let getter = key && makeGetter(key);
  for (let obj of targets) {
    let target = key ? getter === null ? obj[key] : getter(obj) : obj;
    if (target == null) continue;
    if (!isPrepared(target)) target = getPrepared(target);
    if (key) target = newResult(target.target, -INF, obj);
    else {
      target._score = -INF;
      target._indexes.len = 0;
    }
    results.push(target);
    if (results.length >= limit) break;
  }
  return results;
}
function finishResults(length, limited, transform2) {
  if (!length) return noResults;
  let results = new Array(length);
  for (let i = length - 1; i >= 0; i--) {
    let result = heap.poll();
    if (transform2) result = transform2(result);
    if (result instanceof KeysResult && !result._partWinners) markBestKeyScore(result);
    results[i] = result;
  }
  results.total = length + limited;
  return results;
}
function materializeKeys(result) {
  for (let k = 0; k < result.length; k++) if (result[k] !== noTarget) result[k] = materialize(result[k]);
  return result;
}
function algorithm1(search, target, firstTable, row) {
  let matchI = target._targetLower.indexOf(search._lower);
  if (matchI === -1) return null;
  let beginning = firstTable[row * 26 + search.lowerCodes[0] - 97];
  let strict = beginning !== 0;
  if (strict) matchI = beginning - 1;
  let score2 = matchI === 0 ? 0 : -matchI * matchI * 0.2;
  if (!strict) score2 *= 1e3;
  else if (target._beginningsLen > 24) score2 *= (target._beginningsLen - 24) * 10;
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
  while (targetCodes[first] !== firstCode) if (++first >= targetLen) return null;
  let second = first + 1;
  while (targetCodes[second] !== secondCode) if (++second >= targetLen) return null;
  if (cutoff !== -INF && scoreCeiling(2, targetLen) <= cutoff) return prunedMatch;
  if (beginnings === null) {
    beginnings = target._beginnings;
    if (beginnings === null) target._beginnings = beginnings = makeBeginnings(target);
    end = beginnings.length;
  }
  let substringI = target._targetLower.indexOf(search._lower, first);
  let substring = substringI !== -1;
  let low = lowerBound(beginnings, start, end, substringI);
  let substringStart = substring && low < end && beginnings[low] === substringI;
  let strict = substringStart && substringI === first;
  if (!strict) {
    let firstBeginning = start;
    while (firstBeginning < end && beginnings[firstBeginning] < first) firstBeginning++;
    for (let backtracks = 0; firstBeginning < end; ) {
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
      while (secondBeginning < end && beginnings[secondBeginning] <= consecutive) secondBeginning++;
      while (secondBeginning < end && targetCodes[beginnings[secondBeginning]] !== secondCode) secondBeginning++;
      if (secondBeginning < end) {
        first = strictFirst;
        second = beginnings[secondBeginning];
        strict = true;
        break;
      }
      if (++backtracks > 200) break;
      firstBeginning++;
    }
  }
  if (substring && !substringStart) {
    while (low < end && beginnings[low] <= substringI) low++;
    for (; low < end; low++) {
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
  if (first) resultScore -= first * first * 0.2;
  if (!strict) resultScore *= 1e3;
  else if (end - start > 24) resultScore *= (end - start - 24) * 10;
  let lengthPenalty = (targetLen - 2) / 2;
  resultScore -= lengthPenalty;
  if (substring) resultScore /= 5;
  if (substringStart) resultScore /= 5;
  resultScore -= lengthPenalty;
  let substringEnd = substring && second === first + 1 && (second + 1 === targetLen || isBeginning(beginnings, start, end, second + 1));
  target._score = substringEnd ? resultScore + Math.min(4, -resultScore / 2) : resultScore;
  target._indexes[0] = first;
  target._indexes[1] = second;
  target._indexes.len = 2;
  return target;
}
function algorithm(search, target, spaces = false, partial2 = false, changed = false, singleMatch = true, beginnings = null, start = 0, end = 0, cutoff = -INF) {
  if (!spaces && search.hasSpace) return algorithmSpaces(search, target, partial2);
  let searchCodes = search.lowerCodes;
  let targetCodes = target._targetLowerCodes;
  let searchLen = searchCodes.length;
  let targetLen = targetCodes.length;
  let searchCode = searchCodes[0];
  let searchI = 0;
  let targetI = 0;
  for (; ; ) {
    if (searchCode === targetCodes[targetI]) {
      simpleMatch[searchI] = targetI;
      if (++searchI === searchLen) break;
      searchCode = searchCodes[searchI];
    }
    if (++targetI >= targetLen) return null;
  }
  if (cutoff !== -INF && searchLen > 1 && scoreCeiling(searchLen, targetLen) <= cutoff) return prunedMatch;
  if (searchLen === 1 && !changed && singleMatch) {
    let matchI;
    let strict2;
    if (target._singleMatchCode === searchCode) {
      matchI = target._singleMatchIndex;
      strict2 = target._singleMatchStrict;
    } else if (target._nextBeginningIndexes !== null) {
      let next2 = target._nextBeginningIndexes;
      targetI = simpleMatch[0] === 0 ? 0 : next2[simpleMatch[0] - 1];
      while (targetI < targetLen && searchCode !== targetCodes[targetI]) targetI = next2[targetI];
      strict2 = targetI < targetLen;
      matchI = strict2 ? targetI : simpleMatch[0];
    } else {
      prepareSingleMatch(target, searchCode, simpleMatch[0]);
      matchI = target._singleMatchIndex;
      strict2 = target._singleMatchStrict;
    }
    let resultScore = matchI === 0 ? 0 : -matchI * matchI * 0.2;
    if (!strict2) resultScore *= 1e3;
    else if (target._beginningsLen > 24) resultScore *= (target._beginningsLen - 24) * 10;
    target._score = resultScore - (targetLen - 1);
    target._indexes[0] = matchI;
    target._indexes.len = 1;
    return target;
  }
  searchI = 0;
  let strict = false;
  let strictLen = 0;
  let next = target._nextBeginningIndexes;
  if (beginnings === null && next === null) next = target._nextBeginningIndexes = makeNextBeginnings(target);
  let beginningLen = beginnings === null ? changed ? 0 : target._beginningsLen : end - start;
  if (!beginningLen) {
    beginningLen = 1;
    for (let i = next[0]; i < targetLen; i = next[i]) beginningLen++;
    if (!changed) target._beginningsLen = beginningLen;
  }
  let substringI = searchLen <= 1 ? -1 : target._targetLower.indexOf(search._lower, simpleMatch[0]);
  let isSubstring = substringI !== -1;
  let substringStart = isSubstring && (substringI === 0 || (beginnings ? isBeginning(beginnings, start, end, substringI) : next[substringI - 1] === substringI));
  if (substringStart && substringI === simpleMatch[0]) strict = true;
  else {
    targetI = simpleMatch[0] === 0 ? 0 : beginnings ? nextBeginning(beginnings, start, end, simpleMatch[0] - 1, targetLen) : next[simpleMatch[0] - 1];
    let backtracks = 0;
    if (targetI !== targetLen) for (; ; ) {
      if (targetI >= targetLen) {
        if (searchI <= 0 || ++backtracks > 200) break;
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
      } else targetI = beginnings ? nextBeginning(beginnings, start, end, targetI, targetLen) : next[targetI];
    }
  }
  if (isSubstring && !substringStart) {
    if (beginnings) {
      for (let b = start; b < end; b++) {
        let i = beginnings[b];
        if (i <= substringI) continue;
        let s = 0;
        for (; s < searchLen && searchCodes[s] === targetCodes[i + s]; s++) ;
        if (s === searchLen) {
          substringI = i;
          substringStart = true;
          break;
        }
      }
    } else for (let i = 0; i < next.length; i = next[i]) {
      if (i <= substringI) continue;
      let s = 0;
      for (; s < searchLen && searchCodes[s] === targetCodes[i + s]; s++) ;
      if (s === searchLen) {
        substringI = i;
        substringStart = true;
        break;
      }
    }
  }
  let matches;
  if (!strict) {
    if (isSubstring) for (let i = 0; i < searchLen; i++) simpleMatch[i] = substringI + i;
    matches = simpleMatch;
  } else if (substringStart) {
    for (let i = 0; i < searchLen; i++) simpleMatch[i] = substringI + i;
    matches = simpleMatch;
  } else matches = strictMatch;
  let matchEnd = matches[searchLen - 1] + 1;
  let substringEnd = isSubstring && matchEnd - matches[0] === searchLen && (matchEnd === targetLen || (beginnings ? isBeginning(beginnings, start, end, matchEnd) : next[matchEnd - 1] === matchEnd));
  target._score = calculateScore(matches, searchLen, targetLen, strict, beginningLen, isSubstring, substringStart, substringEnd);
  for (let i = 0; i < searchLen; i++) target._indexes[i] = matches[i];
  target._indexes.len = searchLen;
  return target;
}
function mergePartScores(length) {
  for (let i = 0; i < length; i++) {
    let partial2 = partials[i];
    let best = spaceScores[i];
    if (partial2 > -1e3 && best > -INF) best = Math.max(best, (best + partial2) / 4);
    spaceScores[i] = Math.max(best, partial2);
  }
}
function appendIndexes(indexes, additions) {
  let length = indexes.len;
  outer: for (let i = 0; i < additions.length; i++) {
    let index = additions[i];
    for (let j = 0; j < length; j++) if (indexes[j] === index) continue outer;
    indexes[length++] = index;
  }
  indexes.len = length;
}
function mergeScores(results, length) {
  let total = -INF;
  for (let i = 0; i < length; i++) {
    let score2 = results[i]._score;
    if (score2 > -1e3 && total > -INF) total = Math.max(total, (total + score2) / 4);
    if (score2 > total) total = score2;
  }
  return total;
}
function calculateScore(matches, searchLen, targetLen, strict, beginningLen, substring, substringStart, substringEnd) {
  let score2 = 0;
  let groups = 0;
  for (let i = 1; i < searchLen; i++) if (matches[i] - matches[i - 1] !== 1) {
    score2 -= matches[i];
    groups++;
  }
  let unmatchedDistance = matches[searchLen - 1] - matches[0] - (searchLen - 1);
  score2 -= (12 + unmatchedDistance) * groups;
  if (matches[0] !== 0) score2 -= matches[0] * matches[0] * 0.2;
  if (!strict) score2 *= 1e3;
  else if (beginningLen > 24) score2 *= (beginningLen - 24) * 10;
  let lengthPenalty = (targetLen - searchLen) / 2;
  score2 -= lengthPenalty;
  let substringBonus = 1 + searchLen * searchLen;
  if (substring) score2 /= substringBonus;
  if (substringStart) score2 /= substringBonus;
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
  for (let i = 0; i < searches.length; i++) {
    partials[i] = -INF;
    if (partial2) (partIndexes[i] ||= []).length = 0;
    result = algorithm(searches[i], target, false, false, changesLen !== 0, false);
    if (result === null) {
      if (partial2) continue;
      resetBeginnings(target, changesLen);
      return null;
    }
    matched = true;
    if (i < searches.length - 1) {
      let indexes = result._indexes;
      let consecutive = true;
      for (let j = 0; j < indexes.len - 1; j++) if (indexes[j + 1] - indexes[j] !== 1) {
        consecutive = false;
        break;
      }
      if (consecutive) {
        let beginning = indexes[indexes.len - 1] + 1;
        let previous = target._nextBeginningIndexes[beginning - 1];
        for (let j = beginning - 1; j >= 0 && target._nextBeginningIndexes[j] === previous; j--) {
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
      for (let j = 0; j < indexes.length; j++) indexes[j] = result._indexes[j];
    }
    let partScore = result._score / searches.length;
    score2 += partScore;
    partials[i] = partScore;
    if (result._indexes[0] < previousFirst) score2 -= (previousFirst - result._indexes[0]) * 2;
    previousFirst = result._indexes[0];
    if (!partial2) for (let j = 0; j < result._indexes.len; j++) {
      let index = result._indexes[j];
      if (seenAt[index] === generation) continue;
      seenAt[index] = generation;
      seen[seenLen++] = index;
    }
  }
  if (partial2 && !matched) return null;
  resetBeginnings(target, changesLen);
  if (target._bitflags & SPACE_BIT) {
    let spacedResult = algorithm(search, target, true);
    if (spacedResult !== null && spacedResult._score > score2) {
      if (partial2) {
        let searchFrom = 0;
        for (let i = 0; i < searches.length; i++) {
          partials[i] = spacedResult._score / searches.length;
          let part = searches[i]._lower;
          let searchI = search._lower.indexOf(part, searchFrom);
          let indexes = partIndexes[i];
          indexes.length = part.length;
          for (let j = 0; j < part.length; j++) indexes[j] = spacedResult._indexes[searchI + j];
          searchFrom = searchI + part.length;
        }
        if (spacedResult._score < GOOD_PART_SCORE) spacedResult._indexes.len = 0;
      }
      return spacedResult;
    }
  }
  if (partial2) {
    result = target;
    let targetLower = target._targetLower;
    for (let i = 1; i < searches.length; i++) {
      let previous = partIndexes[i - 1];
      if (!previous.length || !partIndexes[i].length) continue;
      let previousEnd = previous[previous.length - 1] + 1;
      let at = previousEnd;
      let code;
      while ((code = targetLower.charCodeAt(at)) === 32 || code >= 9 && code <= 13) at++;
      let part = searches[i]._lower;
      if (!targetLower.startsWith(part, at)) continue;
      for (let j = previousEnd; j < at; j++) previous.push(j);
      let indexes = partIndexes[i];
      indexes.length = part.length;
      for (let j = 0; j < part.length; j++) indexes[j] = at + j;
    }
    result._indexes.len = 0;
    for (let i = 0; i < searches.length; i++) if (partials[i] * searches.length >= GOOD_PART_SCORE) {
      appendIndexes(result._indexes, partIndexes[i]);
    }
  } else {
    for (let i = 0; i < seenLen; i++) result._indexes[i] = seen[i];
    result._indexes.len = seenLen;
  }
  result._score = score2;
  return result;
}
function resetBeginnings(target, changesLen) {
  for (let i = changesLen - 1; i >= 0; i--) {
    target._nextBeginningIndexes[changes[i * 2]] = changes[i * 2 + 1];
  }
}
var SnapshotTargets = class {
  constructor(targets, options) {
    this._mode = options?.keys ? 2 : options?.key ? 1 : 0;
    this._keys = this._mode === 2 ? options.keys.slice() : [options?.key];
    this._input = targets.slice();
    this._index = 0;
    this._done = false;
    this._error = null;
    this._scheduled = null;
    if (targets.length === 0) this._finish();
    else this._schedule();
  }
  _schedule() {
    if (this._scheduled !== null) return;
    this._scheduled = scheduleTask((deadline) => {
      this._scheduled = null;
      this._run(deadline);
    });
  }
  _cancel() {
    if (this._scheduled !== null) this._scheduled();
    this._scheduled = null;
  }
  _initialize() {
    if (this._targets) return;
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
    if (this._done || this._error) return;
    let end = Date.now() + 4;
    let hasTime = () => deadline && !deadline.didTimeout ? deadline.timeRemaining() > 1 : Date.now() < end;
    try {
      this._initialize();
      do
        this._prepareOne();
      while (this._index < this._input.length && hasTime());
      if (this._index === this._input.length) this._complete();
      else this._schedule();
    } catch (error2) {
      this._error = error2;
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
    for (let k = 0; k < keysLength; k++) {
      let value = mode === 0 ? obj : this._getters[k] === null ? obj[this._keys[k]] : this._getters[k](obj);
      let row = mode === 2 ? i * keysLength + k : i;
      let prepared2 = this._targets[row] = value ? prepTarget(value) : noTarget;
      if (prepared2 !== noTarget) indexBeginnings(prepared2, this._first, row, this._buildingBeginnings);
      this._offsets[row + 1] = this._buildingBeginnings.length;
      bitflags |= prepared2._bitflags;
    }
    if (mode === 2) this._bitflags[i] = bitflags;
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
    for (let bit = 0; bit < 32; bit++) if (bitflags & 1 << bit) candidateBitOffsets[offsetsLen++] = bit * words;
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
    for (let word = 0; word < words; word++) {
      let matches = bits[candidateBitOffsets[0] + word];
      for (let i = 1; i < offsetsLen && matches; i++) matches &= bits[candidateBitOffsets[i] + word];
      if (!fill) {
        rowsLen += bitCount(matches);
        if (rowsLen >= stop) return rowsLen;
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
    if (history.length < 2 || options?.scoreFn || options?.threshold !== void 0) return null;
    let limit = getLimit(options);
    if (limit === INF) return null;
    let current = history[history.length - 1];
    let value = query._lower;
    if (current.query === value && current.limit === limit && current.results) return copyResults(current.results);
    if (value.length >= current.query.length || !current.query.startsWith(value)) return null;
    let i = history.length - 2;
    while (i >= 0 && history[i].query.length > value.length) i--;
    let entry = history[i];
    if (!entry || entry.query !== value || entry.limit !== limit) return null;
    history.length = i + 1;
    if (!entry.results) return null;
    this._resetSearch();
    return copyResults(entry.results);
  }
  _remember(query, results, options) {
    let history = this._history;
    let limit = getLimit(options);
    if (options?.scoreFn || options?.threshold !== void 0 || limit === INF || results.length > 256) {
      history.length = 0;
      return;
    }
    let value = query._lower;
    let last = history[history.length - 1];
    if (last && !value.startsWith(last.query)) history.length = 0;
    else if (last?.query === value && last.limit === limit) history.pop();
    history.push({ query: value, limit, results: value.length <= 32 ? copyResults(results) : null });
  }
  _resetSearch() {
    this._lastQuery = null;
    this._lastRowsLen = this._matchedRowsLen = this._candidateLength = 0;
    this._candidateRows = null;
  }
  _finish() {
    if (this._error) throw this._error;
    if (this._done) return;
    this._cancel();
    try {
      this._initialize();
      while (this._index < this._input.length) this._prepareOne();
      this._complete();
    } catch (error2) {
      this._error = error2;
      this._done = true;
      throw error2;
    }
  }
};
function copyResult(result) {
  if (result === noTarget) return noTarget;
  if (result instanceof KeysResult) {
    let copy2 = result.map(copyResult);
    copy2.obj = result.obj;
    copy2._score = result._score;
    if (result._partWinners) copy2._partWinners = true;
    return copy2;
  }
  let copy = materialize(result, result.obj);
  if (result._bestKeyScore !== void 0) copy._bestKeyScore = result._bestKeyScore;
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
  if (isPrepared(target)) target = target.target;
  else if (typeof target === "number") target = "" + target;
  else if (typeof target !== "string") target = "";
  let info = lowerInfo(target);
  return newResult(target, -INF, null, info._lower, info.lowerCodes, info.bitflags);
}
function prepQuery(search) {
  if (typeof search === "number") search = "" + search;
  else if (typeof search !== "string") search = "";
  search = remapChars(search).trim();
  let info = lowerInfoRemapped(search);
  info.bitflags &= ~SPACE_BIT;
  info.parts = info.hasSpace ? [...new Set(info._lower.split(/\s+/))].map(prepQuery) : [];
  return info;
}
function getPrepared(target) {
  if (target.length > 999) return prepTarget(target);
  let prepared2 = targetCache.get(target);
  if (prepared2 === void 0) targetCache.set(target, prepared2 = prepTarget(target));
  return prepared2;
}
function getQuery(search) {
  if (search.length > 999) return prepQuery(search);
  let prepared2 = searchCache.get(search);
  if (prepared2 === void 0) {
    if (searchCache.size >= 512) searchCache.clear();
    searchCache.set(search, prepared2 = prepQuery(search));
  }
  return prepared2;
}
function scanBeginnings(prepared2, visit) {
  let target = remapChars(prepared2.target);
  let wasUpper = false;
  let wasAlnum = false;
  let count = 0;
  for (let i = 0; i < target.length; i++) {
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
  prepared2._beginningsLen = count;
}
function indexBeginnings(prepared2, firstTable, row, packed) {
  if (prepared2.target.length >= 65535) return;
  let target = remapChars(prepared2.target);
  let lowerCodes = prepared2._targetLowerCodes;
  let offset = row * 26;
  let wasUpper = false;
  let wasAlnum = false;
  let count = 0;
  for (let i = 0; i < target.length; i++) {
    let code = target.charCodeAt(i);
    let upper = code >= 65 && code <= 90;
    let alnum = upper || code >= 97 && code <= 122 || code >= 48 && code <= 57;
    let beginning = upper && !wasUpper || !wasAlnum || !alnum;
    wasUpper = upper;
    wasAlnum = alnum;
    if (!beginning) continue;
    count++;
    packed.push(i);
    code = lowerCodes[i];
    if (code >= 97 && code <= 122) {
      let slot = offset + code - 97;
      if (firstTable[slot] === 0) firstTable[slot] = i + 1;
    }
  }
  prepared2._beginningsLen = count;
}
function prepareSingleMatch(prepared2, searchCode, fallbackIndex) {
  let matchI = fallbackIndex;
  let strict = false;
  scanBeginnings(prepared2, (i) => {
    if (!strict && searchCode === prepared2._targetLowerCodes[i]) {
      matchI = i;
      strict = true;
    }
  });
  prepared2._singleMatchCode = searchCode;
  prepared2._singleMatchIndex = matchI;
  prepared2._singleMatchStrict = strict;
}
function makeBeginnings(prepared2) {
  let beginnings = [];
  scanBeginnings(prepared2, (i) => beginnings.push(i));
  return beginnings;
}
function makeNextBeginnings(prepared2) {
  let next = [];
  let fill = 0;
  scanBeginnings(prepared2, (i) => {
    for (; fill < i; fill++) next[fill] = i;
  });
  for (; fill < prepared2.target.length; fill++) next[fill] = prepared2.target.length;
  return next;
}
function remapCharacter(char) {
  let remapped = remappings[char];
  if (remapped !== void 0) return remapped;
  if (char.charCodeAt(0) < 128) return char;
  remapped = char.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return remapped.length === 1 ? remapped : char;
}
function remapChars(value) {
  if (customAsciiRemappings) return value.replace(/[\s\S]/g, remapCharacter);
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
  for (let i = 0; i < lower.length; i++) {
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
var Result = class {
  get ["indexes"]() {
    return this._indexes.slice(0, this._indexes.len).sort((a, b) => a - b);
  }
  set ["indexes"](value) {
    this._indexes = value;
  }
  ["highlight"](open2, close, threshold) {
    return highlight(this, open2, close, threshold);
  }
  get ["score"]() {
    return normalizeScore(this._score);
  }
};
var KeysResult = class extends Array {
  get ["score"]() {
    return normalizeScore(this._score);
  }
};
function newResult(target, score2 = -INF, obj = null, lower = "", lowerCodes = null, bitflags = 0) {
  let result = new Result();
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
function materialize(prepared2, obj = null) {
  let result = new Result();
  result.target = prepared2.target;
  result.obj = obj;
  result._score = prepared2._score;
  result._indexes = prepared2._indexes;
  return result;
}
function markBestKeyScore(result) {
  let best = -INF;
  for (let i = 0; i < result.length; i++) if (result[i] !== noTarget && result[i]._score > best) best = result[i]._score;
  for (let i = 0; i < result.length; i++) if (result[i] !== noTarget) result[i]._bestKeyScore = best;
  return result;
}
function captureKeysResult(matches, keysLength, obj, score2, partWinners = false) {
  let result = new KeysResult(keysLength);
  for (let k = 0; k < keysLength; k++) result[k] = matches[k];
  result.obj = obj;
  result._score = score2;
  if (partWinners) result._partWinners = true;
  return result;
}
var normalizeScore = (value) => value === -INF ? 0 : value > 1 ? value : Math.E ** (((-value + 1) ** 0.04307 - 1) * -2);
var denormalizeScore = (value) => value === 0 ? -INF : value > 1 ? value : 1 - Math.pow(Math.log(value) / -2 + 1, 1 / 0.04307);
var GOOD_PART_SCORE = denormalizeScore(0.5);
var isPrepared = (value) => typeof value === "object" && typeof value?._bitflags === "number";
function makeGetter(key) {
  if (typeof key === "function") return key;
  let path = Array.isArray(key) ? key : typeof key === "string" && key.includes(".") ? key.split(".") : null;
  if (path === null) return null;
  return (obj) => {
    if (path !== key) {
      let direct = obj[key];
      if (direct !== void 0) return direct;
    }
    for (let i = 0; obj && i < path.length; i++) obj = obj[path[i]];
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
    if (values[middle] < value) start = middle + 1;
    else end = middle;
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
    for (let child = 1; child < length; child = 1 + index * 2) {
      let right = child + 1;
      index = right < length && items[right]._score < items[child]._score ? right : child;
      items[index - 1 >> 1] = items[index];
    }
    for (let parent = index - 1 >> 1; index > 0 && item._score < items[parent]._score; parent = (index = parent) - 1 >> 1) {
      items[index] = items[parent];
    }
    items[index] = item;
  }
  return {
    add(item) {
      let index = length++;
      for (let parent = index - 1 >> 1; index > 0 && item._score < items[parent]._score; parent = (index = parent) - 1 >> 1) {
        items[index] = items[parent];
      }
      items[index] = item;
    },
    poll() {
      if (!length) return;
      let root = items[0];
      let last = items[--length];
      items[length] = void 0;
      if (length) {
        items[0] = last;
        down();
      }
      return root;
    },
    peek() {
      return length ? items[0] : void 0;
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
var targetCache = /* @__PURE__ */ new Map();
var searchCache = /* @__PURE__ */ new Map();
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
var remapFrom = '\\"`\u2018\u2019\u201A\u201B\u201C\u201D\u201E\u201F\xAB\xBB\u2039\u203A\u2010\u2013\u2014\u2212\u2044\u2215\u2026\xF8\xD8\u0142\u0141\u0111\u0110\xF0\xD0\u0131\u0127\u0126\u0167\u0166';
var remapTo = "/''''''''''''''----//.oOlLdDdDihHtT";
for (let i = 0; i < remapFrom.length; i++) remappings[remapFrom[i]] = remapTo[i];
var customAsciiRemappings = false;
var heap = createHeap();
var noTarget = prepTarget("");
var prunedMatch = {};
var fuzzysort_default = { single, go, highlight, score, remap, prepare, snapshot: snapshot2, cleanup };

// ../viewer/src/document/pick.ts
var prepared = /* @__PURE__ */ new WeakMap();
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
  for (const key in left) if (key !== "text" && left[key] !== right[key]) return false;
  for (const key in right) if (key !== "text" && left[key] !== right[key]) return false;
  return true;
}
function appendSpan(target, span3) {
  const previous = target.at(-1);
  if (previous && sameStyle(previous, span3)) {
    previous.text += span3.text;
  } else {
    target.push(span3);
  }
}
function mergeCrossSpanGraphemes(spans) {
  const normalized = [];
  const text = spans.map((span3) => span3.text).join("");
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
  for (const span3 of spans) {
    if (remaining <= 0) {
      break;
    }
    const spanWidth = measureSanitizedTextWidth(span3.text);
    if (spanWidth === 0) {
      appendSpan(sliced, { ...span3 });
      continue;
    }
    if (remainingOffset >= spanWidth) {
      remainingOffset -= spanWidth;
      continue;
    }
    if (remainingOffset === 0 && spanWidth <= remaining) {
      appendSpan(sliced, { ...span3 });
      remaining -= spanWidth;
      usedWidth += spanWidth;
      continue;
    }
    const visible = sliceSanitizedTextByWidth(
      span3.text,
      remainingOffset,
      remaining
    );
    remainingOffset = 0;
    if (visible.text.length === 0) {
      continue;
    }
    const nextSpan = {
      ...span3,
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
  for (const span3 of safeSpans) {
    const spanWidth = measureSimpleSanitizedTextWidth(span3.text);
    simpleSpanWidths.push(spanWidth);
    hasCompositionSensitiveSpan ||= spanWidth === null;
  }
  if (safeSpans.length > 1 && hasCompositionSensitiveSpan) {
    plannedSpans = mergeCrossSpanGraphemes(safeSpans);
    simpleSpanWidths = plannedSpans.map(
      (span3) => measureSimpleSanitizedTextWidth(span3.text)
    );
  }
  for (let spanIndex = 0; spanIndex < plannedSpans.length; spanIndex += 1) {
    const span3 = plannedSpans[spanIndex];
    const simpleSpanWidth = simpleSpanWidths[spanIndex] ?? null;
    const spanWidth = simpleSpanWidth ?? measureSanitizedTextWidth(span3.text);
    if (spanWidth === 0) {
      appendSpan(current, { ...span3 });
      continue;
    }
    if (spanWidth > width * SINGLE_PASS_WRAP_LINE_THRESHOLD || simpleSpanWidth === null || width === 1 && !isPrintableAsciiText(span3.text)) {
      for (const chunk of wrapSanitizedTextByWidth(
        span3.text,
        width,
        remaining,
        current.length > 0
      )) {
        if (chunk.startsNewLine) {
          current = [];
          lines.push(current);
          remaining = width;
        }
        if (chunk.text.length > 0) {
          appendSpan(current, { ...span3, text: chunk.text });
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
      const visible = sliceSanitizedTextByWidth(span3.text, offset, remaining);
      if (visible.width === 0) {
        if (current.length > 0 || remaining < width) {
          current = [];
          lines.push(current);
          remaining = width;
        }
        const forced = sliceSanitizedTextByWidth(span3.text, offset, width);
        if (forced.width === 0) {
          break;
        }
        const nextSpan2 = {
          ...span3,
          text: forced.text
        };
        current.push(nextSpan2);
        offset += forced.width;
        remaining = Math.max(0, width - forced.width);
        continue;
      }
      const nextSpan = {
        ...span3,
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
  const bounds = /* @__PURE__ */ new Set([0, bytes.length]);
  for (const span3 of [...syntax, ...changed]) {
    bounds.add(span3.start_column);
    bounds.add(span3.end_column);
  }
  const sorted = [...bounds].sort((a, b) => a - b);
  const wordBg = side === "left" ? theme.deleteWord : theme.addWord;
  const spans = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const start = sorted[i], end = sorted[i + 1];
    const capture = syntax.filter((s) => s.start_column <= start && s.end_column >= end).sort((a, b) => a.end_column - a.start_column - (b.end_column - b.start_column))[0];
    const emphasized = changed.some((s) => s.start_column <= start && s.end_column >= end);
    spans.push({
      text: decoder.decode(bytes.slice(start, end)),
      fg: capture ? captureColor(capture.capture, theme) : theme.fg,
      bg: emphasized ? wordBg : void 0
    });
  }
  let column = 0;
  return spans.map((span3) => ({
    ...span3,
    text: span3.text.split("	").map((part, index) => {
      const padding = index ? " ".repeat(4 - column % 4) : "";
      column += padding.length + measureTextWidth(part);
      return padding + part;
    }).join("")
  }));
}
var empty = { kind: "empty", sign: " ", spans: [] };
function byLine(spans) {
  const result = /* @__PURE__ */ new Map();
  for (const span3 of spans) result.set(span3.line, [...result.get(span3.line) ?? [], span3]);
  return result;
}
function placeholderRows(fileIndex, label) {
  return [
    { key: `${fileIndex}:load`, fileIndex, label: "Load diff", loadDiff: true },
    { key: `${fileIndex}:why`, fileIndex, label: label || "Hidden by default" }
  ];
}
function rowsForFile(file, fileIndex, layout, theme, collapsed = /* @__PURE__ */ new Set()) {
  const d = file.diff;
  const rows = [{ key: `${fileIndex}:header`, fileIndex, label: filePath(file.file) }];
  if (d.type === "binary")
    return [...rows, { key: `${fileIndex}:binary`, fileIndex, label: "Binary file" }];
  const texts = [sourceLines(d.lhs?.text ?? ""), sourceLines(d.rhs?.text ?? "")];
  const syntax = [byLine(d.lhs?.syntax ?? []), byLine(d.rhs?.syntax ?? [])];
  const { leaves, folds } = flatten(d);
  const hidden = [hiddenLines(folds[0], collapsed), hiddenLines(folds[1], collapsed)];
  const bands = folds.map((side) => collapsedFolds(side, collapsed));
  const quoted = bands.map((sideBands) => {
    const result = /* @__PURE__ */ new Map();
    for (const fold of sideBands.values())
      if (fold.syntax && fold.label.includes("\n") && fold.syntax.start.line < fold.startLine)
        result.set(fold.syntax.start.line, fold);
    return result;
  });
  const isQuoted = (region2) => quoted[region2.side].get(region2.syntax?.start.line ?? -1) === region2;
  const inline = bands.map((sideBands, side) => {
    const result = /* @__PURE__ */ new Map();
    for (const fold of sideBands.values()) {
      if (!fold.syntax || fold.label.includes("\n")) continue;
      sideBands.delete(fold.startLine);
      result.set(fold.syntax.start.line, fold);
      for (let line = fold.syntax.start.line + 1; line <= fold.syntax.end.line; line++) hidden[side].add(line);
    }
    return result;
  });
  const paired = pairedIds(d);
  const headers = [foldHeaders(folds[0], leaves[0], collapsed, paired[0]), foldHeaders(folds[1], leaves[1], collapsed, paired[1])];
  const guides = folds.map((side, index) => {
    const lines = /* @__PURE__ */ new Map();
    for (const fold of side) {
      if (!fold.syntax || collapsed.has(fold.foldStateId)) continue;
      const opener = texts[index][fold.syntax.start.line];
      const column = byteColumn(opener, opener.length - opener.trimStart().length);
      for (let line = fold.syntax.start.line + 1; line <= fold.syntax.end.line; line++)
        lines.set(line, [...lines.get(line) ?? [], { column, id: fold.foldStateId }]);
    }
    return lines;
  });
  const scopes = folds.map((side) => {
    const lines = /* @__PURE__ */ new Map();
    for (const fold of side) {
      if (!fold.syntax || collapsed.has(fold.foldStateId)) continue;
      for (let line = fold.syntax.start.line; line <= fold.syntax.end.line; line++)
        lines.set(line, [...lines.get(line) ?? [], fold]);
    }
    return lines;
  });
  const scopeOf = (side, line) => {
    const around = scopes[side].get(line) ?? [];
    const extent = (fold) => fold.syntax.end.line - fold.syntax.start.line;
    const inner = around.reduce((best, fold) => !best || extent(fold) < extent(best) || extent(fold) === extent(best) && fold.syntax.start.column > best.syntax.start.column ? fold : best, void 0);
    return {
      scope: inner?.foldStateId,
      body: around.filter((fold) => fold.syntax.start.line < line && line < fold.syntax.end.line).map((fold) => fold.foldStateId)
    };
  };
  const quotedEnds = quoted.map((side) => {
    const lines = /* @__PURE__ */ new Map();
    for (const fold of side.values())
      for (const line of [fold.syntax.start.line, fold.syntax.end.line]) lines.set(line, [...lines.get(line) ?? [], fold]);
    return lines;
  });
  const withBraces = (spans, side, line) => {
    let result = spans;
    for (const fold of [...scopes[side].get(line) ?? [], ...quotedEnds[side].get(line) ?? []]) {
      const { start, end } = fold.syntax, text = texts[side][line];
      if (start.line === line && start.column > 0) result = markBrace(result, byteColumn(text, start.column - 1), fold.foldStateId);
      if (end.line === line) result = markBrace(result, byteColumn(text, end.column), fold.foldStateId);
    }
    return result;
  };
  const tintOf = (region2) => foldTint(region2.id, region2.side, paired[region2.side]);
  const labelOf = (region2) => region2.label || lineCount("lastHidden" in region2 ? region2.lastHidden - region2.startLine + 1 : region2.endLine - region2.startLine);
  const isChanged = changedLine(leaves);
  const spanned = new Set(leaves.flat().filter((leaf) => leaf.changed.size).map((leaf) => leaf.alignmentId));
  const collapsedTint = (region2) => {
    const tint = tintOf(region2);
    if (tint !== "neutral") return { tint, note: "" };
    const last = "lastHidden" in region2 ? region2.lastHidden : region2.endLine - 1;
    const inside = leaves[region2.side].filter((leaf) => leaf.endLine > region2.startLine && leaf.startLine <= last);
    let count = 0;
    for (const leaf of inside)
      for (let line = Math.max(leaf.startLine, region2.startLine); line <= Math.min(leaf.endLine - 1, last); line++)
        if (isChanged(leaf, line)) count++;
    if (!count && !inside.some((leaf) => spanned.has(leaf.alignmentId))) return { tint, note: "" };
    return { tint: "modified", note: count ? ` \xB7 ${lineCount(count)} changed` : "" };
  };
  const placeholder = (text, tint) => ({ text, fg: theme.foldPlaceholder, bg: foldBackground(theme, tint) });
  const caches = [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Map()];
  const spansOf = (side, line, leaf) => {
    let spans = caches[side].get(line);
    if (!spans) {
      spans = lineSpans(
        texts[side][line],
        syntax[side].get(line) ?? [],
        leaf.changed.get(line) ?? [],
        side ? "right" : "left",
        theme
      );
      caches[side].set(line, spans);
    }
    return spans;
  };
  const cell = (leaf, line, side) => {
    if (line === null || leaf === null) return empty;
    let spans = withBraces(spansOf(side, line, leaf), side, line);
    let fold = headers[side].get(line);
    const opens = quoted[side].get(line);
    if (opens) fold = { id: opens.foldStateId, label: opens.label, collapsed: true, tint: collapsedTint(opens).tint };
    const folded = inline[side].get(line);
    if (folded) {
      const { start, end } = folded.syntax;
      const closer = texts[side][end.line];
      const suffix = lineSpans(closer, syntax[side].get(end.line) ?? [], [], side ? "right" : "left", theme);
      const label = labelOf(folded).replace(/\n/g, " \xB7 ");
      const { tint, note } = collapsedTint(folded);
      spans = [
        ...sliceSpansWindow(spans, 0, byteColumn(texts[side][line], start.column)).spans,
        placeholder(` \u22EF ${label}${note} `, tint),
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
    for (const row of pendingOld) rows.push(row);
    for (const row of pendingNew) rows.push(row);
    pendingOld = [];
    pendingNew = [];
  };
  const band = (region2) => {
    const { tint, note } = collapsedTint(region2);
    const multiline = region2.label.includes("\n");
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
      const [header2, ...labels2] = region2.label.split("\n").map((text, i) => ({ ...label, spans: lead2(i ? text : `${text}${note}`) }));
      return { header: header2, labels: labels2 };
    }
    const lead = (text) => withGuides([{ text: " ".repeat(region2.parentColumn) }, placeholder(text, tint)], enclosing, theme);
    const header = {
      kind: "context",
      sign: " ",
      band: tint,
      spans: lead(`\u22EF${multiline ? "" : " " + labelOf(region2)}${note}`),
      fold: { id: region2.foldStateId, label: region2.label, collapsed: true, tint },
      ...scopeOf(region2.side, region2.startLine)
    };
    const labels = multiline ? region2.label.split("\n").map((text) => ({ ...label, spans: lead(text) })) : [];
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
    for (let i = 0; i < Math.max(left?.labels.length ?? 0, right?.labels.length ?? 0); i++)
      rows.push({ key: `${key}:label:${i}`, fileIndex, left: left?.labels[i] ?? empty, right: right?.labels[i] ?? empty });
  };
  const emit = (l, r, left, right) => {
    const key = `${fileIndex}:${l ?? "_"}:${r ?? "_"}`;
    const folded = (line, leaf, side) => line === null ? leaf !== null && collapsed.has(leaf.foldStateId) : hidden[side].has(line);
    const [leftFolded, rightFolded] = [folded(l, left, 0), folded(r, right, 1)];
    if (leftFolded) l = null;
    if (rightFolded) r = null;
    if (l === null && r === null) return;
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
      const removed2 = a.kind === "deletion" || !rightFolded;
      pendingOld.push({ key: `${key}:old`, fileIndex, cell: {
        kind: removed2 ? "deletion" : "context",
        sign: removed2 ? "-" : " ",
        oldLineNumber: l + 1,
        fold: a.fold,
        scope: a.scope,
        body: a.body,
        spans: a.spans
      } });
    }
    if (r !== null) {
      const added2 = b.kind === "addition" || !leftFolded;
      pendingNew.push({ key: `${key}:new`, fileIndex, cell: {
        kind: added2 ? "addition" : "context",
        sign: added2 ? "+" : " ",
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
    if (leftFold || rightFold) collapsedRow("fold", leftFold ?? null, rightFold ?? null);
    const leftGap = left && collapsed.has(left.foldStateId) ? left : null;
    const rightGap = right && collapsed.has(right.foldStateId) ? right : null;
    const shown = (gap, side) => gap && !hidden[side].has(gap.startLine) ? gap : null;
    if (shown(leftGap, 0) || shown(rightGap, 1)) collapsedRow("gap", shown(leftGap, 0), shown(rightGap, 1));
    const leftLines = left && !leftGap ? left.endLine - left.startLine : 0;
    const rightLines = right && !rightGap ? right.endLine - right.startLine : 0;
    for (let i = 0; i < Math.max(leftLines, rightLines); i++)
      emit(i < leftLines ? left.startLine + i : null, i < rightLines ? right.startLine + i : null, left, right);
  };
  zipLeaves(leaves, leafRows);
  flush();
  return markHunks(rows);
}
function markHunks(rows) {
  let inHunk = false;
  for (const row of rows) {
    const changed = row.cell ? row.cell.kind !== "context" : row.left !== void 0 && (row.left.kind !== "context" || row.right.kind !== "context");
    if (changed && !inHunk) row.hunkStart = true;
    inHunk = changed;
  }
  return rows;
}
var lineCount = (count) => `${count} line${count === 1 ? "" : "s"}`;
function markBrace(spans, column, id) {
  const at = sliceSpansWindow(spans, column, 1).spans;
  if (!at.length) return spans;
  return [
    ...sliceSpansWindow(spans, 0, column).spans,
    ...at.map((span3) => ({ ...span3, brace: id })),
    ...sliceSpansWindow(spans, column + 1, Infinity).spans
  ];
}
function withGuides(spans, guides, theme) {
  let result = spans;
  for (const { column, id } of guides) {
    const text = result.map((s) => s.text).join("");
    const width = measureTextWidth(text);
    if (width <= column) result = [...result, { text: " ".repeat(column + 1 - width) }];
    const at = sliceSpansWindow(result, column, 1).spans;
    if (!at.every((s) => /^\s*$/.test(s.text))) continue;
    result = [
      ...sliceSpansWindow(result, 0, column).spans,
      { text: "\u2502", fg: theme.guide, guide: id },
      ...sliceSpansWindow(result, column + 1, Infinity).spans
    ];
  }
  return result;
}

// ../viewer/src/viewport/cell.ts
function lightMatches(spans, lit, theme) {
  const ranges = occurrences(spans.map((span3) => span3.text).join(""), lit.pattern);
  if (!ranges.length) return spans;
  const result = [];
  let offset = 0;
  for (const span3 of spans) {
    const end = offset + span3.text.length;
    let cut = offset;
    for (const [nth, [from, to]] of ranges.entries()) {
      if (to <= cut || from >= end) continue;
      const start = Math.max(from, cut), stop = Math.min(to, end), current = nth === lit.current;
      if (start > cut) result.push({ ...span3, text: span3.text.slice(cut - offset, start - offset) });
      result.push({
        ...span3,
        text: span3.text.slice(start - offset, stop - offset),
        lit: true,
        bg: current ? theme.searchCurrent : theme.searchMatch,
        fg: current ? theme.searchCurrentText : span3.fg
      });
      cut = stop;
    }
    if (cut < end) result.push({ ...span3, text: span3.text.slice(cut - offset) });
    offset = end;
  }
  return result;
}
function litRuns(text, fg, bg, lit, theme) {
  const spans = lit ? lightMatches([{ text, fg, bg }], lit, theme) : [{ text, fg, bg }];
  return spans.map((span3) => ({ text: span3.text, fg: span3.fg ?? fg, bg: span3.bg ?? bg }));
}
var viewedBox = (viewed) => viewed ? "[\u2713]" : "[ ]";
var viewedHint = (viewed) => ` ${viewed ? "Unmark viewed" : "Mark as viewed"} \xB7 V `;
function chevron(fold) {
  if (!fold) return " ";
  return fold.collapsed ? "\u25B8" : "\u25BE";
}
function planCell(value, spans, width, unified, { theme, geometry, visualLine, focus, selected = false, read = false }) {
  const fold = value.fold;
  const washed = focus?.armed && value.body?.includes(focus.id);
  const changed = value.kind === "addition" || value.kind === "deletion";
  const bg = selected ? theme.selection : value.kind === "addition" ? read ? theme.readAddition : theme.addition : value.kind === "deletion" ? read ? theme.readDeletion : theme.deletion : washed ? theme.focusWash : theme.bg;
  if (read && changed) spans = spans.map((span3) => span3.lit ? span3 : { ...span3, fg: theme.muted, bg: void 0 });
  const digits = geometry.gutter - 4;
  const number3 = (n) => `${visualLine ? "" : n ?? ""}`.padStart(digits);
  const numbers = unified ? ` ${number3(value.oldLineNumber)} ${number3(value.newLineNumber)} ` : ` ${number3("lineNumber" in value ? value.lineNumber : void 0)} `;
  const gutterWidth = unified ? geometry.unifiedGutter : geometry.gutter;
  const available = Math.max(1, width - gutterWidth);
  const used = Math.min(available, spans.reduce((n, s) => n + measureTextWidth(s.text), 0));
  const rest = available - used;
  const painted = value.band && rest > 0 ? [...spans, {
    text: (value.fold ? "  " + "\u2504".repeat(rest) : " ".repeat(rest)).slice(0, rest),
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
  for (const span3 of painted) {
    const rail = span3.guide !== void 0 && span3.guide === focus?.id;
    const brace = span3.brace !== void 0 && span3.brace === focus?.id;
    const text2 = rail && focus.armed ? span3.text.replace(/│/g, "\u2503") : span3.text;
    const cells = measureTextWidth(text2);
    runs.push({
      text: text2,
      fg: rail || brace ? theme.accent : span3.fg ?? theme.fg,
      bg: brace && focus.armed ? theme.focusBrace : selected ? bg : span3.bg ?? bg
    });
    if (span3.guide !== void 0) {
      hits.push([column, column + cells, span3.guide]);
      hovers.push([column, column + cells, { id: span3.guide, armed: true }]);
    }
    column += cells;
  }
  if (column < width) runs.push({ text: " ".repeat(width - column), fg: theme.fg, bg });
  const text = runs.map((run) => run.text).join("");
  const padding = hits.map(([from, to, id]) => [
    from > 0 && sliceTextByWidth(text, from - 1, 1).text === " " ? from - 1 : from,
    to < width && sliceTextByWidth(text, to, 1).text === " " ? to + 1 : to,
    id
  ]);
  hits.push(...padding);
  hovers.push(...padding.map(([from, to, id]) => [from, to, { id, armed: true }]));
  const opens = fold?.collapsed ? fold.id : value.labelOf;
  if (opens !== void 0) {
    hits.push([codeColumn, width, opens]);
    hovers.push([codeColumn, width, { id: opens, armed: true }]);
  }
  if (value.scope !== void 0) hovers.push([0, width, { id: value.scope, armed: false }]);
  return { bg, runs, hits, hovers };
}

// ../viewer/src/viewport/geometry.ts
function measureRows(rows, width, wrap, horizontalOffset, maxLine) {
  const digits = String(maxLine).length;
  const gutter = digits + 4, unifiedGutter = digits * 2 + 5;
  const leftWidth = Math.floor((width - 1) / 2), rightWidth = width - leftWidth - 1;
  const measure = (spans, available) => {
    if (!spans) return [];
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
    if (rows[mid].top + rows[mid].height > top) end = mid;
    else start = mid + 1;
  }
  end = start;
  while (end < rows.length && rows[end].top < bottom) end++;
  return rows.slice(start, end);
}
function sourceLine(row, side) {
  return side === "right" ? row.right?.lineNumber ?? row.cell?.newLineNumber : row.left?.lineNumber ?? row.cell?.oldLineNumber;
}
var rowFold = (row) => row.cell?.fold ?? row.right?.fold ?? row.left?.fold;
function positionAt(geometry, top) {
  const item = visibleRows(geometry, top, 1)[0];
  if (!item) return null;
  const row = item.row, right = sourceLine(row, "right");
  return {
    key: row.key,
    fileIndex: row.fileIndex,
    offset: top - item.top,
    fold: rowFold(row)?.id,
    side: right === void 0 ? "left" : "right",
    line: right ?? sourceLine(row, "left")
  };
}
function positionTop(geometry, position) {
  if (!position) return 0;
  const at = (row) => row.top + Math.min(position.offset, row.height - 1);
  const same = geometry.rows.find((r) => r.row.key === position.key);
  if (same) return at(same);
  const file = geometry.rows.filter((r) => r.row.fileIndex === position.fileIndex);
  const folded = position.fold !== void 0 && file.find((r) => [r.row.left?.fold?.id, r.row.right?.fold?.id, r.row.cell?.fold?.id].includes(position.fold));
  if (folded) return at(folded);
  const line = position.line;
  const next = line !== void 0 && file.find((r) => (sourceLine(r.row, position.side) ?? -1) >= line);
  return (next || file[0]).top;
}

// ../viewer/src/viewer.ts
var Viewer = class {
  /** `splitColumns`: the narrowest diff column `auto` lays out split. */
  constructor(store, theme, splitColumns) {
    this.store = store;
    this.theme = theme;
    this.splitColumns = splitColumns;
    store.subscribe(() => this.emit());
  }
  store;
  theme;
  splitColumns;
  mode = "auto";
  wrap = false;
  position = null;
  horizontal = 0;
  hover = null;
  closed = /* @__PURE__ */ new Map();
  collapsed = /* @__PURE__ */ new Map();
  pendingZ = false;
  pendingBracket = null;
  viewed = /* @__PURE__ */ new Set();
  prompt = null;
  search = null;
  promptCount;
  picker = null;
  openRows = /* @__PURE__ */ new WeakMap();
  rowCache = /* @__PURE__ */ new WeakMap();
  /** Bumped when rows change; keys the geometry cache. */
  revision = 0;
  measured;
  size;
  listeners = /* @__PURE__ */ new Set();
  /** Bumped by every change, for `useSyncExternalStore`. */
  version = 0;
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
    return this.pendingZ || this.pendingBracket !== null;
  }
  isClosed(index, file) {
    return this.closed.get(index) ?? fileVisibility(file).collapsed;
  }
  foldsOf(index, diff2) {
    return this.collapsed.get(index) ?? defaultCollapsed(diff2);
  }
  fileOrder(snapshot3) {
    return flattenFileTree(buildFileTree(snapshot3.inventory), /* @__PURE__ */ new Set()).flatMap(({ node: node2 }) => node2.fileIndex === void 0 ? [] : [node2.fileIndex]);
  }
  documentRows(snapshot3, layout) {
    const { inventory, files, failures } = snapshot3;
    const perFile = this.fileOrder(snapshot3).map((index) => {
      const file = files[index];
      if (!file) {
        const failure2 = failures[index];
        const status = failure2 ?? (snapshot3.complete ? "File did not load" : "Computing diff\u2026");
        return [
          { key: `${index}:header`, fileIndex: index, label: filePath(inventory[index].file) },
          ...["", status, "", ""].map((label, line) => ({
            key: `${index}:pending:${line}`,
            fileIndex: index,
            label,
            pending: line === 1 && !failure2 && !snapshot3.complete
          }))
        ];
      }
      const folds = file.diff.type === "text" ? this.foldsOf(index, file.diff) : /* @__PURE__ */ new Set();
      const key = `${index}:${layout}:${this.theme.name}:${[...folds].sort((a, b) => a - b).join(",")}`;
      let cached2 = this.rowCache.get(file);
      if (cached2?.key !== key) {
        cached2 = { key, rows: rowsForFile(file, index, layout, this.theme, folds) };
        this.rowCache.set(file, cached2);
      }
      if (!this.isClosed(index, file)) return cached2.rows;
      return fileVisibility(file).collapsed ? [cached2.rows[0], ...placeholderRows(index, fileVisibility(file).label)] : cached2.rows.slice(0, 1);
    });
    const all2 = [];
    for (const fileRows of perFile) {
      const last = all2.at(-1);
      if (last && !last.key.endsWith(":header") && last.label !== "")
        all2.push({ key: `${last.fileIndex}:end`, fileIndex: last.fileIndex, label: "" });
      for (const row of fileRows) all2.push(row);
    }
    for (const [i, error2] of snapshot3.errors.entries())
      all2.push({ key: `error:${i}`, fileIndex: -1, label: error2 });
    return all2;
  }
  lay(size) {
    this.size = size;
    const snapshot3 = this.snapshot;
    const contentWidth = size.columns, viewportHeight = size.rows;
    const layout = this.mode === "auto" ? contentWidth >= this.splitColumns ? "split" : "unified" : this.mode;
    const lit = this.lit();
    const key = `${this.revision}:${layout}:${contentWidth}:${this.wrap}:${this.horizontal}:${lit ? JSON.stringify(lit) : ""}`;
    if (this.measured?.key !== key || this.measured.snapshot !== snapshot3) {
      const rows2 = lit ? this.lightRows(this.documentRows(snapshot3, layout), lit) : this.documentRows(snapshot3, layout);
      const maxLine = Math.max(1, ...snapshot3.files.flatMap((file) => file?.diff.type === "text" ? [file.diff.lhs, file.diff.rhs].map((source2) => source2 ? sourceLines(source2.text).length : 0) : []));
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
    if (!this.size) throw new Error("The viewer has not been laid out yet");
    return this.lay(this.size);
  }
  scrollTo(value) {
    const at = this.current();
    this.position = positionAt(at.geometry, Math.max(0, Math.min(at.maxScroll, value)));
    this.emit();
  }
  /** Relative to the latest position, so key repeats within one frame add up. */
  move(amount) {
    this.scrollTo(this.current().top + amount);
  }
  scrub(row) {
    const at = this.current();
    this.scrollTo(Math.round(Math.max(0, Math.min(1, row / Math.max(1, at.size.rows - 1))) * at.maxScroll));
  }
  jump(index) {
    const row = this.current().geometry.rows.find((r) => r.row.fileIndex === index);
    if (!row) throw new Error(`File ${index} has no rows`);
    this.scrollTo(row.top);
  }
  toggleFile(index) {
    const file = this.snapshot.files[index];
    if (!file) return;
    this.setClosed(index, !this.isClosed(index, file));
    this.reshape();
  }
  setClosed(index, closed) {
    const at = this.current();
    const header = at.geometry.rows.find((r) => r.row.key === `${index}:header`);
    if (header.top < at.top) this.position = { key: header.row.key, fileIndex: index, offset: 0, side: "right" };
    this.closed.set(index, closed);
  }
  /** Undefined when the file shows no changed lines. */
  isViewed(index) {
    const diff2 = this.snapshot.files[index]?.diff;
    const markable = diff2?.type === "text" && diff2.stats.visible.added + diff2.stats.visible.removed > 0;
    return markable ? this.viewed.has(index) : void 0;
  }
  viewedFiles() {
    let viewed = 0, total = 0;
    this.snapshot.files.forEach((_, index) => {
      const state = this.isViewed(index);
      if (state === void 0) return;
      total++;
      if (state) viewed++;
    });
    return { viewed, total };
  }
  toggleViewedFile(index) {
    const state = this.isViewed(index);
    if (state === void 0) return;
    if (state) this.viewed.delete(index);
    else this.viewed.add(index);
    this.setClosed(index, !state);
    this.reshape();
  }
  cancel() {
    if (this.prompt === null && !this.picker && !this.pendingZ && !this.pendingBracket) return;
    this.prompt = null;
    this.picker = null;
    this.pendingZ = false;
    this.pendingBracket = null;
    this.emit();
  }
  get picking() {
    return this.picker !== null;
  }
  pickerState() {
    if (!this.picker) return void 0;
    const { inventory } = this.snapshot;
    const picks = rankFiles(inventory, this.fileOrder(this.snapshot), this.picker.query, (index) => this.isViewed(index) === true);
    return { query: this.picker.query, cursor: Math.min(this.picker.cursor, Math.max(0, picks.length - 1)), picks, total: inventory.length };
  }
  pickFile(index) {
    this.picker = null;
    const file = this.snapshot.files[index];
    if (file && this.isClosed(index, file)) {
      this.closed.set(index, false);
      this.revision++;
    }
    this.jump(index);
  }
  typePicker(key) {
    const picker = this.picker, name = key.key;
    if (name === "escape" || key.ctrl && (name === "c" || name === "g")) this.picker = null;
    else if (name === "return" || name === "enter") {
      const state = this.pickerState(), pick2 = state.picks[state.cursor];
      if (pick2) return this.pickFile(pick2.fileIndex);
      this.picker = null;
    } else if (name === "up" || key.ctrl && name === "p") picker.cursor = Math.max(0, picker.cursor - 1);
    else if (name === "down" || key.ctrl && name === "n") picker.cursor += 1;
    else if (name === "backspace") this.picker = { query: picker.query.slice(0, -1), cursor: 0 };
    else if (!key.ctrl && !key.meta) {
      const text = name === "space" ? " " : name;
      if ([...text].length !== 1) return;
      this.picker = { query: picker.query + text, cursor: 0 };
    } else return;
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
    if (!this.search) return void 0;
    const { pattern, matches, at } = this.search;
    return { pattern, at: at + 1, total: matches.length, files: new Set(matches.map((match) => match.fileIndex)).size };
  }
  lit() {
    const pattern = this.prompt ?? this.search?.pattern;
    if (!pattern) return void 0;
    return { pattern, on: this.prompt === null && this.search ? this.search.matches[this.search.at] : void 0 };
  }
  litFor(lit, fileIndex, key, side) {
    const { on } = lit;
    return { pattern: lit.pattern, current: on && on.fileIndex === fileIndex && on.key === key && on.side === side ? on.nth : void 0 };
  }
  headerLit(fileIndex) {
    const lit = this.lit();
    return lit && this.litFor(lit, fileIndex, `${fileIndex}:header`, "right");
  }
  lightRows(rows, lit) {
    const light2 = (cell, fileIndex, key, side) => {
      if (!cell) return cell;
      const spans = lightMatches(cell.spans, this.litFor(lit, fileIndex, key, side), this.theme);
      return spans === cell.spans ? cell : { ...cell, spans };
    };
    return rows.map((row) => {
      if (row.cell) {
        const cell = light2(row.cell, row.fileIndex, row.key, row.cell.newLineNumber === void 0 ? "left" : "right");
        return cell === row.cell ? row : { ...row, cell };
      }
      const left = light2(row.left, row.fileIndex, row.key, "left"), right = light2(row.right, row.fileIndex, row.key, "right");
      return left === row.left && right === row.right ? row : { ...row, left, right };
    });
  }
  allOpenRows(index, file, layout) {
    let cached2 = this.openRows.get(file);
    if (cached2?.layout !== layout) {
      cached2 = { layout, rows: rowsForFile(file, index, layout, this.theme, /* @__PURE__ */ new Set()) };
      this.openRows.set(file, cached2);
    }
    return cached2.rows;
  }
  findMatches(pattern) {
    const { files, inventory } = this.snapshot;
    const layout = this.current().layout;
    const matches = [];
    for (const index of this.fileOrder(this.snapshot)) {
      occurrences(filePath(inventory[index].file), pattern).forEach((_, nth) => matches.push({ fileIndex: index, key: `${index}:header`, side: "right", nth }));
      const file = files[index];
      if (!file) continue;
      for (const row of this.allOpenRows(index, file, layout)) {
        const cells = row.cell ? [[row.cell.newLineNumber === void 0 ? "left" : "right", row.cell, row.cell.newLineNumber ?? row.cell.oldLineNumber]] : [["left", row.left, row.left?.lineNumber], ["right", row.right, row.right?.lineNumber]];
        for (const [side, cell, line] of cells) {
          if (!cell || line === void 0) continue;
          occurrences(cell.spans.map((span3) => span3.text).join(""), pattern).forEach((_, nth) => matches.push({ fileIndex: index, key: row.key, side, line, nth }));
        }
      }
    }
    return matches;
  }
  placeOf(order, layout, fileIndex, key, side, line) {
    const file = this.snapshot.files[fileIndex];
    const rows = file ? this.allOpenRows(fileIndex, file, layout) : [];
    const lineOf = (row2) => side === "left" ? row2.left?.lineNumber ?? row2.cell?.oldLineNumber : row2.right?.lineNumber ?? row2.cell?.newLineNumber;
    let row = rows.findIndex((r) => r.key === key);
    if (row < 0 && line !== void 0) row = rows.findIndex((r) => (lineOf(r) ?? -1) >= line);
    return order.indexOf(fileIndex) * 1e7 + Math.max(0, row);
  }
  commitSearch(pattern) {
    this.prompt = null;
    if (!pattern) return this.emit();
    const snapshot3 = this.snapshot, matches = this.findMatches(pattern);
    this.search = { pattern, matches, at: -1, snapshot: snapshot3 };
    if (!matches.length) return this.emit();
    const at = this.current(), top = positionAt(at.geometry, at.top);
    const order = this.fileOrder(snapshot3);
    const from = top ? this.placeOf(order, at.layout, top.fileIndex, top.key, top.side, top.line) : 0;
    const next = matches.findIndex((match) => this.placeOf(order, at.layout, match.fileIndex, match.key, match.side, match.line) >= from);
    this.search.at = next < 0 ? 0 : next;
    this.goTo(matches[this.search.at]);
  }
  /** Also searches files that streamed in since the search. */
  stepMatch(direction) {
    const search = this.search;
    if (!search) return;
    if (search.snapshot !== this.snapshot) {
      const on = search.matches[search.at];
      search.matches = this.findMatches(search.pattern);
      search.snapshot = this.snapshot;
      search.at = on ? search.matches.findIndex((m) => m.fileIndex === on.fileIndex && m.key === on.key && m.side === on.side && m.nth === on.nth) : -1;
    }
    const total = search.matches.length;
    if (!total) return this.emit();
    search.at = (search.at + direction + total) % total;
    this.goTo(search.matches[search.at]);
  }
  goTo(match) {
    const file = this.snapshot.files[match.fileIndex];
    if (file && match.line !== void 0) {
      if (this.isClosed(match.fileIndex, file)) this.closed.set(match.fileIndex, false);
      if (file.diff.type === "text") {
        const hiding = hidingIds(file.diff, match.side === "left" ? 0 : 1, match.line - 1, this.foldsOf(match.fileIndex, file.diff));
        if (hiding.length) this.setFolds(match.fileIndex, file.diff, hiding, false);
      }
    }
    this.position = { key: match.key, fileIndex: match.fileIndex, offset: 0, side: match.side, line: match.line };
    this.reshape();
  }
  type(key) {
    const name = key.key, prompt = this.prompt;
    if (name === "return" || name === "enter") return this.commitSearch(prompt);
    if (name === "escape" || key.ctrl && (name === "c" || name === "g")) this.prompt = null;
    else if (name === "backspace") this.prompt = prompt ? prompt.slice(0, -1) : null;
    else if (!key.ctrl && !key.meta) {
      const text = name === "space" ? " " : name;
      if ([...text].length !== 1) return;
      this.prompt = prompt + text;
    } else return;
    this.emit();
  }
  /** "toggle" reads the first id's state, so quick repeated clicks alternate. */
  setFolds(fileIndex, diff2, ids, collapse) {
    const next = new Set(this.foldsOf(fileIndex, diff2));
    const close = collapse === "toggle" ? !next.has(ids[0]) : collapse;
    for (const id of ids) if (close) next.add(id);
    else next.delete(id);
    this.collapsed.set(fileIndex, next);
  }
  /** Recursive commands (Alt-click, zC, zO, zA) include every fold nested inside. */
  setFold(fileIndex, id, collapse, recursive2) {
    const diff2 = this.snapshot.files[fileIndex]?.diff;
    if (diff2?.type !== "text") throw new Error(`File ${fileIndex} has no folds`);
    this.setFolds(fileIndex, diff2, recursive2 ? [id, ...nestedIds(diff2, id)] : [id], collapse);
    this.reshape();
  }
  textDiffs() {
    return this.snapshot.files.flatMap((file, index) => file?.diff.type === "text" ? [{ index, diff: file.diff }] : []);
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
    if (target) this.scrollTo(target.top);
  }
  navigateHunk(direction) {
    this.navigate(direction, (row) => !!row.hunkStart);
  }
  navigateFold(direction) {
    this.navigate(direction, (row) => !!rowFold(row));
  }
  foldCommand(command) {
    if (command === "R") return this.foldAll(false);
    if (command === "M") return this.foldAll(true);
    if (command === "j") return this.navigateFold(1);
    if (command === "k") return this.navigateFold(-1);
    const at = this.current();
    const current = visibleRows(at.geometry, at.top, 1)[0]?.row;
    const fold = current && rowFold(current);
    if (!current || !fold) return;
    const recursive2 = command === command.toUpperCase();
    const letter = command.toLowerCase();
    if (letter === "a") this.setFold(current.fileIndex, fold.id, "toggle", recursive2);
    else if (letter === "o") this.setFold(current.fileIndex, fold.id, false, recursive2);
    else if (letter === "c") this.setFold(current.fileIndex, fold.id, true, recursive2);
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
  /** `t` swaps between the two bundled defaults; a configured theme is left by the first press. */
  toggleTheme() {
    this.setTheme(this.theme.isLight ? dark : light);
  }
  pan(columns) {
    this.horizontal = Math.max(0, this.horizontal + columns);
    this.emit();
  }
  setHover(hover2) {
    if (JSON.stringify(hover2) === JSON.stringify(this.hover)) return;
    this.hover = hover2;
    this.emit();
  }
  toggleTopFile() {
    const at = this.current();
    const current = visibleRows(at.geometry, at.top, 1)[0];
    if (current && current.row.fileIndex >= 0) this.toggleFile(current.row.fileIndex);
  }
  /** Returns false for keys the frontend handles. */
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
      if (!key.ctrl && !key.meta && name.length === 1 && "aocAOCRMjk".includes(name)) this.foldCommand(name);
      return true;
    }
    if (this.pendingBracket) {
      const bracket = this.pendingBracket;
      this.pendingBracket = null;
      if (!key.ctrl && !key.meta && name === "c") this.navigateHunk(bracket === "]" ? 1 : -1);
      return true;
    }
    if ((key.meta || key.ctrl) && name === "p") {
      this.picker = { query: "", cursor: 0 };
      this.emit();
      return true;
    }
    if (key.meta) return false;
    if (key.ctrl) {
      if (name === "d") this.move(half);
      else if (name === "u") this.move(-half);
      else if (name === "f") this.move(page);
      else if (name === "b") this.move(-page);
      else return false;
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
      case "[":
        this.pendingBracket = name;
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
        if (at.currentFile >= 0) this.toggleViewedFile(at.currentFile);
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
};

// ../viewer/src/viewport/picker.ts
function exactly(runs, width, bg) {
  const result = [];
  let room = width;
  for (const run of runs) {
    if (room <= 0) break;
    const cells = measureTextWidth(run.text);
    result.push(cells <= room ? run : { ...run, text: sliceTextByWidth(run.text, 0, room).text });
    room -= Math.min(cells, room);
  }
  if (room > 0) result.push({ text: " ".repeat(room), fg: bg, bg });
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
    const right = read ? [{ text: "\u2713 ", fg: theme.accent, bg: rowBg }] : tally ? [{ text: `+${tally.added} `, fg: theme.addedText, bg: rowBg }, { text: `\u2212${tally.removed} `, fg: theme.removedText, bg: rowBg }] : [{ text: " ", fg: rowBg, bg: rowBg }];
    const rightWidth = right.reduce((n, run) => n + measureTextWidth(run.text), 0);
    const room2 = Math.max(1, width - 2 - rightWidth - 1);
    let path = sanitizeTerminalLine(pick2.path), shift = 0;
    if (measureTextWidth(path) > room2) {
      shift = path.length - (room2 - 1);
      path = `\u2026${path.slice(shift)}`;
      shift -= 1;
    }
    const matched = new Set(pick2.indexes.map((index) => index - shift));
    const nameStart = path.lastIndexOf("/") + 1;
    const runs = [{ text: cursor ? "\u25B8 " : "  ", fg: theme.accent, bg: rowBg }];
    [...path].forEach((char, index) => {
      const fg = matched.has(index) ? theme.accent : read ? theme.muted : index < nameStart ? theme.fileHeaderDir : theme.fg;
      const bold = matched.has(index) && !read;
      const last = runs.at(-1);
      if (last.fg === fg && !!last.bold === bold && runs.length > 1) last.text += char;
      else runs.push({ text: char, fg, bg: rowBg, bold });
    });
    const used = runs.reduce((n, run) => n + measureTextWidth(run.text), 0);
    runs.push({ text: " ".repeat(Math.max(0, width - used - rightWidth)), fg: rowBg, bg: rowBg }, ...right);
    lines.push({ runs: exactly(runs, width, rowBg), pick: pick2.fileIndex });
  }
  const hint = `enter open \xB7 \u2191\u2193 or ctrl-n/p move \xB7 ${closeHint} `;
  const typed = [
    { text: "\u203A ", fg: theme.accent, bg },
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
  if (!selection) return [-1, -1];
  const a = rows.findIndex((r) => r.key === selection.anchor), b = rows.findIndex((r) => r.key === selection.end);
  return a < 0 || b < 0 ? [-1, -1] : [Math.min(a, b), Math.max(a, b)];
}
function selectionCover(rows, selection) {
  const [a, b] = selectionBounds(rows, selection);
  if (!selection || a < 0) return () => void 0;
  const anchor2 = rows.findIndex((r) => r.key === selection.anchor), end = rows.findIndex((r) => r.key === selection.end);
  const position = (index, side) => index * 2 + (side === "right" ? 1 : 0);
  const ends = [position(anchor2, selection.anchorSide), position(end, selection.endSide)];
  const [first, last] = [Math.min(...ends), Math.max(...ends)];
  const oneColumn = selection.anchorSide === selection.endSide ? selection.anchorSide : void 0;
  return (index) => {
    if (index < a || index > b) return void 0;
    if (rows[index].cell) return { left: true, right: true };
    if (oneColumn) return { left: oneColumn === "left", right: oneColumn === "right" };
    return {
      left: position(index, "left") >= first && position(index, "left") <= last,
      right: position(index, "right") >= first && position(index, "right") <= last
    };
  };
}
var orders = /* @__PURE__ */ new WeakMap();
function orderOf(diff2) {
  let order = orders.get(diff2);
  if (!order) {
    order = diffOrder(diff2);
    orders.set(diff2, order);
  }
  return order;
}
var textDiff = (files, fileIndex) => {
  const diff2 = files[fileIndex]?.diff;
  if (diff2?.type !== "text") throw new Error(`File ${fileIndex} has no text to select`);
  return diff2;
};
function selectedRanges(files, rows, selection) {
  const [a, b] = selectionBounds(rows, selection);
  if (a < 0) return [];
  const cover = selectionCover(rows, selection);
  const oneColumn = selection.anchorSide === selection.endSide && !rows[a].cell ? selection.anchorSide === "left" ? "old" : "new" : void 0;
  const touched = /* @__PURE__ */ new Map();
  for (let index = a; index <= b; index++) {
    const row = rows[index], covered = cover(index);
    if (!covered) continue;
    const old = row.cell ? row.cell.oldLineNumber : covered.left ? row.left?.lineNumber : void 0;
    const neu = row.cell ? row.cell.newLineNumber : covered.right ? row.right?.lineNumber : void 0;
    if (old === void 0 && neu === void 0) continue;
    let numbers = touched.get(row.fileIndex);
    if (!numbers) touched.set(row.fileIndex, numbers = { old: /* @__PURE__ */ new Set(), new: /* @__PURE__ */ new Set() });
    if (old !== void 0) numbers.old.add(old);
    if (neu !== void 0) numbers.new.add(neu);
  }
  const ranges = [];
  for (const [fileIndex, numbers] of touched) {
    let lines;
    if (oneColumn) lines = [...numbers[oneColumn]].sort((x, y) => x - y).map((n) => oneColumn === "old" ? { old: n } : { new: n });
    else {
      const order = orderOf(textDiff(files, fileIndex));
      const at = (map, n) => {
        const index = map.get(n);
        if (index === void 0) throw new Error(`Line ${n} of file ${fileIndex} is missing from its diff's order`);
        return index;
      };
      const indices = /* @__PURE__ */ new Set([...[...numbers.old].map((n) => at(order.oldAt, n)), ...[...numbers.new].map((n) => at(order.newAt, n))]);
      lines = [...indices].sort((x, y) => x - y).map((index) => order.lines[index]);
    }
    if (!lines.length) continue;
    const file = files[fileIndex];
    ranges.push({
      fileIndex,
      oldPath: file?.file.lhs?.path,
      newPath: file?.file.rhs?.path,
      start: lines[0],
      end: lines.at(-1),
      side: oneColumn,
      lines
    });
  }
  return ranges;
}
function span2(range, side) {
  const numbers = range.lines.flatMap((line) => line[side] ?? []);
  return numbers.length ? [numbers[0], numbers.at(-1)] : void 0;
}
var removed = (line) => line.new === void 0;
var added = (line) => line.old === void 0;
function rangeName(range) {
  const both = !range.side && range.lines.some(removed) && range.lines.some(added);
  const side = range.side ?? (both ? void 0 : range.lines.some(removed) ? "old" : "new");
  const path = side === "old" ? range.oldPath : range.newPath ?? range.oldPath;
  if (side) {
    const [first, last] = span2(range, side);
    const letter = side === "old" ? "L" : "R";
    return `${path}:${letter}${first}${first === last ? "" : `-${last}`}`;
  }
  return `${path}:L${span2(range, "old")[0]}-R${span2(range, "new")[1]}`;
}
function lineCount2(range) {
  if (!range.side) return range.lines.length;
  const [first, last] = span2(range, range.side);
  return last - first + 1;
}
function selectionLead(message, ranges, width) {
  const count = ranges.reduce((sum, range) => sum + lineCount2(range), 0);
  const lead = (what) => ` ${message ? `${message} \xB7 ` : ""}${what} \xB7 ${count} ${count === 1 ? "line" : "lines"} `;
  if (ranges.length !== 1) return lead(`${ranges.length} files`);
  const name = rangeName(ranges[0]);
  const whole = lead(name);
  if (measureTextWidth(whole) <= width) return whole;
  const colon = name.lastIndexOf(":");
  return lead(`${name.slice(0, colon).split("/").at(-1)}${name.slice(colon)}`);
}
function sourcesOf(files, range) {
  const diff2 = files[range.fileIndex]?.diff;
  if (diff2?.type !== "text") throw new Error(`File ${range.fileIndex} has no text to copy`);
  return {
    old: diff2.lhs ? sourceLines(diff2.lhs.text) : [],
    new: diff2.rhs ? sourceLines(diff2.rhs.text) : [],
    oldTerminated: diff2.lhs?.text.endsWith("\n") ?? true,
    newTerminated: diff2.rhs?.text.endsWith("\n") ?? true
  };
}
function patch(range, order, sources) {
  const oldPath = `a/${range.oldPath ?? range.newPath}`;
  const newPath = `b/${range.newPath ?? range.oldPath}`;
  const quote = (path) => /["\\\t\r\n]/.test(path) ? JSON.stringify(path) : path;
  const out = [
    `diff --git ${quote(oldPath)} ${quote(newPath)}`,
    `--- ${range.oldPath === void 0 ? "/dev/null" : quote(oldPath)}`,
    `+++ ${range.newPath === void 0 ? "/dev/null" : quote(newPath)}`
  ];
  const indexOf = (line) => line.old !== void 0 ? order.oldAt.get(line.old) : order.newAt.get(line.new);
  const hunks = [];
  const indices = range.side ? (() => {
    const [first, last] = span2(range, range.side);
    const at = range.side === "old" ? order.oldAt : order.newAt;
    return Array.from({ length: last - first + 1 }, (_, i) => at.get(first + i));
  })() : range.lines.map(indexOf);
  for (const index of indices) {
    const hunk = hunks.at(-1);
    if (hunk && hunk.at(-1) === index - 1) hunk.push(index);
    else hunks.push([index]);
  }
  for (const hunk of hunks) {
    const lines = hunk.map((index) => order.lines[index]);
    const side = (key) => {
      const numbers = lines.flatMap((line) => line[key] ?? []);
      const start = numbers[0] ?? (key === "old" ? order.oldBefore : order.newBefore)[hunk[0]];
      return numbers.length === 1 ? `${start}` : `${start},${numbers.length}`;
    };
    out.push(`@@ -${side("old")} +${side("new")} @@`);
    for (const line of lines) {
      const [before, after] = [
        line.old === void 0 ? void 0 : sources.old[line.old - 1],
        line.new === void 0 ? void 0 : sources.new[line.new - 1]
      ];
      const emit = (prefix, text, side2) => {
        out.push(`${prefix}${text}`);
        if (line[side2] === sources[side2].length && !sources[`${side2}Terminated`]) out.push("\\ No newline at end of file");
      };
      const sameEnding = (line.old === sources.old.length && !sources.oldTerminated) === (line.new === sources.new.length && !sources.newTerminated);
      if (before !== void 0 && before === after && sameEnding) emit(" ", after, "new");
      else {
        if (before !== void 0) emit("-", before, "old");
        if (after !== void 0) emit("+", after, "new");
      }
    }
  }
  return out.join("\n") + "\n";
}
function snapshotIdentity(snapshot3) {
  switch (snapshot3.type) {
    case "revision":
      return snapshot3.rev;
    case "index":
      return "index (staged)";
    case "working_tree":
      return "working tree (uncommitted)";
    case "path":
      return `path ${JSON.stringify(snapshot3.path)}`;
    case "empty_tree":
      return "empty tree";
  }
}
function rangeReference(files, comparison, range) {
  const body = patch(range, orderOf(textDiff(files, range.fileIndex)), sourcesOf(files, range));
  const { lhs, rhs } = files[range.fileIndex].file;
  const oid = /^[0-9a-f]+$/i;
  const old = lhs?.oid ?? "0".repeat(rhs?.oid.length ?? 40);
  const neu = rhs?.oid ?? "0".repeat(lhs?.oid.length ?? 40);
  const mode = lhs?.mode === rhs?.mode ? ` ${lhs.mode}` : "";
  const headers = oid.test(old) && oid.test(neu) ? `index ${old}..${neu}${mode}
` : "";
  const firstLine = body.indexOf("\n") + 1;
  return `Base: ${snapshotIdentity(comparison.lhs)}
Head: ${snapshotIdentity(comparison.rhs)}

` + body.slice(0, firstLine) + headers + body.slice(firstLine);
}
function agentReference(files, comparison, rows, selection) {
  return selectedRanges(files, rows, selection).map((range) => rangeReference(files, comparison, range)).join("\n");
}
function copySelection(files, rows, selection) {
  return selectedRanges(files, rows, selection).flatMap((range) => {
    const sources = sourcesOf(files, range);
    const side = range.lines.some((line) => line.new !== void 0) ? "new" : "old";
    return range.lines.flatMap((line) => line[side] === void 0 ? [] : [sources[side][line[side] - 1]]);
  }).join("\n");
}

// src/paint.ts
var fit = (text, width) => sliceTextByWidth(text, 0, width).text;
var Colors = class {
  list = [];
  index = /* @__PURE__ */ new Map();
  of(color) {
    let at = this.index.get(color);
    if (at === void 0) {
      at = this.list.push(color) - 1;
      this.index.set(color, at);
    }
    return at;
  }
};
var LineBuilder = class {
  constructor(colors, bg) {
    this.colors = colors;
    this.bg = bg;
  }
  colors;
  bg;
  segments = [];
  hits = [];
  hovers = [];
  width = 0;
  text(text, fg, bg = this.bg, bold = false) {
    if (!text) return this;
    const segment = [text, this.colors.of(fg), this.colors.of(bg)];
    if (bold) segment.push(1);
    const last = this.segments.at(-1);
    if (last && last[1] === segment[1] && last[2] === segment[2] && last[3] === segment[3]) last[0] += text;
    else this.segments.push(segment);
    this.width += measureTextWidth(text);
    return this;
  }
  fill(to, bg = this.bg) {
    return to > this.width ? this.text(" ".repeat(to - this.width), bg, bg) : this;
  }
  hit(from, to, act) {
    if (to > from) this.hits.push([from, to, act]);
    return this;
  }
  hover(from, to, hover2) {
    if (to > from) this.hovers.push([from, to, hover2]);
    return this;
  }
  cut(width) {
    let room = width;
    const segments = [];
    for (const segment of this.segments) {
      if (room <= 0) break;
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
    if (this.hits.length) line.hits = this.hits;
    if (this.hovers.length) line.hovers = this.hovers;
    return line;
  }
};
function paintCell(line, value, spans, width, unified, { fileIndex, ...options }) {
  const start = line.width;
  const plan = planCell(value, spans, width, unified, options);
  for (const run of plan.runs) line.text(run.text, run.fg, run.bg);
  for (const [from, to, id] of plan.hits) line.hit(start + from, start + to, { fold: id, file: fileIndex });
  for (const [from, to, focus] of plan.hovers) line.hover(start + from, start + to, { file: fileIndex, ...focus });
}

// src/frame.ts
var SPINNER = "\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F";
var KEYS = [
  ["j k \xB7 d u \xB7 space b", "scroll a line, half a page, a page"],
  ["g G", "first file, last line"],
  ["h l \xB7 H L", "pan sideways, faster"],
  ["[c ]c", "previous, next change"],
  ["za zo zc \xB7 zA zO zC", "toggle, open, close the top fold; deep"],
  ["zM zR \xB7 zj zk", "fold all, unfold all; next, previous fold"],
  ["c", "show or hide unchanged context"],
  ["/ \xB7 n N", "search; next, previous match"],
  ["ctrl-p \xB7 \u2318P", "go to a changed file"],
  ["\\ \xB7 \u2318B \xB7 \u2630 files", "the file tree"],
  ["V \xB7 a header's box", "mark a file viewed"],
  ["drag \xB7 y \xB7 Y", "select lines; copy them; copy them for an agent"],
  ["enter \xB7 \u2318L", "add the selected lines to the chat"],
  ["s \xB7 w \xB7 t", "split or unified; wrap; theme"],
  ["?", "this list"],
  ["q", "close the pane"]
];
var KEYS_BUTTON = " ? keys ";
var CHAT_BUTTON = " Add to chat \xB7 enter ";
var SPLIT_COLUMNS = 180;
var TREE_MIN_COLUMNS = 120;
var Pane = class {
  constructor(store, theme) {
    this.store = store;
    this.theme = theme;
    this.viewer = new Viewer(store, theme, SPLIT_COLUMNS);
  }
  store;
  theme;
  viewer;
  message = "";
  size;
  /** Undefined until toggled: then the width decides. */
  showTree;
  closedDirectories = /* @__PURE__ */ new Set();
  treeScroll = 0;
  /** The tree re-follows only when the current file changes, so scrolling the tree sticks. */
  treeFollows;
  selection = null;
  /** A press on code started the selection, so a drag moves its end; a click on anything else stops that. */
  selecting = false;
  /** The code row on each frame line of the last frame, and which side a column falls on. */
  cellsAt = /* @__PURE__ */ new Map();
  /** The key list, shown in place of the diff. */
  helpView = false;
  /** A narrow pane showing the tree in place of the diff. */
  filesView = false;
  /** The tree row the tree that took the pane is on. */
  treeCursor = 0;
  subscribe(listener) {
    return this.viewer.subscribe(listener);
  }
  hover(hover2) {
    this.viewer.setHover(hover2);
  }
  /** What an input asks of the hooks module beyond a redraw: to close the pane, or to copy text. */
  input(input2) {
    if ("act" in input2 && "chat" in input2.act) return this.chat();
    if ("act" in input2) this.act(input2.act, input2.alt === true);
    else if ("select" in input2) this.select(input2.select);
    else return this.press(input2.press);
    return {};
  }
  /**
   * The pane lost the keyboard. Escape never reaches it, only takes the focus away, so this is
   * where Escape closes whatever was open: the search prompt, the picker, the key list, the tree.
   */
  blur() {
    this.viewer.cancel();
    this.selection = null;
    this.helpView = false;
    this.filesView = false;
  }
  /** Says how a copy the pane asked for went; `refusal` is the clipboard's reason when it did not. */
  copied(what, refusal) {
    this.message = refusal ? `Not copied: ${refusal}` : `Copied ${what}`;
  }
  /** Says how putting ranges in the prompt box went; `refusal` is why the box did not take them. */
  chatted(names, refusal) {
    this.message = refusal ? `Not added to the chat: ${refusal}` : `Added ${names.join(", ")} to the chat`;
  }
  /** A press on a code line starts a selection on its side; a drag moves the selection's end. */
  select({ x, y, extend: extend2 }) {
    const cell = this.cellsAt.get(y);
    if (!extend2) {
      this.selecting = !!cell;
      this.selection = cell ? { anchor: cell.key, anchorSide: cell.side(x), end: cell.key, endSide: cell.side(x) } : null;
    } else if (this.selecting && this.selection && cell) this.selection = { ...this.selection, end: cell.key, endSide: cell.side(x) };
  }
  /** `recursive`: an Alt-click. */
  act(action2, recursive2) {
    this.message = "";
    this.selecting = false;
    if ("fold" in action2) this.viewer.setFold(action2.file, action2.fold, "toggle", recursive2);
    else if ("viewedFile" in action2) this.viewer.toggleViewedFile(action2.viewedFile);
    else if ("file" in action2) this.viewer.toggleFile(action2.file);
    else if ("jump" in action2) this.goToFile(action2.jump);
    else if ("dir" in action2) this.toggleDirectory(action2.dir);
    else if ("scrub" in action2) this.viewer.scrub(action2.scrub);
    else if ("files" in action2) this.toggleFiles();
    else if ("pick" in action2) this.viewer.pickFile(action2.pick);
    else if ("help" in action2) this.helpView = !this.helpView;
    else if ("layout" in action2) this.viewer.toggleLayout();
    else throw new Error(`The pane does not act on ${JSON.stringify(action2)} here`);
  }
  press(key) {
    if (this.viewer.prompting || this.viewer.picking) {
      this.viewer.press(key);
      return {};
    }
    const plain = !key.ctrl && !key.meta;
    if (plain && key.key === "q") return { close: true };
    this.message = "";
    if (this.helpView) {
      this.helpView = false;
      return {};
    }
    if (plain && key.key === "?") {
      this.helpView = true;
      return {};
    }
    if (!this.size) throw new Error("The pane has not been drawn yet");
    const files = plain && key.key === "\\" || key.meta && key.key === "b";
    if (this.filesView) {
      if (files) this.toggleFiles();
      else this.pressFiles(key.key);
      return {};
    }
    if (plain && (key.key === "y" || key.key === "Y")) return this.copy(key.key === "Y");
    if (this.selection && (plain && (key.key === "return" || key.key === "enter") || key.meta && key.key === "l"))
      return this.chat();
    if (files) this.toggleFiles();
    else {
      const chord = this.viewer.chording;
      this.viewer.press(key);
      if (!chord && plain && (key.key === "s" || key.key === "c")) this.selection = null;
    }
    return {};
  }
  /** Too narrow for a sidebar: the tree takes the whole pane instead. */
  narrow(size) {
    return size.columns < TREE_MIN_COLUMNS;
  }
  treeRows() {
    return flattenFileTree(buildFileTree(this.store.getSnapshot().inventory), this.closedDirectories);
  }
  /** The files key or button: in a narrow pane, swap the diff for the tree and back; otherwise show or hide the sidebar. */
  toggleFiles() {
    if (!this.size) throw new Error("The pane has not been drawn yet");
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
  /** A key in the tree that took the pane: move, open a directory or go to a file. */
  pressFiles(name) {
    const rows = this.treeRows();
    if (name === "j" || name === "down") this.treeCursor = Math.min(rows.length - 1, this.treeCursor + 1);
    else if (name === "k" || name === "up") this.treeCursor = Math.max(0, this.treeCursor - 1);
    else if (name === "return" || name === "enter") {
      const node2 = rows[this.treeCursor]?.node;
      if (!node2) return;
      if (node2.fileIndex === void 0) this.toggleDirectory(node2.key);
      else this.goToFile(node2.fileIndex);
    }
  }
  toggleDirectory(key) {
    if (this.closedDirectories.has(key)) this.closedDirectories.delete(key);
    else this.closedDirectories.add(key);
  }
  /** Goes to a file from the tree; a tree that took the pane gives it back to the diff. */
  goToFile(index) {
    this.viewer.jump(index);
    this.filesView = false;
  }
  /** `y` copies the selected lines as they are; `Y` as a reference an agent can read. */
  copy(forAgent) {
    if (!this.selection) {
      this.message = "Drag across lines to select them first";
      return {};
    }
    const { snapshot: snapshot3, rows } = this.viewer.lay(this.layoutSize(this.size));
    if (!snapshot3.comparison) throw new Error("A selection exists before diffr named the comparison");
    const text = forAgent ? agentReference(snapshot3.files, snapshot3.comparison, rows, this.selection) : copySelection(snapshot3.files, rows, this.selection);
    if (!text) {
      this.message = "The selection holds no source lines";
      return {};
    }
    return { copy: { text, what: forAgent ? "for agent" : "source lines" } };
  }
  /** The selected ranges, for the prompt box; the selection is done with once they are on their way. */
  chat() {
    if (!this.selection) {
      this.message = "Drag across lines to select them first";
      return {};
    }
    const { snapshot: snapshot3, rows } = this.viewer.lay(this.layoutSize(this.size));
    const { comparison } = snapshot3;
    if (!comparison) throw new Error("A selection exists before diffr named the comparison");
    const ranges = selectedRanges(snapshot3.files, rows, this.selection);
    if (!ranges.length) {
      this.message = "The selection holds no source lines";
      return {};
    }
    this.selection = null;
    this.selecting = false;
    return { chat: ranges.map((range) => ({ name: rangeName(range), context: rangeReference(snapshot3.files, comparison, range) })) };
  }
  /** `wheelColumn` is undefined for the pane's scroll keys. */
  scroll(by, wheelColumn) {
    if (this.filesView) return this.pressFiles(by < 0 ? "up" : "down");
    if (wheelColumn === void 0) return this.viewer.move(by);
    if (!this.size) throw new Error("The pane has not been drawn yet");
    if (wheelColumn >= this.sidebar(this.size)) return this.viewer.move(by * 3);
    const treeRows = flattenFileTree(buildFileTree(this.store.getSnapshot().inventory), this.closedDirectories);
    this.treeScroll = Math.max(0, Math.min(Math.max(0, treeRows.length - this.bodyRows(this.size)), this.treeScroll + by * 3));
  }
  /** Includes the divider; 0 when hidden, as it always is in a narrow pane. */
  sidebar(size) {
    return !this.narrow(size) && (this.showTree ?? true) ? Math.max(16, Math.min(28, size.columns - 40)) : 0;
  }
  /** The title bar and the status line take a row each. */
  bodyRows(size) {
    return Math.max(1, size.rows - 2);
  }
  /** The diff column the viewer lays out: the tree and the scrollbar's last column are not in it. */
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
    const colors = new Colors();
    const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length];
    const statusGlyph = (index) => failures[index] || snapshot3.complete ? "!" : spinner;
    const treeMark = (index) => viewer.isViewed(index) ? "\u2713" : " ";
    const counts = files.map((file) => file && lineCounts2(file));
    const title = new LineBuilder(colors, theme.chrome);
    const loaded = counts.filter((c) => c !== void 0);
    const visible = loaded.reduce((sum, c) => add(sum, c.visible), zero);
    const button = " \u2630 files ";
    title.hit(0, measureTextWidth(button), { files: true }).text(button, this.filesView ? theme.bg : theme.accent, this.filesView ? theme.accent : theme.chrome);
    title.text(` ${snapshot3.comparison ? comparisonLabel(snapshot3.comparison.lhs, snapshot3.comparison.rhs) : "diffr"}`, theme.fg).text(` \xB7 ${inventory.length} files \xB7 `, theme.muted).text(`+${visible.added}`, theme.addedText).text(` \u2212${visible.removed}`, theme.removedText).text(snapshot3.complete ? " " : "\u2026 ", theme.muted);
    for (const block of blockBar(visible))
      title.text(block === "neutral" ? "\u25A1" : "\u25A0", block === "added" ? theme.addedText : block === "removed" ? theme.removedText : theme.muted);
    const badge = `${horizontal ? `  \u21E0 col ${horizontal + 1}` : ""}  ${layout} [s] `;
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
      const file = files[fileIndex], count = counts[fileIndex]?.visible;
      const path = sanitizeTerminalLine(filePath(inventory[fileIndex].file));
      const shown = !!file && !!count;
      const start = line.width;
      const state = shown ? viewer.isViewed(fileIndex) : void 0, viewed = state === true;
      const tally = shown && !viewed ? [` +${count.added}`, ` \u2212${count.removed}`] : [];
      const box = state === void 0 ? "" : ` ${viewedBox(state)}`;
      const hint = state !== void 0 && hover2 && "header" in hover2 && hover2.file === fileIndex ? viewedHint(state) : "";
      const statsWidth = shown ? measureTextWidth(tally.join("") + (hint && ` ${hint}`) + box) + 1 : 0;
      const pathWidth = Math.max(1, contentWidth - statsWidth - 1);
      const glyph = shown ? viewer.isClosed(fileIndex, file) ? "\u25B8" : "\u25BE" : statusGlyph(fileIndex);
      const directory = fit(`${glyph} ${path.slice(0, path.lastIndexOf("/") + 1)}`, pathWidth);
      const name = fit(path.slice(path.lastIndexOf("/") + 1), Math.max(0, pathWidth - measureTextWidth(directory)));
      const lit = viewer.headerLit(fileIndex);
      line.text("\u258C", viewed ? theme.muted : theme.accent, theme.fileHeader);
      for (const run of litRuns(directory, viewed ? theme.muted : theme.fileHeaderDir, theme.fileHeader, lit, theme))
        line.text(run.text, run.fg, run.bg);
      for (const run of litRuns(name, viewed ? theme.muted : shown ? theme.fg : theme.fileHeaderDir, theme.fileHeader, lit, theme))
        line.text(run.text, run.fg, run.bg, !viewed);
      line.fill(start + 1 + pathWidth, theme.fileHeader);
      if (tally.length) line.text(tally[0], theme.addedText, theme.fileHeader).text(tally[1], theme.removedText, theme.fileHeader);
      if (hint) line.text(" ", theme.fg, theme.fileHeader).text(hint, theme.bg, theme.accent);
      if (state !== void 0) {
        line.hit(line.width, line.width + measureTextWidth(box), { viewedFile: fileIndex });
        line.hover(line.width, line.width + measureTextWidth(box), { file: fileIndex, header: true });
        line.text(box, viewed ? theme.accent : theme.fg, theme.fileHeader);
      }
      line.fill(start + contentWidth, theme.fileHeader);
      if (shown) line.hit(start, start + contentWidth, { file: fileIndex });
    };
    this.cellsAt.clear();
    const rowIndex = new Map(at.rows.map((row, index) => [row.key, index]));
    const cover = selectionCover(at.rows, this.selection);
    const body = [];
    for (const measured of viewport) {
      const row = measured.row;
      for (let visualLine = Math.max(0, top - measured.top); visualLine < measured.height && measured.top + visualLine < top + viewportHeight - (sticky ? 1 : 0); visualLine++) {
        if (row.key.endsWith(":header")) body.push((line) => fileHeader(line, row.fileIndex));
        else if (row.label !== void 0)
          body.push((line) => {
            const start = line.width;
            const label = row.pending ? `    ${spinner} ${row.label}` : row.loadDiff ? `    ${row.label}` : row.label;
            line.text(fit(sanitizeTerminalLine(label), contentWidth), row.loadDiff ? theme.accent : theme.muted, theme.bg);
            if (row.loadDiff) line.hit(start, start + contentWidth, { file: row.fileIndex });
            line.fill(start + contentWidth, theme.bg);
          });
        else
          body.push((line, y) => {
            const focus = hover2?.file === row.fileIndex && "id" in hover2 ? hover2 : void 0;
            const paint = { theme, geometry, fileIndex: row.fileIndex, visualLine, focus, read: viewer.isViewed(row.fileIndex) === true };
            const selected2 = cover(rowIndex.get(row.key));
            if (row.cell) {
              const side = row.cell.newLineNumber === void 0 ? "left" : "right";
              this.cellsAt.set(y + 1, { key: row.key, side: () => side });
              paintCell(
                line,
                row.cell,
                measured.cell[visualLine] ?? [],
                geometry.leftWidth + geometry.rightWidth + 1,
                true,
                { ...paint, selected: selected2 !== void 0 }
              );
            } else {
              paintCell(
                line,
                row.left,
                measured.left[visualLine] ?? [],
                geometry.leftWidth,
                false,
                { ...paint, selected: selected2?.left === true }
              );
              const divider = line.width;
              this.cellsAt.set(y + 1, { key: row.key, side: (x) => x < divider ? "left" : "right" });
              line.text("\u2502", theme.muted, theme.bg);
              paintCell(
                line,
                row.right,
                measured.right[visualLine] ?? [],
                geometry.rightWidth,
                false,
                { ...paint, selected: selected2?.right === true }
              );
            }
          });
      }
    }
    if (currentFile >= 0 && sticky) body.unshift((line) => fileHeader(line, currentFile));
    if (!body.length)
      body.push((line) => line.text(snapshot3.complete ? "No changed files" : `${spinner} Starting comparison\u2026`, theme.muted, theme.bg));
    if (this.helpView) {
      const keyWidth = Math.max(...KEYS.map(([keys]) => measureTextWidth(keys))) + 4;
      for (let y = 0; y < viewportHeight; y++) {
        const line = new LineBuilder(colors, theme.bg), entry = KEYS[y];
        line.hit(0, size.columns, { help: true });
        if (entry) line.text(`  ${entry[0]}`, theme.accent).fill(keyWidth).text(entry[1], theme.fg);
        lines.push(line.line(size.columns));
      }
    } else if (this.filesView) {
      this.treeCursor = Math.min(this.treeCursor, Math.max(0, treeRows.length - 1));
      this.treeScroll = this.treeCursor < this.treeScroll ? this.treeCursor : this.treeCursor >= this.treeScroll + viewportHeight ? this.treeCursor - viewportHeight + 1 : this.treeScroll;
      for (let y = 0; y < viewportHeight; y++) {
        const line = new LineBuilder(colors, theme.bg), index = this.treeScroll + y, entry = treeRows[index];
        if (entry) {
          const { node: node2, depth } = entry, file = node2.fileIndex;
          const cursor = index === this.treeCursor, bg = cursor ? theme.highlight : theme.bg;
          const read2 = file !== void 0 && viewer.isViewed(file) === true;
          const count = file === void 0 || read2 ? void 0 : counts[file]?.visible;
          const tally = count ? [` +${count.added}`, ` \u2212${count.removed} `] : [" "];
          const label = "  ".repeat(depth) + (file === void 0 ? this.closedDirectories.has(node2.key) ? "\u25B8 " : "\u25BE " : `${files[file] ? treeMark(file) : statusGlyph(file)} `) + node2.name;
          const width = size.columns - 2 - measureTextWidth(tally.join(""));
          line.text(cursor ? "\u25B8 " : "  ", theme.accent, bg).text(
            fit(sanitizeTerminalLine(label), width),
            file === currentFile ? theme.accent : file === void 0 || read2 ? theme.muted : theme.fg,
            bg,
            file === currentFile
          ).fill(2 + width, bg);
          if (count) line.text(tally[0], theme.addedText, bg).text(tally[1], theme.removedText, bg);
          line.fill(size.columns, bg);
          line.hit(0, size.columns, file === void 0 ? { dir: node2.key } : { jump: file });
        }
        lines.push(line.line(size.columns));
      }
    }
    for (let y = 0; y < (this.filesView || this.helpView ? 0 : viewportHeight); y++) {
      const line = new LineBuilder(colors, theme.bg);
      if (sidebar > 0) {
        const entry = treeRows[treeTop + y];
        if (entry) {
          const { node: node2, depth } = entry;
          const current = node2.fileIndex === currentFile;
          const label = "  ".repeat(depth) + (node2.fileIndex === void 0 ? this.closedDirectories.has(node2.key) ? "\u25B8 " : "\u25BE " : `\u25A4 ${files[node2.fileIndex] ? treeMark(node2.fileIndex) : statusGlyph(node2.fileIndex)} `) + node2.name;
          const read2 = node2.fileIndex !== void 0 && viewer.isViewed(node2.fileIndex) === true;
          line.text(
            fit(sanitizeTerminalLine(label), sidebar - 1),
            current ? theme.accent : node2.fileIndex === void 0 || read2 ? theme.muted : theme.fg,
            current ? theme.highlight : theme.bg
          );
          line.fill(sidebar - 1, current ? theme.highlight : theme.bg);
          line.hit(0, sidebar - 1, node2.fileIndex === void 0 ? { dir: node2.key } : { jump: node2.fileIndex });
        }
        line.fill(sidebar - 1).text("\u2502", theme.muted);
      }
      body[y]?.(line, y);
      line.fill(sidebar + contentWidth);
      const onThumb = y >= thumb.top && y < thumb.top + thumb.height;
      line.hit(line.width, line.width + 1, { scrub: y }).text(" ", theme.muted, onThumb ? theme.muted : theme.bg);
      lines.push(line.line(size.columns));
    }
    const picker = viewer.pickerState();
    if (picker) {
      const drawn = pickerLines(
        picker,
        size.columns,
        Math.min(10, viewportHeight),
        theme,
        (index) => counts[index]?.visible,
        (index) => viewer.isViewed(index) === true,
        "ctrl-c close"
      );
      lines.splice(lines.length - drawn.length, drawn.length, ...drawn.map(({ runs, pick: pick2 }) => {
        const line = new LineBuilder(colors, theme.chrome);
        if (pick2 !== void 0) line.hit(0, size.columns, { pick: pick2 });
        for (const run of runs) line.text(run.text, run.fg, run.bg, run.bold);
        return line.line(size.columns);
      }));
    }
    const status = new LineBuilder(colors, theme.bg);
    const errors = snapshot3.errors.length ? `${snapshot3.errors.length} errors  ` : "";
    const read = viewer.viewedFiles();
    const found = viewer.searchState();
    const selected = this.selection && !this.filesView && !this.helpView ? selectedRanges(files, at.rows, this.selection) : [];
    if (found && "prompt" in found)
      status.text(fit(`/${found.prompt}\u258F \xB7 ${found.count} matches \xB7 enter go \xB7 ctrl-c cancel`, size.columns), theme.fg);
    else if (selected.length) {
      const button2 = measureTextWidth(CHAT_BUTTON);
      const lead = fit(selectionLead(this.message, selected, size.columns - button2), Math.max(0, size.columns - button2));
      status.text(lead, theme.bg, theme.accent, true);
      const from = measureTextWidth(lead);
      status.hit(from, from + button2, { chat: true }).text(CHAT_BUTTON, theme.accent, theme.bg, true);
      const room = size.columns - from - button2;
      const hints = " esc clear";
      if (room > 0) status.text(measureTextWidth(hints) > room ? `${fit(hints, room - 1)}\u2026` : hints, theme.bg, theme.accent).fill(size.columns, theme.accent);
    } else {
      const searched = !found ? "" : `/${found.pattern} \xB7 ${found.total ? `match ${found.at} of ${found.total} in ${found.files} files \xB7 n/N` : "no matches"} \xB7 `;
      const order = flattenFileTree(buildFileTree(inventory), /* @__PURE__ */ new Set()).flatMap(({ node: node2 }) => node2.fileIndex === void 0 ? [] : [node2.fileIndex]);
      const name = inventory[currentFile] ? filePath(inventory[currentFile].file).split("/").at(-1) : void 0;
      const where = name === void 0 ? "" : `${name} \xB7 file ${order.indexOf(currentFile) + 1} of ${order.length} \xB7 ${at.maxScroll ? Math.round(top / at.maxScroll * 100) : 100}% \xB7 `;
      const loading = snapshot3.complete ? "" : `${snapshot3.loaded}/${inventory.length} loaded\u2026 `;
      const keys = this.filesView ? " j/k move \xB7 enter open \xB7 \\ or \u2318B back" : " h/l pan \xB7 / search \xB7 ctrl-p files \xB7 \\ or \u2318B tree \xB7 V viewed \xB7 drag selects \xB7 y/Y copy";
      const room = size.columns - measureTextWidth(KEYS_BUTTON);
      const text = `${this.message ? `${this.message} \xB7 ` : ""}${searched}${this.filesView ? "" : where}${read.viewed}/${read.total} viewed ${loading}${errors}${keys}`;
      status.text(measureTextWidth(text) > room ? `${fit(text, room - 1)}\u2026` : text, theme.muted).fill(room);
      status.hit(room, size.columns, { help: true }).text(KEYS_BUTTON, this.helpView ? theme.bg : theme.accent, this.helpView ? theme.accent : theme.bg);
    }
    lines.push(status.line(size.columns));
    return { colors: colors.list, fg: colors.of(theme.fg), lines, hover: hover2 };
  }
};

// src/register.tsx
var PANE = "diffr";
var TOOL = "mcp__diffr__open";
var MINIMUM = [0, 1, 18];
var INSTALL = "curl -fsSL https://install.dev.fast/diffr | sh";
var BAND = 16;
async function loadTheme($, binary) {
  const shown = await $.process.run([binary, "config", "show", "--json"]);
  if (shown.exitCode !== 0) throw new Error(shown.stderr || `${binary} config show exited with status ${shown.exitCode}`);
  const config2 = themeConfig(JSON.parse(shown.stdout));
  return config2.path ? paletteFromHelix(parseHelixTheme(await $.fs.read(config2.path), config2.path)) : loadBundledTheme(config2.name);
}
async function checkVersion($, binary) {
  let shown;
  try {
    shown = await $.process.run([binary, "--version"]);
  } catch (error2) {
    const reason = error2 instanceof Error ? error2.message : String(error2);
    throw new Error(`${binary} could not run (${reason}). If diffr is installed, run \`diffr config init\` in a terminal so this plugin finds it; otherwise install diffr with: ${INSTALL}`);
  }
  if (shown.exitCode !== 0) throw new Error(shown.stderr || `${binary} --version exited with status ${shown.exitCode}`);
  const match = /^diffr (\d+)\.(\d+)\.(\d+)/.exec(shown.stdout);
  if (!match) throw new Error(`${binary} --version printed ${JSON.stringify(shown.stdout)}, not a diffr version, which looks like "diffr ${MINIMUM.join(".")}"`);
  const version2 = match.slice(1).map(Number);
  const older = version2.findIndex((part, i) => part !== MINIMUM[i]);
  if (older >= 0 && version2[older] < MINIMUM[older])
    throw new Error(`This plugin needs diffr ${MINIMUM.join(".")} or newer, not ${version2.join(".")}; update it with: diffr upgrade`);
}
function check($, binary, checked) {
  return checked.promise ??= checkVersion($, binary).catch((error2) => {
    checked.promise = void 0;
    throw error2;
  });
}
function toolArgs(input2) {
  const args = input2.args ?? [];
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string"))
    throw new Error("args must be a list of strings: revisions or paths, as diffr takes them");
  return args;
}
function summary(args, store) {
  const snapshot3 = store.getSnapshot();
  const shown = `diffr${args.length ? ` ${args.join(" ")}` : ""}`;
  if (!snapshot3.comparison) throw new Error(`${shown} failed: ${snapshot3.errors.join("; ") || "it named no comparison"}`);
  const files = snapshot3.inventory.length;
  return `Opened ${shown} in a pane for the person: ${files} changed ${files === 1 ? "file" : "files"}.`;
}
function named(store, streamed) {
  return new Promise((resolve) => {
    const stop = store.subscribe(() => {
      if (store.getSnapshot().comparison) done();
    });
    const done = () => {
      stop();
      resolve();
    };
    if (store.getSnapshot().comparison) done();
    void streamed.then(done);
  });
}
async function startDiffr($, binary, previous, args) {
  const theme = await loadTheme($, binary);
  void previous?.return({ code: null, signal: null });
  const store = new DiffStore();
  const pane = new Pane(store, theme);
  pane.subscribe(() => $.ui.invalidate("ui.render"));
  const child = $.process.spawn({ argv: [binary, "--format", "ndjson", "--syntax", ...args] });
  return { pane, child, store, streamed: pump(store, child) };
}
async function pump(store, child) {
  let stderr = "";
  async function* stdout() {
    for await (const chunk of child) {
      if (chunk.stream === "stdout") yield chunk.text;
      else stderr = (stderr + chunk.text).slice(-16384);
    }
  }
  try {
    for await (const event of parseDiffEvents(stdout())) store.accept(event);
  } catch (error2) {
    store.fail(stderr ? `${error2}
${stderr}` : error2);
  }
}
function chipRuns(text, names, theme) {
  return names.flatMap((name) => occurrencesOf(text, name).map((start) => ({ start, end: start + name.length, color: theme.bg, backgroundColor: theme.accent, bold: true })));
}
function occurrencesOf(text, name) {
  const starts = [];
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + name.length)) starts.push(at);
  return starts;
}
function register(on, options) {
  const binary = options.diffr;
  if (typeof binary !== "string") throw new Error(`The diffr option must be a string, not ${typeof binary}`);
  let pane;
  let child;
  let focused = false;
  let opened = { title: "diffr" };
  const chips = /* @__PURE__ */ new Map();
  const acks = /* @__PURE__ */ new Map();
  const version2 = {};
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "diffr",
      description: "Review a diff with diffr",
      argumentHint: "[revisions or paths, as for 'git diff <args>']"
    });
    await $.tool.register({
      name: "open",
      description: `Open diffr's review pane for the user, showing a high-quality diff viewer based on 'diffr'. Use it to show them changes you made or want them to review, rather than describing the diff. The user can send you snippets of code that they're looking at via 'highlight + pressing enter'. Args are the same as you would pass to the 'git diff' CLI command, as a list (e.g. ["HEAD~1"], ["main..HEAD", "--", "src"]). For more information on using and customizing diffr, run \`diffr --agent-help\` in the shell.`,
      inputSchema: {
        type: "object",
        properties: { args: { type: "array", items: { type: "string" }, description: "diffr's arguments, one per item" } }
      },
      isDeferred: false
    });
    return next(e);
  });
  on("command.run", { command: "diffr" }, async ($, e) => {
    const args = splitArgs(e.args);
    let started;
    try {
      await check($, binary, version2);
      started = await startDiffr($, binary, child, args);
    } catch (error2) {
      return { text: `diffr could not start: ${error2 instanceof Error ? error2.message : String(error2)}` };
    }
    ({ pane, child } = started);
    opened = { title: ["diffr", ...args].join(" "), columns: Math.floor(e.presentation.columns * 0.6) };
    await $.ui.open({ id: PANE, ...opened, focus: true });
    return { text: `Opened diffr ${e.args} in a pane.`.replace("  ", " ") };
  });
  on("tool.call", { tool: TOOL }, async ($, e) => {
    const refuse = (error2) => ({ deny: error2 instanceof Error ? error2.message : String(error2) });
    let args, started;
    try {
      args = toolArgs(e);
      await check($, binary, version2);
      started = await startDiffr($, binary, child, args);
    } catch (error2) {
      return refuse(error2);
    }
    ({ pane, child } = started);
    opened = { title: ["diffr", ...args].join(" ") };
    await $.ui.open({ id: PANE, ...opened });
    await named(started.store, started.streamed);
    try {
      return { result: summary(args, started.store) };
    } catch (error2) {
      return refuse(error2);
    }
  });
  on("ui.render", { component: "Pane", requestId: "diffr" }, async ($, e) => {
    if (e.surface !== "terminal" && e.surface !== "desktop") {
      const { Text: Text2 } = $.ui.resolve(e);
      return /* @__PURE__ */ h(Text2, { dimColor: true }, "The diffr pane draws in the terminal and the desktop app.");
    }
    const { Box, Text, Client } = $.ui.resolve(e);
    if (!pane) return /* @__PURE__ */ h(Text, { dimColor: true }, "Run /diffr to open a comparison.");
    if (focused && !e.props.isFocused) pane.blur();
    focused = e.props.isFocused;
    const columns = e.props.bodyColumns, rows = e.props.scroll.bodyRows;
    const frame = pane.frame({ columns, rows });
    const bands = Array.from({ length: Math.ceil(frame.lines.length / BAND) }, (_, i) => frame.lines.slice(i * BAND, (i + 1) * BAND));
    return /* @__PURE__ */ h(Box, { flexDirection: "column", width: columns }, bands.map((lines, i) => /* @__PURE__ */ h(
      Client,
      {
        key: `diff-${i}`,
        module: "./view.js",
        props: { ...frame, lines, offset: i * BAND, acks: Object.fromEntries(acks) },
        width: columns,
        height: lines.length
      }
    )));
  });
  on("ui.message", async ($, e) => {
    if (e.requestId !== PANE || !pane) return {};
    const post2 = parsePost(e.data);
    if (post2.hover !== void 0) pane.hover(post2.hover);
    for (const [seq, input2] of post2.inputs) {
      if (seq <= (acks.get(post2.instance) ?? 0)) continue;
      acks.set(post2.instance, seq);
      const outcome = pane.input(input2);
      if (outcome.close) {
        await $.ui.close({ id: PANE });
        return {};
      }
      if (outcome.copy) {
        const copied = await $.ui.copy({ text: outcome.copy.text, surface: e.surface });
        pane.copied(outcome.copy.what, copied.isCopied ? void 0 : copied.reason);
      }
      if (outcome.chat) {
        const names = outcome.chat.map((chip) => chip.name);
        const text = `${names.join(" ")} `;
        const filled = await $.prompt.fill({ text, mode: "insert", decorations: chipRuns(text, names, pane.theme) });
        if (filled.isFilled) for (const chip of outcome.chat) chips.set(chip.name, chip.context);
        pane.chatted(names, filled.isFilled ? void 0 : filled.refusal === "dialog" ? "a dialog holds the keys" : filled.refusal === "no_composer" ? "this session has no prompt box" : "a hook kept it out");
        if (filled.isFilled) {
          await $.ui.close({ id: PANE });
          const reopened = await $.ui.open({ id: PANE, ...opened });
          if (!reopened.isPlaced) $.ui.toast(`diffr: ${reopened.reason}; run /diffr to open it again`);
        }
      }
    }
    $.ui.invalidate("ui.render");
    return {};
  });
  on("prompt.edit", async ($, e, next) => {
    const box = await next(e);
    if (!chips.size || !pane) return box;
    return { ...box, decorations: [...box.decorations ?? [], ...chipRuns(box.text, [...chips.keys()], pane.theme)] };
  });
  on("prompt.submit", async ($, e, next) => {
    if (!chips.size) return next(e);
    const named2 = [...chips].filter(([name]) => e.text.includes(name));
    chips.clear();
    if (!named2.length) return next(e);
    return next({ ...e, context: [...e.context ?? [], ...named2.map(([name, code]) => `The person selected these lines in diffr's review pane; their prompt calls them ${name}.
${code}`)] });
  });
  on("ui.scroll", { requestId: "diffr" }, async ($, e) => {
    if (!pane) return {};
    pane.scroll(e.by, e.pointer?.column);
    $.ui.invalidate("ui.render");
    return {};
  });
}
export {
  register
};
/*! Bundled license information:

smol-toml/dist/error.js:
smol-toml/dist/primitive.js:
smol-toml/dist/date.js:
smol-toml/dist/extract.js:
smol-toml/dist/util.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
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
   *)
*/
