// Database Schema Types

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
}

export interface TableInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
}

export interface ViewInfo {
  schema: string;
  name: string;
  columns: ColumnInfo[];
}

export interface ForeignKeyInfo {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  constraintName?: string;
}

export interface StoredProcedureInfo {
  schema: string;
  name: string;
  parameters?: ParameterInfo[];
}

export interface FunctionInfo {
  schema: string;
  name: string;
  returnType?: string;
  parameters?: ParameterInfo[];
}

export interface ParameterInfo {
  name: string;
  type: string;
  mode?: 'IN' | 'OUT' | 'INOUT';
  defaultValue?: string;
}

export interface DatabaseSchema {
  tables: TableInfo[];
  views: ViewInfo[];
  foreignKeys: ForeignKeyInfo[];
  storedProcedures?: StoredProcedureInfo[];
  functions?: FunctionInfo[];
}

export const emptySchema: DatabaseSchema = {
  tables: [],
  views: [],
  foreignKeys: [],
  storedProcedures: [],
  functions: [],
};
