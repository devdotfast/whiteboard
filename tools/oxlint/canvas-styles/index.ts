import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode } from "@oxlint/plugins";

type ScaleCheck = {
  scale: string;
  matches: (text: string) => boolean;
};

const px = /^-?\d+(\.\d+)?px$/;

const number = /^\d+(\.\d+)?$/;

const duration = /\d(ms|s)\b/;

// A drop shadow: a nonzero offset and a blur. Rings and hairlines stay literal.
const dropShadow = /(^|,\s*)(inset\s+)?-?\d+(\.\d+)?(px)?\s+-?[1-9][\d.]*px\s+[1-9][\d.]*px/;

const zero = /^0(px|em)?$/;

const radiusCheck: ScaleCheck = {
  scale: "radius",
  matches: (text) => (/\dpx|%/.test(text) || number.test(text)) && !zero.test(text),
};

const motionCheck: ScaleCheck = {
  scale: "motion",
  matches: (text) => duration.test(text) || text.includes("cubic-bezier("),
};

// In the `font` shorthand, a size is the px word before any `/line-height`, and
// a weight is a bare three-digit word.
const fontCheck: ScaleCheck = {
  scale: "fontSize or fontWeight",
  matches: (text) =>
    text.split(/\s+/).some((word) => /^\d+(\.\d+)?px(\/|$)/.test(word) || /^\d{3}$/.test(word)),
};

// The `/line-height` part of the `font` shorthand.
const fontLeadingCheck: ScaleCheck = {
  scale: "leading",
  matches: (text) => /\/\d/.test(text),
};

// The words of a value outside function calls: `calc()`, `max()` and `anchor()`
// mix units and tokens, so their literals stay.
function bareWords(text: string): string[] {
  let outside = text;

  for (let previous = ""; previous !== outside; ) {
    previous = outside;
    outside = outside.replace(/[\w-]*\([^()]*\)/g, " ");
  }

  return outside.split(/\s+/).filter(Boolean);
}

// StyleX reads a bare number as px. Hairline offsets of a pixel or less stay literal.
const spacingCheck: ScaleCheck = {
  scale: "space",
  matches: (text) =>
    bareWords(text).some((word) => {
      const length = /^-?(\d+(\.\d+)?)(px)?$/.exec(word);

      return length !== null && Number(length[1]) > 1;
    }),
};

const spacingProperty =
  /^(padding|margin|inset)(Top|Right|Bottom|Left|(Inline|Block)(Start|End)?)?$|^(gap|rowGap|columnGap|top|right|bottom|left)$/;

const leadingCheck: ScaleCheck = {
  scale: "leading",
  matches: (text) => /^\d+(\.\d+)?(px)?$/.test(text),
};

const checks = new Map<string, ScaleCheck>([
  // StyleX reads a bare number as px.
  ["fontSize", { scale: "fontSize", matches: (text) => px.test(text) || number.test(text) }],
  ["fontWeight", { scale: "fontWeight", matches: (text) => number.test(text) }],
  ["lineHeight", leadingCheck],
  ["borderRadius", radiusCheck],
  ["borderTopLeftRadius", radiusCheck],
  ["borderTopRightRadius", radiusCheck],
  ["borderBottomLeftRadius", radiusCheck],
  ["borderBottomRightRadius", radiusCheck],
  ["zIndex", { scale: "layer", matches: (text) => number.test(text) && Number(text) >= 10 }],
  ["transition", motionCheck],
  ["transitionDuration", motionCheck],
  ["transitionDelay", motionCheck],
  ["transitionTimingFunction", motionCheck],
  ["animation", motionCheck],
  ["animationDuration", motionCheck],
  ["animationDelay", motionCheck],
  ["animationTimingFunction", motionCheck],
  ["boxShadow", { scale: "elevation", matches: (text) => dropShadow.test(text) }],
  [
    "letterSpacing",
    { scale: "tracking", matches: (text) => /\d(em|px)$/.test(text) && !zero.test(text) },
  ],
]);

function checksFor(name: string): ScaleCheck[] {
  if (spacingProperty.test(name)) return [spacingCheck];

  if (name === "font") return [fontCheck, fontLeadingCheck];
  const check = checks.get(name);

  return check === undefined ? [] : [check];
}

function propertyName(property: ESTree.ObjectProperty): string | null {
  const key = property.key;

  if (key.type === "Identifier") return key.name;

  if (key.type === "Literal") return String(key.value);

  return null;
}

// The import that binds `name` here, as [source, imported name], if any.
function importOf(sourceCode: SourceCode, identifier: ESTree.IdentifierReference) {
  let scope: Scope | null = sourceCode.getScope(identifier);

  while (scope !== null) {
    const variable = scope.set.get(identifier.name);

    if (variable !== undefined) {
      const definition = variable.defs[0];

      if (definition?.type !== "ImportBinding" || definition.parent?.type !== "ImportDeclaration") {
        return null;
      }

      const specifier = definition.node;

      const imported =
        specifier.type === "ImportSpecifier"
          ? specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value
          : "*";

      return [definition.parent.source.value, imported] as const;
    }

    scope = scope.upper;
  }

  return null;
}

// `stylex.create(...)` through any namespace or default name, or a named `create`.
function isStylexCreate(sourceCode: SourceCode, node: ESTree.Node | null): boolean {
  if (node?.type !== "CallExpression") return false;
  const callee = node.callee;

  if (callee.type === "Identifier") {
    const binding = importOf(sourceCode, callee);

    return binding?.[0] === "@stylexjs/stylex" && binding[1] === "create";
  }

  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.object.type !== "Identifier" ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "create"
  ) {
    return false;
  }

  return importOf(sourceCode, callee.object)?.[0] === "@stylexjs/stylex";
}

