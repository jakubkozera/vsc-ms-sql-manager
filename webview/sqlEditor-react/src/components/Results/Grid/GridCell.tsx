import { useState, useMemo, useCallback, useEffect, memo, type CSSProperties } from 'react';
import { ColumnDef } from '../../../types/grid';
import { InlineCellEditor } from './InlineCellEditor';
import { HoverPopup } from '../../HoverPopup';
import { useVSCode } from '../../../context/VSCodeContext';
import './GridCell.css';

interface GridCellProps {
  value: any;
  column: ColumnDef;
  rowIndex: number;
  colIndex: number;
  isSelected?: boolean;
  isModified?: boolean;
  isDeleted?: boolean;
  isEditable?: boolean;
  isExpanded?: boolean;
  pinnedOffset?: number;
  /** Validation error message — shown on hover, blocks commit */
  validationError?: string | null;
  /** Force this cell into edit mode (e.g. from context menu) */
  forceEdit?: boolean;
  /** Called when a force-edit session is complete */
  onForceEditComplete?: () => void;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onFKExpand?: (value: any, e: React.MouseEvent) => void;
  onCellEdit?: (newValue: unknown) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
}

function GridCellComponent({ 
  value, 
  column, 
  rowIndex, 
  colIndex,
  isSelected = false,
  isModified = false,
  isDeleted = false,
  isEditable = true,
  isExpanded = false,
  pinnedOffset,
  validationError,
  forceEdit = false,
  onForceEditComplete,
  onClick,
  onContextMenu,
  onDoubleClick,
  onFKExpand,
  onCellEdit,
  onMouseDown,
  onMouseEnter,
}: GridCellProps) {
  const { config, postMessage } = useVSCode();
  const [isEditing, setIsEditing] = useState(false);

  // Handle forceEdit from context menu
  useEffect(() => {
    if (forceEdit && isEditable && !isEditing) {
      setIsEditing(true);
      onForceEditComplete?.();
    }
  }, [forceEdit, isEditable, isEditing, onForceEditComplete]);
  
  // DIAGNOSTIC: Count renders for this cell (only first few cells when debugging)
  const renderCountRef = useState(() => ({ count: 0 }))[0];
  renderCountRef.count++;
  if ((process.env.NODE_ENV === 'development' || (window as any).DEBUG_GRID) && renderCountRef.count > 1 && rowIndex < 3 && colIndex < 3) {
    console.log('[GridCell RE-RENDER]', { rowIndex, colIndex, renderCount: renderCountRef.count, value, isSelected });
  }
  
  // Determine cell type and format
  const { displayValue, cellType, isLongText } = useMemo(() => {
    if (value === null || value === undefined) {
      return { displayValue: 'NULL', cellType: 'null', isLongText: false };
    }

    if (typeof value === 'boolean') {
      return { displayValue: value ? '✓' : '✗', cellType: 'boolean', isLongText: false };
    }

    if (typeof value === 'number') {
      let displayValue: string;
      switch (config.numberFormat) {
        case 'locale':
          displayValue = value.toLocaleString();
          break;
        case 'fixed-2':
          displayValue = value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          break;
        case 'fixed-4':
          displayValue = value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
          break;
        default:
          displayValue = String(value);
      }
      return { displayValue, cellType: 'number', isLongText: false };
    }

    if (value instanceof Date) {
      return { displayValue: value.toISOString(), cellType: 'date', isLongText: false };
    }

    // Handle plain JS objects / arrays that arrive already parsed from the driver
    // (would otherwise render as "[object Object]")
    if (typeof value === 'object') {
      try {
        const jsonStr = JSON.stringify(value);
        return { displayValue: jsonStr, cellType: 'json', isLongText: jsonStr.length > 100 };
      } catch {
        // fallthrough
      }
    }

    // Check for JSON
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          JSON.parse(trimmed);
          return { displayValue: trimmed, cellType: 'json', isLongText: trimmed.length > 100 };
        } catch {
          // Not valid JSON
        }
      }

      // Check for XML - validate it's actually parseable XML (not just any <…> token)
      if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(trimmed, 'application/xml');
          if (!doc.querySelector('parsererror')) {
            return { displayValue: trimmed, cellType: 'xml', isLongText: trimmed.length > 100 };
          }
        } catch {
          // Not valid XML
        }
      }
    }

    const strValue = String(value);
    return { 
      displayValue: strValue, 
      cellType: 'string', 
      isLongText: strValue.length > 100 
    };
  }, [value, config.numberFormat]);

  const structuredContent = useMemo(() => {
    if (cellType !== 'json' && cellType !== 'xml') {
      return null;
    }

    const rawValue = typeof value === 'string'
      ? value.trim()
      : (value !== null && typeof value === 'object')
        ? JSON.stringify(value)
        : String(value);
    if (cellType === 'json') {
      try {
        return JSON.stringify(JSON.parse(rawValue), null, 2);
      } catch {
        return rawValue;
      }
    }

    return rawValue;
  }, [cellType, value]);

  const openStructuredContent = useCallback(() => {
    if (!structuredContent) {
      return;
    }

    postMessage({
      type: 'openInNewEditor',
      content: structuredContent,
      language: cellType === 'json' ? 'json' : 'xml',
    });
  }, [cellType, postMessage, structuredContent]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (structuredContent && e.button === 0 && e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      openStructuredContent();
      return;
    }

    onClick?.(e);
  }, [onClick, openStructuredContent, structuredContent]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onContextMenu?.(e);
  }, [onContextMenu]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (isEditable) {
      e.preventDefault();
      e.stopPropagation();
      setIsEditing(true);
    }
    onDoubleClick?.(e);
  }, [isEditable, onDoubleClick]);

  const handleEditSave = useCallback((newValue: unknown) => {
    setIsEditing(false);
    if (newValue !== value) {
      onCellEdit?.(newValue);
    }
  }, [value, onCellEdit]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const handleFKClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onFKExpand?.(value, e);
  }, [onFKExpand, value]);

  const handleOpenStructuredContent = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    openStructuredContent();
  }, [openStructuredContent]);

  // Build class names
  const classNames = [
    'grid-cell',
    cellType,
    structuredContent && 'has-open-content-button',
    isLongText && 'long-text',
    isSelected && 'selected',
    isModified && 'modified',
    isModified && validationError && 'validation-error',
    isDeleted && 'deleted',
    isEditing && 'editing',
    config.colorPrimaryForeignKeys && column.isPrimaryKey && 'pk-cell',
    config.colorPrimaryForeignKeys && column.isForeignKey && 'fk-cell',
    column.pinned && 'pinned',
  ].filter(Boolean).join(' ');

  const customJsonXmlStyle = useMemo<CSSProperties | undefined>(() => {
    if (cellType !== 'json' && cellType !== 'xml') {
      return undefined;
    }

    const colorValue = (config.jsonXmlHighlightColor || '').trim();
    if (!colorValue) {
      return undefined;
    }

    return {
      '--json-xml-highlight-color': colorValue,
    } as CSSProperties;
  }, [cellType, config.jsonXmlHighlightColor]);

  // Render inline editor when editing
  if (isEditing) {
    return (
      <td
        className={classNames}
        style={{ 
          width: `${column.width}px`,
          minWidth: `${column.width}px`,
          maxWidth: `${column.width}px`
        }}
        data-testid={`cell-${rowIndex}-${colIndex}`}
      >
        <InlineCellEditor
          value={value}
          columnName={column.name}
          columnType={column.type}
          onSave={handleEditSave}
          onCancel={handleEditCancel}
        />
      </td>
    );
  }

  return (
    <td
      className={classNames}
      style={{ 
        width: `${column.width}px`,
        minWidth: `${column.width}px`,
        maxWidth: `${column.width}px`,
        ...(pinnedOffset !== undefined ? { left: `${pinnedOffset}px` } : {}),
        ...(customJsonXmlStyle ?? {}),
      }}
      title={isLongText && !validationError ? displayValue : undefined}
      data-testid={`cell-${rowIndex}-${colIndex}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
    >
      <span className="cell-content">{displayValue}</span>
      {validationError && (
        <span className="cell-validation-wrapper">
          <HoverPopup content={validationError} placement="top" variant="error">
            <span className="cell-validation-icon" data-testid={`validation-icon-${rowIndex}-${colIndex}`}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 9v4" />
                <path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
                <path d="M12 16h.01" />
              </svg>
            </span>
          </HoverPopup>
        </span>
      )}
      {structuredContent && (
        <button
          type="button"
          className="cell-open-content-button"
          onClick={handleOpenStructuredContent}
          title={cellType === 'json' ? 'Open JSON in new editor' : 'Open XML in new editor'}
          aria-label={cellType === 'json' ? 'Open JSON in new editor' : 'Open XML in new editor'}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M16 4l4 0l0 4" />
            <path d="M14 10l6 -6" />
            <path d="M8 20l-4 0l0 -4" />
            <path d="M4 20l6 -6" />
            <path d="M16 20l4 0l0 -4" />
            <path d="M14 14l6 6" />
            <path d="M8 4l-4 0l0 4" />
            <path d="M4 4l6 6" />
          </svg>
        </button>
      )}
      {(column.isForeignKey || column.isPrimaryKey) && config.colorPrimaryForeignKeys && value !== null && value !== undefined && (
        <span 
          className={`cell-expand-chevron ${isExpanded ? 'expanded' : ''}`}
          onClick={handleFKClick}
          title={column.isForeignKey ? "Expand foreign key" : "View related rows"}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
      )}
    </td>
  );
}

// Custom comparison to prevent unnecessary re-renders
function arePropsEqual(prev: GridCellProps, next: GridCellProps): boolean {
  return (
    prev.value === next.value &&
    prev.isSelected === next.isSelected &&
    prev.isModified === next.isModified &&
    prev.validationError === next.validationError &&
    prev.isDeleted === next.isDeleted &&
    prev.isEditable === next.isEditable &&
    prev.isExpanded === next.isExpanded &&
    prev.pinnedOffset === next.pinnedOffset &&
    prev.forceEdit === next.forceEdit &&
    prev.column.width === next.column.width &&
    prev.column.pinned === next.column.pinned
  );
}

export const GridCell = memo(GridCellComponent, arePropsEqual);
