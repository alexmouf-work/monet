/** Common tool interface — docs/01 §8. */
import type { Vec2 } from '../core/model/types';
import type { View } from '../engine/viewport';
import type { ToolId } from '../app/toolStore';

export interface ToolPointerEvent {
  /** Doc-space float coordinates. */
  doc: Vec2;
  /** Screen-space (CSS px, workspace-relative) coordinates. */
  screen: Vec2;
  buttons: number;
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface Tool {
  id: ToolId;
  cursor: string;
  onPointerDown?(e: ToolPointerEvent): void;
  onPointerMove?(e: ToolPointerEvent): void;
  onPointerUp?(e: ToolPointerEvent): void;
  onKey?(e: KeyboardEvent): boolean | void;
  /** Screen-space overlay drawing. */
  drawOverlay?(ctx: CanvasRenderingContext2D, view: View): void;
  /** Commit pending state when switching away. */
  deactivate?(): void;
}
