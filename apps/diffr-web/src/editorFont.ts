/**
 * Monaco takes a font as monospace only when its probe glyphs share one width, and otherwise
 * measures every caret and selection from the DOM, which lands a caret at a line's end past the
 * margin of text injected there (the fold hint's). Geist Mono has no "→", one of the probes, so it
 * always fails. Review Desktop measures before Geist Mono loads and gets Menlo's uniform widths;
 * the page measures Geist Mono itself and only overrules that one verdict.
 */
import { FontMeasurements } from "vs/editor/browser/config/fontMeasurements.js";
import { FontInfo } from "vs/editor/common/config/fontInfo.js";

const readFontInfo = FontMeasurements.readFontInfo.bind(FontMeasurements);

FontMeasurements.readFontInfo = (targetWindow, bareFontInfo) => {
  const info = readFontInfo(targetWindow, bareFontInfo);

  if (info.isMonospace || !info.fontFamily.startsWith('"Geist Mono"')) return info;

  return new FontInfo({ ...info, isMonospace: true }, info.isTrusted);
};
