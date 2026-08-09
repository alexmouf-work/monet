/** Importing this module registers every implemented tool. */
import { registerTool } from './registry';
import { panTool } from './panTool';
import { eraserTool, markerTool, penTool } from './brushTools';

registerTool(panTool);
registerTool(penTool);
registerTool(markerTool);
registerTool(eraserTool);

export { getTool, registerTool } from './registry';
