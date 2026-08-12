/** 3D model mode — canonical types (docs/11 §3). Pure data; no DOM, no GL. */
import type { Rect } from '../model/types';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Face = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
export type Axis = 'x' | 'y' | 'z';

export const FACES: Face[] = ['north', 'south', 'east', 'west', 'up', 'down'];

/** One model unit = 1/16 block; a full block spans 0..16. */
export const MODEL_UNIT = 16;

export interface ElementRotation {
  origin: Vec3;
  axis: Axis;
  angle: number;
  rescale?: boolean;
}

export interface ModelFace {
  /** [u1, v1, u2, v2] in 0..16 texture space, v measured from the texture's top. */
  uv: [number, number, number, number];
  /** Key into Model3D.textures (the leading '#' is not stored). */
  texture: string;
  rotation?: 0 | 90 | 180 | 270;
  cullface?: Face;
  tintindex?: number;
  /** Keys this build does not model, carried through a save (docs/11 §13.1). */
  extra?: Record<string, unknown>;
}

export interface ModelElement {
  id: number;
  name: string;
  groupId: number | null;
  from: Vec3;
  to: Vec3;
  rotation?: ElementRotation;
  faces: Partial<Record<Face, ModelFace>>;
  shade?: boolean;
  visible: boolean;
  locked: boolean;
  /** Keys this build does not model, carried through a save (docs/11 §13.1). */
  extra?: Record<string, unknown>;
}

export interface ModelGroup {
  id: number;
  name: string;
  parentId: number | null;
  origin: Vec3;
  rotation?: Vec3;
  visible: boolean;
  locked: boolean;
}

/** Where a texture variable's pixels actually live (docs/11 §4.3). */
export type TextureRef =
  | { kind: 'file'; sourceId: string; path: string; width: number; height: number }
  | {
      kind: 'region';
      sourceId: string;
      path: string;
      rect: Rect;
      sheetWidth: number;
      sheetHeight: number;
    }
  | { kind: 'unresolved'; ref: string };

export interface CameraState {
  target: Vec3;
  /** Degrees. yaw 0 & pitch 0 puts the camera on +z looking at the south face. */
  yaw: number;
  pitch: number;
  distance: number;
  projection: 'perspective' | 'orthographic';
  fov: number;
}

export type ModelFormat = 'java_block' | 'java_item' | 'bedrock_geo' | 'monet_model';

export interface Model3D {
  kind: 'model';
  id: string;
  name: string;
  dirty: boolean;
  binding?: { sourceId: string; path: string };
  format: ModelFormat;
  unit: typeof MODEL_UNIT;
  elements: ModelElement[];
  groups: ModelGroup[];
  textures: Record<string, TextureRef>;
  /** Parent refs that could not be resolved — shown as a banner, never a crash (docs/11 §4.2). */
  missing: string[];
  ambientocclusion?: boolean;
  guiLight?: 'front' | 'side';
  /** `display` slots as read, merged down the parent chain (docs/11 §10.2). */
  display?: Record<string, DisplaySlot>;
  /**
   * The SOURCE FILE's own JSON, untouched — the round-trip baseline (docs/11 §13.1). Writing
   * merges over it, so `parent` and any key this build does not model survive an edit.
   * Typed loosely to keep this module import-free.
   */
  raw?: Record<string, unknown>;
  /** JSON of the elements as loaded: unchanged + inherited geometry needs no `elements` out. */
  baseline?: string;
  /** JSON of `display` as loaded — an inherited, untouched slot is not the child's to declare. */
  displayBaseline?: string;
  camera: CameraState;
  vanillaMode: boolean;
  nextItemId: number;
}

/** One `display` slot: Minecraft's rotation (deg), translation (−80..80) and scale (≤4). */
export interface DisplaySlot {
  rotation?: Vec3;
  translation?: Vec3;
  scale?: Vec3;
}

/** The display slots Minecraft honours, in its own order. */
export const DISPLAY_SLOTS = [
  'thirdperson_righthand',
  'thirdperson_lefthand',
  'firstperson_righthand',
  'firstperson_lefthand',
  'gui',
  'head',
  'ground',
  'fixed',
] as const;

export type DisplaySlotName = (typeof DISPLAY_SLOTS)[number];

/** What a ray through the viewport found (docs/11 §7). */
export interface FaceHit {
  elementId: number;
  face: Face;
  /** Model-space point of the hit. */
  point: Vec3;
  /** 0..1 within the face's own texture, v downward — face uv rect and rotation applied. */
  uvNorm: { u: number; v: number };
  /** The face's texture variable (key into Model3D.textures). */
  textureVar: string;
  distance: number;
}

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Minecraft's fixed directional shading multipliers — docs/11 §5. */
export const FACE_SHADE: Record<Face, number> = {
  up: 1.0,
  down: 0.5,
  north: 0.8,
  south: 0.8,
  east: 0.6,
  west: 0.6,
};
