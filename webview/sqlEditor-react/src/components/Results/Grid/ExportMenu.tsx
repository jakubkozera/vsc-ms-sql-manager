import { useRef, useEffect, useState } from 'react';
import { ExportFormat } from '../../../services/exportService';
import './ExportMenu.css';

interface ExportMenuProps {
  position: { x: number; y: number };
  onExport: (format: ExportFormat, includeHeaders: boolean) => void;
  onClose: () => void;
  hasSelection?: boolean;
}

const EXPORT_FORMATS: { format: ExportFormat; label: string; description: string }[] = [
  { format: 'clipboard', label: 'Copy to Clipboard', description: 'Tab-separated for Excel' },
  { format: 'csv', label: 'Export as CSV', description: 'Comma-separated values' },
  { format: 'tsv', label: 'Export as TSV', description: 'Tab-separated values' },
  { format: 'json', label: 'Export as JSON', description: 'JSON array of objects' },
  { format: 'insert', label: 'Export as SQL', description: 'INSERT statements' },
];

export function ExportMenu({ position, onExport, onClose, hasSelection }: ExportMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [includeHeaders, setIncludeHeaders] = useState(true);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleFormatClick = (format: ExportFormat) => {
    onExport(format, includeHeaders);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="export-menu"
      style={{ left: position.x, top: position.y }}
      data-testid="export-menu"
    >
      <div className="export-menu-header">
        <span className="export-menu-title">
          Export {hasSelection ? 'Selection' : 'All Data'}
        </span>
        <button className="export-menu-close" onClick={onClose}>×</button>
      </div>

      <div className="export-menu-options">
        <label className="export-option-checkbox">
          <input
            type="checkbox"
            checked={includeHeaders}
            onChange={e => setIncludeHeaders(e.target.checked)}
          />
          Include column headers
        </label>
      </div>

      <div className="export-menu-formats">
        {EXPORT_FORMATS.map(({ format, label, description }) => (
          <button
            key={format}
            className="export-format-button"
            onClick={() => handleFormatClick(format)}
            data-testid={`export-${format}`}
          >
            <span className="export-format-icon">
              {getFormatIcon(format)}
            </span>
            <div className="export-format-info">
              <span className="export-format-label">{label}</span>
              <span className="export-format-description">{description}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function getFormatIcon(format: ExportFormat): string {
  switch (format) {
    case 'clipboard':
      return '📋';
    case 'csv':
      return '📊';
    case 'tsv':
      return '📑';
    case 'json':
      return '{}';
    case 'insert':
      return '💾';
    default:
      return '📄';
  }
}
