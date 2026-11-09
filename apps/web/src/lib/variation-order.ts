/** Clothing sizes from the smallest to the largest; the spellings of one size share a rank. */
const SIZE_RANKS = [
  ['3xs', 'xxxs'],
  ['2xs', 'xxs'],
  ['xs'],
  ['s'],
  ['m'],
  ['l'],
  ['xl'],
  ['2xl', 'xxl'],
  ['3xl', 'xxxl'],
  ['4xl', 'xxxxl'],
];

const rank = (value: string) =>
  SIZE_RANKS.findIndex((spellings) => spellings.includes(value.trim().toLowerCase()));

/** Natural order: clothing sizes by size (XS, S, M, L, XL…), numbers by value, the rest A–Z. */
export function compareOptionValues(a: string, b: string): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== -1 && rb !== -1) return ra - rb;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Compares two variations by their option values, the first option first. */
export function compareVariations(a: string[], b: string[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const c = compareOptionValues(a[i] ?? '', b[i] ?? '');
    if (c !== 0) return c;
  }
  return 0;
}
