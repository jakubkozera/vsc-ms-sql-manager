import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { FilterConfig, FilterType, ColumnFilterCategory, getColumnFilterCategory } from '../../../types/grid';
import './FilterPopup.css';

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 6l-12 12" />
    <path d="M6 6l12 12" />
  </svg>
);

interface FilterPopupProps {
  columnName: string;
  columnType: string;
  currentFilter?: FilterConfig;
  position: { x: number; y: number };
  distinctValues?: string[];
  onApply: (filter: FilterConfig | null) => void;
  onClose: () => void;
}

const TEXT_FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does not contain' },
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equals' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'endsWith', label: 'Ends with' },
  { value: 'regex', label: 'Regex' },
  { value: 'in', label: 'In (select values)' },
  { value: 'isNull', label: 'Is NULL' },
  { value: 'isNotNull', label: 'Is not NULL' },
];

const NUMBER_FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equals' },
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'lessThan', label: 'Less than' },
  { value: 'between', label: 'Between' },
  { value: 'isNull', label: 'Is NULL' },
  { value: 'isNotNull', label: 'Is not NULL' },
];

const DATE_FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: 'dateEquals', label: 'Equals' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
  { value: 'dateBetween', label: 'Between' },
  { value: 'isNull', label: 'Is NULL' },
  { value: 'isNotNull', label: 'Is not NULL' },
];

const GUID_FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'in', label: 'In (select values)' },
  { value: 'isNull', label: 'Is NULL' },
  { value: 'isNotNull', label: 'Is not NULL' },
];

const BINARY_FILTER_TYPES: { value: FilterType; label: string }[] = [
  { value: 'isNull', label: 'Is NULL' },
  { value: 'isNotNull', label: 'Is not NULL' },
];

function getFilterTypesForCategory(category: ColumnFilterCategory): { value: FilterType; label: string }[] {
  switch (category) {
    case 'number': return NUMBER_FILTER_TYPES;
    case 'date': return DATE_FILTER_TYPES;
    case 'boolean': return []; // boolean uses special UI
    case 'guid': return GUID_FILTER_TYPES;
    case 'binary':
    case 'xml_json': return BINARY_FILTER_TYPES;
    default: return TEXT_FILTER_TYPES;
  }
}

function getDefaultFilterType(category: ColumnFilterCategory): FilterType {
  switch (category) {
    case 'number': return 'equals';
    case 'date': return 'after';
    case 'boolean': return 'boolAny';
    case 'guid': return 'in';
    case 'binary':
    case 'xml_json': return 'isNull';
    default: return 'in';
  }
}

// â”€â”€ Custom date input with calendar icon â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const CalendarIcon = () => (
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
    aria-hidden="true"
  >
    <path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12z" />
    <path d="M16 3v4" />
    <path d="M8 3v4" />
    <path d="M4 11h16" />
    <path d="M11 15h1" />
    <path d="M12 15v3" />
  </svg>
);

interface DateInputProps {
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}
function DateInput({ value, onChange, autoFocus }: DateInputProps) {
  return (
    <div className="filter-date-input">
      <input
        type="datetime-local"
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus={autoFocus}
      />
      <span className="filter-date-icon" aria-hidden="true">
        <CalendarIcon />
      </span>
    </div>
  );
}

// â”€â”€ Custom numeric input with chevron spinners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ChevronUpIcon = () => (
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
    aria-hidden="true"
  >
    <path d="M6 15l6 -6l6 6" />
  </svg>
);
const ChevronDownIcon = () => (
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
    aria-hidden="true"
  >
    <path d="M6 9l6 6l6 -6" />
  </svg>
);

interface NumericInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}
function NumericInput({ value, onChange, placeholder, autoFocus }: NumericInputProps) {
  const step = (delta: number) => {
    const current = parseFloat(value);
    onChange(String(isNaN(current) ? delta : current + delta));
  };
  const handleChange = (raw: string) => {
    if (raw === '' || raw === '-' || /^-?\d*\.?\d*$/.test(raw)) onChange(raw);
  };
  return (
    <div className="filter-numeric-input">
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => handleChange(e.target.value)}
        placeholder={placeholder ?? '0'}
        autoFocus={autoFocus}
      />
      <div className="filter-numeric-btns">
        <button type="button" className="filter-numeric-btn" onClick={() => step(1)} aria-label="Increase">
          <ChevronUpIcon />
        </button>
        <button type="button" className="filter-numeric-btn" onClick={() => step(-1)} aria-label="Decrease">
          <ChevronDownIcon />
        </button>
      </div>
    </div>
  );
}

