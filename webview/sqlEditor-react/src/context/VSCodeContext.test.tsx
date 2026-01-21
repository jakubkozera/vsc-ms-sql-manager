import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { VSCodeProvider, useVSCode } from './VSCodeContext';
import type { IncomingMessage } from '../types/messages';

describe('VSCodeContext - Database Operations', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    postMessageMock = vi.fn();
    
    // Mock acquireVsCodeApi
    (global as any).acquireVsCodeApi = () => ({
      postMessage: postMessageMock,
      getState: () => null,
      setState: () => {},
    });

    // Capture message event listener
    const originalAddEventListener = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'message') {
        messageHandler = handler as (event: MessageEvent) => void;
      }
      return originalAddEventListener.call(window, event, handler);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    messageHandler = null;
  });

  const sendMessage = (message: IncomingMessage) => {
    if (!messageHandler) {
      throw new Error('Message handler not registered');
    }
    act(() => {
      messageHandler!(new MessageEvent('message', { data: message }));
    });
  };

  it('should initialize with empty databases array', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    expect(result.current.databases).toEqual([]);
    expect(result.current.currentDatabase).toBeNull();
  });

  it('should update databases when receiving databasesUpdate message', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    sendMessage({
      type: 'databasesUpdate',
      databases: ['master', 'TestDB', 'ProductionDB'],
      currentDatabase: 'master',
    });

    expect(result.current.databases).toEqual(['master', 'TestDB', 'ProductionDB']);
    expect(result.current.currentDatabase).toBe('master');
  });

  it('should update currentDatabase without databases list', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Set initial databases
    sendMessage({
      type: 'databasesUpdate',
      databases: ['master', 'TestDB'],
      currentDatabase: 'master',
    });

    // Update only current database
    sendMessage({
      type: 'databasesUpdate',
      databases: ['master', 'TestDB', 'NewDB'],
      currentDatabase: 'TestDB',
    });

    expect(result.current.databases).toEqual(['master', 'TestDB', 'NewDB']);
    expect(result.current.currentDatabase).toBe('TestDB');
  });

  it('should send switchDatabase message when selectDatabase is called', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Set up connection first
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    act(() => {
      result.current.selectDatabase('TestDB');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'switchDatabase',
      connectionId: 'conn1',
      databaseName: 'TestDB',
    });
  });

  it('should not send switchDatabase when no connection is active', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() => {
      result.current.selectDatabase('TestDB');
    });

    // Should not send switchDatabase message (only ready message)
    expect(postMessageMock).toHaveBeenCalledTimes(1); // Only the ready message
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'ready' });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[VSCode] Cannot select database without active connection'
    );

    consoleWarnSpy.mockRestore();
  });

  it('should preserve databases across connection updates', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Set initial databases
    sendMessage({
      type: 'databasesUpdate',
      databases: ['master', 'TestDB'],
      currentDatabase: 'master',
    });

    // Update connections (shouldn't clear databases)
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    expect(result.current.databases).toEqual(['master', 'TestDB']);
  });

  it('should handle empty databases array', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    sendMessage({
      type: 'databasesUpdate',
      databases: [],
      currentDatabase: undefined,
    });

    expect(result.current.databases).toEqual([]);
    expect(result.current.currentDatabase).toBeNull();
  });

  it('should update database when included in connectionsUpdate', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
      currentDatabase: 'ProductionDB',
    });

    expect(result.current.currentDatabase).toBe('ProductionDB');
  });

  it('should handle database selection flow', async () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Step 1: Connect to server
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    // Step 2: Receive databases list
    sendMessage({
      type: 'databasesUpdate',
      databases: ['master', 'TestDB', 'ProductionDB'],
      currentDatabase: 'master',
    });

    expect(result.current.databases).toEqual(['master', 'TestDB', 'ProductionDB']);
    expect(result.current.currentDatabase).toBe('master');

    // Step 3: User selects different database
    act(() => {
      result.current.selectDatabase('TestDB');
    });

    expect(postMessageMock).toHaveBeenLastCalledWith({
      type: 'switchDatabase',
      connectionId: 'conn1',
      databaseName: 'TestDB',
    });

    // Step 4: Backend confirms database change
    sendMessage({
      type: 'databasesUpdate',
      databases: ['master', 'TestDB', 'ProductionDB'],
      currentDatabase: 'TestDB',
    });

    expect(result.current.currentDatabase).toBe('TestDB');
  });

  it('should handle large number of databases', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    const manyDatabases = Array.from({ length: 100 }, (_, i) => `Database${i + 1}`);

    sendMessage({
      type: 'databasesUpdate',
      databases: manyDatabases,
      currentDatabase: 'Database50',
    });

    expect(result.current.databases).toHaveLength(100);
    expect(result.current.currentDatabase).toBe('Database50');
  });

  it('should maintain database state after query execution', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Setup
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    sendMessage({
      type: 'databasesUpdate',
      databases: ['master', 'TestDB'],
      currentDatabase: 'TestDB',
    });

    // Execute query
    sendMessage({
      type: 'results',
      resultSets: [[]],
      messages: [],
    });

    // Database state should be preserved
    expect(result.current.databases).toEqual(['master', 'TestDB']);
    expect(result.current.currentDatabase).toBe('TestDB');
  });

  it('should handle database name with special characters', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    const specialDatabases = ['master', 'Test-DB', 'Test_DB', 'Test.DB', 'Test DB'];

    sendMessage({
      type: 'databasesUpdate',
      databases: specialDatabases,
      currentDatabase: 'Test-DB',
    });

    expect(result.current.databases).toEqual(specialDatabases);
    expect(result.current.currentDatabase).toBe('Test-DB');

    // Setup connection
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    act(() => {
      result.current.selectDatabase('Test DB');
    });

    expect(postMessageMock).toHaveBeenLastCalledWith({
      type: 'switchDatabase',
      connectionId: 'conn1',
      databaseName: 'Test DB',
    });
  });
});

