import { useState, useRef, useEffect } from 'react';
import { useVSCode } from '../../context/VSCodeContext';
import './Dropdown.css';

export function DatabaseDropdown() {
  const {
    currentConnectionId,
    currentDatabase,
    connections,
    selectDatabase,
  } = useVSCode();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  // TODO: Fetch databases from backend
  const databases: string[] = [];

  const currentConnection = connections.find(c => c.id === currentConnectionId);
  const isServerConnection = currentConnection?.connectionType === 'server';

  // Only show for server connections
  if (!currentConnectionId || !isServerConnection) {
    return null;
  }

  const displayText = currentDatabase || 'Select database';

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSelect = (dbName: string) => {
    selectDatabase(dbName);
    setIsOpen(false);
  };

  return (
    <div className="custom-dropdown" ref={dropdownRef}>
      <button
        className={`dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={displayText}
      >
        {displayText}
      </button>

      {isOpen && (
        <div className="dropdown-menu">
          {databases.length > 0 ? (
            databases.map((db) => (
              <div
                key={db}
                className={`dropdown-item ${db === currentDatabase ? 'selected' : ''}`}
                onClick={() => handleSelect(db)}
              >
                {db}
              </div>
            ))
          ) : (
            <div className="dropdown-item disabled">
              Loading databases...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
