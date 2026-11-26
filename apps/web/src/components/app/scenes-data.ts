// Scenes of the Workshop (ADR-0042): what the API returns and the choices the forms offer.
export const DIRECTIONS = ['interior', 'studio', 'outdoor'] as const;
export const LIGHTS = ['sun', 'evening'] as const;
export const ANGLES = ['front', 'side'] as const;
export const SIZE_CLASSES = ['small', 'medium', 'large', 'runner'] as const;
export const PRODUCT_TYPES = ['lizhnyk', 'rug', 'runner', 'panel', 'pillow', 'pouf'] as const;
export const TABS = ['library', 'candidate', 'archived'] as const;

export type Direction = (typeof DIRECTIONS)[number];
export type GpuState = 'ready' | 'busy' | 'offline';
export type Gpu = { state: GpuState; workers: number };

export interface LocationCard {
  id: string;
  name: string;
  description: string | null;
  mustHave: string | null;
  direction: Direction;
  coverSceneId: string | null;
  archivedAt: string | null;
  position: number;
  coverAssetId: string | null;
  /** Kept scenes, new ones waiting for a decision, archived ones. */
  scenes: number;
  fresh: number;
  archived: number;
  sceneTypes: { key: string; label: string; count: number }[];
}

export interface Scene {
  id: string;
  locationId: string;
  status: 'candidate' | 'library' | 'archived' | 'rejected';
  name: string | null;
  number: number;
  sceneType: string | null;
  style: string | null;
  light: string | null;
  angle: string | null;
  sizeClass: string | null;
  placement: string;
  productTypes: string[];
  tags: string[];
  minCm: number | null;
  maxCm: number | null;
  params: Record<string, unknown>;
  assetId: string | null;
  jobId: string | null;
  createdAt: string;
}

export interface GpuJob {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  /** What the PC is doing: mockup | loading | generating | uploading | saved. */
  stage: string | null;
  claimedAt: string | null;
  error: string | null;
  params: {
    count?: number;
    sceneType?: string;
    sceneTypeLabel?: string;
    light?: string;
    angle?: string;
    sizeClass?: string;
    style?: string;
    /** A refine job: what the owner asked to change, in which scene. */
    instruction?: string;
    parentNumber?: number;
  };
  createdAt: string;
  finishedAt: string | null;
}

export interface LocationDetail {
  location: Omit<LocationCard, 'coverAssetId' | 'scenes' | 'fresh' | 'archived' | 'sceneTypes'>;
  scenes: Scene[];
  jobs: GpuJob[];
  /** Scene types of the location's direction (for "Add scenes"). */
  sceneTypes: { key: string; label: string }[];
  /** Every type's label (scenes made under another direction keep their name). */
  allTypes: { key: string; label: string }[];
  /** The owner's sketches of rooms in this location. */
  sketches: SceneSketch[];
  gpu: Gpu;
}

export interface SceneSketch {
  id: string;
  assetId: string;
  sceneType: string;
  name: string | null;
  zone: unknown;
  position: number;
}

export interface SceneRule {
  key: string;
  direction: Direction | null;
  label: string;
  text: string;
  mockup: { preset: string; size: string; armchair?: boolean; sideTable?: boolean } | null;
  builtIn: boolean;
}

/** Ready-made locations: a concrete description (objects, materials) works far better than abstract words. */
export const LOCATION_TEMPLATES: {
  key: string;
  direction: Direction;
  description: string;
  mustHave: string;
}[] = [
  {
    key: 'chalet',
    direction: 'interior',
    description:
      'Carpathian chalet: exposed old spruce beams, wood-panelled walls, a stone fireplace, wool throws on the sofa, linen curtains, warm honey wood tones',
    mustHave: 'exposed wooden ceiling beams',
  },
  {
    key: 'scandi',
    direction: 'interior',
    description:
      'Scandinavian flat: light oak floor and furniture, cream bouclé, linen curtains, white walls, ceramics, books and plants, honey and caramel accents',
    mustHave: '',
  },
  {
    key: 'hotel',
    direction: 'interior',
    description:
      'Boutique hotel: larch wood, terrazzo, brushed brass details, crisp white linen, warm indirect lighting, calm luxury',
    mustHave: 'a large window with a view',
  },
  {
    key: 'japandi',
    direction: 'interior',
    description:
      'Japandi home: low wooden furniture, light ash and dark walnut, paper lamps, stone and ceramic objects, muted sand and charcoal tones',
    mustHave: '',
  },
];
