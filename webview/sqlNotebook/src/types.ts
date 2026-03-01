export interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string | string[];
  outputs?: CellOutput[];
  execution_count?: number | null;
  metadata?: Record<string, unknown>;
}

export interface CellOutput {
  output_type: string;
  text?: string[];
  data?: Record<string, string[]>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

export interface Notebook {
  cells: NotebookCell[];
  metadata?: {
    kernelspec?: {
      display_name?: string;
      language?: string;
      name?: string;
    };
    [key: string]: unknown;
  };
  nbformat?: number;
  nbformat_minor?: number;
}

export interface Connection {
  id: string;
  name: string;
  server?: string;
  database?: string;
  connectionType?: string;
}

export interface CellResult {
  recordsets: unknown[][];
  rowsAffected: number[];
  executionTime: number;
  columnNames?: string[][];
}

export interface CellState {
  running: boolean;
  result?: CellResult;
  error?: string;
  executionCount?: number;
}
