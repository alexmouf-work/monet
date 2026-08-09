import { describe, it, expect } from 'vitest';
import { MonetFileError, readMonet, writeMonet } from '../src/core/io/monetFile';
import { createDoc } from '../src/core/model/document';
import type { MonetDoc, TextObject } from '../src/core/model/types';

function sampleDoc(): MonetDoc {
  const doc = createDoc({ name: 'sword', width: 4, height: 3 });
  const layer = doc.stack[0] as { pixels: Uint8ClampedArray };
  for (let i = 0; i < layer.pixels.length; i++) layer.pixels[i] = (i * 7) % 256;
  const text: TextObject = {
    kind: 'text',
    id: doc.nextItemId++,
    transform: { cx: 2, cy: 1, w: 4, h: 2, rotation: 30, flipX: false, flipY: true },
    text: 'hi\nthere',
    fontFamily: 'Monocraft',
    sizePx: 8,
    bold: true,
    italic: false,
    underline: true,
    align: 'center',
    color: '#FF00AA',
    alpha: 0.5,
    crisp: true,
  };
  doc.stack.push(text);
  doc.background = { mode: 'color', color: '#123456' };
  return doc;
}

describe('.monet round-trip', () => {
  it('is byte-exact for pixels and deep-equal for objects', async () => {
    const doc = sampleDoc();
    const back = await readMonet(await writeMonet(doc));

    expect(back.name).toBe('sword');
    expect([back.width, back.height]).toEqual([4, 3]);
    expect(back.background).toEqual({ mode: 'color', color: '#123456' });
    expect(back.stack).toHaveLength(2);
    expect([...(back.stack[0] as any).pixels]).toEqual([...(doc.stack[0] as any).pixels]);
    expect(back.stack[1]).toEqual(doc.stack[1]);
    expect(back.nextItemId).toBeGreaterThan(2);
    expect(back.dirty).toBe(false);
  });

  it('preserves an empty stack document', async () => {
    const doc = createDoc({ width: 2, height: 2 });
    doc.stack = [];
    const back = await readMonet(await writeMonet(doc));
    expect(back.stack).toEqual([]);
  });
});

describe('.monet validation', () => {
  it('rejects a non-zip', async () => {
    await expect(readMonet(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(MonetFileError);
  });

  it('rejects a newer format version', async () => {
    const bytes = await writeMonet(createDoc({ width: 2, height: 2 }));
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const m = JSON.parse(await zip.file('manifest.json')!.async('string'));
    m.version = 99;
    zip.file('manifest.json', JSON.stringify(m));
    await expect(readMonet(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /newer version/,
    );
  });

  it('rejects a layer whose byte length disagrees with the canvas size', async () => {
    const bytes = await writeMonet(createDoc({ width: 4, height: 4 }));
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    zip.file('layers/1.raw', new Uint8Array(8));
    await expect(readMonet(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /expected 64/,
    );
  });

  it('rejects unknown item kinds', async () => {
    const bytes = await writeMonet(createDoc({ width: 2, height: 2 }));
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(bytes);
    const m = JSON.parse(await zip.file('manifest.json')!.async('string'));
    m.stack.push({ kind: 'sticker', id: 9 });
    zip.file('manifest.json', JSON.stringify(m));
    await expect(readMonet(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(
      /unknown item kind/,
    );
  });
});