function insideStylexCreate(sourceCode: SourceCode, node: ESTree.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (isStylexCreate(sourceCode, current)) return true;
  }

  return false;
}

// The literal text of a value: a string or number literal, or the fixed parts
// of a template (interpolated scale constants and tokens are fine).
function literalTexts(value: ESTree.Node): string[] {
  if (value.type === "Literal") {
    return value.raw ? [value.raw.replace(/^["']|["']$/g, "")] : [];
  }

  if (value.type === "TemplateLiteral") {
    return [value.quasis.map((quasi) => quasi.value.raw).join("${}")];
  }

  if (value.type === "ObjectExpression") {
    return value.properties.flatMap((entry) =>
      entry.type === "Property" ? literalTexts(entry.value) : [],
    );
  }

  return [];
}

/** Flag literal type, leading, space, radius, layer, motion, elevation and tracking values in stylex.create. */
const scaleLiteralsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Use the scales in packages/review/app/src/scale.stylex.ts instead of literal values.",
    },
    messages: {
      literal: "Use a `{{scale}}` step from scale.stylex.ts instead of `{{value}}`.",
    },
  },
  createOnce(context) {
    return {
      Property(node) {
        const name = propertyName(node);
        const nameChecks = name === null ? [] : checksFor(name);

        // A namespace's name is not a property, whatever it is called.
        if (
          nameChecks.length === 0 ||
          isStylexCreate(context.sourceCode, node.parent.parent) ||
          !insideStylexCreate(context.sourceCode, node)
        ) {
          return;
        }

        for (const check of nameChecks) {
          const offending = literalTexts(node.value).find((text) => check.matches(text.trim()));

          if (offending !== undefined) {
            context.report({
              node: node.value,
              messageId: "literal",
              data: { scale: check.scale, value: offending },
            });
          }
        }
      },
    };
  },
});

// The text of a string or template leaf; nested objects visit as their own properties.
function leafText(value: ESTree.Node): string | null {
  if (value.type === "Literal") return value.raw?.replace(/^["']|["']$/g, "") ?? null;

  if (value.type === "TemplateLiteral") {
    return value.quasis.map((quasi) => quasi.value.raw).join("${}");
  }

  return null;
}

type LeafVisitor = (node: ESTree.ObjectProperty, name: string | null, text: string) => void;

// Visits each string leaf of a stylex.create call.
function leafValues(context: { sourceCode: SourceCode }, visit: LeafVisitor) {
  return {
    Property(node: ESTree.ObjectProperty) {
      const text = leafText(node.value);

      if (text !== null && insideStylexCreate(context.sourceCode, node)) {
        visit(node, propertyName(node), text);
      }
    },
  };
}

/** Flag `!important` in stylex.create values. */
const noImportantRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Raise a style with a variant or stylex.when.ancestor, not !important." },
    messages: {
      important: "Drop `!important`; use a variant or `stylex.when.ancestor` instead.",
    },
  },
  createOnce(context) {
    return leafValues(context, (node, _name, text) => {
      if (text.includes("!important")) context.report({ node: node.value, messageId: "important" });
    });
  },
});

/** Flag a bare `transparent` in stylex.create values; inside a gradient or color-mix it stays. */
const noBareTransparentRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Use tokens.transparent instead of a transparent literal." },
    messages: { transparent: "Use `tokens.transparent` instead of `transparent`." },
  },
  createOnce(context) {
    return leafValues(context, (node, _name, text) => {
      if (bareWords(text).includes("transparent")) {
        context.report({ node: node.value, messageId: "transparent" });
      }
    });
  },
});

const rawColor = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|oklch|oklab)\([^)]*\)/i;

/** Flag hex and functional colors in stylex.create values; mask gradients keep theirs. */
const noRawColorsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Use the colors in tokens.stylex.ts instead of literal colors." },
    messages: { color: "Use a `tokens.*` color instead of `{{value}}`." },
  },
  createOnce(context) {
    return leafValues(context, (node, name, text) => {
      const match = name === "maskImage" || name === "WebkitMaskImage" ? null : rawColor.exec(text);

      if (match !== null) {
        context.report({ node: node.value, messageId: "color", data: { value: match[0] } });
      }
    });
  },
});

const glyph = /^[×✕›‹▾✓→←…]$/;

// The text of a child that is a string: JSX text or a `{"…"}` container.
function childText(child: ESTree.Node): string | null {
  if (child.type === "JSXText") return child.value;

  if (child.type === "JSXExpressionContainer" && child.expression.type === "Literal") {
    return String(child.expression.value);
  }

  return null;
}

/** Flag a Unicode glyph as an element's only content. */
const noGlyphIconsRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Icons are SVG from ui/icons.tsx, not Unicode characters." },
    messages: { glyph: "Use an icon from ui/icons.tsx instead of `{{glyph}}`." },
  },
  createOnce(context) {
    return {
      JSXElement(node) {
        const children = node.children.filter((child) => childText(child)?.trim() !== "");
        const text = children.length === 1 ? childText(children[0])?.trim() : undefined;

        if (text !== undefined && glyph.test(text)) {
          context.report({ node: children[0], messageId: "glyph", data: { glyph: text } });
        }
      },
    };
  },
});

const canvasStylesPlugin = eslintCompatPlugin({
  meta: { name: "canvas-styles" },
  rules: {
    "scale-literals": scaleLiteralsRule,
    "no-important": noImportantRule,
    "no-bare-transparent": noBareTransparentRule,
    "no-raw-colors": noRawColorsRule,
    "no-glyph-icons": noGlyphIconsRule,
  },
});

export default canvasStylesPlugin;
