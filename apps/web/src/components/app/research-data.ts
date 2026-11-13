// Niche research (ADR-0032): what the API returns.

export interface Market {
  code: string;
  share: number;
}

export interface ResearchSummary {
  id: string;
  name: string;
  keywords: string[];
  salesAccountId: string;
  channel: string;
  products: number;
  endsOn: string | null;
  refreshedAt: string | null;
}

export interface SalesAccount {
  id: string;
  platform: 'ETSY' | 'WEBSITE';
  name: string;
}

export interface EtsyMarket {
  keyword: string;
  count: number;
  priceUsd: { min: number; median: number; max: number; listings: number } | null;
  avgFavorers: number;
  tags: { tag: string; n: number }[];
  titlePhrases: { phrase: string; n: number }[];
}

export interface PoolPhrase {
  phrase: string;
  pinterest: {
    mom: number | null;
    yoy: number | null;
    regions: string[];
    peak: string | null;
  } | null;
  etsy: number;
  own: number;
  score: number;
  /** The AI's review (ADR-0033): null = not reviewed. */
  verdict: 'relevant' | 'generic' | 'other_product' | 'other_intent' | null;
  why: string | null;
  /** Shown in the pool and used for ranking and advice. */
  visible: boolean;
  /** The owner's word: hidden by hand, or kept against the AI. */
  byOwner: 'hidden' | 'kept' | null;
}

export type Reason =
  'sells' | 'liked' | 'viewed' | 'trending' | 'noTags' | 'fewTags' | 'shortTitle';

export interface RankedProduct {
  id: string;
  score: number;
  matched: string[];
  missing: string[];
  reasons: Reason[];
  title: string;
  url: string | null;
  imageUrl: string | null;
  tags: number;
  views: number | null;
  favorers: number | null;
  sold12m: number;
  price: number | null;
  currency: string | null;
}

export interface Research {
  id: string;
  name: string;
  keywords: string[];
  channel: string;
  salesAccount: { id: string; platform: string | null; name: string };
  productIds: string[];
  endsOn: string | null;
  directionId: string | null;
  refreshedAt: string | null;
  sources: {
    pinterest: {
      fetchedAt: string;
      error: string | null;
      regions: string[];
      keywords: number;
    } | null;
    etsy: { fetchedAt: string; error: string | null; markets: EtsyMarket[] } | null;
  };
  pool: PoolPhrase[];
  reviewedAt: string | null;
  products: RankedProduct[];
}

export interface Seeds {
  phrases: { phrase: string; why: string }[];
  avoid: { phrase: string; why: string }[];
  costUsd: number;
}