describe('VSCodeContext - Query Execution', () => {
  let postMessageMock: ReturnType<typeof vi.fn>;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    postMessageMock = vi.fn();

    // Mock acquireVsCodeApi
    (global as any).acquireVsCodeApi = () => ({
      postMessage: postMessageMock,
      getState: () => null,
      setState: () => {},
    });

    // Capture message event listener
    const originalAddEventListener = window.addEventListener;
    vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'message') {
        messageHandler = handler as (event: MessageEvent) => void;
      }
      return originalAddEventListener.call(window, event, handler);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    messageHandler = null;
  });

  const sendMessage = (message: IncomingMessage) => {
    if (!messageHandler) {
      throw new Error('Message handler not registered');
    }
    act(() => {
      messageHandler!(new MessageEvent('message', { data: message }));
    });
  };

  it('should execute query when connection is available', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Setup connection
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    // Execute query
    act(() => {
      result.current.executeQuery('SELECT * FROM Users');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'executeQuery',
      query: 'SELECT * FROM Users',
      connectionId: 'conn1',
      databaseName: undefined,
      includeActualPlan: undefined,
    });
  });

  it('should clear previous results and set isExecuting when executing new query', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Setup connection and set some existing results
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    // Simulate previous results
    sendMessage({
      type: 'results',
      resultSets: [[{ id: 1 }]],
      messages: [],
    });

    expect(result.current.lastResults).toBeDefined();

    // Execute new query
    act(() => {
      result.current.executeQuery('SELECT 1');
    });

    // Should have cleared lastResults and set executing flag
    expect(result.current.lastResults).toBeNull();
    expect(result.current.isExecuting).toBe(true);
  });

  it('should clear previous results and set isExecuting when executing estimated plan', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Setup connection and set some existing results
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    // Simulate previous results
    sendMessage({
      type: 'results',
      resultSets: [[{ id: 1 }]],
      messages: [],
    });

    expect(result.current.lastResults).toBeDefined();

    // Execute estimated plan
    act(() => {
      result.current.executeEstimatedPlan('SELECT 1');
    });

    // Should have cleared lastResults and set executing flag
    expect(result.current.lastResults).toBeNull();
    expect(result.current.isExecuting).toBe(true);
  });

  it('should execute query with actual plan option', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Setup connection
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    // Execute query with actual plan
    act(() => {
      result.current.executeQuery('SELECT * FROM Users', { includeActualPlan: true });
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'executeQuery',
      query: 'SELECT * FROM Users',
      connectionId: 'conn1',
      databaseName: undefined,
      includeActualPlan: true,
    });
  });

  it('should execute query with current database', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Setup connection and database
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
      currentDatabase: 'TestDB',
    });

    // Execute query
    act(() => {
      result.current.executeQuery('SELECT * FROM Users');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'executeQuery',
      query: 'SELECT * FROM Users',
      connectionId: 'conn1',
      databaseName: 'TestDB',
      includeActualPlan: undefined,
    });
  });

  it('should show error message when no connection is selected', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // No connection setup - should be empty state

    // Execute query
    act(() => {
      result.current.executeQuery('SELECT * FROM Users');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'showMessage',
      level: 'error',
      message: 'Please select a connection first',
    });

    // Should have called ready and showMessage
    expect(postMessageMock).toHaveBeenCalledTimes(2);
  });

  it('should access latest state even after state changes (closure capture fix)', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Initially no connections
    act(() => {
      result.current.executeQuery('SELECT 1');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'showMessage',
      level: 'error',
      message: 'Please select a connection first',
    });

    // Clear mock
    postMessageMock.mockClear();

    // Now add connection - the callback should access the new state
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Test Server', server: 'localhost', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    // Execute query again - should now work with the new connection
    act(() => {
      result.current.executeQuery('SELECT * FROM Users');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'executeQuery',
      query: 'SELECT * FROM Users',
      connectionId: 'conn1',
      databaseName: undefined,
      includeActualPlan: undefined,
    });
  });

  it('should handle multiple connections and use current connection', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Setup multiple connections
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Server 1', server: 'server1', connectionType: 'server' },
        { id: 'conn2', name: 'Server 2', server: 'server2', connectionType: 'server' },
        { id: 'conn3', name: 'Server 3', server: 'server3', connectionType: 'server' },
      ],
      currentConnectionId: 'conn2', // Second connection is active
    });

    // Execute query - should use the active connection (conn2)
    act(() => {
      result.current.executeQuery('SELECT * FROM Products');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'executeQuery',
      query: 'SELECT * FROM Products',
      connectionId: 'conn2',
      databaseName: undefined,
      includeActualPlan: undefined,
    });
  });

  it('should handle connection switching and use new active connection', () => {
    const { result } = renderHook(() => useVSCode(), {
      wrapper: VSCodeProvider,
    });

    // Setup initial connections
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Server 1', server: 'server1', connectionType: 'server' },
        { id: 'conn2', name: 'Server 2', server: 'server2', connectionType: 'server' },
      ],
      currentConnectionId: 'conn1',
    });

    // Execute query with first connection
    act(() => {
      result.current.executeQuery('SELECT * FROM Table1');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'executeQuery',
      query: 'SELECT * FROM Table1',
      connectionId: 'conn1',
      databaseName: undefined,
      includeActualPlan: undefined,
    });

    // Clear mock
    postMessageMock.mockClear();

    // Switch to second connection
    sendMessage({
      type: 'connectionsUpdate',
      connections: [
        { id: 'conn1', name: 'Server 1', server: 'server1', connectionType: 'server' },
        { id: 'conn2', name: 'Server 2', server: 'server2', connectionType: 'server' },
      ],
      currentConnectionId: 'conn2',
    });

    // Execute query again - should use the new active connection
    act(() => {
      result.current.executeQuery('SELECT * FROM Table2');
    });

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'executeQuery',
      query: 'SELECT * FROM Table2',
      connectionId: 'conn2',
      databaseName: undefined,
      includeActualPlan: undefined,
    });
  });
});
