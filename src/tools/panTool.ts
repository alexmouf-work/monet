import { useDocStore } from '../app/docStore';
import { useViewStore } from '../app/viewStore';
import type { Tool, ToolPointerEvent } from './types';

let last: { x: number; y: number } | null = null;

export const panTool: Tool = {
  id: 'pan',
  cursor: 'grab',

  onPointerDown(e: ToolPointerEvent) {
    last = { ...e.screen };
  },

  onPointerMove(e: ToolPointerEvent) {
    if (!last) return;
    const id = useDocStore.getState().activeId;
    if (!id) return;
    useViewStore.getState().pan(id, e.screen.x - last.x, e.screen.y - last.y);
    last = { ...e.screen };
  },

  onPointerUp() {
    last = null;
  },
};
