import { useState, useRef, useEffect } from 'react';
import './FKQuickPick.css';

export interface FKRelation {
  tableName: string;
  schemaName: string;
  columnName: string;
  referencedTable: string;
  referencedSchema: string;
  referencedColumn: string;
  constraintName: string;
}

interface FKQuickPickProps {
  relations: FKRelation[];
  cellValue: unknown;
  position: { x: number; y: number };
  onSelect: (relation: FKRelation) => void;
  onClose: () => void;
}

export function FKQuickPick({
  relations,
  cellValue,
  position,
  onSelect,
  onClose,
}: FKQuickPickProps) {
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const filteredRelations = relations.filter(rel => {
    if (!filter) return true;
    const searchText = `${rel.referencedSchema}.${rel.referencedTable}`.toLowerCase();
    return searchText.includes(filter.toLowerCase());
  });
  
  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  
  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredRelations.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredRelations[selectedIndex]) {
          onSelect(filteredRelations[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };
  
  return (
    <div
      ref={containerRef}
      className="fk-quick-pick"
      style={{ left: position.x, top: position.y }}
      onKeyDown={handleKeyDown}
      data-testid="fk-quick-pick"
    >
      <div className="fk-quick-pick-header">
        <span className="fk-quick-pick-title">Expand Foreign Key</span>
        <span className="fk-quick-pick-value">Value: {formatValue(cellValue)}</span>
      </div>
      
      <input
        ref={inputRef}
        className="fk-quick-pick-search"
        type="text"
        placeholder="Search relations..."
        value={filter}
        onChange={e => {
          setFilter(e.target.value);
          setSelectedIndex(0);
        }}
      />
      
      <div className="fk-quick-pick-list">
        {filteredRelations.length === 0 ? (
          <div className="fk-quick-pick-empty">No matching relations</div>
        ) : (
          filteredRelations.map((rel, index) => (
            <div
              key={rel.constraintName}
              className={`fk-quick-pick-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => onSelect(rel)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div className="fk-item-main">
                <span className="fk-item-icon">🔗</span>
                <span className="fk-item-table">
                  {rel.referencedSchema}.{rel.referencedTable}
                </span>
              </div>
              <div className="fk-item-detail">
                {rel.columnName} → {rel.referencedColumn}
              </div>
            </div>
          ))
        )}
      </div>
      
      <div className="fk-quick-pick-footer">
        <span className="fk-quick-pick-hint">↑↓ to navigate, Enter to select, Esc to close</span>
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  const str = String(value);
  return str.length > 30 ? str.substring(0, 27) + '...' : str;
}
