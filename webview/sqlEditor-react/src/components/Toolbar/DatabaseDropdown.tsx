import { useState, useRef, useEffect } from 'react';
import { useVSCode } from '../../context/VSCodeContext';
import './Dropdown.css';

export function DatabaseDropdown() {
  const {
    currentConnectionId,
    currentDatabase,
    databases,
    connections,
    selectDatabase,
  } = useVSCode();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentConnection = connections.find(c => c.id === currentConnectionId);
  const isServerConnection = currentConnection?.connectionType === 'server';

  const displayText = currentDatabase || 'Select database';

  // Close on outside click - MUST be before any early returns
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

  // Only show for server connections - AFTER all hooks
  if (!currentConnectionId || !isServerConnection) {
    return null;
  }

  const handleSelect = (dbName: string) => {
    selectDatabase(dbName);
    setIsOpen(false);
  };

  return (
    <>
          {/* Database icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ verticalAlign: 'middle', marginLeft: '8px' }}
      >
        <path d="M12 6m-8 0a8 3 0 1 0 16 0a8 3 0 1 0 -16 0" />
        <path d="M4 6v6a8 3 0 0 0 16 0v-6" />
        <path d="M4 12v6a8 3 0 0 0 16 0v-6" />
      </svg>
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
    </>

  );
}
