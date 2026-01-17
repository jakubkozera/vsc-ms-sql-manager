import { describe, it, expect } from 'vitest';
import { render, screen } from '../../../test/testUtils';
import { GridCell } from './GridCell';
import { ColumnDef } from '../../../types/grid';

describe('GridCell', () => {
  const defaultColumn: ColumnDef = {
    name: 'test',
    index: 0,
    type: 'string',
    isPrimaryKey: false,
    isForeignKey: false,
    width: 150,
  };

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
    expect(screen.getByText('true')).toBeInTheDocument();
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
