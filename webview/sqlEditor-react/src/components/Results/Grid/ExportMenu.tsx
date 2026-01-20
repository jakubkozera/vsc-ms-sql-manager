import { useRef, useEffect } from 'react';
import { ExportFormat } from '../../../services/exportService';
import './ExportMenu.css';

interface ExportMenuProps {
  position: { x: number; y: number };
  onExport: (format: ExportFormat, includeHeaders: boolean) => void;
  onClose: () => void;
  hasSelection?: boolean;
  onAutoFit?: () => void;
}

const EXPORT_FORMATS: { format: ExportFormat | string; label: string; description: string; action?: string }[] = [
  { format: 'autofit', label: 'Auto-fit all columns', description: '', action: 'autofit' },
  { format: 'divider', label: '', description: '', action: 'divider' },
  { format: 'clipboard', label: 'Copy to clipboard', description: '' },
  { format: 'json', label: 'Export to JSON', description: '' },
  { format: 'csv', label: 'Export to CSV', description: '' },
  { format: 'tsv', label: 'Export to Excel (TSV)', description: '' },
  { format: 'insert', label: 'Export to SQL INSERT', description: '' },
  { format: 'markdown', label: 'Export to Markdown', description: '' },
  { format: 'xml', label: 'Export to XML', description: '' },
  { format: 'html', label: 'Export to HTML', description: '' },
];

export function ExportMenu({ position, onExport, onClose, onAutoFit }: ExportMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const includeHeaders = true; // Always include headers in new version

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

  const handleFormatClick = (format: ExportFormat | string, action?: string) => {
    if (action === 'autofit') {
      if (onAutoFit) {
        onAutoFit();
      }
      onClose();
      return;
    }
    if (action === 'divider') {
      return; // Ignore clicks on divider
    }
    // For now, unsupported formats will be handled as text export
    onExport(format as ExportFormat, includeHeaders);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="export-menu"
      style={{ left: position.x, top: position.y }}
      data-testid="export-menu"
    >
      <div className="export-menu-formats">
        {EXPORT_FORMATS.map(({ format, label, description, action }, index) => {
          if (action === 'divider') {
            return (
              <div key={`divider-${index}`} className="export-menu-divider" />
            );
          }
          return (
            <button
              key={format}
              className="export-format-button"
              onClick={() => handleFormatClick(format, action)}
              data-testid={`export-${format}`}
            >
              <span className="export-format-icon">
                {getFormatIcon(format)}
              </span>
              <div className="export-format-info">
                <span className="export-format-label">{label}</span>
                {description && <span className="export-format-description">{description}</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getFormatIcon(format: ExportFormat | string): React.ReactNode {
  switch (format) {
    case 'autofit':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M7 8h10" />
          <path d="M7 12h10" />
          <path d="M7 16h10" />
        </svg>
      );
    case 'clipboard':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
        </svg>
      );
    case 'json':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14,2 14,8 20,8"/>
          <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/>
          <path d="M14 12a1 1 0 0 1 1 1v1a1 1 0 0 0 1 1 1 1 0 0 0-1 1v1a1 1 0 0 1-1 1"/>
        </svg>
      );
    case 'csv':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
          <path d="M7 16.5a1.5 1.5 0 0 0 -3 0v3a1.5 1.5 0 0 0 3 0" />
          <path d="M10 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75" />
          <path d="M16 15l2 6l2 -6" />
        </svg>
      );
    case 'insert':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
          <path d="M4 15l4 6" />
          <path d="M4 21l4 -6" />
          <path d="M17 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75" />
          <path d="M11 15v6h3" />
        </svg>
      );
    case 'markdown':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" />
          <path d="M7 15v-6l2 2l2 -2v6" />
          <path d="M14 13l2 2l2 -2m-2 2v-6" />
        </svg>
      );
    case 'xml':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
          <path d="M4 15l4 6" />
          <path d="M4 21l4 -6" />
          <path d="M19 15v6h3" />
          <path d="M11 21v-6l2.5 3l2.5 -3v6" />
        </svg>
      );
    case 'html':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
          <path d="M2 21v-6" />
          <path d="M5 15v6" />
          <path d="M2 18h3" />
          <path d="M20 15v6h2" />
          <path d="M13 21v-6l2 3l2 -3v6" />
          <path d="M7.5 15h3" />
          <path d="M9 15v6" />
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

