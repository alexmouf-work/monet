/** Importing this module registers every implemented tool. */
import { registerTool } from './registry';
import { panTool } from './panTool';
import { eraserTool, markerTool, penTool } from './brushTools';
import { bucketTool } from './bucketTool';
import { eyedropperTool } from './eyedropperTool';
import { selectTool } from './selectTool';
import { shapeTool } from './shapeTool';
import { textTool } from './textTool';

registerTool(panTool);
registerTool(penTool);
registerTool(markerTool);
registerTool(eraserTool);
registerTool(bucketTool);
registerTool(eyedropperTool);
registerTool(selectTool);
registerTool(shapeTool);
registerTool(textTool);

export { getTool, registerTool } from './registry';
