import React, { createContext, useContext, useEffect, useReducer, useCallback, useMemo } from 'react';
import type {
  IncomingMessage,
  OutgoingMessage,
  Connection,
  QueryMessage,
  ResultSetMetadata,
  Snippet,
  EditorConfig,
  ResultsMessage,
  RelationResultsMessage,
} from '../types/messages';
import { DatabaseSchema, emptySchema } from '../types/schema';
import { defaultEditorConfig } from '../types/messages';

// ============================================
// VS Code API Type
// ============================================

interface VSCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeApi;

// ============================================
// State Types
// ============================================

interface VSCodeState {
  // Connection state
  connections: Connection[];
  currentConnectionId: string | null;
  currentDatabase: string | null;
  
  // Schema
  dbSchema: DatabaseSchema;
  
  // Editor content
  editorContent: string;
  
  // Snippets
  snippets: Snippet[];
  
  // Config
  config: EditorConfig;
  
  // Query execution state
  isExecuting: boolean;
  lastResults: any[][] | null;
  lastColumnNames: string[][] | null;
  lastMetadata: ResultSetMetadata[] | null;
  lastMessages: QueryMessage[];
  lastError: string | null;
  lastPlanXml: string | null;
  executionTime: number | null;
  rowsAffected: number | null;
  
  // FK Expansion
  pendingExpansions: Map<string, RelationResultsMessage>;
}

type VSCodeAction =
  | { type: 'SET_CONFIG'; config: Partial<EditorConfig> }
  | { type: 'SET_CONTENT'; content: string }
  | { type: 'SET_CONNECTIONS'; connections: Connection[]; currentConnectionId?: string; currentDatabase?: string }
  | { type: 'SET_DATABASES'; databases: string[]; currentDatabase?: string }
  | { type: 'SET_SCHEMA'; schema: DatabaseSchema }
  | { type: 'SET_SNIPPETS'; snippets: Snippet[] }
  | { type: 'SET_EXECUTING'; isExecuting: boolean }
  | { type: 'SET_RESULTS'; payload: ResultsMessage }
  | { type: 'SET_ERROR'; error: string; messages?: QueryMessage[] }
  | { type: 'SET_QUERY_PLAN'; planXml: string; executionTime?: number; messages?: QueryMessage[]; resultSets?: any[][] }
  | { type: 'QUERY_CANCELLED' }
  | { type: 'SET_EXPANSION_RESULT'; payload: RelationResultsMessage }
  | { type: 'CLEAR_RESULTS' };

const initialState: VSCodeState = {
  connections: [],
  currentConnectionId: null,
  currentDatabase: null,
  dbSchema: emptySchema,
  editorContent: '',
  snippets: [],
  config: defaultEditorConfig,
  isExecuting: false,
  lastResults: null,
  lastColumnNames: null,
  lastMetadata: null,
  lastMessages: [],
  lastError: null,
  lastPlanXml: null,
  executionTime: null,
  rowsAffected: null,
  pendingExpansions: new Map(),
};

