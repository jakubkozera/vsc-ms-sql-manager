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

export interface DatabaseSchema {
  tables: TableInfo[];
  views: ViewInfo[];
  foreignKeys: ForeignKeyInfo[];
}

export const emptySchema: DatabaseSchema = {
  tables: [],
  views: [],
  foreignKeys: [],
};
