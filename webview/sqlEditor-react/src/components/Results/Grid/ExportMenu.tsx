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

function getFormatIcon(format: ExportFormat): React.ReactNode {
  switch (format) {
    case 'clipboard':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
        </svg>
      );
    case 'csv':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      );
    case 'tsv':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
        </svg>
      );
    case 'json':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 3h5v5M8 3H3v5M8 21H3v-5M16 21h5v-5"/>
        </svg>
      );
    case 'insert':
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
          <polyline points="17 21 17 13 7 13 7 21"/>
          <polyline points="7 3 7 8 15 8"/>
        </svg>
      );
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      );
  }
}