function vsCodeReducer(state: VSCodeState, action: VSCodeAction): VSCodeState {
  switch (action.type) {
    case 'SET_CONFIG':
      return {
        ...state,
        config: { ...state.config, ...action.config },
      };
      
    case 'SET_CONTENT':
      return {
        ...state,
        editorContent: action.content,
      };
      
    case 'SET_CONNECTIONS': {
      const currentId = action.currentConnectionId ?? state.currentConnectionId;
      const currentDb = action.currentDatabase ?? state.currentDatabase;
      return {
        ...state,
        connections: action.connections,
        currentConnectionId: currentId,
        currentDatabase: currentDb,
      };
    }
    
    case 'SET_DATABASES':
      return {
        ...state,
        currentDatabase: action.currentDatabase ?? state.currentDatabase,
      };
      
    case 'SET_SCHEMA':
      return {
        ...state,
        dbSchema: action.schema,
      };
      
    case 'SET_SNIPPETS':
      return {
        ...state,
        snippets: action.snippets,
      };
      
    case 'SET_EXECUTING':
      return {
        ...state,
        isExecuting: action.isExecuting,
        lastError: action.isExecuting ? null : state.lastError,
      };
      
    case 'SET_RESULTS':
      return {
        ...state,
        isExecuting: false,
        lastResults: action.payload.resultSets,
        lastColumnNames: action.payload.columnNames ?? null,
        lastMetadata: action.payload.metadata ?? null,
        lastMessages: action.payload.messages ?? [],
        lastPlanXml: action.payload.planXml ?? null,
        executionTime: action.payload.executionTime ?? null,
        rowsAffected: action.payload.rowsAffected ?? null,
        lastError: null,
      };
      
    case 'SET_ERROR':
      return {
        ...state,
        isExecuting: false,
        lastError: action.error,
        lastMessages: action.messages ?? [{ type: 'error', text: action.error }],
      };
      
    case 'SET_QUERY_PLAN':
      return {
        ...state,
        isExecuting: false,
        lastPlanXml: action.planXml,
        executionTime: action.executionTime ?? null,
        lastMessages: action.messages ?? [],
        lastResults: action.resultSets ?? state.lastResults,
      };
      
    case 'QUERY_CANCELLED':
      return {
        ...state,
        isExecuting: false,
        lastMessages: [{ type: 'info', text: 'Query execution cancelled.' }],
      };
      
    case 'SET_EXPANSION_RESULT': {
      const newExpansions = new Map(state.pendingExpansions);
      newExpansions.set(action.payload.expansionId, action.payload);
      return {
        ...state,
        pendingExpansions: newExpansions,
      };
    }
    
    case 'CLEAR_RESULTS':
      return {
        ...state,
        lastResults: null,
        lastColumnNames: null,
        lastMetadata: null,
        lastMessages: [],
        lastError: null,
        lastPlanXml: null,
        executionTime: null,
        rowsAffected: null,
      };
      
    default:
      return state;
  }
}

// ============================================
// Context Type
// ============================================

interface VSCodeContextValue extends VSCodeState {
  // Derived state
  isConnected: boolean;
  
  // Actions
  postMessage: (message: OutgoingMessage) => void;
  setEditorContent: (content: string) => void;
  
  // Query execution
  executeQuery: (query: string, options?: { includeActualPlan?: boolean }) => void;
  executeEstimatedPlan: (query: string) => void;
  cancelQuery: () => void;
  
  // Connection management
  selectConnection: (connectionId: string) => void;
  selectDatabase: (databaseName: string) => void;
  manageConnections: () => void;
  
  // FK Expansion
  expandRelation: (expansionId: string, query: string) => void;
  getExpansionResult: (expansionId: string) => RelationResultsMessage | undefined;
}

const VSCodeContext = createContext<VSCodeContextValue | null>(null);

// ============================================
// Provider Component
// ============================================

