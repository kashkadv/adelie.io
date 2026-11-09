/**
 * The article a SKU belongs to: "00011512/1" is the article "00011512" — what a website's product
 * (`g:id` of its feed) is matched by (ADR-0021).
 */
export const baseSku = (sku: string): string => sku.split('/')[0]!;

/** The distinct articles of a list of SKUs. */
export const articlesOf = (skus: readonly string[]): string[] => [
  ...new Set(skus.map((s) => baseSku(s.trim())).filter(Boolean)),
];
