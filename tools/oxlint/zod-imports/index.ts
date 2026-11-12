import { defineRule, eslintCompatPlugin } from "@oxlint/plugins";

/** Flag the `z` and default imports of zod, which keep every locale in a bundle. */
const namespaceImportRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Import zod as a namespace so bundlers can drop its locales.",
    },
    messages: { namespace: 'Use `import * as z from "{{source}}"`.' },
  },
  createOnce(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;

        if (source !== "zod" && !source.startsWith("zod/")) return;

        for (const specifier of node.specifiers) {
          const isObjectImport =
            specifier.type === "ImportDefaultSpecifier" ||
            (specifier.type === "ImportSpecifier" &&
              specifier.imported.type === "Identifier" &&
              specifier.imported.name === "z");

          if (isObjectImport) {
            context.report({
              node: specifier,
              messageId: "namespace",
              data: { source },
            });
          }
        }
      },
    };
  },
});

const zodImportsPlugin = eslintCompatPlugin({
  meta: { name: "zod-imports" },
  rules: { namespace: namespaceImportRule },
});

export default zodImportsPlugin;