export function VSCodeProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(vsCodeReducer, initialState);
  
  // Get VS Code API (memoized)
  const vscode = useMemo(() => {
    try {
      return acquireVsCodeApi();
    } catch {
      // Running outside VS Code (dev mode)
      console.warn('VS Code API not available - running in dev mode');
      return {
        postMessage: (msg: unknown) => console.log('[DEV] postMessage:', msg),
        getState: () => null,
        setState: () => {},
      };
    }
  }, []);
  
  // Post message helper
  const postMessage = useCallback((message: OutgoingMessage) => {
    console.log('[VSCode] Sending message:', message.type);
    vscode.postMessage(message);
  }, [vscode]);
  
  // Message handler
  useEffect(() => {
    const handleMessage = (event: MessageEvent<IncomingMessage>) => {
      const message = event.data;
      console.log('[VSCode] Received message:', message.type);
      
      switch (message.type) {
        case 'config':
          dispatch({ type: 'SET_CONFIG', config: message.config });
          break;
          
        case 'update':
          dispatch({ type: 'SET_CONTENT', content: message.content });
          break;
          
        case 'connectionsUpdate':
          dispatch({
            type: 'SET_CONNECTIONS',
            connections: message.connections,
            currentConnectionId: message.currentConnectionId,
            currentDatabase: message.currentDatabase,
          });
          break;
          
        case 'databasesUpdate':
          dispatch({
            type: 'SET_DATABASES',
            databases: message.databases,
            currentDatabase: message.currentDatabase,
          });
          break;
          
        case 'schemaUpdate':
          dispatch({ type: 'SET_SCHEMA', schema: message.schema });
          break;
          
        case 'executing':
          dispatch({ type: 'SET_EXECUTING', isExecuting: true });
          break;
          
        case 'results':
          dispatch({ type: 'SET_RESULTS', payload: message });
          break;
          
        case 'relationResults':
          dispatch({ type: 'SET_EXPANSION_RESULT', payload: message });
          break;
          
        case 'queryPlan':
          dispatch({
            type: 'SET_QUERY_PLAN',
            planXml: message.planXml,
            executionTime: message.executionTime,
            messages: message.messages,
            resultSets: message.resultSets,
          });
          break;
          
        case 'error':
          dispatch({ type: 'SET_ERROR', error: message.error, messages: message.messages });
          break;
          
        case 'queryCancelled':
          dispatch({ type: 'QUERY_CANCELLED' });
          break;
          
        case 'snippetsUpdate':
          dispatch({ type: 'SET_SNIPPETS', snippets: message.snippets });
          break;
          
        case 'autoExecuteQuery':
          // Will be handled in the editor component
          console.log('[VSCode] Auto-execute query requested');
          break;
          
        default:
          console.log('[VSCode] Unhandled message type:', (message as any).type);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  
  // Action helpers
  const setEditorContent = useCallback((content: string) => {
    dispatch({ type: 'SET_CONTENT', content });
    postMessage({ type: 'contentChanged', content });
  }, [postMessage]);
  
  const executeQuery = useCallback((query: string, options?: { includeActualPlan?: boolean }) => {
    if (!state.currentConnectionId) {
      postMessage({ type: 'showMessage', level: 'error', message: 'Please select a connection first' });
      return;
    }
    
    postMessage({
      type: 'executeQuery',
      query,
      connectionId: state.currentConnectionId,
      databaseName: state.currentDatabase ?? undefined,
      includeActualPlan: options?.includeActualPlan,
    });
  }, [state.currentConnectionId, state.currentDatabase, postMessage]);
  
  const executeEstimatedPlan = useCallback((query: string) => {
    if (!state.currentConnectionId) {
      postMessage({ type: 'showMessage', level: 'error', message: 'Please select a connection first' });
      return;
    }
    
    postMessage({
      type: 'executeEstimatedPlan',
      query,
      connectionId: state.currentConnectionId,
      databaseName: state.currentDatabase ?? undefined,
    });
  }, [state.currentConnectionId, state.currentDatabase, postMessage]);
  
  const cancelQuery = useCallback(() => {
    postMessage({ type: 'cancelQuery' });
  }, [postMessage]);
  
  const selectConnection = useCallback((connectionId: string) => {
    postMessage({ type: 'selectConnection', connectionId });
  }, [postMessage]);
  
  const selectDatabase = useCallback((databaseName: string) => {
    postMessage({ type: 'selectDatabase', databaseName });
  }, [postMessage]);
  
  const manageConnections = useCallback(() => {
    postMessage({ type: 'manageConnections' });
  }, [postMessage]);
  
  const expandRelation = useCallback((expansionId: string, query: string) => {
    if (!state.currentConnectionId) return;
    
    postMessage({
      type: 'expandRelation',
      expansionId,
      query,
      connectionId: state.currentConnectionId,
      databaseName: state.currentDatabase ?? undefined,
    });
  }, [state.currentConnectionId, state.currentDatabase, postMessage]);
  
  const getExpansionResult = useCallback((expansionId: string) => {
    return state.pendingExpansions.get(expansionId);
  }, [state.pendingExpansions]);
  
  // Derived state
  const isConnected = state.currentConnectionId !== null;
  
  // Context value
  const contextValue: VSCodeContextValue = useMemo(() => ({
    ...state,
    isConnected,
    postMessage,
    setEditorContent,
    executeQuery,
    executeEstimatedPlan,
    cancelQuery,
    selectConnection,
    selectDatabase,
    manageConnections,
    expandRelation,
    getExpansionResult,
  }), [
    state,
    isConnected,
    postMessage,
    setEditorContent,
    executeQuery,
    executeEstimatedPlan,
    cancelQuery,
    selectConnection,
    selectDatabase,
    manageConnections,
    expandRelation,
    getExpansionResult,
  ]);
  
  return (
    <VSCodeContext.Provider value={contextValue}>
      {children}
    </VSCodeContext.Provider>
  );
}

// ============================================
// Hook
// ============================================

export function useVSCode(): VSCodeContextValue {
  const context = useContext(VSCodeContext);
  if (!context) {
    throw new Error('useVSCode must be used within a VSCodeProvider');
  }
  return context;
}
