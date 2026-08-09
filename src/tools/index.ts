/** Importing this module registers every implemented tool. */
import { registerTool } from './registry';
import { panTool } from './panTool';
import { eraserTool, markerTool, penTool } from './brushTools';
import { bucketTool } from './bucketTool';
import { eyedropperTool } from './eyedropperTool';

registerTool(panTool);
registerTool(penTool);
registerTool(markerTool);
registerTool(eraserTool);
registerTool(bucketTool);
registerTool(eyedropperTool);

export { getTool, registerTool } from './registry';
