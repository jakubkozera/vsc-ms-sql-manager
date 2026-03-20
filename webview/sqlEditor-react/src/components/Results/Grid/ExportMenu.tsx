import { useRef, useEffect, useLayoutEffect, useState } from 'react';
import { ExportFormat } from '../../../services/exportService';
import './ExportMenu.css';

interface ExportMenuProps {
  position: { x: number; y: number };
  onExport: (format: ExportFormat, includeHeaders: boolean) => void;
  onCopy: (format: ExportFormat, includeHeaders: boolean) => void;
  onClose: () => void;
  hasSelection?: boolean;
  onAutoFit?: () => void;
}

interface SubMenuItem {
  format: ExportFormat;
  label: string;
}

const COPY_SUBMENU: SubMenuItem[] = [
  { format: 'clipboard', label: 'to clipboard' },
  { format: 'table', label: 'as Table' },
  { format: 'json', label: 'as JSON' },
  { format: 'csv', label: 'as CSV' },
  { format: 'tsv', label: 'as TSV' },
  { format: 'insert', label: 'as SQL INSERT' },
  { format: 'markdown', label: 'as Markdown' },
  { format: 'xml', label: 'as XML' },
  { format: 'html', label: 'as HTML' },
];

const EXPORT_SUBMENU: SubMenuItem[] = [
  { format: 'json', label: 'to JSON' },
  { format: 'csv', label: 'to CSV' },
  { format: 'tsv', label: 'to Excel (TSV)' },
  { format: 'insert', label: 'to SQL INSERT' },
  { format: 'markdown', label: 'to Markdown' },
  { format: 'xml', label: 'to XML' },
  { format: 'html', label: 'to HTML' },
];

interface ExportMenuExtProps extends ExportMenuProps {
  onSelectAll?: () => void;
  onCreateChart?: () => void;
}

export function ExportMenu({ position, onExport, onCopy, onClose, onAutoFit, onSelectAll, onCreateChart }: ExportMenuExtProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<'copy' | 'export' | null>(null);
  const includeHeaders = true;

  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let x = position.x;
    let y = position.y;
    if (y + rect.height > window.innerHeight - 8) {
      y = position.y - rect.height;
    }
    if (x + rect.width > window.innerWidth - 8) {
      x = window.innerWidth - rect.width - 8;
    }
    setAdjustedPos({ x: Math.max(0, x), y: Math.max(0, y) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleCopyClick = (format: ExportFormat) => {
    onCopy(format, includeHeaders);
    onClose();
  };

  const handleExportClick = (format: ExportFormat) => {
    onExport(format, includeHeaders);
    onClose();
  };

  const handleAutoFitClick = () => {
    if (onAutoFit) {
      onAutoFit();
    }
    onClose();
  };

  const handleSelectAllClick = () => {
    if (onSelectAll) {
      onSelectAll();
    }
    onClose();
  };

  const handleCreateChartClick = () => {
    if (onCreateChart) {
      onCreateChart();
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="export-menu"
      style={{ left: (adjustedPos ?? position).x, top: (adjustedPos ?? position).y, visibility: adjustedPos ? 'visible' : 'hidden' }}
      data-testid="export-menu"
    >
      <div className="export-menu-formats">
        {/* Auto fit */}
        <button
          className="export-format-button"
          onClick={handleAutoFitClick}
          data-testid="export-autofit"
        >
          <span className="export-format-icon">{getFormatIcon('autofit')}</span>
          <span className="export-format-label">Auto-fit all columns</span>
        </button>

        {/* Select All */}
        <button
          className="export-format-button"
          onClick={handleSelectAllClick}
          data-testid="export-select-all"
        >
          <span className="export-format-icon">{getFormatIcon('selectAll')}</span>
          <span className="export-format-label">Select All</span>
        </button>

        {/* Create Chart */}
        <button
          className="export-format-button"
          onClick={handleCreateChartClick}
          data-testid="export-create-chart"
        >
          <span className="export-format-icon">{getFormatIcon('chart')}</span>
          <span className="export-format-label">Create Chart…</span>
        </button>

        <div className="export-menu-divider" />

        {/* Copy → submenu */}
        <div
          className="export-submenu-container"
          onMouseEnter={() => setOpenSubmenu('copy')}
          onMouseLeave={() => setOpenSubmenu(null)}
          data-testid="copy-submenu-container"
        >
          <button className="export-format-button export-submenu-trigger" data-testid="copy-submenu-trigger">
            <span className="export-format-icon">{getFormatIcon('clipboard')}</span>
            <span className="export-format-label">Copy</span>
            <span className="export-submenu-arrow">{getChevronIcon()}</span>
          </button>
          {openSubmenu === 'copy' && (
            <div className="export-submenu" data-testid="copy-submenu">
              {COPY_SUBMENU.map(({ format, label }) => (
                <button
                  key={`copy-${format}`}
                  className="export-format-button"
                  onClick={() => handleCopyClick(format)}
                  data-testid={`copy-${format}`}
                >
                  <span className="export-format-icon">{getFormatIcon(format)}</span>
                  <span className="export-format-label">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Export → submenu */}
        <div
          className="export-submenu-container"
          onMouseEnter={() => setOpenSubmenu('export')}
          onMouseLeave={() => setOpenSubmenu(null)}
          data-testid="export-submenu-container"
        >
          <button className="export-format-button export-submenu-trigger" data-testid="export-submenu-trigger">
            <span className="export-format-icon">{getFormatIcon('export')}</span>
            <span className="export-format-label">Export</span>
            <span className="export-submenu-arrow">{getChevronIcon()}</span>
          </button>
          {openSubmenu === 'export' && (
            <div className="export-submenu" data-testid="export-submenu">
              {EXPORT_SUBMENU.map(({ format, label }) => (
                <button
                  key={`export-${format}`}
                  className="export-format-button"
                  onClick={() => handleExportClick(format)}
                  data-testid={`export-${format}`}
                >
                  <span className="export-format-icon">{getFormatIcon(format)}</span>
                  <span className="export-format-label">{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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
    case 'table':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M3 15h18" />
          <path d="M9 3v18" />
          <path d="M15 3v18" />
        </svg>
      );
    case 'export':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          <path d="M7 9l5-5l5 5" />
          <path d="M12 4v12" />
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
    case 'selectAll':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      );
    case 'chart':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="M7 16l4-4 4 4 4-6" />
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

function getChevronIcon(): React.ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6l-6 6" />
    </svg>
  );
}

