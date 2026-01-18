import { useState, useEffect, useCallback, useMemo } from 'react';
import { DatabaseSchema } from '../../../types/schema';
import { ForeignKeyReference } from '../../../types/messages';
import './FKQuickPick.css';

interface FKQuickPickProps {
  relations: ForeignKeyReference[];
  keyValue: any;
  dbSchema?: DatabaseSchema;
  onSelect: (relation: ForeignKeyReference) => void;
  onCancel: () => void;
  onOpenQuery: (query: string) => void;
}

export function FKQuickPick({ relations, keyValue, dbSchema, onSelect, onCancel, onOpenQuery }: FKQuickPickProps) {
  const [filterText, setFilterText] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(relations.length === 1 ? 0 : -1);
  const [selectedRelation, setSelectedRelation] = useState<ForeignKeyReference | null>(
    relations.length === 1 ? relations[0] : null
  );

  // Sort relations (non-composite first)
  const sortedRelations = useMemo(() => {
    return [...relations].sort((a, b) => {
      if (a.isComposite && !b.isComposite) return 1;
      if (!a.isComposite && b.isComposite) return -1;
      return 0;
    });
  }, [relations]);

  // Filter relations
  const filteredRelations = useMemo(() => {
    if (!filterText) return sortedRelations;
    const lower = filterText.toLowerCase();
    return sortedRelations.filter(rel => 
      `${rel.table} (${rel.schema})`.toLowerCase().includes(lower)
    );
  }, [sortedRelations, filterText]);

  // Get table definition for selected relation
  const selectedTableDef = useMemo(() => {
    if (!selectedRelation || !dbSchema) return null;
    return dbSchema.tables.find(
      t => t.schema === selectedRelation.schema && t.name === selectedRelation.table
    );
  }, [selectedRelation, dbSchema]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredRelations.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredRelations.length === 1) {
        onSelect(filteredRelations[0]);
      } else if (selectedIndex >= 0 && selectedIndex < filteredRelations.length) {
        onSelect(filteredRelations[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [filteredRelations, selectedIndex, onSelect, onCancel]);

  // Update selected relation when index changes
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < filteredRelations.length) {
      setSelectedRelation(filteredRelations[selectedIndex]);
    } else {
      setSelectedRelation(null);
    }
  }, [selectedIndex, filteredRelations]);

  // Handle relation click
  const handleRelationClick = useCallback((relation: ForeignKeyReference, index: number) => {
    setSelectedIndex(index);
    setSelectedRelation(relation);
    onSelect(relation);
  }, [onSelect]);

  // Handle open query button
  const handleOpenQuery = useCallback((e: React.MouseEvent, relation: ForeignKeyReference) => {
    e.stopPropagation();
    const query = `SELECT * FROM [${relation.schema}].[${relation.table}] WHERE [${relation.column}] = '${keyValue}'`;
    onOpenQuery(query);
  }, [keyValue, onOpenQuery]);

  // Handle overlay click
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
    }
  }, [onCancel]);

  return (
    <div className="fk-quick-pick-overlay" onClick={handleOverlayClick}>
      <div className="fk-quick-pick">
        {/* Left Panel - List */}
        <div className="fk-quick-pick-left">
          <div className="fk-quick-pick-header">Select related table</div>
          
          <div className="fk-quick-pick-filter">
            <input
              type="text"
              placeholder="Type to filter tables..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <svg
              className="fk-quick-pick-search-icon"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
              <path d="M21 21l-6 -6" />
            </svg>
          </div>
          
          <div className="fk-quick-pick-list">
            {filteredRelations.map((rel, index) => (
              <div
                key={`${rel.schema}-${rel.table}-${rel.column}`}
                className={`fk-quick-pick-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleRelationClick(rel, index)}
                onMouseEnter={() => {
                  setSelectedIndex(index);
                  setSelectedRelation(rel);
                }}
              >
                <div className="fk-quick-pick-item-label">
                  {rel.table} ({rel.schema}){rel.isComposite ? ' - Composite Key' : ''}
                </div>
                <div className="fk-quick-pick-item-query">
                  SELECT * FROM [{rel.schema}].[{rel.table}] WHERE [{rel.column}] = '{keyValue}'
                </div>
                {index === selectedIndex && (
                  <button
                    className="fk-quick-pick-open-query-btn"
                    onClick={(e) => handleOpenQuery(e, rel)}
                    title="Open in New Query"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
                      <path d="M11 13l9 -9" />
                      <path d="M15 4h5v5" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
        
        {/* Right Panel - Details */}
        <div className="fk-quick-pick-right">
          {selectedTableDef ? (
            <>
              <div className="fk-quick-pick-details-header">
                <div className="fk-quick-pick-details-title">{selectedRelation!.schema}.{selectedRelation!.table}</div>
                <div className="fk-quick-pick-details-subtitle">Relation: {selectedRelation!.column}</div>
              </div>
              
              <table className="fk-quick-pick-details-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTableDef.columns.map(col => (
                    <tr key={col.name}>
                      <td>{col.name}</td>
                      <td>{col.type || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className="fk-quick-pick-details-empty">
              Select a table to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
