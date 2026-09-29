import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

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
  matches: (text) => /\dpx|%/.test(text) && !zero.test(text),
};

const durationCheck: ScaleCheck = { scale: "motion", matches: (text) => duration.test(text) };

const checks = new Map<string, ScaleCheck>([
  ["fontSize", { scale: "fontSize", matches: (text) => px.test(text) }],
  ["fontWeight", { scale: "fontWeight", matches: (text) => number.test(text) }],
  ["borderRadius", radiusCheck],
  ["borderTopLeftRadius", radiusCheck],
  ["borderTopRightRadius", radiusCheck],
  ["borderBottomLeftRadius", radiusCheck],
  ["borderBottomRightRadius", radiusCheck],
  ["zIndex", { scale: "layer", matches: (text) => number.test(text) && Number(text) >= 10 }],
  ["transition", durationCheck],
  ["transitionDuration", durationCheck],
  ["animation", durationCheck],
  ["animationDuration", durationCheck],
  ["boxShadow", { scale: "elevation", matches: (text) => dropShadow.test(text) }],
  [
    "letterSpacing",
    { scale: "tracking", matches: (text) => /\d(em|px)$/.test(text) && !zero.test(text) },
  ],
]);

function propertyName(property: ESTree.ObjectProperty): string | null {
  const key = property.key;

  if (key.type === "Identifier") return key.name;

  if (key.type === "Literal") return String(key.value);

  return null;
}

function isStylexCreate(node: ESTree.Node): boolean {
  if (node.type !== "CallExpression") return false;
  const callee = node.callee;

  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "stylex" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "create"
  );
}

function insideStylexCreate(node: ESTree.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (isStylexCreate(current)) return true;
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

/** Flag literal type, radius, layer, motion, elevation and tracking values in stylex.create. */
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
        const check = name === null ? undefined : checks.get(name);

        if (check === undefined || !insideStylexCreate(node)) return;
        const offending = literalTexts(node.value).find((text) => check.matches(text.trim()));

        if (offending !== undefined) {
          context.report({
            node: node.value,
            messageId: "literal",
            data: { scale: check.scale, value: offending },
          });
        }
      },
    };
  },
});

const canvasStylesPlugin = eslintCompatPlugin({
  meta: { name: "canvas-styles" },
  rules: { "scale-literals": scaleLiteralsRule },
});

export default canvasStylesPlugin;
