// The AI layer (ADR-0024, ADR-0029): one interface for a structured answer, providers behind it.
// The first provider is OpenAI's Responses API with a JSON schema; the answer is parsed, and the
// caller validates it before anything is saved.

export interface Usage {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

export interface StructuredRequest {
  /** What the model is and must do. */
  instructions: string;
  /** The task and its data, as text (JSON inside is fine). */
  input: string;
  /** A JSON schema of the answer (strict: every property required, no others). */
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
}

export type StructuredResult =
  | { ok: true; data: unknown; usage: Usage; model: string }
  | { ok: false; error: string; usage: Usage; model: string };

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  structured(request: StructuredRequest): Promise<StructuredResult>;
}

/** Cost in millionths of a dollar, from prices per million tokens. */
export function costMicros(
  usage: Usage,
  price: { input: number; cachedInput: number; output: number },
): number {
  const fresh = Math.max(0, usage.inputTokens - usage.cachedTokens);
  return Math.round(
    fresh * price.input +
      usage.cachedTokens * price.cachedInput +
      usage.outputTokens * price.output,
  );
}

const NO_USAGE: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

/** Reads an OpenAI Responses API answer: the text of the message, or why there is none. */
export function readResponse(
  body: unknown,
): { ok: true; text: string; usage: Usage } | { ok: false; error: string; usage: Usage } {
  const b = (body ?? {}) as {
    status?: string;
    error?: { message?: string } | null;
    incomplete_details?: { reason?: string } | null;
    output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
    usage?: {
      input_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens?: number;
    };
  };
  const usage: Usage = b.usage
    ? {
        inputTokens: b.usage.input_tokens ?? 0,
        cachedTokens: b.usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: b.usage.output_tokens ?? 0,
      }
    : NO_USAGE;
  if (b.error?.message) return { ok: false, error: b.error.message, usage };
  if (b.status && b.status !== 'completed') {
    return { ok: false, error: `${b.status}: ${b.incomplete_details?.reason ?? 'unknown'}`, usage };
  }
  const parts = (b.output ?? [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? []);
  const refusal = parts.find((p) => p.type === 'refusal');
  if (refusal) return { ok: false, error: `refused: ${refusal.refusal ?? ''}`, usage };
  const text = parts
    .filter((p) => p.type === 'output_text')
    .map((p) => p.text ?? '')
    .join('');
  if (!text) return { ok: false, error: 'empty answer', usage };
  return { ok: true, text, usage };
}

/** OpenAI Responses API with Structured Outputs. Nothing is stored on OpenAI's side (`store: false`). */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async structured(request: StructuredRequest): Promise<StructuredResult> {
    let res: Response;
    try {
      res = await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          instructions: request.instructions,
          input: request.input,
          store: false,
          max_output_tokens: request.maxOutputTokens ?? 6000,
          text: {
            format: {
              type: 'json_schema',
              name: request.schemaName,
              schema: request.schema,
              strict: true,
            },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      return {
        ok: false,
        error: `network: ${(err as Error).message}`,
        usage: NO_USAGE,
        model: this.model,
      };
    }
    const body: unknown = await res.json().catch(() => null);
    const read = readResponse(body);
    if (!res.ok && read.ok) {
      return { ok: false, error: `http ${res.status}`, usage: read.usage, model: this.model };
    }
    if (!read.ok) return { ...read, error: read.error.slice(0, 500), model: this.model };
    try {
      return { ok: true, data: JSON.parse(read.text), usage: read.usage, model: this.model };
    } catch {
      return { ok: false, error: 'answer is not JSON', usage: read.usage, model: this.model };
    }
  }
}
