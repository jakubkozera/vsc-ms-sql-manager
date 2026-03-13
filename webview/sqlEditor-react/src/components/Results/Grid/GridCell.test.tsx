import { describe, it, expect } from 'vitest';
import { render, screen } from '../../../test/testUtils';
import { GridCell } from './GridCell';
import { ColumnDef } from '../../../types/grid';

const defaultColumn: ColumnDef = {
  name: 'test',
  index: 0,
  type: 'string',
  isPrimaryKey: false,
  isForeignKey: false,
  width: 150,
};

describe('GridCell', () => {

  it('renders string value', () => {
    render(
      <table><tbody><tr>
        <GridCell value="Hello World" column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('renders NULL for null values', () => {
    render(
      <table><tbody><tr>
        <GridCell value={null} column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('null');
    expect(screen.getByText('NULL')).toBeInTheDocument();
  });

  it('renders number values', () => {
    render(
      <table><tbody><tr>
        <GridCell value={42} column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('number');
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders boolean values', () => {
    render(
      <table><tbody><tr>
        <GridCell value={true} column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('boolean');
    expect(screen.getByText('✓')).toBeInTheDocument();
  });

  it('detects JSON content', () => {
    render(
      <table><tbody><tr>
        <GridCell value='{"name": "test"}' column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('json');
  });

  it('detects XML content', () => {
    render(
      <table><tbody><tr>
        <GridCell value='<root><item>test</item></root>' column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('xml');
  });

  it('does not detect <unknown> as XML', () => {
    render(
      <table><tbody><tr>
        <GridCell value='<unknown>' column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).not.toHaveClass('xml');
  });

  it('does not detect unclosed tags as XML', () => {
    render(
      <table><tbody><tr>
        <GridCell value='<not valid xml>' column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).not.toHaveClass('xml');
  });

  it('detects self-closing XML as XML', () => {
    render(
      <table><tbody><tr>
        <GridCell value='<item attr="val" />' column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('xml');
  });

  it('marks long text with long-text class', () => {
    const longText = 'a'.repeat(150);
    render(
      <table><tbody><tr>
        <GridCell value={longText} column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );
    
    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('long-text');
  });
});

describe('GridCell — modified indicator', () => {
  it('adds modified class when isModified is true', () => {
    render(
      <table><tbody><tr>
        <GridCell value="hello" column={defaultColumn} rowIndex={0} colIndex={0} isModified={true} />
      </tr></tbody></table>
    );

    expect(screen.getByTestId('cell-0-0')).toHaveClass('modified');
  });

  it('does not render the dot indicator span when isModified is true', () => {
    render(
      <table><tbody><tr>
        <GridCell value="hello" column={defaultColumn} rowIndex={0} colIndex={0} isModified={true} />
      </tr></tbody></table>
    );

    // The old "●" span must be gone — indicator is now a CSS ::after triangle
    const cell = screen.getByTestId('cell-0-0');
    expect(cell.querySelector('.cell-modified-indicator')).toBeNull();
  });

  it('does not add modified class when isModified is false', () => {
    render(
      <table><tbody><tr>
        <GridCell value="hello" column={defaultColumn} rowIndex={0} colIndex={0} isModified={false} />
      </tr></tbody></table>
    );

    expect(screen.getByTestId('cell-0-0')).not.toHaveClass('modified');
  });
});

describe('GridCell — JS object / array JSON rendering', () => {
  it('renders plain JS object as JSON string and applies json class', () => {
    render(
      <table><tbody><tr>
        <GridCell value={{ name: 'Alice', age: 30 }} column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );

    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('json');
    expect(cell.querySelector('.cell-content')!.textContent).toBe('{"name":"Alice","age":30}');
  });

  it('does not render [object Object] for a JS object value', () => {
    render(
      <table><tbody><tr>
        <GridCell value={{ id: 1 }} column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );

    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('renders JS array as JSON string and applies json class', () => {
    render(
      <table><tbody><tr>
        <GridCell value={[1, 2, 3]} column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );

    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('json');
    expect(cell.querySelector('.cell-content')!.textContent).toBe('[1,2,3]');
  });

  it('shows open JSON button for a plain JS object', () => {
    render(
      <table><tbody><tr>
        <GridCell value={{ key: 'value' }} column={defaultColumn} rowIndex={0} colIndex={0} />
      </tr></tbody></table>
    );

    expect(screen.getByRole('button', { name: 'Open JSON in new editor' })).toBeInTheDocument();
  });
});

describe('GridCell — validation error', () => {
  it('adds validation-error class when isModified and validationError is set', () => {
    render(
      <table><tbody><tr>
        <GridCell value="abc" column={defaultColumn} rowIndex={0} colIndex={0} isModified={true} validationError="Value must be a whole number for type int" />
      </tr></tbody></table>
    );

    const cell = screen.getByTestId('cell-0-0');
    expect(cell).toHaveClass('modified');
    expect(cell).toHaveClass('validation-error');
  });

  it('does not add validation-error class when isModified is false', () => {
    render(
      <table><tbody><tr>
        <GridCell value="abc" column={defaultColumn} rowIndex={0} colIndex={0} isModified={false} validationError="some error" />
      </tr></tbody></table>
    );

    const cell = screen.getByTestId('cell-0-0');
    expect(cell).not.toHaveClass('validation-error');
  });

  it('does not add validation-error class when validationError is null', () => {
    render(
      <table><tbody><tr>
        <GridCell value="hello" column={defaultColumn} rowIndex={0} colIndex={0} isModified={true} validationError={null} />
      </tr></tbody></table>
    );

    const cell = screen.getByTestId('cell-0-0');
    expect(cell).not.toHaveClass('validation-error');
  });

  it('shows validation error warning icon when isModified and validationError is set', () => {
    render(
      <table><tbody><tr>
        <GridCell value="abc" column={defaultColumn} rowIndex={0} colIndex={0} isModified={true} validationError="Value must be a whole number for type int" />
      </tr></tbody></table>
    );

    const icon = screen.getByTestId('validation-icon-0-0');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass('cell-validation-icon');
  });

  it('shows longText title when no validationError', () => {
    const longText = 'a'.repeat(150);
    render(
      <table><tbody><tr>
        <GridCell value={longText} column={defaultColumn} rowIndex={0} colIndex={0} isModified={false} />
      </tr></tbody></table>
    );

    const cell = screen.getByTestId('cell-0-0');
    expect(cell.getAttribute('title')).toBe(longText);
  });
});
