import React, { useCallback, useEffect, useRef, useState } from 'react';

interface CellActionsProps {
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onDeleteCell: (index: number) => void;
  onMoveCell: (index: number, direction: 'up' | 'down') => void;
  onInsertCellBelow: (index: number, type: 'code' | 'markdown') => void;
}

const MoveUpIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5l0 14" />
    <path d="M18 11l-6 -6" />
    <path d="M6 11l6 -6" />
  </svg>
);

const MoveDownIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5l0 14" />
    <path d="M18 13l-6 6" />
    <path d="M6 13l6 6" />
  </svg>
);

const DeleteIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7l16 0" />
    <path d="M10 11l0 6" />
    <path d="M14 11l0 6" />
    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
    <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
  </svg>
);

const InsertBelowIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const CodeSmallIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 8l-4 4l4 4" />
    <path d="M17 8l4 4l-4 4" />
  </svg>
);

const TextSmallIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h12" />
  </svg>
);

const CellActions: React.FC<CellActionsProps> = ({
  index,
  isFirst,
  isLast,
  onDeleteCell,
  onMoveCell,
  onInsertCellBelow,
}) => {
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleInsert = useCallback((type: 'code' | 'markdown') => {
    onInsertCellBelow(index, type);
    setShowInsertMenu(false);
  }, [index, onInsertCellBelow]);

  useEffect(() => {
    if (!showInsertMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowInsertMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showInsertMenu]);

  return (
    <div className="cell-actions">
      <button
        className="cell-action-btn"
        onClick={() => onMoveCell(index, 'up')}
        disabled={isFirst}
        title="Move cell up"
      >
        <MoveUpIcon />
      </button>
      <button
        className="cell-action-btn"
        onClick={() => onMoveCell(index, 'down')}
        disabled={isLast}
        title="Move cell down"
      >
        <MoveDownIcon />
      </button>
      <div className="insert-cell-menu-wrapper" ref={menuRef}>
        <button
          className="cell-action-btn"
          onClick={() => setShowInsertMenu(!showInsertMenu)}
          title="Insert cell below"
        >
          <InsertBelowIcon />
        </button>
        {showInsertMenu && (
          <div className="insert-cell-dropdown">
            <button className="add-cell-option" onClick={() => handleInsert('code')}>
              <CodeSmallIcon /> Code
            </button>
            <button className="add-cell-option" onClick={() => handleInsert('markdown')}>
              <TextSmallIcon /> Text
            </button>
          </div>
        )}
      </div>
      <button
        className="cell-action-btn delete-cell-btn"
        onClick={() => onDeleteCell(index)}
        title="Delete cell"
      >
        <DeleteIcon />
      </button>
    </div>
  );
};

export default CellActions;
