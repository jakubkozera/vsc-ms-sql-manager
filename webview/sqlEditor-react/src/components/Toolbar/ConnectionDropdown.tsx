import { useState, useRef, useEffect } from 'react';
import { useVSCode } from '../../context/VSCodeContext';
import './Dropdown.css';

export function ConnectionDropdown() {
  const {
    connections,
    currentConnectionId,
    selectConnection,
    manageConnections,
  } = useVSCode();

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentConnection = connections.find(c => c.id === currentConnectionId);
  const displayText = currentConnection?.name || currentConnection?.server || 'Not Connected';

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

  const handleTriggerClick = () => {
    if (!currentConnectionId) {
      // No connection - open connection manager
      manageConnections();
    } else {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (connectionId: string) => {
    selectConnection(connectionId);
    setIsOpen(false);
  };

  return (
    <div className="custom-dropdown" ref={dropdownRef}>
      <button
        className={`dropdown-trigger ${isOpen ? 'open' : ''}`}
        onClick={handleTriggerClick}
        title={displayText}
      >
        {displayText}
      </button>

      {isOpen && connections.length > 0 && (
        <div className="dropdown-menu">
          {connections.map((conn) => (
            <div
              key={conn.id}
              className={`dropdown-item ${conn.id === currentConnectionId ? 'selected' : ''}`}
              onClick={() => handleSelect(conn.id)}
            >
              {conn.name || conn.server}
            </div>
          ))}
          <div className="dropdown-separator" />
          <div
            className="dropdown-item"
            onClick={() => {
              manageConnections();
              setIsOpen(false);
            }}
          >
            Manage Connections...
          </div>
        </div>
      )}
    </div>
  );
}
