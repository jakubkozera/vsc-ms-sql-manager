import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test/testUtils';
import { InlineCellEditor } from './InlineCellEditor';

describe('InlineCellEditor – BIT column', () => {
  it('renders a checkbox for bit column type', () => {
    render(
      <InlineCellEditor
        value={true}
        columnName="IsActive"
        columnType="bit"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('inline-cell-editor-checkbox')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-cell-editor')).toBeNull();
  });

  it('renders checked checkbox when value is true', () => {
    render(
      <InlineCellEditor
        value={true}
        columnName="IsActive"
        columnType="bit"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const checkbox = screen.getByTestId('inline-cell-editor-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('renders unchecked checkbox when value is false', () => {
    render(
      <InlineCellEditor
        value={false}
        columnName="IsActive"
        columnType="bit"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const checkbox = screen.getByTestId('inline-cell-editor-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('renders checked checkbox when value is 1', () => {
    render(
      <InlineCellEditor
        value={1}
        columnName="IsActive"
        columnType="bit"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const checkbox = screen.getByTestId('inline-cell-editor-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it('renders unchecked checkbox when value is 0', () => {
    render(
      <InlineCellEditor
        value={0}
        columnName="IsActive"
        columnType="bit"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const checkbox = screen.getByTestId('inline-cell-editor-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it('calls onSave with true when checkbox is checked', () => {
    const onSave = vi.fn();
    render(
      <InlineCellEditor
        value={false}
        columnName="IsActive"
        columnType="bit"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );
    const checkbox = screen.getByTestId('inline-cell-editor-checkbox');
    fireEvent.click(checkbox);
    expect(onSave).toHaveBeenCalledWith(true);
  });

  it('calls onSave with false when checkbox is unchecked', () => {
    const onSave = vi.fn();
    render(
      <InlineCellEditor
        value={true}
        columnName="IsActive"
        columnType="bit"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );
    const checkbox = screen.getByTestId('inline-cell-editor-checkbox');
    fireEvent.click(checkbox);
    expect(onSave).toHaveBeenCalledWith(false);
  });

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    render(
      <InlineCellEditor
        value={true}
        columnName="IsActive"
        columnType="bit"
        onSave={vi.fn()}
        onCancel={onCancel}
      />
    );
    const checkbox = screen.getByTestId('inline-cell-editor-checkbox');
    fireEvent.keyDown(checkbox, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('has correct aria-label', () => {
    render(
      <InlineCellEditor
        value={false}
        columnName="IsActive"
        columnType="bit"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Edit IsActive')).toBeInTheDocument();
  });
});

describe('InlineCellEditor – text columns', () => {
  it('renders a text input for non-bit columns', () => {
    render(
      <InlineCellEditor
        value="hello"
        columnName="Name"
        columnType="varchar"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('inline-cell-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('inline-cell-editor-checkbox')).toBeNull();
  });

  it('calls onSave with parsed integer for int column', () => {
    const onSave = vi.fn();
    render(
      <InlineCellEditor
        value={42}
        columnName="Age"
        columnType="int"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );
    const input = screen.getByTestId('inline-cell-editor');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith(42);
  });

  it('calls onSave with null for empty input', () => {
    const onSave = vi.fn();
    render(
      <InlineCellEditor
        value="some text"
        columnName="Name"
        columnType="varchar"
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );
    const input = screen.getByTestId('inline-cell-editor') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('calls onCancel when Escape is pressed', () => {
    const onCancel = vi.fn();
    render(
      <InlineCellEditor
        value="test"
        columnName="Name"
        columnType="varchar"
        onSave={vi.fn()}
        onCancel={onCancel}
      />
    );
    const input = screen.getByTestId('inline-cell-editor');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
