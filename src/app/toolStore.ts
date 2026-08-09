/** Active tool, per-tool settings and the colour system — docs/01 §7, docs/02 §1. */
import { create } from 'zustand';
import type { Hex, ShapeType, TextAlign } from '../core/model/types';
import { PAINT_PALETTE, pushRecent } from '../core/color/palette';
import { DEFAULT_FONT } from '../ui/fonts';
import { invalidate } from './bus';

export type ToolId =
  'select' | 'pan' | 'pen' | 'marker' | 'eraser' | 'bucket' | 'eyedropper' | 'shape' | 'text';

export type FeatureTab = 'brushes' | 'shapes' | 'text' | 'noise' | 'recolour' | 'canvas';

export type TipShape = 'circle' | 'square';

export interface BrushSettings {
  size: number;
  tip: TipShape;
}

export interface ShapeSettings {
  type: ShapeType;
  fillEnabled: boolean;
  fillColor: Hex;
  fillAlpha: number;
  strokeEnabled: boolean;
  strokeColor: Hex;
  strokeAlpha: number;
  strokeWidth: number;
  crisp: boolean;
}

export interface TextSettings {
  fontFamily: string;
  sizePx: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  crisp: boolean;
}

interface ToolState {
  active: ToolId;
  tab: FeatureTab;
  /** Tool restored when a transient tool (Alt-eyedropper, space-pan) releases. */
  previous: ToolId | null;

  pen: BrushSettings;
  marker: BrushSettings;
  eraser: BrushSettings;
  bucket: { tolerancePct: number };
  shape: ShapeSettings;
  text: TextSettings;

  color: Hex;
  alpha: number;
  swatches: Hex[];
  recents: Hex[];

  setTool(id: ToolId): void;
  setTab(tab: FeatureTab): void;
  pushTransient(id: ToolId): void;
  popTransient(): void;
  setBrush(tool: 'pen' | 'marker' | 'eraser', patch: Partial<BrushSettings>): void;
  nudgeSize(delta: number): void;
  setBucket(patch: Partial<{ tolerancePct: number }>): void;
  setShape(patch: Partial<ShapeSettings>): void;
  setText(patch: Partial<TextSettings>): void;
  setColor(hex: Hex, alpha?: number): void;
  setAlpha(alpha: number): void;
  commitRecent(): void;
  addSwatch(hex?: Hex): void;
  removeSwatch(hex: Hex): void;
  hydrate(patch: Partial<Pick<ToolState, 'swatches' | 'recents' | 'color' | 'alpha'>>): void;
}

/** Which tool a feature tab activates when selected. */
export const TAB_TOOL: Record<FeatureTab, ToolId | null> = {
  brushes: 'pen',
  shapes: 'shape',
  text: 'text',
  noise: null,
  recolour: null,
  canvas: null,
};

export const BRUSH_TOOLS: ToolId[] = ['pen', 'marker', 'eraser', 'bucket', 'eyedropper'];

export const useToolStore = create<ToolState>((set, get) => ({
  active: 'pen',
  tab: 'brushes',
  previous: null,

  pen: { size: 1, tip: 'square' },
  marker: { size: 8, tip: 'circle' },
  eraser: { size: 4, tip: 'square' },
  bucket: { tolerancePct: 15 },
  shape: {
    type: 'rectangle',
    fillEnabled: true,
    fillColor: '#3FA7D6',
    fillAlpha: 1,
    strokeEnabled: true,
    strokeColor: '#000000',
    strokeAlpha: 1,
    strokeWidth: 1,
    crisp: true,
  },
  text: {
    fontFamily: DEFAULT_FONT,
    sizePx: 16,
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    crisp: true,
  },

  color: '#000000',
  alpha: 1,
  swatches: [],
  recents: [PAINT_PALETTE[0]],

  setTool(id) {
    set({ active: id, previous: null });
    invalidate(false);
  },

  setTab(tab) {
    const tool = TAB_TOOL[tab];
    set((s) => ({ tab, active: tool ?? s.active }));
    invalidate(false);
  },

  pushTransient(id) {
    const { active } = get();
    if (active === id) return;
    set({ previous: active, active: id });
    invalidate(false);
  },

  popTransient() {
    const { previous } = get();
    if (previous) set({ active: previous, previous: null });
    invalidate(false);
  },

  setBrush(tool, patch) {
    set((s) => ({ [tool]: { ...s[tool], ...patch } }) as Partial<ToolState>);
    invalidate(false);
  },

  nudgeSize(delta) {
    const { active } = get();
    if (active !== 'pen' && active !== 'marker' && active !== 'eraser') return;
    const size = Math.max(1, Math.min(64, get()[active].size + delta));
    get().setBrush(active, { size });
  },

  setBucket(patch) {
    set((s) => ({ bucket: { ...s.bucket, ...patch } }));
  },

  setShape(patch) {
    set((s) => ({ shape: { ...s.shape, ...patch } }));
    invalidate(false);
  },

  setText(patch) {
    set((s) => ({ text: { ...s.text, ...patch } }));
    invalidate(false);
  },

  setColor(hex, alpha) {
    set((s) => ({ color: hex.toUpperCase(), alpha: alpha ?? s.alpha }));
    invalidate(false);
  },

  setAlpha(alpha) {
    set({ alpha: Math.max(0, Math.min(1, alpha)) });
    invalidate(false);
  },

  commitRecent() {
    set((s) => ({ recents: pushRecent(s.recents, s.color) }));
  },

  addSwatch(hex) {
    const c = (hex ?? get().color).toUpperCase();
    set((s) => (s.swatches.includes(c) ? s : { swatches: [...s.swatches, c] }));
  },

  removeSwatch(hex) {
    set((s) => ({ swatches: s.swatches.filter((h) => h !== hex) }));
  },

  hydrate(patch) {
    set(patch);
  },
}));
