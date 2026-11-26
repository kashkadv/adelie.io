/**
 * Prompt rules of the scene library (ADR-0042, owner 2026-11-26). Shipped defaults - the texts worked out in Stage 0
 * (docs/plans/product-studio.md) - are copied into a project the first time its rules are read; the owner edits them in
 * Adelie. The server builds every scene's prompt from them, so the PC only draws and the recipe keeps the exact text.
 */
export const DIRECTIONS = ['interior', 'studio', 'outdoor'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** What the PC draws as the block mock-up of a scene type (infra/gpu-agent/prototypes/scene_proxy.py). */
export interface Mockup {
  /** The big block: sofa | bed | bench | table (interior), podium | backdrop (studio, later). */
  preset: string;
  /** Its size, cm: width x depth x height. */
  size: string;
  armchair?: boolean;
  sideTable?: boolean;
}

export interface RuleDefault {
  key: string;
  direction: Direction | null;
  label: string;
  text: string;
  mockup?: Mockup;
}

const BLOCKS =
  'Every grey block of image 1 becomes its real object completely, of the same size in the same place; no plain grey boxes remain.';

export const DEFAULT_RULES: RuleDefault[] = [
  {
    key: 'general',
    direction: null,
    label: 'General',
    text:
      'Keep the camera and the layout of image 1 exactly; the floor boards run in the same direction as its lines. ' +
      'The floor area of about {size} cm in front stays open and bare: nothing stands on it, touches it or hangs over it, ' +
      'no rug or carpet anywhere. Everything at real-world size and well built, like real products from a good store: ' +
      'straight evenly spaced legs, clean edges, square corners, true proportions between objects, a sensible layout like ' +
      "an interior designer's. Throws lie folded on the seats, nothing hangs down to the floor. Curtains only at windows, on " +
      'a straight rod. Rectangular picture frames, plants with natural leaves. No animals, no people, no text. ' +
      'A real photograph: an unedited photo from an interior magazine, true-to-life colours, natural textures, subtle film ' +
      'grain; not a 3D render, not an illustration.',
  },
  {
    key: 'living',
    direction: 'interior',
    label: 'Вітальня',
    text: `A living room. The long block is a sofa against the back wall. The block on the left, beyond the sofa's end, is one armchair turned 80 to 90 degrees to the sofa, symmetrical, both armrests identical, not touching the sofa. The small table shape by the other end is a side table on slim legs. ${BLOCKS}`,
    mockup: { preset: 'sofa', size: '220x90x80', armchair: true, sideTable: true },
  },
  {
    key: 'bedroom',
    direction: 'interior',
    label: 'Спальня',
    text: `A bedroom. The long block is a bed with its headboard against the back wall and its foot towards the open floor, the bedding smooth and neatly made, bedside tables on both sides. ${BLOCKS}`,
    mockup: { preset: 'bed', size: '180x210x95' },
  },
  {
    key: 'hotel_room',
    direction: 'interior',
    label: 'Номер готелю',
    text: `A hotel room. The long block is a bed with an upholstered headboard against the back wall, crisp bedding, matching bedside tables and lamps. ${BLOCKS}`,
    mockup: { preset: 'bed', size: '180x210x100' },
  },
  {
    key: 'lobby',
    direction: 'interior',
    label: 'Хол / лобі',
    text: `A lobby or lounge. The long block is a long lounge sofa against the back wall; one armchair beyond its end turned 80 to 90 degrees to it; a side table by the other end. ${BLOCKS}`,
    mockup: { preset: 'sofa', size: '240x95x80', armchair: true, sideTable: true },
  },
  {
    key: 'hall',
    direction: 'interior',
    label: 'Передпокій / коридор',
    text: `A hallway or entrance. The block is a low bench against the wall; coat hooks or a narrow console above or beside it. ${BLOCKS}`,
    mockup: { preset: 'bench', size: '120x40x45' },
  },
  {
    key: 'reading',
    direction: 'interior',
    label: 'Куточок для читання',
    text: `A reading corner. The long block is a small sofa against the back wall; one armchair beyond its end turned 80 to 90 degrees to it; a side table with a reading lamp by the other end; books nearby. ${BLOCKS}`,
    mockup: { preset: 'sofa', size: '200x90x80', armchair: true, sideTable: true },
  },
  {
    key: 'kids',
    direction: 'interior',
    label: 'Дитяча',
    text: `A kids' room. The block is a low daybed with cushions against the back wall; low shelves with a few toys and books. ${BLOCKS}`,
    mockup: { preset: 'bed', size: '190x90x70' },
  },
  {
    key: 'kitchen',
    direction: 'interior',
    label: 'Кухня / їдальня',
    text: `A dining room. The block is a long wooden dining table with chairs, standing parallel to the back wall. ${BLOCKS}`,
    mockup: { preset: 'table', size: '200x90x75' },
  },
];

export const LIGHT_TEXT: Record<string, string> = {
  sun: 'Light: warm late-afternoon sunlight through the windows, long soft shadows across the floor.',
  evening:
    'Light: evening, the room lit by warm table and floor lamps, dim ambient light, gentle deep shadows, cosy and calm.',
};

export const SIZE_MOCK: Record<string, string> = {
  small: '100x150',
  medium: '160x230',
  large: '200x300',
  runner: '70x250',
};

/**
 * One scene's prompt, most important first: the location's style, its must-haves, the scene type's rule, the general
 * rule, then this request (series style, light, wishes).
 */
export function composePrompt(a: {
  location: { description: string | null; mustHave: string | null };
  typeRule: { label: string; text: string };
  general: { text: string };
  sizeClass: string;
  light: string;
  style: string;
  notes: string;
}): string {
  const size = (SIZE_MOCK[a.sizeClass] ?? SIZE_MOCK['medium']!).replace('x', ' x ');
  const fill = (t: string) => t.replaceAll('{size}', size).trim();
  const parts = [
    a.location.description?.trim() && `The place: ${a.location.description.trim()}`,
    a.location.mustHave?.trim() && `Always in this place: ${a.location.mustHave.trim()}`,
    'Image 1 is a grey block mock-up of this scene seen from standing height; turn it into a real photograph.',
    fill(a.typeRule.text),
    fill(a.general.text),
    a.style.trim() && `Style of this series: ${a.style.trim()}.`,
    LIGHT_TEXT[a.light] ?? LIGHT_TEXT['sun'],
    a.notes.trim(),
  ];
  return parts.filter(Boolean).join(' ');
}
