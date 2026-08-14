import { describe, expect, it } from 'vitest';
import { basename, bundleNeeds, matchPath, placeholderPixels } from '../src/core/model3d/bundle';
import type { RawJavaModel } from '../src/core/model3d/javaModel';
import { bundlePathFor } from '../src/integrations/fsa/modelBundle';

describe('matching a wanted asset against the files on offer', () => {
  const want = 'assets/mymod/textures/block/gear.png';

  it('prefers an exact path, then a suffix, then the basename', () => {
    expect(matchPath(want, [want, 'other.png'])).toBe(want);
    expect(matchPath(want, [`src/main/resources/${want}`])).toBe(`src/main/resources/${want}`);
    expect(matchPath(want, ['loose/gear.png'])).toBe('loose/gear.png');
  });

  it('is case-insensitive but refuses an ambiguous basename', () => {
    expect(matchPath(want, ['Loose/GEAR.PNG'])).toBe('Loose/GEAR.PNG');
    // Two files called gear.png in different folders: guessing would pick the wrong art.
    expect(matchPath(want, ['a/gear.png', 'b/gear.png'])).toBeNull();
  });

  it('returns null when nothing is close', () => {
    expect(matchPath(want, ['assets/mymod/textures/block/cog.png'])).toBeNull();
    expect(basename('a/b/Stone.PNG')).toBe('stone.png');
  });
});

describe('what a model needs', () => {
  const read = (models: Record<string, RawJavaModel>) => (path: string) => models[path] ?? null;

  it('lists the textures a standalone model references', () => {
    const root: RawJavaModel = {
      textures: { all: 'mymod:block/gear', particle: '#all' },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16] }],
    };
    const needs = bundleNeeds(root, read({}));
    expect(needs.textures).toEqual(['assets/mymod/textures/block/gear.png']);
    expect(needs.models).toEqual([]);
    expect(needs.unresolved).toEqual([]);
  });

  it('resolves vanilla parents from the builtin table, asking for nothing', () => {
    const root: RawJavaModel = {
      parent: 'minecraft:block/cube_all',
      textures: { all: 'minecraft:block/stone' },
    };
    const needs = bundleNeeds(root, read({}));
    expect(needs.models).toEqual([]);
    expect(needs.textures).toEqual(['assets/minecraft/textures/block/stone.png']);
  });

  it('asks for a mod parent it has never seen, and stops guessing there', () => {
    const root: RawJavaModel = {
      parent: 'mymod:block/machine',
      textures: { top: 'mymod:block/t' },
    };
    const needs = bundleNeeds(root, read({}));
    expect(needs.models).toEqual(['assets/mymod/models/block/machine.json']);
  });

  it('picks up the parent’s textures once that parent arrives, child winning', () => {
    const parent: RawJavaModel = {
      textures: { side: 'mymod:block/side', top: 'mymod:block/parent_top' },
      elements: [{ from: [0, 0, 0], to: [16, 16, 16] }],
    };
    const root: RawJavaModel = {
      parent: 'mymod:block/machine',
      textures: { top: 'mymod:block/child_top' },
    };
    const needs = bundleNeeds(root, read({ 'assets/mymod/models/block/machine.json': parent }));
    expect(needs.models).toEqual([]);
    expect(needs.textures.sort()).toEqual([
      'assets/mymod/textures/block/child_top.png', // child overrode the parent's top
      'assets/mymod/textures/block/side.png',
    ]);
  });

  it('reports a variable that only ever points at another variable', () => {
    const root: RawJavaModel = { textures: { all: '#missing' } };
    expect(bundleNeeds(root, read({})).unresolved).toEqual(['#all']);
  });

  it('survives a parent cycle', () => {
    const a: RawJavaModel = { parent: 'mymod:b' };
    const b: RawJavaModel = { parent: 'mymod:a' };
    const needs = bundleNeeds(
      a,
      read({ 'assets/mymod/models/b.json': b, 'assets/mymod/models/a.json': a }),
    );
    expect(needs.textures).toEqual([]);
  });
});

describe('where a picked file lands in the bundle', () => {
  it('keeps an assets-relative path from wherever it starts', () => {
    expect(bundlePathFor('src/main/resources/assets/mymod/textures/block/gear.png')).toBe(
      'assets/mymod/textures/block/gear.png',
    );
    expect(bundlePathFor('assets/mymod/models/block/gear.json')).toBe(
      'assets/mymod/models/block/gear.json',
    );
  });

  it('gives a loose file a synthetic path so refs can still find it by name', () => {
    expect(bundlePathFor('gear.png')).toBe('assets/minecraft/textures/gear.png');
    expect(bundlePathFor('machine.json')).toBe('assets/minecraft/models/machine.json');
  });
});

describe('the placeholder', () => {
  it('is a magenta/black checker with opaque alpha', () => {
    const px = placeholderPixels(16, 8);
    expect(px.length).toBe(16 * 16 * 4);
    const at = (x: number, y: number) => [...px.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([248, 0, 248, 255]); // magenta
    expect(at(8, 0)).toEqual([0, 0, 0, 255]); // black
    expect(at(0, 8)).toEqual([0, 0, 0, 255]);
    expect(at(8, 8)).toEqual([248, 0, 248, 255]);
  });
});
