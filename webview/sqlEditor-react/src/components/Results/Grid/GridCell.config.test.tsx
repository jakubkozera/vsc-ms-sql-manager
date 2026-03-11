import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GridCell } from './GridCell';
import { ColumnDef } from '../../../types/grid';

// Mock useVSCode so we can control config per test
vi.mock('../../../context/VSCodeContext', () => ({
  useVSCode: vi.fn(),
}));

import { useVSCode } from '../../../context/VSCodeContext';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockConfig(config: {
  colorPrimaryForeignKeys?: boolean;
  numberFormat?: 'plain' | 'locale' | 'fixed-2' | 'fixed-4';
}) {
  vi.mocked(useVSCode).mockReturnValue({
    config: {
      colorPrimaryForeignKeys: config.colorPrimaryForeignKeys ?? true,
      numberFormat: config.numberFormat ?? 'plain',
    },
  } as any);
}

function renderCell(value: unknown, column: ColumnDef) {
  return render(
    <table><tbody><tr>
      <GridCell value={value} column={column} rowIndex={0} colIndex={0} />
    </tr></tbody></table>
  );
}

const pkColumn: ColumnDef = {
  name: 'id', index: 0, type: 'number',
  isPrimaryKey: true, isForeignKey: false, width: 150,
};

const fkColumn: ColumnDef = {
  name: 'userId', index: 0, type: 'number',
  isPrimaryKey: false, isForeignKey: true, width: 150,
};

const numColumn: ColumnDef = {
  name: 'amount', index: 0, type: 'number',
  isPrimaryKey: false, isForeignKey: false, width: 150,
};

// ── colorPrimaryForeignKeys tests ─────────────────────────────────────────────

describe('GridCell — colorPrimaryForeignKeys setting', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('applies pk-cell class when colorPrimaryForeignKeys is true', () => {
    mockConfig({ colorPrimaryForeignKeys: true });
    renderCell(1, pkColumn);
    expect(screen.getByTestId('cell-0-0')).toHaveClass('pk-cell');
  });

  it('does NOT apply pk-cell class when colorPrimaryForeignKeys is false', () => {
    mockConfig({ colorPrimaryForeignKeys: false });
    renderCell(1, pkColumn);
    expect(screen.getByTestId('cell-0-0')).not.toHaveClass('pk-cell');
  });

  it('applies fk-cell class when colorPrimaryForeignKeys is true', () => {
    mockConfig({ colorPrimaryForeignKeys: true });
    renderCell(5, fkColumn);
    expect(screen.getByTestId('cell-0-0')).toHaveClass('fk-cell');
  });

  it('does NOT apply fk-cell class when colorPrimaryForeignKeys is false', () => {
    mockConfig({ colorPrimaryForeignKeys: false });
    renderCell(5, fkColumn);
    expect(screen.getByTestId('cell-0-0')).not.toHaveClass('fk-cell');
  });

  it('shows expand chevron for FK column when colorPrimaryForeignKeys is true', () => {
    mockConfig({ colorPrimaryForeignKeys: true });
    renderCell(5, fkColumn);
    expect(screen.getByTitle('Expand foreign key')).toBeInTheDocument();
  });

  it('hides expand chevron for FK column when colorPrimaryForeignKeys is false', () => {
    mockConfig({ colorPrimaryForeignKeys: false });
    renderCell(5, fkColumn);
    expect(screen.queryByTitle('Expand foreign key')).not.toBeInTheDocument();
  });

  it('shows expand chevron for PK column when colorPrimaryForeignKeys is true', () => {
    mockConfig({ colorPrimaryForeignKeys: true });
    renderCell(1, pkColumn);
    expect(screen.getByTitle('View related rows')).toBeInTheDocument();
  });

  it('hides expand chevron for PK column when colorPrimaryForeignKeys is false', () => {
    mockConfig({ colorPrimaryForeignKeys: false });
    renderCell(1, pkColumn);
    expect(screen.queryByTitle('View related rows')).not.toBeInTheDocument();
  });
});

// ── numberFormat tests ────────────────────────────────────────────────────────

describe('GridCell — numberFormat setting', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('plain format renders number as raw string', () => {
    mockConfig({ numberFormat: 'plain' });
    renderCell(1234567.89, numColumn);
    expect(screen.getByText('1234567.89')).toBeInTheDocument();
  });

  it('plain format renders integers without decimal point', () => {
    mockConfig({ numberFormat: 'plain' });
    renderCell(42, numColumn);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('locale format renders number via toLocaleString()', () => {
    mockConfig({ numberFormat: 'locale' });
    renderCell(1234567.89, numColumn);
    const span = screen.getByTestId('cell-0-0').querySelector('.cell-content')!;
    expect(span.textContent).toBe((1234567.89).toLocaleString());
  });

  it('fixed-2 format always shows 2 decimal places for integer', () => {
    mockConfig({ numberFormat: 'fixed-2' });
    renderCell(42, numColumn);
    const expected = (42).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('fixed-2 format rounds to 2 decimal places', () => {
    mockConfig({ numberFormat: 'fixed-2' });
    renderCell(42.5, numColumn);
    const expected = (42.5).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('fixed-4 format always shows 4 decimal places for integer', () => {
    mockConfig({ numberFormat: 'fixed-4' });
    renderCell(42, numColumn);
    const expected = (42).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('fixed-4 format pads number with trailing zeros', () => {
    mockConfig({ numberFormat: 'fixed-4' });
    renderCell(42.5, numColumn);
    const expected = (42.5).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('cell retains number class regardless of format', () => {
    mockConfig({ numberFormat: 'fixed-2' });
    renderCell(99, numColumn);
    expect(screen.getByTestId('cell-0-0')).toHaveClass('number');
  });
});
