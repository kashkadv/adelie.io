import { Prisma, type PrismaClient } from '@adelie/db';
import { OpenAiProvider, costMicros } from '../ai/provider.js';
import { config } from '../config.js';

/**
 * "Refine" and "Refine an area" (owner, 2026-11-27): the owner's request, in any language, rewritten by the AI into one
 * concrete English edit instruction before it goes to the PC. Tested on the PC: FLUX 3 Klein (distilled, cfg 1)
 * returned the photo unchanged for Ukrainian requests and did the same request in concrete English. The owner asked
 * that the AI also improve the request where it can - without changing what was asked.
 */
export const REFINE_INSTRUCTIONS = `You prepare edit instructions for an image-editing model (FLUX) that edits photographs of room interiors used as backdrops for handmade wool products.

The owner writes a short request in any language about what to change in the photo. Rewrite it as ONE precise English instruction the model will follow:
- Keep the owner's intent exactly. Never add changes, objects or styles the owner did not ask for, and never drop any they asked for.
- Make it concrete and visual: name the objects and say their material, colour, finish and real-world size where the request implies them; say how a thing stands, hangs or lies (on the floor, against the wall, on the shelf).
- When something is removed, say what is seen there instead: the surface around it continuing (plain plastered wall, wooden floor) - unless the owner says what to put there.
- "Instead of X" / "replace X with Y" stays a replacement: say "replace X with Y".
- When the request is about an area marked on the photo, refer to it as "the red-tinted area" (the model is shown the photo with that area tinted red), e.g. "In the red-tinted area, replace the window with ...".
- Fit the room: match its style, light and materials as described in the context, unless the owner asks otherwise.
- No people, animals, text or logos unless asked. One or two sentences, imperative, no preamble, no quotes.`;

export const REFINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { instruction: { type: 'string' } },
  required: ['instruction'],
} as const;

/** The AI's instruction, if it is usable: a non-empty sentence or two, without the tint wording when no area. */
export function parseRefineAnswer(data: unknown): string | null {
  const text = (data as { instruction?: unknown } | null)?.instruction;
  if (typeof text !== 'string') return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length >= 8 ? clean.slice(0, 900) : null;
}

/** The context the AI sees: the request, whether it is about a marked area, and the room. */
export function refineInput(r: {
  request: string;
  area: boolean;
  sceneType: string | null;
  location: string | null;
}) {
  return [
    `Owner's request: ${r.request}`,
    r.area
      ? 'It is about one area the owner marked on the photo (the model sees it tinted red).'
      : 'It is about the whole photo.',
    r.sceneType ? `Room: ${r.sceneType}.` : '',
    r.location ? `The place: ${r.location}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Asks the AI for the instruction and logs the run (`ai_run`, kind `scene_refine_request`). Null when AI is off, the
 * project's monthly limit is spent, or the answer is unusable - then the owner's own words go to the PC.
 */
export async function improveRefineRequest(
  db: PrismaClient,
  r: {
    workspaceId: string;
    projectId: string;
    userId: string | null;
    request: string;
    area: boolean;
    sceneType: string | null;
    location: string | null;
  },
): Promise<string | null> {
  const ai = config.ai;
  if (!ai) return null;
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const spent = await db.aiRun.aggregate({
    where: { projectId: r.projectId, createdAt: { gte: month } },
    _sum: { costMicros: true },
  });
  if ((spent._sum.costMicros ?? 0) >= ai.monthlyLimitUsd * 1e6) return null;
  const provider = new OpenAiProvider(ai.apiKey, ai.model);
  const input = refineInput(r);
  const answer = await provider.structured({
    instructions: REFINE_INSTRUCTIONS,
    input,
    schema: REFINE_SCHEMA as unknown as Record<string, unknown>,
    schemaName: 'scene_refine_request',
    maxOutputTokens: 600,
  });
  const instruction = answer.ok ? parseRefineAnswer(answer.data) : null;
  await db.aiRun.create({
    data: {
      workspaceId: r.workspaceId,
      projectId: r.projectId,
      userId: r.userId,
      kind: 'scene_refine_request',
      provider: provider.name,
      model: answer.model,
      status: instruction ? 'ok' : 'error',
      inputTokens: answer.usage.inputTokens,
      cachedTokens: answer.usage.cachedTokens,
      outputTokens: answer.usage.outputTokens,
      costMicros: costMicros(answer.usage, ai.price),
      input: { request: r.request, area: r.area, context: input } as Prisma.InputJsonValue,
      output: answer.ok ? (answer.data as Prisma.InputJsonValue) : Prisma.DbNull,
      error: answer.ok ? (instruction ? null : 'unusable answer') : answer.error,
    },
  });
  return instruction;
}
