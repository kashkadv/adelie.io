import { describe, expect, it } from 'vitest';
import { OpenAiProvider, costMicros, readResponse } from '../ai/provider.js';
import { IDEAS_SCHEMA, parseBrief, parseIdeas } from './ideas.js';

describe('brief', () => {
  it('needs what the project is; keeps known channels only', () => {
    expect(parseBrief({ audience: 'x' })).toBeNull();
    expect(
      parseBrief({ about: ' Wool rugs ', channels: ['pinterest', 'myspace', 'pinterest'] }),
    ).toEqual({
      about: 'Wool rugs',
      audience: '',
      language: '',
      channels: ['pinterest'],
      assets: '',
      goal: '',
    });
  });
});

describe('ideas', () => {
  it('keeps valid ideas and evens out the rest', () => {
    expect(
      parseIdeas({
        ideas: [
          {
            title: 'Rug care tips',
            channel: 'pinterest',
            format: 'pin',
            minutes: 2.4,
            notes: 'n',
            why: 'w',
            evidence: 'results',
          },
          { title: 'x', channel: 'myspace', format: 'pin' },
          { title: '', channel: 'pinterest', format: 'pin' },
          {
            title: 'Reel',
            channel: 'instagram',
            format: 'short',
            minutes: 'a',
            evidence: 'market',
          },
        ],
      }),
    ).toEqual([
      {
        title: 'Rug care tips',
        channel: 'pinterest',
        format: 'pin',
        minutes: 5,
        notes: 'n',
        why: 'w',
        evidence: 'results',
      },
      {
        title: 'Reel',
        channel: 'instagram',
        format: 'short',
        minutes: 30,
        notes: '',
        why: '',
        evidence: 'hypothesis',
      },
    ]);
    expect(parseIdeas(null)).toEqual([]);
  });

  it('the schema is strict: every property required', () => {
    const item = IDEAS_SCHEMA.properties.ideas.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.additionalProperties).toBe(false);
  });
});

describe('the OpenAI provider', () => {
  const answer = (over: object = {}) => ({
    status: 'completed',
    output: [
      { type: 'reasoning' },
      { type: 'message', content: [{ type: 'output_text', text: '{"ideas":[]}' }] },
    ],
    usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 300 },
    ...over,
  });

  it('reads the message text and the usage', () => {
    expect(readResponse(answer())).toEqual({
      ok: true,
      text: '{"ideas":[]}',
      usage: { inputTokens: 1000, cachedTokens: 200, outputTokens: 300 },
    });
    expect(
      readResponse(
        answer({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
      ).ok,
    ).toBe(false);
    expect(
      readResponse({
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
      }),
    ).toMatchObject({ ok: false, error: 'refused: no' });
  });

  it('costs by the model’s prices', () => {
    // 800 fresh × $1 + 200 cached × $0.05 + 300 out × $5 per million tokens = $0.00231
    expect(
      costMicros(
        { inputTokens: 1000, cachedTokens: 200, outputTokens: 300 },
        { input: 1, cachedInput: 0.05, output: 5 },
      ),
    ).toBe(2310);
  });

  it('sends a strict JSON schema, stores nothing, parses the answer', async () => {
    let sent: Record<string, unknown> = {};
    const provider = new OpenAiProvider('sk-test', 'gpt-test', (async (_url, init) => {
      sent = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify(answer()), { status: 200 });
    }) as typeof fetch);
    const result = await provider.structured({
      instructions: 'i',
      input: 'x',
      schema: { type: 'object' },
      schemaName: 'ideas',
    });
    expect(result).toMatchObject({ ok: true, data: { ideas: [] }, model: 'gpt-test' });
    expect(sent).toMatchObject({
      model: 'gpt-test',
      store: false,
      text: { format: { type: 'json_schema', name: 'ideas', strict: true } },
    });
  });
});
