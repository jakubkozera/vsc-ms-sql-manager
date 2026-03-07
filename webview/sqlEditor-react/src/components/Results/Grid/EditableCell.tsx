import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import './EditableCell.css';

interface EditableCellProps {
  value: unknown;
  rowIndex: number;
  columnIndex: number;
  columnName: string;
  isModified: boolean;
  isDeleted: boolean;
  onEdit: (newValue: unknown) => void;
  onCancel: () => void;
  dataType?: string;
}

export function EditableCell({
  value,
  rowIndex,
  columnIndex,
  columnName: _columnName,
  isModified,
  isDeleted,
  onEdit,
  onCancel,
  dataType,
}: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  
  // Determine if value needs textarea (multiline)
  const isMultiline = typeof value === 'string' && (value.includes('\n') || value.length > 100);
  
  const formatDisplayValue = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  };
  
  const startEditing = useCallback(() => {
    if (isDeleted) return;
    setEditValue(formatDisplayValue(value));
    setIsEditing(true);
  }, [value, isDeleted]);
  
  const commitEdit = useCallback(() => {
    let parsedValue: unknown = editValue;
    
    // Try to parse based on data type or original value type
    if (editValue === '' || editValue.toLowerCase() === 'null') {
      parsedValue = null;
    } else if (dataType?.includes('int') || dataType?.includes('decimal') || dataType?.includes('float') || dataType?.includes('numeric')) {
      const num = Number(editValue);
      if (!isNaN(num)) {
        parsedValue = num;
      }
    } else if (dataType?.includes('bit') || typeof value === 'boolean') {
      parsedValue = editValue === '1' || editValue.toLowerCase() === 'true';
    }
    
    onEdit(parsedValue);
    setIsEditing(false);
  }, [editValue, dataType, value, onEdit]);
  
  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    onCancel();
  }, [onCancel]);
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Tab') {
      commitEdit();
      // Don't prevent default - let tab work naturally
    }
  }, [commitEdit, cancelEdit]);
  
  const handleDoubleClick = useCallback(() => {
    startEditing();
  }, [startEditing]);
  
  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);
  
  const displayValue = formatDisplayValue(value);
  const isNull = value === null || value === undefined;
  
  const cellClasses = [
    'editable-cell',
    isModified && 'modified',
    isDeleted && 'deleted',
    isNull && 'null-value',
  ].filter(Boolean).join(' ');
  
  if (isEditing) {
    const InputComponent = isMultiline ? 'textarea' : 'input';
    
    return (
      <div className="editable-cell editing" data-testid={`edit-cell-${rowIndex}-${columnIndex}`}>
        <InputComponent
          ref={inputRef as any}
          className="cell-input"
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          data-testid="cell-input"
        />
      </div>
    );
  }
  
  return (
    <div
      className={cellClasses}
      onDoubleClick={handleDoubleClick}
      title={isModified ? `Modified (original: ${formatDisplayValue(value)})` : undefined}
      data-testid={`cell-${rowIndex}-${columnIndex}`}
    >
      <span className="cell-content">
        {isNull ? <span className="null-indicator">NULL</span> : displayValue}
      </span>
      {isModified && <span className="modified-indicator" title="Modified">●</span>}
    </div>
  );
}
