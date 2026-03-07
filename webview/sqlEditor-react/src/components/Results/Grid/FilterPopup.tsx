import { useState, useCallback, useRef, useEffect } from 'react';
import { FilterConfig } from '../../../types/grid';
import './FilterPopup.css';

interface FilterPopupProps {
  columnName: string;
  columnType: string;
  currentFilter?: FilterConfig;
  position: { x: number; y: number };
  onApply: (filter: FilterConfig | null) => void;
  onClose: () => void;
}

const TEXT_FILTER_TYPES = [
  { value: 'contains', label: 'Contains' },
  { value: 'equals', label: 'Equals' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'endsWith', label: 'Ends with' },
  { value: 'isNull', label: 'Is NULL' },
  { value: 'isNotNull', label: 'Is not NULL' },
] as const;

const NUMBER_FILTER_TYPES = [
  { value: 'equals', label: 'Equals' },
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'lessThan', label: 'Less than' },
  { value: 'between', label: 'Between' },
  { value: 'isNull', label: 'Is NULL' },
  { value: 'isNotNull', label: 'Is not NULL' },
] as const;

export function FilterPopup({
  columnName,
  columnType,
  currentFilter,
  position,
  onApply,
  onClose,
}: FilterPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const isNumeric = ['int', 'bigint', 'decimal', 'float', 'money', 'numeric', 'smallint', 'tinyint', 'real', 'number'].some(
    t => columnType.toLowerCase().includes(t)
  );

  const filterTypes = isNumeric ? NUMBER_FILTER_TYPES : TEXT_FILTER_TYPES;

  const [filterType, setFilterType] = useState<FilterConfig['type']>(
    currentFilter?.type || 'contains'
  );
  const [filterValue, setFilterValue] = useState<string>(
    currentFilter?.value?.toString() || ''
  );
  const [filterValueTo, setFilterValueTo] = useState<string>(
    currentFilter?.valueTo?.toString() || ''
  );

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const handleApply = useCallback(() => {
    if (filterType === 'isNull' || filterType === 'isNotNull') {
      onApply({ type: filterType, value: null });
    } else if (filterType === 'between') {
      const from = isNumeric ? parseFloat(filterValue) : filterValue;
      const to = isNumeric ? parseFloat(filterValueTo) : filterValueTo;
      onApply({ type: filterType, value: from, valueTo: to });
    } else {
      const value = isNumeric ? parseFloat(filterValue) : filterValue;
      onApply({ type: filterType, value });
    }
  }, [filterType, filterValue, filterValueTo, isNumeric, onApply]);

  const handleClear = useCallback(() => {
    onApply(null);
  }, [onApply]);

  const needsValue = filterType !== 'isNull' && filterType !== 'isNotNull';
  const needsSecondValue = filterType === 'between';

  return (
    <div
      ref={popupRef}
      className="filter-popup"
      style={{ left: position.x, top: position.y }}
      data-testid="filter-popup"
    >
      <div className="filter-popup-header">
        <span className="filter-popup-title">Filter: {columnName}</span>
        <button className="filter-popup-close" onClick={onClose}>×</button>
      </div>

      <div className="filter-popup-content">
        <div className="filter-field">
          <label>Condition:</label>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value as FilterConfig['type'])}
          >
            {filterTypes.map(ft => (
              <option key={ft.value} value={ft.value}>
                {ft.label}
              </option>
            ))}
          </select>
        </div>

        {needsValue && (
          <div className="filter-field">
            <label>{needsSecondValue ? 'From:' : 'Value:'}</label>
            <input
              type={isNumeric ? 'number' : 'text'}
              value={filterValue}
              onChange={e => setFilterValue(e.target.value)}
              placeholder={isNumeric ? '0' : 'Enter value...'}
              autoFocus
            />
          </div>
        )}

        {needsSecondValue && (
          <div className="filter-field">
            <label>To:</label>
            <input
              type={isNumeric ? 'number' : 'text'}
              value={filterValueTo}
              onChange={e => setFilterValueTo(e.target.value)}
              placeholder={isNumeric ? '0' : 'Enter value...'}
            />
          </div>
        )}
      </div>

      <div className="filter-popup-footer">
        <button className="filter-btn filter-btn-clear" onClick={handleClear}>
          Clear
        </button>
        <button className="filter-btn filter-btn-apply" onClick={handleApply}>
          Apply
        </button>
      </div>
    </div>
  );
}
