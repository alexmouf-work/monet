/**
 * Tool registry. Tools register themselves here as they are implemented; unregistered
 * ids fall back to a no-op so the app always runs.
 */
import type { ToolId } from '../app/toolStore';
import type { Tool } from './types';

const noop = (id: ToolId): Tool => ({ id, cursor: 'default' });

const tools = new Map<ToolId, Tool>();

export function registerTool(tool: Tool): void {
  tools.set(tool.id, tool);
}

export const getTool = (id: ToolId): Tool => tools.get(id) ?? noop(id);
