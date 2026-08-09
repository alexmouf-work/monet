/** Importing this module registers every implemented tool. */
import { registerTool } from './registry';
import { panTool } from './panTool';

registerTool(panTool);

export { getTool, registerTool } from './registry';
