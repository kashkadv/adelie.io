/** Product problems as the API reports them (apps/api sales/product-issues.ts). */
export type IssueLevel = 'critical' | 'important' | 'note';

export type IssueCode =
  | 'pinToUnavailable'
  | 'noPrice'
  | 'noPhoto'
  | 'soldOutActive'
  | 'duplicateSku'
  | 'noSku'
  | 'noTags'
  | 'noPins'
  | 'sharedSku'
  | 'fewTags'
  | 'skuFormat'
  | 'noViews';

export type ProductIssue = { code: IssueCode; level: IssueLevel };

/** Most serious first. */
export const ISSUE_LEVELS: IssueLevel[] = ['critical', 'important', 'note'];

/** Colour by importance: red — critical, amber — important, grey — worth a look. */
export const ISSUE_STYLE: Record<IssueLevel, { text: string; dot: string }> = {
  critical: { text: 'text-rose-600 dark:text-rose-400', dot: 'bg-rose-500' },
  important: { text: 'text-amber-600 dark:text-amber-400', dot: 'bg-amber-500' },
  note: { text: 'text-muted', dot: 'bg-accent-foreground/50' },
};

export const topIssueLevel = (issues: ProductIssue[]): IssueLevel | null =>
  ISSUE_LEVELS.find((l) => issues.some((i) => i.level === l)) ?? null;

export const sortIssues = (issues: ProductIssue[]): ProductIssue[] =>
  [...issues].sort((a, b) => ISSUE_LEVELS.indexOf(a.level) - ISSUE_LEVELS.indexOf(b.level));
