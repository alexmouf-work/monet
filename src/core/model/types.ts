/** Canonical document data shapes — docs/01 §3. Single source of truth. */

export type Hex = string; // '#RRGGBB' (alpha carried separately, 0–1)

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Transform {
  cx: number;
  cy: number; // centre, doc-space px (float)
  w: number;
  h: number; // unrotated size, doc-space px (>0)
  rotation: number; // degrees, 0–360, clockwise
  flipX: boolean;
  flipY: boolean;
}

export interface FillStyle {
  enabled: boolean;
  color: Hex;
  alpha: number; // 0–1
}

export interface StrokeStyle {
  enabled: boolean;
  color: Hex;
  alpha: number; // 0–1
  width: number; // px ≥ 1
}

export type ShapeType =
  | 'triangle'
  | 'rectangle'
  | 'pentagon'
  | 'hexagon'
  | 'circle'
  | 'ellipse'
  | 'arrow'
  | 'arrowhead'
  | 'line'
  | 'spline';

export interface RasterLayer {
  kind: 'raster';
  id: number;
  /** width*height*4, RGBA un-premultiplied — the source of truth for raster content. */
  pixels: Uint8ClampedArray;
}

export interface ShapeObject {
  kind: 'shape';
  id: number;
  shape: ShapeType;
  transform: Transform;
  fill: FillStyle;
  stroke: StrokeStyle;
  /** line/spline/arrowhead: unit space [0..1]² */
  points?: Vec2[];
  crisp: boolean;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextObject {
  kind: 'text';
  id: number;
  transform: Transform; // w = wrap width; h derived and kept in sync
  text: string; // '\n' separated
  fontFamily: string;
  sizePx: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  color: Hex;
  alpha: number;
  crisp: boolean;
}

export type Item = RasterLayer | ShapeObject | TextObject;
export type ObjectItem = ShapeObject | TextObject;

export interface Background {
  mode: 'transparent' | 'color';
  /** Persists across mode toggles — docs/06 §1.1. */
  color: Hex;
}

/** Where Ctrl+S goes — docs/08. */
export interface SourceBinding {
  sourceId: string;
  path: string; // repo/folder-relative PNG path
  /**
   * When set, this document is an on-demand extraction of one rectangle of a sheet/atlas
   * (docs/11 §9.2): saving blits the region back into the sheet instead of replacing the file.
   */
  region?: Rect;
}

export interface MonetDoc {
  id: string;
  name: string;
  width: number;
  height: number; // 1–4096
  background: Background;
  stack: Item[]; // index 0 = bottom
  nextItemId: number;
  binding?: SourceBinding;
  dirty: boolean;
}

export const MAX_DIM = 4096;

export const isRaster = (i: Item): i is RasterLayer => i.kind === 'raster';
export const isObject = (i: Item): i is ObjectItem => i.kind !== 'raster';
