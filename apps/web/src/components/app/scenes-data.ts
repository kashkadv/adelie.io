// Scene library of the Workshop (ADR-0042): what the API returns and the choices the forms offer.
/** Rooms generated inside a location (a hotel, a chalet…). */
export const ROOMS = [
  'living',
  'bedroom',
  'hotel_room',
  'lobby',
  'hall',
  'reading',
  'kids',
  'kitchen',
  'other',
] as const;
export const LIGHTS = ['sun', 'evening'] as const;
export const ANGLES = ['front', 'side'] as const;
export const SIZE_CLASSES = ['small', 'medium', 'large', 'runner'] as const;
export const PRODUCT_TYPES = ['lizhnyk', 'rug', 'runner', 'panel', 'pillow', 'pouf'] as const;
export const STATUS_VIEWS = ['library', 'candidate', 'archived'] as const;

export type Room = (typeof ROOMS)[number];
export type GpuState = 'ready' | 'busy' | 'offline';

export interface SceneLocation {
  id: string;
  name: string;
  description: string | null;
  position: number;
  /** Scenes per status. */
  counts: Partial<Record<'candidate' | 'library' | 'archived' | 'rejected', number>>;
}

export interface Scene {
  id: string;
  locationId: string;
  status: 'candidate' | 'library' | 'archived' | 'rejected';
  name: string | null;
  number: number;
  room: string | null;
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
  error: string | null;
  params: { count?: number; room?: string; location?: { name: string } };
  createdAt: string;
  finishedAt: string | null;
}

export interface ScenesData {
  locations: SceneLocation[];
  scenes: Scene[];
  jobs: GpuJob[];
  gpu: { state: GpuState; workers: number };
}
