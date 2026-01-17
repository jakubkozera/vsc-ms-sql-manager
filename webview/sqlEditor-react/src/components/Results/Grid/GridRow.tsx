import { ColumnDef } from '../../../types/grid';
import { GridCell } from './GridCell';
import './GridRow.css';

interface GridRowProps {
  row: any[];
  rowIndex: number;
  columns: ColumnDef[];
}

export function GridRow({ row, rowIndex, columns }: GridRowProps) {
  return (
    <tr className="grid-row" data-testid={`row-${rowIndex}`}>
      {/* Row number cell */}
      <td className="grid-cell row-number-cell">
        {rowIndex + 1}
      </td>

      {columns.map((column, colIndex) => (
        <GridCell
          key={column.name}
          value={row[colIndex]}
          column={column}
          rowIndex={rowIndex}
          colIndex={colIndex}
        />
      ))}
    </tr>
  );
}
