// Herramientas de código de LAIN que usa el PRODUCTO (la revisión de un PR) y que el modelo del
// investigador NO ve: no están en CODE_TOOLS, así que no entran en sus specs ni en sus prompts.
// Siguen siendo sólo de lectura.

export const PRODUCT_CODE_TOOLS = ['assess_change', 'get_capabilities'] as const;
export type ProductCodeTool = (typeof PRODUCT_CODE_TOOLS)[number];

export const isProductCodeTool = (name: string): name is ProductCodeTool =>
  (PRODUCT_CODE_TOOLS as readonly string[]).includes(name);
