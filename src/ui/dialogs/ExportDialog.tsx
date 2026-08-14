/** Export — docs/09 §6, formats per docs/07. */
import { useState } from 'react';
import { Dialog } from './Dialog';
import { ICO_SIZES } from '../../core/io/ico';
import { fitToPage } from '../../core/io/pdfFit';
import {
  EXPORT_EXT,
  availableFormats,
  defaultExportOptions,
  exportDocument,
  type ExportFormat,
} from '../../app/exportActions';
import {
  MODEL_EXPORT_LABEL,
  exportModel,
  type ModelExportFormat,
} from '../../app/modelExportActions';
import { isBundleModel } from '../../app/modelBundleActions';
import type { Model3D } from '../../core/model3d/types';
import { useDocStore } from '../../app/docStore';
import { Slider } from '../controls/Slider';

const LABELS: Record<ExportFormat, string> = {
  png: 'PNG — lossless, keeps transparency (default)',
  jpeg: 'JPEG — lossy, no transparency',
  webp: 'WebP — lossy, keeps transparency',
  ico: 'ICO — Windows icon, multiple sizes',
  bmp: 'BMP — 32-bit with alpha',
  pdf: 'PDF — one page, image fitted edge to edge',
};

export function ExportDialog({ onClose }: { onClose(): void }) {
  const doc = useDocStore((s) => (s.activeId ? s.docs[s.activeId] : null));
  const model = useDocStore((s) => (s.activeId ? s.models[s.activeId] : null));
  const [opts, setOpts] = useState(() => (doc ? defaultExportOptions(doc) : null));
  const [busy, setBusy] = useState(false);

  // A model document exports model formats instead of image ones (docs/11 §13.3).
  if (model) return <ModelExportDialog model={model} onClose={onClose} />;
  if (!doc || !opts) return null;
  const patch = (p: Partial<typeof opts>) => setOpts({ ...opts, ...p });
  const lossy = opts.format === 'jpeg' || opts.format === 'webp';
  const fit = fitToPage(doc.width, doc.height);

  return (
    <Dialog
      title="Export"
      onCancel={onClose}
      confirmLabel={busy ? 'Exporting…' : 'Export'}
      confirmDisabled={busy}
      onConfirm={() => {
        setBusy(true);
        void exportDocument(doc, opts).then(() => {
          setBusy(false);
          onClose();
        });
      }}
    >
      <label className="field-col">
        <span className="field-label">Format</span>
        <select
          value={opts.format}
          onChange={(e) => patch({ format: e.target.value as ExportFormat })}
        >
          {availableFormats().map((f) => (
            <option key={f} value={f}>
              {LABELS[f]}
            </option>
          ))}
        </select>
      </label>

      <div className="field-row">
        <label style={{ flex: 1 }}>
          Filename
          <input
            type="text"
            style={{ flex: 1 }}
            value={opts.filename}
            onChange={(e) => patch({ filename: e.target.value })}
          />
        </label>
        <span className="field-label">.{EXPORT_EXT[opts.format]}</span>
      </div>

      {lossy && (
        <Slider
          label="Quality"
          suffix="%"
          min={5}
          max={100}
          value={Math.round(opts.quality * 100)}
          onChange={(v) => patch({ quality: v / 100 })}
        />
      )}

      {opts.format === 'jpeg' && (
        <p className="panel__hint">
          Transparent areas are filled with{' '}
          {doc.background.mode === 'color' ? doc.background.color : 'white'}.
        </p>
      )}

      {opts.format === 'ico' && (
        <>
          <span className="field-label">Sizes</span>
          <div className="presets">
            {ICO_SIZES.map((size) => (
              <label key={size} className="chipbtn">
                <input
                  type="checkbox"
                  checked={opts.icoSizes.includes(size)}
                  onChange={(e) =>
                    patch({
                      icoSizes: e.target.checked
                        ? [...opts.icoSizes, size]
                        : opts.icoSizes.filter((s) => s !== size),
                    })
                  }
                />{' '}
                {size}
              </label>
            ))}
          </div>
          {opts.icoSizes.length === 0 && (
            <p className="panel__hint">No sizes selected — the defaults will be used.</p>
          )}
        </>
      )}

      {opts.format === 'pdf' && (
        <p className="panel__hint">
          A4 {fit.landscape ? 'landscape' : 'portrait'}, image drawn at {Math.round(fit.drawW)} ×{' '}
          {Math.round(fit.drawH)} pt with no margin on the{' '}
          {Math.abs(fit.drawW - fit.pageW) < 0.01 ? 'long' : 'short'} axis.
        </p>
      )}

      <p className="panel__hint">
        Source: {doc.width} × {doc.height} px
      </p>
    </Dialog>
  );
}

/** Model documents export geometry formats and camera renders instead (docs/11 §13.3). */
function ModelExportDialog({ model, onClose }: { model: Model3D; onClose(): void }) {
  const [format, setFormat] = useState<ModelExportFormat>('java');
  const [busy, setBusy] = useState(false);
  const missing = model.missing.length > 0;

  return (
    <Dialog
      title={`Export ${model.name}`}
      onCancel={onClose}
      confirmLabel={busy ? 'Exporting…' : 'Export'}
      confirmDisabled={busy}
      onConfirm={() => {
        setBusy(true);
        void exportModel(model, format).then(() => {
          setBusy(false);
          onClose();
        });
      }}
    >
      <label className="field-col">
        <span className="field-label">Format</span>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as ModelExportFormat)}
          autoFocus
        >
          {(Object.keys(MODEL_EXPORT_LABEL) as ModelExportFormat[])
            .filter((f) => f !== 'bundle' || isBundleModel(model))
            .map((f) => (
              <option key={f} value={f}>
                {MODEL_EXPORT_LABEL[f]}
              </option>
            ))}
        </select>
      </label>

      {format === 'java' && (
        <p className="panel__hint">
          Minecraft key order and 0–16 numbers. `parent` and any key Monet does not model are
          preserved, and inherited geometry you have not touched is left inherited.
        </p>
      )}
      {format === 'bedrock' && (
        <p className="panel__hint">
          Format 1.12.0, one bone. Bedrock mirrors x and puts the origin at the block’s bottom
          centre, so coordinates shift and east/west swap — the geometry is converted, not copied.
        </p>
      )}
      {format === 'monet_model' && (
        <p className="panel__hint">
          Editable project: elements, groups, UVs, camera and the round-trip baseline. Texture
          pixels stay in their sources rather than being copied in.
        </p>
      )}
      {format === 'bundle' && (
        <p className="panel__hint">
          Everything you loaded, back out as a zip: the model JSON as it now stands plus every
          texture with your edits in it, at the paths Minecraft expects.
        </p>
      )}
      {format === 'png' && (
        <p className="panel__hint">
          The model from the current camera, at the viewport’s size, on transparency — the grid,
          gizmo and selection highlight are left out, so frame the model and the render is an icon.
        </p>
      )}

      <p className="panel__hint">
        {model.elements.length} element{model.elements.length === 1 ? '' : 's'}
        {missing ? ` · ${model.missing.length} unresolved reference(s)` : ''}
      </p>
    </Dialog>
  );
}
