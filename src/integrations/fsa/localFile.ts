/**
 * Local file access — docs/07 §8. File System Access API where available (Chromium), with
 * an <input type=file> / download fallback everywhere else.
 */

export interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface FsaWindow {
  showSaveFilePicker?(o: {
    suggestedName?: string;
    types?: PickerType[];
  }): Promise<FileSystemFileHandle>;
  showOpenFilePicker?(o: {
    multiple?: boolean;
    types?: PickerType[];
  }): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?(o?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}

const w = () => window as unknown as FsaWindow;

export const hasFsaSave = () => typeof w().showSaveFilePicker === 'function';
export const hasFsaOpen = () => typeof w().showOpenFilePicker === 'function';
export const hasFsaDirectory = () => typeof w().showDirectoryPicker === 'function';

export const TYPE_PNG: PickerType = { description: 'PNG image', accept: { 'image/png': ['.png'] } };
export const TYPE_MONET: PickerType = {
  description: 'Monet project',
  accept: { 'application/zip': ['.monet'] },
};
export const TYPE_IMAGES: PickerType = {
  description: 'Images and projects',
  accept: {
    'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.ico'],
    'application/zip': ['.monet'],
  },
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A save target: a real handle (silent overwrites) or a download (always a new file). */
export type SaveTarget =
  | { kind: 'handle'; handle: FileSystemFileHandle; name: string }
  | { kind: 'download'; name: string };

export async function pickSaveTarget(
  suggestedName: string,
  types: PickerType[],
): Promise<SaveTarget | null> {
  if (hasFsaSave()) {
    try {
      const handle = await w().showSaveFilePicker!({ suggestedName, types });
      return { kind: 'handle', handle, name: handle.name || suggestedName };
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return null;
      // Fall through to a download when the picker is unavailable or blocked.
    }
  }
  return { kind: 'download', name: suggestedName };
}

export async function writeToTarget(target: SaveTarget, blob: Blob): Promise<void> {
  if (target.kind === 'download') {
    downloadBlob(blob, target.name);
    return;
  }
  const writable = await (target.handle as any).createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Re-request write permission after a reload (handles persist, grants do not). */
export async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as any;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function pickOpenFiles(types: PickerType[], multiple = false): Promise<File[]> {
  if (hasFsaOpen()) {
    try {
      const handles = await w().showOpenFilePicker!({ multiple, types });
      return Promise.all(handles.map((h) => h.getFile()));
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return [];
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = types.flatMap((t) => Object.values(t.accept).flat()).join(',');
    input.onchange = () => resolve(input.files ? [...input.files] : []);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Handles from a picker, kept per document so plain Ctrl+S can overwrite silently. */
const handles = new Map<string, FileSystemFileHandle>();

export const rememberHandle = (docId: string, handle: FileSystemFileHandle) =>
  handles.set(docId, handle);
export const recallHandle = (docId: string) => handles.get(docId);
export const forgetHandle = (docId: string) => handles.delete(docId);
