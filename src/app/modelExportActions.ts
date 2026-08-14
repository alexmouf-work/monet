/**
 * Model export — docs/11 §13.3: Java JSON, Bedrock `.geo.json`, the `.monet_model` project,
 * and render-to-PNG from the live camera. Every one is a download; jar sources are read-only
 * and folder/repo model write-back rides with the source layer, not here.
 */
import { downloadBlob } from '../integrations/fsa/localFile';
import { encodePixelsToPng } from '../engine/exporters';
import { writeJavaModel } from '../core/model3d/javaModelWriter';
import { writeBedrockGeometry } from '../core/model3d/bedrockWriter';
import { writeMonetModel } from '../core/model3d/monetModelFile';
import type { Model3D } from '../core/model3d/types';
import { modelRenderer } from './modelViewState';
import { toast } from './bus';

export type ModelExportFormat = 'java' | 'bedrock' | 'monet_model' | 'png' | 'bundle';

export const MODEL_EXPORT_LABEL: Record<ModelExportFormat, string> = {
  java: 'Java model (.json)',
  bedrock: 'Bedrock geometry (.geo.json)',
  monet_model: 'Monet project (.monet_model)',
  png: 'Render to PNG (current camera)',
  bundle: 'Model bundle (.zip — model + every texture)',
};

const safeName = (model: Model3D) => model.name.replace(/\s+/g, '_') || 'model';

export async function exportModel(model: Model3D, format: ModelExportFormat): Promise<void> {
  const base = safeName(model);
  switch (format) {
    case 'java': {
      const json = writeJavaModel(model);
      downloadBlob(new Blob([json], { type: 'application/json' }), `${base}.json`);
      toast(`Exported ${base}.json`, 'ok');
      return;
    }
    case 'bedrock': {
      const json = writeBedrockGeometry(model);
      downloadBlob(new Blob([json], { type: 'application/json' }), `${base}.geo.json`);
      toast(`Exported ${base}.geo.json`, 'ok');
      return;
    }
    case 'monet_model': {
      const bytes = await writeMonetModel(model);
      downloadBlob(
        new Blob([bytes as BlobPart], { type: 'application/zip' }),
        `${base}.monet_model`,
      );
      toast(`Exported ${base}.monet_model`, 'ok');
      return;
    }
    case 'bundle': {
      const { downloadBundleZip } = await import('./modelBundleActions');
      await downloadBundleZip(model);
      return;
    }
    case 'png': {
      const frame = modelRenderer()?.readFrame();
      if (!frame) {
        toast('The 3D viewport is not available, so there is nothing to render.', 'error');
        return;
      }
      const png = await encodePixelsToPng(frame.pixels, frame.width, frame.height);
      downloadBlob(new Blob([png as BlobPart], { type: 'image/png' }), `${base}.png`);
      toast(`Rendered ${base}.png (${frame.width}×${frame.height})`, 'ok');
      return;
    }
  }
}
