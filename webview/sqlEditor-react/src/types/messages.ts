// VS Code Message Types - komunikacja z extension

import type { DatabaseSchema } from './schema';

// ============================================
// Incoming Messages (from Extension to Webview)
// ============================================

export interface ConfigMessage {
  type: 'config';
  config: {
    colorPrimaryForeignKeys?: string;
  };
}

export interface UpdateMessage {
  type: 'update';
  content: string;
}

export interface ConnectionsUpdateMessage {
  type: 'connectionsUpdate';
  connections: Connection[];
  currentConnectionId?: string;
  currentDatabase?: string;
}

export interface DatabasesUpdateMessage {
  type: 'databasesUpdate';
  databases: string[];
  currentDatabase?: string;
}

export interface SchemaUpdateMessage {
  type: 'schemaUpdate';
  schema: DatabaseSchema;
}

export interface ExecutingMessage {
  type: 'executing';
}

export interface ResultsMessage {
  type: 'results';
  resultSets: any[][];
  executionTime?: number;
  rowsAffected?: number;
  messages?: QueryMessage[];
  planXml?: string;
  columnNames?: string[][];
  metadata?: ResultSetMetadata[];
  originalQuery?: string;
}

export interface RelationResultsMessage {
  type: 'relationResults';
  expansionId: string;
  resultSets?: any[][];
  metadata?: ResultSetMetadata[];
  columnNames?: string[][];
  executionTime?: number;
  error?: string;
}

export interface QueryPlanMessage {
  type: 'queryPlan';
  planXml: string;
  executionTime?: number;
  messages?: QueryMessage[];
  resultSets?: any[][];
}

export interface ErrorMessage {
  type: 'error';
  error: string;
  messages?: QueryMessage[];
}

export interface QueryCancelledMessage {
  type: 'queryCancelled';
}

export interface CommitSuccessMessage {
  type: 'commitSuccess';
  message: string;
}

export interface ConfirmActionResultMessage {
  type: 'confirmActionResult';
  confirmed: boolean;
  action: string;
}

export interface ShowMessageMessage {
  type: 'showMessage';
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface AutoExecuteQueryMessage {
  type: 'autoExecuteQuery';
}

export interface SnippetsUpdateMessage {
  type: 'snippetsUpdate';
  snippets: Snippet[];
}

export interface SnippetInputReceivedMessage {
  type: 'snippetInputReceived';
  success: boolean;
  name?: string;
  prefix?: string;
  body?: string;
  description?: string;
}

export interface PasteContentMessage {
  type: 'pasteContent';
  content: string;
}

// Union of all incoming message types
export type IncomingMessage =
  | ConfigMessage
  | UpdateMessage
  | ConnectionsUpdateMessage
  | DatabasesUpdateMessage
  | SchemaUpdateMessage
  | ExecutingMessage
  | ResultsMessage
  | RelationResultsMessage
  | QueryPlanMessage
  | ErrorMessage
  | QueryCancelledMessage
  | CommitSuccessMessage
  | ConfirmActionResultMessage
  | ShowMessageMessage
  | AutoExecuteQueryMessage
  | SnippetsUpdateMessage
  | SnippetInputReceivedMessage
  | PasteContentMessage;

// ============================================
// Outgoing Messages (from Webview to Extension)
// ============================================

export interface ExecuteQueryOutgoing {
  type: 'executeQuery';
  query: string;
  connectionId: string;
  databaseName?: string;
  includeActualPlan?: boolean;
}

export interface ExecuteEstimatedPlanOutgoing {
  type: 'executeEstimatedPlan';
  query: string;
  connectionId: string;
  databaseName?: string;
}

export interface CancelQueryOutgoing {
  type: 'cancelQuery';
}

export interface ManageConnectionsOutgoing {
  type: 'manageConnections';
}

export interface SelectConnectionOutgoing {
  type: 'selectConnection';
  connectionId: string;
}

export interface SwitchDatabaseOutgoing {
  type: 'switchDatabase';
  connectionId: string;
  databaseName: string;
}

export interface CommitChangesOutgoing {
  type: 'commitChanges';
  changes: PendingChange[];
  connectionId: string;
  databaseName: string;
}

export interface ExpandRelationOutgoing {
  type: 'expandRelation';
  expansionId: string;
  keyValue: any;
  schema: string;
  table: string;
  column: string;
  connectionId: string;
}

export interface OpenNewQueryOutgoing {
  type: 'openNewQuery';
  query: string;
  connectionId: string;
  database?: string;
}

export interface OpenInNewEditorOutgoing {
  type: 'openInNewEditor';
  content: string;
  language: string;
}

export interface ShowMessageOutgoing {
  type: 'showMessage';
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface CreateSnippetOutgoing {
  type: 'createSnippet';
  name: string;
  prefix: string;
  body: string;
  description?: string;
}

export interface ContentChangedOutgoing {
  type: 'contentChanged';
  content: string;
}

export interface RequestPasteOutgoing {
  type: 'requestPaste';
}

export interface SaveFileOutgoing {
  type: 'saveFile';
  content: string;
  defaultFileName: string;
  fileType: string;
  encoding?: string;
}

// Union of all outgoing message types
export type OutgoingMessage =
  | ExecuteQueryOutgoing
  | ExecuteEstimatedPlanOutgoing
  | CancelQueryOutgoing
  | ManageConnectionsOutgoing
  | SelectConnectionOutgoing
  | SwitchDatabaseOutgoing
  | CommitChangesOutgoing
  | ExpandRelationOutgoing
  | OpenNewQueryOutgoing
  | OpenInNewEditorOutgoing
  | ShowMessageOutgoing
  | CreateSnippetOutgoing
  | ContentChangedOutgoing
  | RequestPasteOutgoing
  | SaveFileOutgoing;

// ============================================
// Supporting Types
// ============================================

export interface Connection {
  id: string;
  name?: string;
  server: string;
  connectionType: 'server' | 'database';
}

export interface QueryMessage {
  type: 'info' | 'warning' | 'error';
  text: string;
}

export interface ResultSetMetadata {
  tableName?: string;
  schemaName?: string;
  isEditable: boolean;
  primaryKeyColumns?: string[];
  columns: ResultColumnMetadata[];
}

export interface ResultColumnMetadata {
  name: string;
  type: string;
  sourceTable?: string;
  sourceSchema?: string;
  isPrimaryKey?: boolean;
  isForeignKey?: boolean;
  foreignKeyReferences?: ForeignKeyReference[];
}

export interface ForeignKeyReference {
  schema: string;
  table: string;
  column: string;
  isComposite?: boolean;
}

export interface PendingChange {
  type: 'UPDATE' | 'DELETE' | 'INSERT';
  tableName: string;
  schemaName: string;
  primaryKeyValues: Record<string, any>;
  changes?: Record<string, { oldValue: any; newValue: any }>;
  rowIndex: number;
}

export interface Snippet {
  name: string;
  prefix: string;
  body: string;
  description?: string;
}

export interface EditorConfig {
  colorPrimaryForeignKeys: string;
}

export const defaultEditorConfig: EditorConfig = {
  colorPrimaryForeignKeys: '#007acc',
};
