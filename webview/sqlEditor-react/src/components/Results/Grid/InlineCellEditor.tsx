import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import './InlineCellEditor.css';

interface InlineCellEditorProps {
  value: unknown;
  columnName: string;
  columnType?: string;
  onSave: (newValue: unknown) => void;
  onCancel: () => void;
}

function isBitType(columnType?: string): boolean {
  return columnType?.toLowerCase() === 'bit';
}

export function InlineCellEditor({ 
  value, 
  columnName, 
  columnType,
  onSave, 
  onCancel 
}: InlineCellEditorProps) {
  // BIT column: render checkbox editor
  if (isBitType(columnType)) {
    return (
      <BitCheckboxEditor
        value={value}
        columnName={columnName}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  return (
    <TextCellEditor
      value={value}
      columnName={columnName}
      columnType={columnType}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

interface BitCheckboxEditorProps {
  value: unknown;
  columnName: string;
  onSave: (newValue: unknown) => void;
  onCancel: () => void;
}

function BitCheckboxEditor({ value, columnName, onSave, onCancel }: BitCheckboxEditorProps) {
  const checkboxRef = useRef<HTMLInputElement>(null);
  const checked = value === true || value === 1 || value === '1';

  useEffect(() => {
    checkboxRef.current?.focus();
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSave(e.target.checked);
  }, [onSave]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [onCancel]);

  return (
    <div className="inline-cell-editor-bit" data-testid="inline-cell-editor-bit">
      <input
        ref={checkboxRef}
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        aria-label={`Edit ${columnName}`}
        data-testid="inline-cell-editor-checkbox"
        className="inline-cell-editor-checkbox"
      />
    </div>
  );
}

interface TextCellEditorProps {
  value: unknown;
  columnName: string;
  columnType?: string;
  onSave: (newValue: unknown) => void;
  onCancel: () => void;
}

function TextCellEditor({ value, columnName, columnType, onSave, onCancel }: TextCellEditorProps) {
  const [editValue, setEditValue] = useState<string>(formatValue(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const parsed = parseValue(editValue, columnType);
      onSave(parsed);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Tab') {
      // Allow tab to save and move to next cell
      const parsed = parseValue(editValue, columnType);
      onSave(parsed);
    }
  }, [editValue, columnType, onSave, onCancel]);

  const handleBlur = useCallback(() => {
    const parsed = parseValue(editValue, columnType);
    onSave(parsed);
  }, [editValue, columnType, onSave]);

  return (
    <input
      ref={inputRef}
      className="inline-cell-editor"
      type="text"
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      aria-label={`Edit ${columnName}`}
      data-testid="inline-cell-editor"
    />
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function parseValue(value: string, columnType?: string): unknown {
  // Empty string treated as NULL
  if (value === '' || value.toLowerCase() === 'null') {
    return null;
  }

  // Try to parse based on column type
  if (columnType) {
    const type = columnType.toLowerCase();
    
    if (type.includes('int') || type === 'tinyint' || type === 'smallint' || type === 'bigint') {
      const num = parseInt(value, 10);
      return isNaN(num) ? value : num;
    }
    
    if (type.includes('decimal') || type.includes('numeric') || type.includes('float') || type.includes('real') || type === 'money' || type === 'smallmoney') {
      const num = parseFloat(value);
      return isNaN(num) ? value : num;
    }
    
    if (type === 'bit') {
      return value === '1' || value.toLowerCase() === 'true';
    }
  }

  // Return as string by default
  return value;
}
