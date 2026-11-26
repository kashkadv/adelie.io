/**
 * Scene library (ADR-0042): the choices of a scene and how a request for new candidates is checked.
 * The agent on the PC turns the parameters into a block mock-up in centimetres and a prompt.
 */
/** A scene type is a rule's key (living, bedroom, podium, a custom one); checked against the project's rules. */
export const SCENE_TYPE = /^[a-z][a-z0-9_]{0,39}$/;
export const LIGHTS = ['sun', 'evening'] as const;
export const ANGLES = ['front', 'side'] as const;
export const PRODUCT_TYPES = ['lizhnyk', 'rug', 'runner', 'panel', 'pillow', 'pouf'] as const;
export const PLACEMENTS = ['floor', 'wall'] as const;
export const STATUSES = ['candidate', 'library', 'archived', 'rejected'] as const;

/**
 * Size classes of the free zone: the mock-up product (cm) the room is laid out around, and the long sides of the
 * products the scene takes.
 */
export const SIZE_CLASSES = {
  small: { mock: '100x150', minCm: 60, maxCm: 150 },
  medium: { mock: '160x230', minCm: 120, maxCm: 230 },
  large: { mock: '200x300', minCm: 180, maxCm: 300 },
  runner: { mock: '70x250', minCm: 150, maxCm: 300 },
} as const;
export type SizeClass = keyof typeof SIZE_CLASSES;

export const MAX_CANDIDATES = 8;

const pick = <T extends readonly string[]>(list: T, v: unknown): T[number] | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T[number]) : null;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface CandidateRequest {
  locationId: string;
  sceneType: string;
  style: string;
  light: (typeof LIGHTS)[number];
  angle: (typeof ANGLES)[number];
  sizeClass: SizeClass;
  placement: (typeof PLACEMENTS)[number];
  productTypes: (typeof PRODUCT_TYPES)[number][];
  notes: string;
  count: number;
}

/** Checks a "new candidates" request; returns the field that is wrong. */
export function parseCandidateRequest(
  body: Record<string, unknown>,
): { ok: true; request: CandidateRequest } | { ok: false; error: string } {
  const locationId = typeof body['locationId'] === 'string' ? body['locationId'] : '';
  if (!/^[0-9a-f-]{36}$/i.test(locationId)) return { ok: false, error: 'locationId' };
  const rawType = body['sceneType'] ?? body['room'] ?? 'living';
  const sceneType = typeof rawType === 'string' && SCENE_TYPE.test(rawType) ? rawType : null;
  if (!sceneType) return { ok: false, error: 'sceneType' };
  const light = pick(LIGHTS, body['light'] ?? 'sun');
  if (!light) return { ok: false, error: 'light' };
  const angle = pick(ANGLES, body['angle'] ?? 'front');
  if (!angle) return { ok: false, error: 'angle' };
  const sizeClass =
    typeof body['sizeClass'] === 'string' && body['sizeClass'] in SIZE_CLASSES
      ? (body['sizeClass'] as SizeClass)
      : null;
  if (!sizeClass) return { ok: false, error: 'sizeClass' };
  const placement = pick(PLACEMENTS, body['placement'] ?? 'floor');
  if (!placement) return { ok: false, error: 'placement' };
  const types = Array.isArray(body['productTypes']) ? body['productTypes'] : [];
  const productTypes = [...new Set(types.map((t) => pick(PRODUCT_TYPES, t)))].filter(
    (t): t is (typeof PRODUCT_TYPES)[number] => !!t,
  );
  if (!productTypes.length) return { ok: false, error: 'productTypes' };
  const count = Number(body['count'] ?? 4);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CANDIDATES)
    return { ok: false, error: 'count' };
  return {
    ok: true,
    request: {
      locationId,
      sceneType,
      style: text(body['style'], 300),
      light,
      angle,
      sizeClass,
      placement,
      productTypes,
      notes: text(body['notes'], 1000),
      count,
    },
  };
}

/** Distinct random seeds for a job's candidates. */
export function seedsFor(count: number, rand = Math.random): number[] {
  const seeds = new Set<number>();
  while (seeds.size < count) seeds.add(1 + Math.floor(rand() * 2_000_000_000));
  return [...seeds];
}

/** Candidates rejected this long ago are deleted with their files. */
export const REJECTED_KEEP_MS = 7 * 86_400_000;