// â”€â”€ Main component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function FilterPopup({
  columnName,
  columnType,
  currentFilter,
  position,
  distinctValues,
  onApply,
  onClose,
}: FilterPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const category = getColumnFilterCategory(columnType);
  const filterTypes = getFilterTypesForCategory(category);

  const [filterType, setFilterType] = useState<FilterType>(
    currentFilter?.type || getDefaultFilterType(category)
  );
  const [filterValue, setFilterValue] = useState<string>(
    currentFilter?.value?.toString() || ''
  );
  const [filterValueTo, setFilterValueTo] = useState<string>(
    currentFilter?.valueTo?.toString() || ''
  );
  const [caseSensitive, setCaseSensitive] = useState(currentFilter?.caseSensitive || false);

  // Boolean multi-select state (checkboxes)
  const [boolSelected, setBoolSelected] = useState<Set<string>>(() => {
    if (currentFilter?.type === 'boolAny' && currentFilter.selectedValues) {
      return new Set(currentFilter.selectedValues);
    }
    return new Set(['true']); // default: True selected
  });

  // IN filter state
  const [selectedValues, setSelectedValues] = useState<Set<string>>(
    currentFilter?.selectedValues ? new Set(currentFilter.selectedValues) : new Set(distinctValues || [])
  );
  const [inSearchTerm, setInSearchTerm] = useState('');

  // Smart repositioning: after mount, clamp popup inside viewport
  const [adjustedPos, setAdjustedPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!popupRef.current) return;
    const rect = popupRef.current.getBoundingClientRect();
    let { x, y } = position;
    if (y + rect.height > window.innerHeight - 8) {
      y = Math.max(8, window.innerHeight - rect.height - 8);
    }
    if (x + rect.width > window.innerWidth - 8) {
      x = Math.max(8, window.innerWidth - rect.width - 8);
    }
    setAdjustedPos({ x, y });
  }, []); // only on mount

  const filteredDistinctValues = useMemo(() => {
    if (!distinctValues) return [];
    if (!inSearchTerm) return distinctValues;
    const term = inSearchTerm.toLowerCase();
    return distinctValues.filter(v => v.toLowerCase().includes(term));
  }, [distinctValues, inSearchTerm]);

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
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const isNumeric = category === 'number';
  const isDate = category === 'date';

  const handleApply = useCallback(() => {
    if (category === 'boolean') {
      if (boolSelected.size === 0) {
        onApply(null);
      } else {
        onApply({ type: 'boolAny', value: null, selectedValues: new Set(boolSelected) });
      }
      return;
    }
    if (filterType === 'isNull' || filterType === 'isNotNull') {
      onApply({ type: filterType, value: null });
    } else if (filterType === 'in') {
      onApply({ type: 'in', value: null, selectedValues: new Set(selectedValues) });
    } else if (filterType === 'between' || filterType === 'dateBetween') {
      const from = isNumeric ? parseFloat(filterValue) : filterValue;
      const to = isNumeric ? parseFloat(filterValueTo) : filterValueTo;
      onApply({ type: filterType, value: from, valueTo: to, caseSensitive });
    } else {
      const value = isNumeric ? parseFloat(filterValue) : filterValue;
      onApply({ type: filterType, value, caseSensitive });
    }
  }, [category, filterType, filterValue, filterValueTo, isNumeric, caseSensitive, selectedValues, boolSelected, onApply]);

  const handleClear = useCallback(() => {
    onApply(null);
  }, [onApply]);

  const toggleSelectedValue = useCallback((val: string) => {
    setSelectedValues(prev => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedValues(new Set(filteredDistinctValues));
  }, [filteredDistinctValues]);

  const deselectAll = useCallback(() => {
    setSelectedValues(new Set());
  }, []);

  const toggleBool = useCallback((key: string) => {
    setBoolSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const noValueNeeded = ['isNull', 'isNotNull', 'in'].includes(filterType);
  const needsSecondValue = filterType === 'between' || filterType === 'dateBetween';
  const showCaseSensitiveToggle = category === 'text' && !noValueNeeded && filterType !== 'regex';
  const showInFilter = filterType === 'in';

  const posStyle = {
    left: adjustedPos ? adjustedPos.x : position.x,
    top: adjustedPos ? adjustedPos.y : position.y,
    visibility: adjustedPos ? 'visible' as const : 'hidden' as const,
  };

  // â”€â”€ Boolean filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (category === 'boolean') {
    return (
      <div ref={popupRef} className="filter-popup" style={posStyle} data-testid="filter-popup">
        <div className="filter-popup-header">
          <span className="filter-popup-title">Filter: {columnName}</span>
          <button className="filter-popup-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="filter-popup-content">
          <div className="filter-bool-options">
            {[
              { key: 'true', label: 'True' },
              { key: 'false', label: 'False' },
              { key: 'null', label: 'NULL' },
            ].map(opt => (
              <label key={opt.key} className="filter-bool-label">
                <input
                  type="checkbox"
                  checked={boolSelected.has(opt.key)}
                  onChange={() => toggleBool(opt.key)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
        <div className="filter-popup-footer">
          <button className="filter-btn filter-btn-clear" onClick={handleClear}>Clear</button>
          <button className="filter-btn filter-btn-apply" onClick={handleApply}>Apply</button>
        </div>
      </div>
    );
  }

  // â”€â”€ Binary / XML/JSON â€“ only null checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (category === 'binary' || category === 'xml_json') {
    return (
      <div ref={popupRef} className="filter-popup" style={posStyle} data-testid="filter-popup">
        <div className="filter-popup-header">
          <span className="filter-popup-title">Filter: {columnName}</span>
          <button className="filter-popup-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="filter-popup-content">
          <div className="filter-field">
            <label>Condition:</label>
            <select value={filterType} onChange={e => setFilterType(e.target.value as FilterType)}>
              {filterTypes.map(ft => (
                <option key={ft.value} value={ft.value}>{ft.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="filter-popup-footer">
          <button className="filter-btn filter-btn-clear" onClick={handleClear}>Clear</button>
          <button className="filter-btn filter-btn-apply" onClick={handleApply}>Apply</button>
        </div>
      </div>
    );
  }

  // â”€â”€ General filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div ref={popupRef} className="filter-popup" style={posStyle} data-testid="filter-popup">
      <div className="filter-popup-header">
        <span className="filter-popup-title">Filter: {columnName}</span>
        <button className="filter-popup-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
      </div>

      <div className="filter-popup-content">
        <div className="filter-field">
          <label>Condition:</label>
          <select value={filterType} onChange={e => setFilterType(e.target.value as FilterType)}>
            {filterTypes.map(ft => (
              <option key={ft.value} value={ft.value}>{ft.label}</option>
            ))}
          </select>
        </div>

        {showInFilter && distinctValues && (
          <div className="filter-in-section" data-testid="filter-in-section">
            <div className="filter-in-search">
              <input
                type="text"
                value={inSearchTerm}
                onChange={e => setInSearchTerm(e.target.value)}
                placeholder="Search values..."
              />
            </div>
            <div className="filter-in-actions">
              <button className="filter-in-action-btn" onClick={selectAll}>Select all</button>
              <button className="filter-in-action-btn" onClick={deselectAll}>Deselect all</button>
              <span className="filter-in-count">{selectedValues.size}/{filteredDistinctValues.length}</span>
            </div>
            <div className="filter-in-list">
              {filteredDistinctValues.map((val, i) => (
                <label key={i} className="filter-in-item">
                  <input
                    type="checkbox"
                    checked={selectedValues.has(val)}
                    onChange={() => toggleSelectedValue(val)}
                  />
                  <span className="filter-in-value" title={val}>{val === '(NULL)' ? <em>(NULL)</em> : val}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {!noValueNeeded && (
          <div className="filter-field">
            <label>{needsSecondValue ? 'From:' : 'Value:'}</label>
            {isNumeric
              ? <NumericInput value={filterValue} onChange={setFilterValue} autoFocus />
              : isDate
                ? <DateInput value={filterValue} onChange={setFilterValue} autoFocus />
                : <input
                    type="text"
                    value={filterValue}
                    onChange={e => setFilterValue(e.target.value)}
                    placeholder="Enter value..."
                    autoFocus
                  />
            }
          </div>
        )}

        {needsSecondValue && (
          <div className="filter-field">
            <label>To:</label>
            {isNumeric
              ? <NumericInput value={filterValueTo} onChange={setFilterValueTo} />
              : isDate
                ? <DateInput value={filterValueTo} onChange={setFilterValueTo} />
                : <input
                    type="text"
                    value={filterValueTo}
                    onChange={e => setFilterValueTo(e.target.value)}
                    placeholder="Enter value..."
                  />
            }
          </div>
        )}

        {showCaseSensitiveToggle && (
          <div className="filter-field filter-field-inline">
            <label className="filter-checkbox-label">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={e => setCaseSensitive(e.target.checked)}
              />
              Case sensitive
            </label>
          </div>
        )}
      </div>

      <div className="filter-popup-footer">
        <button className="filter-btn filter-btn-clear" onClick={handleClear}>Clear</button>
        <button className="filter-btn filter-btn-apply" onClick={handleApply}>Apply</button>
      </div>
    </div>
  );
}


