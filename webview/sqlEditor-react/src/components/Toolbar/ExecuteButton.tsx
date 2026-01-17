import { useState, useRef, useEffect } from 'react';
import './ExecuteButton.css';

interface ExecuteButtonProps {
  onExecute: () => void;
  onCancel: () => void;
  isExecuting: boolean;
  disabled: boolean;
  includeActualPlan: boolean;
  onToggleActualPlan: (enabled: boolean) => void;
}

export function ExecuteButton({
  onExecute,
  onCancel,
  isExecuting,
  disabled,
  includeActualPlan,
  onToggleActualPlan,
}: ExecuteButtonProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };

    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  return (
    <div className="button-container" ref={dropdownRef}>
      {/* Main Execute/Cancel Button */}
      {isExecuting ? (
        <button
          className="main-button cancel"
          onClick={onCancel}
          title="Cancel Query"
        >
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
            <path d="M5 5m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z" />
          </svg>
          Cancel
        </button>
      ) : (
        <button
          className="main-button"
          onClick={onExecute}
          disabled={disabled}
          title="Execute Query (F5 or Ctrl+Shift+E)"
        >
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
            <path d="M7 4v16l13 -8z" />
          </svg>
          Run
        </button>
      )}

      {/* Dropdown Toggle */}
      <button
        className={`dropdown-toggle ${dropdownOpen ? 'open' : ''}`}
        onClick={() => setDropdownOpen(!dropdownOpen)}
        disabled={isExecuting}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6l6 -6" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {dropdownOpen && (
        <div className="execute-dropdown-menu">
          <div className="dropdown-item">
            <label htmlFor="actualPlanCheckbox">With execution plan</label>
            <label className="toggle-switch">
              <input
                type="checkbox"
                id="actualPlanCheckbox"
                checked={includeActualPlan}
                onChange={(e) => onToggleActualPlan(e.target.checked)}
              />
              <span className="toggle-slider"></span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
