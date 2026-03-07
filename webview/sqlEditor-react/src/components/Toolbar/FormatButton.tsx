import { useState, useRef, useEffect } from 'react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import './FormatButton.css';

export interface FormatOptions {
  tabWidth: number;
  keywordCase: 'upper' | 'lower' | 'preserve';
  dataTypeCase: 'upper' | 'lower' | 'preserve';
  functionCase: 'upper' | 'lower' | 'preserve';
  linesBetweenQueries: number;
  indentStyle: 'standard' | 'tabularLeft' | 'tabularRight';
  logicalOperatorNewline: 'before' | 'after';
  formatBeforeRun: boolean;
}

const defaultFormatOptions: FormatOptions = {
  tabWidth: 2,
  keywordCase: 'upper',
  dataTypeCase: 'upper',
  functionCase: 'upper',
  linesBetweenQueries: 1,
  indentStyle: 'standard',
  logicalOperatorNewline: 'before',
  formatBeforeRun: false,
};

interface FormatButtonProps {
  onFormat: () => void;
}

export function FormatButton({ onFormat }: FormatButtonProps) {
  const [showPopup, setShowPopup] = useState(false);
  const [options, setOptions] = useLocalStorage<FormatOptions>('sqlFormattingOptions', defaultFormatOptions);
  const popupRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close popup on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current &&
        containerRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowPopup(false);
      }
    };

    if (showPopup) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPopup]);

  const handleApplyAndFormat = () => {
    setShowPopup(false);
    onFormat();
  };

  const updateOption = <K extends keyof FormatOptions>(key: K, value: FormatOptions[K]) => {
    setOptions(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="format-button-container" ref={containerRef}>
      {/* Format Button */}
      <button
        className="format-icon-only-button"
        onClick={onFormat}
        title="Format SQL (T-SQL)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 3v4a1 1 0 0 0 1 1h4" />
          <path d="M12 21h-5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v3.5" />
          <path d="M9 9h1" />
          <path d="M9 13h6" />
          <path d="M9 17h3" />
          <path d="M19 22.5a4.75 4.75 0 0 1 3.5 -3.5a4.75 4.75 0 0 1 -3.5 -3.5a4.75 4.75 0 0 1 -3.5 3.5a4.75 4.75 0 0 1 3.5 3.5" />
        </svg>
      </button>

      {/* Options Button */}
      <button
        className="format-options-icon-button"
        onClick={() => setShowPopup(!showPopup)}
        title="Formatting options"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z" />
          <path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
        </svg>
      </button>

      {/* Format Options Popup */}
      {showPopup && (
        <div className="format-options-popup" ref={popupRef}>
          <div className="format-options-header">
            <h3>Formatting Options</h3>
            <button className="close-popup" onClick={() => setShowPopup(false)}>
              ×
            </button>
          </div>

          <div className="format-options-content">
            <div className="format-option">
              <label htmlFor="indentOption">Indent:</label>
              <input
                type="number"
                id="indentOption"
                value={options.tabWidth}
                min={1}
                max={8}
                onChange={(e) => updateOption('tabWidth', parseInt(e.target.value, 10))}
              />
            </div>

            <div className="format-option">
              <label htmlFor="linesBetweenQueriesOption">Lines between queries:</label>
              <input
                type="number"
                id="linesBetweenQueriesOption"
                value={options.linesBetweenQueries}
                min={0}
                max={5}
                onChange={(e) => updateOption('linesBetweenQueries', parseInt(e.target.value, 10))}
              />
            </div>

            <div className="format-option">
              <label htmlFor="keywordCaseOption">Keyword case:</label>
              <select
                id="keywordCaseOption"
                value={options.keywordCase}
                onChange={(e) => updateOption('keywordCase', e.target.value as FormatOptions['keywordCase'])}
              >
                <option value="upper">UPPER</option>
                <option value="lower">lower</option>
                <option value="preserve">Preserve</option>
              </select>
            </div>

            <div className="format-option">
              <label htmlFor="dataTypeOption">Data type case:</label>
              <select
                id="dataTypeOption"
                value={options.dataTypeCase}
                onChange={(e) => updateOption('dataTypeCase', e.target.value as FormatOptions['dataTypeCase'])}
              >
                <option value="upper">UPPER</option>
                <option value="lower">lower</option>
                <option value="preserve">Preserve</option>
              </select>
            </div>

            <div className="format-option">
              <label htmlFor="functionCaseOption">Function case:</label>
              <select
                id="functionCaseOption"
                value={options.functionCase}
                onChange={(e) => updateOption('functionCase', e.target.value as FormatOptions['functionCase'])}
              >
                <option value="upper">UPPER</option>
                <option value="lower">lower</option>
                <option value="preserve">Preserve</option>
              </select>
            </div>

            <div className="format-option">
              <label htmlFor="indentStyleOption">Indentation style:</label>
              <select
                id="indentStyleOption"
                value={options.indentStyle}
                onChange={(e) => updateOption('indentStyle', e.target.value as FormatOptions['indentStyle'])}
              >
                <option value="standard">Standard</option>
                <option value="tabularLeft">Tabular, Left</option>
                <option value="tabularRight">Tabular, Right</option>
              </select>
            </div>

            <div className="format-option">
              <label htmlFor="logicalOperatorNewlineOption">AND/OR newlines:</label>
              <select
                id="logicalOperatorNewlineOption"
                value={options.logicalOperatorNewline}
                onChange={(e) => updateOption('logicalOperatorNewline', e.target.value as FormatOptions['logicalOperatorNewline'])}
              >
                <option value="before">before</option>
                <option value="after">after</option>
              </select>
            </div>

            <div className="format-option" style={{ borderTop: '1px solid var(--vscode-panel-border)', paddingTop: '12px', marginTop: '12px' }}>
              <label htmlFor="formatBeforeRunOption">
                <input
                  type="checkbox"
                  id="formatBeforeRunOption"
                  checked={options.formatBeforeRun}
                  onChange={(e) => updateOption('formatBeforeRun', e.target.checked)}
                />
                Format before run
              </label>
            </div>
          </div>

          <div className="format-options-footer">
            <button className="apply-format-button" onClick={handleApplyAndFormat}>
              Apply & Format
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Export for use in other components
export function useFormatOptions() {
  const [options] = useLocalStorage<FormatOptions>('sqlFormattingOptions', defaultFormatOptions);
  return options;
}
