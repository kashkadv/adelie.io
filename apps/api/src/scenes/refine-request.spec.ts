import { describe, expect, it } from 'vitest';
import { parseRefineAnswer, refineInput } from './refine-request.js';

describe('refine request', () => {
  it('takes a usable instruction and tidies its spaces', () => {
    expect(
      parseRefineAnswer({ instruction: '  In the red-tinted area,\n replace the window  ' }),
    ).toBe('In the red-tinted area, replace the window');
  });

  it('refuses an empty or missing instruction', () => {
    expect(parseRefineAnswer({ instruction: ' ' })).toBeNull();
    expect(parseRefineAnswer({})).toBeNull();
    expect(parseRefineAnswer(null)).toBeNull();
  });

  it('tells the AI whether the request is about a marked area', () => {
    const area = refineInput({
      request: 'прибери вікно',
      area: true,
      sceneType: 'Вітальня',
      location: null,
    });
    expect(area).toContain('прибери вікно');
    expect(area).toContain('tinted red');
    expect(area).not.toContain('The place');
    const whole = refineInput({
      request: 'darker walls',
      area: false,
      sceneType: null,
      location: 'Carpathian chalet',
    });
    expect(whole).toContain('whole photo');
    expect(whole).toContain('Carpathian chalet');
  });
});
