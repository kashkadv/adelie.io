import { describe, expect, it } from 'vitest';
import { OpenAiProvider, costMicros, readResponse } from '../ai/provider.js';
import { ideasSchema, parseBrief, parseIdeas, resolveFocus, todayIn } from './ideas.js';

describe('brief', () => {
  it('needs what the project is', () => {
    expect(parseBrief({ directions: [{ name: 'x' }] })).toBeNull();
  });

  it('keeps directions with known channels; ids stay unique', () => {
    expect(
      parseBrief({
        about: ' Wool rugs ',
        directions: [
          { id: 'world', name: 'World', channels: ['pinterest', 'myspace', 'pinterest'] },
          { id: 'world', name: 'Duplicate' },
          { id: 'Bad Id', name: 'Ukraine', language: 'українська', channels: ['instagram'] },
          {},
        ],
      }),
    ).toEqual({
      about: 'Wool rugs',
      assets: '',
      directions: [
        {
          id: 'world',
          name: 'World',
          goal: '',
          audience: '',
          language: '',
          channels: ['pinterest'],
        },
        {
          id: 'd3',
          name: 'Ukraine',
          goal: '',
          audience: '',
          language: 'українська',
          channels: ['instagram'],
        },
      ],
    });
  });

  it('a brief saved before directions reads as one direction', () => {
    expect(
      parseBrief({
        about: 'Rugs',
        goal: 'Etsy sales',
        language: 'English',
        channels: ['pinterest'],
      }),
    ).toMatchObject({
      directions: [{ id: 'd1', goal: 'Etsy sales', language: 'English', channels: ['pinterest'] }],
    });
  });
});

describe('week focus', () => {
  const dirs = [{ id: 'world' }, { id: 'ua' }];
  it('the week’s own choice wins', () => {
    expect(resolveFocus(dirs, [{ weekStart: '2026-11-16', focus: 'ua' }], '2026-11-16')).toEqual({
      value: 'ua',
      isDefault: false,
    });
  });
  it('alternates from the last choice', () => {
    const chosen = [{ weekStart: '2026-11-09', focus: 'world' }];
    expect(resolveFocus(dirs, chosen, '2026-11-16')).toEqual({ value: 'ua', isDefault: true });
    expect(resolveFocus(dirs, chosen, '2026-11-23').value).toBe('world');
    expect(
      resolveFocus(dirs, [{ weekStart: '2026-11-09', focus: 'all' }], '2026-11-16').value,
    ).toBe('all');
  });
  it('without any choice: by the week’s number; one direction: it', () => {
    const a = resolveFocus(dirs, [], '2026-11-16').value;
    const b = resolveFocus(dirs, [], '2026-11-23').value;
    expect(a).not.toBe(b);
    expect(resolveFocus([{ id: 'only' }], [], '2026-11-16')).toEqual({
      value: 'only',
      isDefault: true,
    });
  });
});

describe('ideas', () => {
  const days = ['2026-11-14', '2026-11-15'];
  it('keeps valid ideas on one of the given days', () => {
    expect(
      parseIdeas(
        {
          ideas: [
            {
              title: 'Rug care tips',
              channel: 'pinterest',
              format: 'pin',
              day: '2026-11-15',
              minutes: 2.4,
              notes: 'n',
              why: 'w',
              evidence: 'results',
            },
            { title: 'x', channel: 'myspace', format: 'pin' },
            {
              title: 'Reel',
              channel: 'instagram',
              format: 'short',
              day: '2026-11-10',
              minutes: 'a',
            },
          ],
        },
        days,
      ),
    ).toEqual([
      {
        title: 'Rug care tips',
        channel: 'pinterest',
        format: 'pin',
        day: '2026-11-15',
        minutes: 5,
        notes: 'n',
        why: 'w',
        evidence: 'results',
      },
      {
        title: 'Reel',
        channel: 'instagram',
        format: 'short',
        day: '2026-11-14',
        minutes: 30,
        notes: '',
        why: '',
        evidence: 'hypothesis',
      },
    ]);
    expect(parseIdeas(null, days)).toEqual([]);
  });

  it('the schema is strict and limited to the days and channels given', () => {
    const schema = ideasSchema(days, ['pinterest']);
    const item = schema.properties.ideas.items;
    expect([...item.required].sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.properties.day.enum).toEqual(days);
    expect(item.properties.channel.enum).toEqual(['pinterest']);
  });

  it('today is the project’s day', () => {
    const late = new Date('2026-11-13T23:30:00Z');
    expect(todayIn('Europe/Kyiv', late)).toBe('2026-11-14');
    expect(todayIn('America/New_York', late)).toBe('2026-11-13');
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
