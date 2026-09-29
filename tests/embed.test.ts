import { describe, expect, it } from 'vitest';
import { EMBED_DEFAULT_SIZE, embedDim, hostOrigins, parseEmbed } from '../src/core/io/embed';
import { MAX_DIM } from '../src/core/model/types';

describe('embed mode parameters (docs/07 §12)', () => {
  it('reads ?embed=1&w=&h=', () => {
    expect(parseEmbed('?embed=1&w=1024&h=768')).toEqual({ width: 1024, height: 768 });
    expect(parseEmbed('?embed=1')).toEqual({
      width: EMBED_DEFAULT_SIZE,
      height: EMBED_DEFAULT_SIZE,
    });
    expect(parseEmbed('?w=10&h=10')).toBeNull();
    expect(parseEmbed('?embed=0')).toBeNull();
  });
  it('keeps sizes whole and within MAX_DIM', () => {
    expect(embedDim('12.6')).toBe(13);
    expect(embedDim('0')).toBe(EMBED_DEFAULT_SIZE);
    expect(embedDim('nonsense')).toBe(EMBED_DEFAULT_SIZE);
    expect(embedDim(MAX_DIM * 2)).toBe(MAX_DIM);
  });
  it('trusts the configured hosts, else only the framing page', () => {
    expect(hostOrigins('https://a.example, https://b.example/', 'https://c.example/x')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(hostOrigins(undefined, 'https://lemma.example/m/X/s/1?slide=2')).toEqual([
      'https://lemma.example',
    ]);
    expect(hostOrigins('', '')).toEqual([]);
  });
});
