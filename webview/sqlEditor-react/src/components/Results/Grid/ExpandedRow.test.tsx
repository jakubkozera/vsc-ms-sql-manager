import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExpandedRow } from './ExpandedRow';
import type { ResultSetMetadata } from '../../../types/messages';

describe('ExpandedRow', () => {
  describe('Loading State', () => {
    it('should display loader when isLoading is true', () => {
      render(
        <ExpandedRow
          data={[]}
          metadata={undefined}
          columnNames={undefined}
          isLoading={true}
          error={undefined}
        />
      );
      
      expect(document.querySelector('.loader-spinner')).toBeInTheDocument();
    });
  });

  describe('Error State', () => {
    it('should display error message when error is provided', () => {
      render(
        <ExpandedRow
          data={[]}
          metadata={undefined}
          columnNames={undefined}
          isLoading={false}
          error="Failed to load data"
        />
      );
      
      expect(screen.getByText(/Failed to load data/)).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should display empty message when no data is provided', () => {
      render(
        <ExpandedRow
          data={[]}
          metadata={undefined}
          columnNames={undefined}
          isLoading={false}
          error={undefined}
        />
      );
      
      expect(screen.getByText(/No related data found/)).toBeInTheDocument();
    });
  });

  describe('Data Rendering with columnNames', () => {
    it('should render table with data using columnNames array', () => {
      const data = [
        ['value1', 'value2', 'value3'],
        ['value4', 'value5', 'value6'],
      ];
      
      const columnNames = ['Column1', 'Column2', 'Column3'];
      
      const metadata: ResultSetMetadata = {
        columns: [
          { name: 'Column1', type: 'string', isPrimaryKey: false, isForeignKey: false },
          { name: 'Column2', type: 'string', isPrimaryKey: false, isForeignKey: false },
          { name: 'Column3', type: 'string', isPrimaryKey: false, isForeignKey: false },
        ],
        isEditable: true,
      };
      
      render(
        <ExpandedRow
          data={data}
          metadata={metadata}
          columnNames={columnNames}
          isLoading={false}
          error={undefined}
        />
      );
      
      // Check headers
      expect(screen.getByText('Column1')).toBeInTheDocument();
      expect(screen.getByText('Column2')).toBeInTheDocument();
      expect(screen.getByText('Column3')).toBeInTheDocument();
      
      // Check data cells
      expect(screen.getByText('value1')).toBeInTheDocument();
      expect(screen.getByText('value2')).toBeInTheDocument();
      expect(screen.getByText('value3')).toBeInTheDocument();
      expect(screen.getByText('value4')).toBeInTheDocument();
      expect(screen.getByText('value5')).toBeInTheDocument();
      expect(screen.getByText('value6')).toBeInTheDocument();
    });
  });

  describe('Data Rendering with array format', () => {
    it('should render table with array data using metadata columns', () => {
      const data = [
        ['id1', 'name1', 100],
        ['id2', 'name2', 200],
      ];
      
      const metadata: ResultSetMetadata = {
        columns: [
          { name: 'Id', type: 'uniqueidentifier', isPrimaryKey: true, isForeignKey: false },
          { name: 'Name', type: 'nvarchar', isPrimaryKey: false, isForeignKey: false },
          { name: 'Count', type: 'int', isPrimaryKey: false, isForeignKey: false },
        ],
        isEditable: true,
      };
      
      render(
        <ExpandedRow
          data={data}
          metadata={metadata}
          columnNames={undefined}
          isLoading={false}
          error={undefined}
        />
      );
      
      // Check headers from metadata
      expect(screen.getByText('Id')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Count')).toBeInTheDocument();
      
      // Check data
      expect(screen.getByText('id1')).toBeInTheDocument();
      expect(screen.getByText('name1')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
      expect(screen.getByText('id2')).toBeInTheDocument();
      expect(screen.getByText('name2')).toBeInTheDocument();
      expect(screen.getByText('200')).toBeInTheDocument();
    });
    
    it('should use fallback column names when metadata is missing', () => {
      const data = [
        ['value1', 'value2'],
        ['value3', 'value4'],
      ];
      
      render(
        <ExpandedRow
          data={data}
          metadata={undefined}
          columnNames={undefined}
          isLoading={false}
          error={undefined}
        />
      );
      
      // Should use fallback "Column X" names
      expect(screen.getByText('Column 1')).toBeInTheDocument();
      expect(screen.getByText('Column 2')).toBeInTheDocument();
    });
  });

  describe('Data Rendering with object format', () => {
    it('should render table with object data using Object.keys', () => {
      const data = [
        { Id: 'id1', Name: 'name1', Active: true },
        { Id: 'id2', Name: 'name2', Active: false },
      ];
      
      render(
        <ExpandedRow
          data={data}
          metadata={undefined}
          columnNames={undefined}
          isLoading={false}
          error={undefined}
        />
      );
      
      // Check headers from object keys
      expect(screen.getByText('Id')).toBeInTheDocument();
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('Active')).toBeInTheDocument();
      
      // Check data
      expect(screen.getByText('id1')).toBeInTheDocument();
      expect(screen.getByText('name1')).toBeInTheDocument();
      expect(screen.getByText('true')).toBeInTheDocument();
      expect(screen.getByText('id2')).toBeInTheDocument();
      expect(screen.getByText('name2')).toBeInTheDocument();
      expect(screen.getByText('false')).toBeInTheDocument();
    });
  });

  describe('NULL Values', () => {
    it('should display NULL for null values', () => {
      const data = [
        ['value1', null, 'value3'],
      ];
      
      const columnNames = ['Col1', 'Col2', 'Col3'];
      
      render(
        <ExpandedRow
          data={data}
          metadata={undefined}
          columnNames={columnNames}
          isLoading={false}
          error={undefined}
        />
      );
      
      expect(screen.getByText('value1')).toBeInTheDocument();
      expect(screen.getByText('NULL')).toBeInTheDocument();
      expect(screen.getByText('value3')).toBeInTheDocument();
    });
  });

  describe('Multiple Rows', () => {
    it('should render multiple rows with correct data', () => {
      const data = [
        ['row1-col1', 'row1-col2'],
        ['row2-col1', 'row2-col2'],
        ['row3-col1', 'row3-col2'],
        ['row4-col1', 'row4-col2'],
        ['row5-col1', 'row5-col2'],
      ];
      
      const columnNames = ['Column1', 'Column2'];
      
      render(
        <ExpandedRow
          data={data}
          metadata={undefined}
          columnNames={columnNames}
          isLoading={false}
          error={undefined}
        />
      );
      
      // Check all 5 rows are rendered
      expect(screen.getByText('row1-col1')).toBeInTheDocument();
      expect(screen.getByText('row2-col1')).toBeInTheDocument();
      expect(screen.getByText('row3-col1')).toBeInTheDocument();
      expect(screen.getByText('row4-col1')).toBeInTheDocument();
      expect(screen.getByText('row5-col1')).toBeInTheDocument();
      
      expect(screen.getByText('row1-col2')).toBeInTheDocument();
      expect(screen.getByText('row2-col2')).toBeInTheDocument();
      expect(screen.getByText('row3-col2')).toBeInTheDocument();
      expect(screen.getByText('row4-col2')).toBeInTheDocument();
      expect(screen.getByText('row5-col2')).toBeInTheDocument();
    });
  });

  describe('Primary and Foreign Keys', () => {
    it('should apply PK and FK styling based on metadata', () => {
      const data = [['pk-value', 'fk-value', 'normal-value']];
      
      const columnNames = ['PrimaryKey', 'ForeignKey', 'NormalColumn'];
      
      const metadata: ResultSetMetadata = {
        columns: [
          { name: 'PrimaryKey', type: 'int', isPrimaryKey: true, isForeignKey: false },
          { name: 'ForeignKey', type: 'int', isPrimaryKey: false, isForeignKey: true },
          { name: 'NormalColumn', type: 'string', isPrimaryKey: false, isForeignKey: false },
        ],
        isEditable: true,
      };
      
      const { container } = render(
        <ExpandedRow
          data={data}
          metadata={metadata}
          columnNames={columnNames}
          isLoading={false}
          error={undefined}
        />
      );
      
      // Check that cells have appropriate classes
      const pkCell = container.querySelector('.pk-cell');
      const fkCell = container.querySelector('.fk-cell');
      
      expect(pkCell).toBeInTheDocument();
      expect(fkCell).toBeInTheDocument();
    });
  });
});
