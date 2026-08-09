/** Read-only shortcut reference — docs/09 §6/§7. */
import { Dialog } from './Dialog';

const GROUPS: [string, [string, string][]][] = [
  [
    'Tools',
    [
      ['B', 'Pixel pen'],
      ['M', 'Marker'],
      ['E', 'Eraser'],
      ['F', 'Paint bucket'],
      ['I', 'Eyedropper'],
      ['S', 'Select'],
      ['H / hold Space', 'Pan'],
      ['[ / ]', 'Brush size − / +'],
      ['Alt + click', 'Pick colour with any tool'],
    ],
  ],
  [
    'Tabs',
    [
      ['B', 'Brushes'],
      ['U', 'Shapes'],
      ['T', 'Text'],
      ['N', 'Noise'],
      ['R', 'Recolour'],
      ['C', 'Canvas'],
    ],
  ],
  [
    'File',
    [
      ['Ctrl+N', 'New'],
      ['Ctrl+O', 'Open'],
      ['Ctrl+S', 'Save'],
      ['Ctrl+Shift+S', 'Save As'],
      ['Ctrl+Shift+E', 'Export'],
      ['Ctrl+W', 'Close tab'],
    ],
  ],
  [
    'Edit',
    [
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
      ['Ctrl+C / X / V', 'Copy / Cut / Paste'],
      ['Del', 'Delete selection or object'],
      ['Ctrl+A', 'Select all'],
      ['Ctrl+D', 'Duplicate object'],
      ['Ctrl+Shift+X', 'Crop to selection'],
      ['Ctrl+Shift+F', 'Flatten image'],
      ['Arrows / Shift+Arrows', 'Nudge 1 / 10 px'],
    ],
  ],
  [
    'View',
    [
      ['Scroll up / down', 'Zoom in / out at cursor'],
      ['Ctrl+0', 'Fit'],
      ['Ctrl+1', '100 %'],
      ['+ / −', 'Zoom in / out'],
      ['G', 'Cycle pixel grid'],
      ['Ctrl+T', 'Tiling preview'],
      ['Ctrl+E', 'Resize canvas'],
      ['Esc', 'Cancel / deselect'],
      ['?', 'This list'],
    ],
  ],
];

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog
      title="Keyboard shortcuts"
      onCancel={onClose}
      onConfirm={onClose}
      confirmLabel="Close"
      wide
    >
      <div className="shortcuts">
        {GROUPS.map(([title, rows]) => (
          <section key={title}>
            <h3>{title}</h3>
            <table>
              <tbody>
                {rows.map(([keys, what]) => (
                  <tr key={keys + what}>
                    <td>
                      <kbd>{keys}</kbd>
                    </td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
