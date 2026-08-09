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
  const [opts, setOpts] = useState(() => (doc ? defaultExportOptions(doc) : null));
  const [busy, setBusy] = useState(false);

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
