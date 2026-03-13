import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  const postMessage = vi.fn();
  vi.mocked(useVSCode).mockReturnValue({
    config: {
      colorPrimaryForeignKeys: config.colorPrimaryForeignKeys ?? true,
      numberFormat: config.numberFormat ?? 'plain',
    },
    postMessage,
  } as any);

  return { postMessage };
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

describe('GridCell — open structured content', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows open button for JSON values', () => {
    mockConfig({});
    renderCell('{"name":"alice"}', {
      name: 'payload',
      index: 0,
      type: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      width: 150,
    });

    expect(screen.getByRole('button', { name: 'Open JSON in new editor' })).toBeInTheDocument();
  });

  it('shows open button for XML values', () => {
    mockConfig({});
    renderCell('<root><item>1</item></root>', {
      name: 'payload',
      index: 0,
      type: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      width: 150,
    });

    expect(screen.getByRole('button', { name: 'Open XML in new editor' })).toBeInTheDocument();
  });

  it('does not show open button for plain text', () => {
    mockConfig({});
    renderCell('plain text', {
      name: 'payload',
      index: 0,
      type: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      width: 150,
    });

    expect(screen.queryByRole('button', { name: 'Open JSON in new editor' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open XML in new editor' })).not.toBeInTheDocument();
  });

  it('sends openInNewEditor message with pretty JSON when clicked', () => {
    const { postMessage } = mockConfig({});
    renderCell('{"name":"alice","role":"admin"}', {
      name: 'payload',
      index: 0,
      type: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      width: 150,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open JSON in new editor' }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'openInNewEditor',
      content: '{\n  "name": "alice",\n  "role": "admin"\n}',
      language: 'json',
    });
  });

  it('sends openInNewEditor message with XML when clicked', () => {
    const { postMessage } = mockConfig({});
    renderCell('<root><item>1</item></root>', {
      name: 'payload',
      index: 0,
      type: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      width: 150,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open XML in new editor' }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'openInNewEditor',
      content: '<root><item>1</item></root>',
      language: 'xml',
    });
  });

  it('sends openInNewEditor message on Ctrl+left click for JSON cell', () => {
    const { postMessage } = mockConfig({});
    renderCell('{"name":"alice"}', {
      name: 'payload',
      index: 0,
      type: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      width: 150,
    });

    fireEvent.click(screen.getByTestId('cell-0-0'), { ctrlKey: true, button: 0 });

    expect(postMessage).toHaveBeenCalledWith({
      type: 'openInNewEditor',
      content: '{\n  "name": "alice"\n}',
      language: 'json',
    });
  });

  it('sends openInNewEditor with serialized JSON for a plain JS object value', () => {
    const { postMessage } = mockConfig({});
    renderCell({ name: 'alice', role: 'admin' }, {
      name: 'payload',
      index: 0,
      type: 'string',
      isPrimaryKey: false,
      isForeignKey: false,
      width: 150,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open JSON in new editor' }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'openInNewEditor',
      content: '{\n  "name": "alice",\n  "role": "admin"\n}',
      language: 'json',
    });
  });
});
