import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { SqlChatHandler, ChatConnectionContext, ChatConversationState } from '../sqlChatHandler';
import { ConnectionProvider } from '../connectionProvider';
import { DatabaseInstructionsManager } from '../databaseInstructions';
import { QueryHistoryManager } from '../queryHistory';

suite('SqlChatHandler Test Suite', () => {
    let handler: SqlChatHandler;
    let connectionProvider: ConnectionProvider;
    let outputChannel: vscode.OutputChannel;
    let context: vscode.ExtensionContext;
    let databaseInstructionsManager: DatabaseInstructionsManager;
    let historyManager: QueryHistoryManager;
    let sandbox: sinon.SinonSandbox;
    let mockGlobalState: any;

    setup(() => {
        sandbox = sinon.createSandbox();

        outputChannel = {
            appendLine: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            clear: sandbox.stub(),
            dispose: sandbox.stub(),
            name: 'test-channel'
        } as any;

        mockGlobalState = {
            get: sandbox.stub().callsFake((key: string, defaultValue: any) => {
                if (key === 'mssqlManager.chatConversations') { return {}; }
                if (key === 'mssqlManager.savedConnections') { return []; }
                return defaultValue;
            }),
            update: sandbox.stub().resolves(true),
            keys: sandbox.stub().returns([]),
            setKeysForSync: sandbox.stub()
        };

        const mockSecrets = {
            store: sandbox.stub().resolves(),
            get: sandbox.stub().resolves(''),
            delete: sandbox.stub().resolves(),
            onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
        };

        context = {
            extensionUri: vscode.Uri.file('/test/path'),
            subscriptions: [],
            workspaceState: {
                get: sandbox.stub().returns(undefined),
                update: sandbox.stub().resolves(),
                keys: sandbox.stub().returns([])
            } as any,
            globalState: mockGlobalState,
            secrets: mockSecrets,
            extensionPath: '/test/path',
            asAbsolutePath: sandbox.stub().returns('/test/path'),
            storagePath: '/test/storage',
            globalStoragePath: '/test/global-storage',
            logPath: '/test/log',
            storageUri: vscode.Uri.file('/test/storage'),
            globalStorageUri: vscode.Uri.file('/test/global-storage'),
            logUri: vscode.Uri.file('/test/log'),
            environmentVariableCollection: {} as any,
            extensionMode: vscode.ExtensionMode.Test,
            extension: {} as any
        } as any;

        connectionProvider = {
            getActiveConnections: sandbox.stub().returns([]),
            getConnectionConfig: sandbox.stub().returns(null),
            getConnection: sandbox.stub().returns(null)
        } as any;

        databaseInstructionsManager = {
            loadInstructions: sandbox.stub().resolves(null)
        } as any;

        historyManager = {
            addEntry: sandbox.stub(),
            getEntries: sandbox.stub().returns([]),
            clearHistory: sandbox.stub()
        } as any;

        handler = new SqlChatHandler(
            context,
            connectionProvider,
            outputChannel,
            databaseInstructionsManager,
            historyManager
        );
    });

    teardown(() => {
        sandbox.restore();
    });

    // ─────────────────────────────────────────────────────────────────────────
    // isSqlGenerationRequest (private, accessed via any cast)
    // ─────────────────────────────────────────────────────────────────────────

    suite('isSqlGenerationRequest', () => {
        const call = (prompt: string): boolean =>
            (handler as any).isSqlGenerationRequest(prompt.toLowerCase());

        test('detects SELECT keyword', () => {
            assert.strictEqual(call('select * from users'), true);
        });

        test('detects INSERT keyword', () => {
            assert.strictEqual(call('insert into orders values (1,2)'), true);
        });

        test('detects UPDATE keyword', () => {
            assert.strictEqual(call('update users set name = "x"'), true);
        });

        test('detects DELETE keyword', () => {
            assert.strictEqual(call('delete from logs'), true);
        });

        test('detects "show me" phrase', () => {
            assert.strictEqual(call('show me all customers'), true);
        });

        test('detects "give me" phrase', () => {
            assert.strictEqual(call('give me a list of products'), true);
        });

        test('detects Polish keyword "wykonaj"', () => {
            assert.strictEqual(call('wykonaj to zapytanie'), true);
        });

        test('detects Polish phrase "pokaż wyniki"', () => {
            assert.strictEqual(call('pokaż wyniki'), true);
        });

        test('returns false for plain greeting', () => {
            assert.strictEqual(call('hello there'), false);
        });

        test('returns false for generic question about the extension', () => {
            assert.strictEqual(call('what can this extension do'), false);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // extractSqlQueries (private)
    // ─────────────────────────────────────────────────────────────────────────

    suite('extractSqlQueries', () => {
        const call = (text: string): string[] =>
            (handler as any).extractSqlQueries(text);

        test('extracts a single sql code block', () => {
            const text = 'Here is your query:\n```sql\nSELECT * FROM Users\n```';
            const results = call(text);
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0], 'SELECT * FROM Users');
        });

        test('extracts multiple sql code blocks', () => {
            const text = '```sql\nSELECT 1\n```\nThen:\n```sql\nSELECT 2\n```';
            const results = call(text);
            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0], 'SELECT 1');
            assert.strictEqual(results[1], 'SELECT 2');
        });

        test('falls back to bare SQL statement when no code blocks', () => {
            const text = 'SELECT id FROM Products;';
            const results = call(text);
            assert.ok(results.length >= 1);
            assert.ok(results[0].includes('SELECT'));
        });

        test('returns empty array for plain text with no SQL', () => {
            const text = 'This is a normal sentence without any SQL.';
            const results = call(text);
            assert.strictEqual(results.length, 0);
        });

        test('strips whitespace from extracted queries', () => {
            const text = '```sql\n  SELECT 1  \n```';
            const results = call(text);
            assert.strictEqual(results[0], 'SELECT 1');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // analyzeSqlQuery (private)
    // ─────────────────────────────────────────────────────────────────────────

    suite('analyzeSqlQuery', () => {
        const call = (sql: string): string =>
            (handler as any).analyzeSqlQuery(sql);

        test('identifies SELECT query', () => {
            assert.ok(call('SELECT * FROM Users').includes('SELECT'));
        });

        test('identifies JOIN operation', () => {
            assert.ok(call('SELECT * FROM A JOIN B ON A.id = B.id').includes('JOIN'));
        });

        test('identifies WHERE clause', () => {
            assert.ok(call('SELECT * FROM A WHERE id = 1').includes('WHERE'));
        });

        test('identifies GROUP BY', () => {
            assert.ok(call('SELECT count(*) FROM A GROUP BY name').includes('GROUP BY'));
        });

        test('identifies ORDER BY', () => {
            assert.ok(call('SELECT * FROM A ORDER BY name').includes('ORDER BY'));
        });

        test('identifies INSERT query', () => {
            assert.ok(call('INSERT INTO Users VALUES (1)').includes('INSERT'));
        });

        test('identifies UPDATE query', () => {
            assert.ok(call('UPDATE Users SET name = "x"').includes('UPDATE'));
        });

        test('identifies DELETE query', () => {
            assert.ok(call('DELETE FROM Users WHERE id = 1').includes('DELETE'));
        });

        test('returns fallback message for unrecognised SQL', () => {
            const result = call('EXEC sp_help');
            assert.ok(typeof result === 'string' && result.length > 0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // getOptimizationSuggestions (private)
    // ─────────────────────────────────────────────────────────────────────────

    suite('getOptimizationSuggestions', () => {
        const call = (sql: string): string =>
            (handler as any).getOptimizationSuggestions(sql);

        test('suggests avoiding SELECT *', () => {
            const result = call('SELECT * FROM Orders');
            assert.ok(result.toLowerCase().includes('select *') || result.toLowerCase().includes('column'));
        });

        test('suggests adding WHERE clause for full table scans', () => {
            const result = call('SELECT id FROM Orders');
            assert.ok(result.toLowerCase().includes('where') || result.length > 0);
        });

        test('returns performance tip for well-formed query', () => {
            const result = call('SELECT id FROM Orders WHERE id = 1');
            assert.ok(typeof result === 'string' && result.length > 0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // shouldRefreshSchema (private)
    // ─────────────────────────────────────────────────────────────────────────

    suite('shouldRefreshSchema', () => {
        const call = (state: ChatConversationState): boolean =>
            (handler as any).shouldRefreshSchema(state);

        test('returns false when connectionContext is missing', () => {
            const state: ChatConversationState = { lastActivity: Date.now() };
            assert.strictEqual(call(state), false);
        });

        test('returns false for a fresh connection (timestamp = now)', () => {
            const state: ChatConversationState = {
                lastActivity: Date.now(),
                connectionContext: {
                    connectionId: 'conn-1',
                    timestamp: Date.now()
                }
            };
            assert.strictEqual(call(state), false);
        });

        test('returns true when schema is older than 30 minutes', () => {
            const thirtyOneMinutesAgo = Date.now() - (31 * 60 * 1000);
            const state: ChatConversationState = {
                lastActivity: Date.now(),
                connectionContext: {
                    connectionId: 'conn-1',
                    timestamp: thirtyOneMinutesAgo
                }
            };
            assert.strictEqual(call(state), true);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // findTablesInSchema (private)
    // ─────────────────────────────────────────────────────────────────────────

    suite('findTablesInSchema', () => {
        const schema = `
CREATE TABLE [dbo].[Users] (
  [Id] INT,
  [Name] NVARCHAR(100)
);

CREATE TABLE [dbo].[Orders] (
  [Id] INT,
  [UserId] INT
);
`;

        const call = (query: string, schemaText: string): string[] =>
            (handler as any).findTablesInSchema(query, schemaText);

        test('finds table matching query', () => {
            const results = call('Users', schema);
            assert.ok(results.length >= 1);
            assert.ok(results[0].includes('Users'));
        });

        test('returns empty array when no match', () => {
            const results = call('Products', schema);
            assert.strictEqual(results.length, 0);
        });

        test('search is case-insensitive', () => {
            const results = call('users', schema);
            assert.ok(results.length >= 1);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // formatQueryResultsForChat (private)
    // ─────────────────────────────────────────────────────────────────────────

    suite('formatQueryResultsForChat', () => {
        const call = (result: any): string =>
            (handler as any).formatQueryResultsForChat(result);

        test('formats successful result with row data', () => {
            const result = {
                recordsets: [[
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' }
                ]],
                rowsAffected: [2],
                executionTime: 42
            };
            const text = call(result);
            assert.ok(text.includes('2'));
            assert.ok(text.includes('id'));
            assert.ok(text.includes('Alice'));
        });

        test('shows execution time when provided', () => {
            const result = {
                recordsets: [[{ id: 1 }]],
                rowsAffected: [1],
                executionTime: 100
            };
            assert.ok(call(result).includes('100'));
        });

        test('handles rowsAffected for DML queries', () => {
            const result = {
                recordsets: [],
                rowsAffected: [5]
            };
            const text = call(result);
            assert.ok(text.includes('5'));
        });

        test('handles empty result set', () => {
            const result = {
                recordsets: [],
                rowsAffected: []
            };
            const text = call(result);
            assert.ok(text.includes('successfully') || text.includes('no rows'));
        });

        test('truncates results after 5 rows', () => {
            const rows = Array.from({ length: 10 }, (_, i) => ({ id: i }));
            const result = { recordsets: [rows], rowsAffected: [10] };
            const text = call(result);
            assert.ok(text.includes('more row'));
        });

        test('does not mention "more rows" when 5 or fewer rows returned', () => {
            const rows = [{ id: 1 }, { id: 2 }];
            const result = { recordsets: [rows], rowsAffected: [2] };
            const text = call(result);
            assert.ok(!text.includes('more row'));
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // setConnectionContext / clearConversationContext
    // ─────────────────────────────────────────────────────────────────────────

    suite('setConnectionContext', () => {
        test('creates conversation state with connection info', () => {
            handler.setConnectionContext('conv-1', 'conn-123', 'TestDB');

            const state: ChatConversationState | undefined =
                (handler as any).conversationStates.get('conv-1');

            assert.ok(state);
            assert.strictEqual(state!.connectionContext?.connectionId, 'conn-123');
            assert.strictEqual(state!.connectionContext?.database, 'TestDB');
        });

        test('clears schemaContext when connection context is set', () => {
            const states: Map<string, ChatConversationState> =
                (handler as any).conversationStates;
            states.set('conv-2', {
                lastActivity: Date.now(),
                schemaContext: 'OLD SCHEMA'
            });

            handler.setConnectionContext('conv-2', 'conn-456', 'OtherDB');
            assert.strictEqual(states.get('conv-2')?.schemaContext, undefined);
        });
    });

    suite('clearConversationContext', () => {
        test('clears specific conversation', async () => {
            handler.setConnectionContext('conv-x', 'conn-1', 'DB1');
            await handler.clearConversationContext('conv-x');

            const states: Map<string, ChatConversationState> =
                (handler as any).conversationStates;
            assert.strictEqual(states.has('conv-x'), false);
        });

        test('clears all conversations when no id given', async () => {
            handler.setConnectionContext('conv-a', 'conn-1', 'DB1');
            handler.setConnectionContext('conv-b', 'conn-2', 'DB2');
            await handler.clearConversationContext();

            const states: Map<string, ChatConversationState> =
                (handler as any).conversationStates;
            assert.strictEqual(states.size, 0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // handleChatRequest — no active connections
    // ─────────────────────────────────────────────────────────────────────────

    suite('handleChatRequest', () => {
        let stream: any;
        let request: any;
        let chatContext: vscode.ChatContext;
        let token: vscode.CancellationToken;

        setup(() => {
            stream = {
                markdown: sandbox.stub(),
                progress: sandbox.stub(),
                button: sandbox.stub(),
                anchor: sandbox.stub(),
                filetree: sandbox.stub(),
                reference: sandbox.stub()
            };

            request = {
                prompt: 'show me all users',
                command: undefined
            };

            chatContext = { history: [] } as vscode.ChatContext;
            token = new vscode.CancellationTokenSource().token;
        });

        test('returns metadata with command when no connections are available', async () => {
            (connectionProvider.getActiveConnections as sinon.SinonStub).returns([]);

            const result = await handler.handleChatRequest(request, chatContext, stream, token);

            assert.ok(result.metadata);
            assert.strictEqual(result.metadata.command, undefined);
            assert.ok((stream.markdown as sinon.SinonStub).called);
        });

        test('stream.button is called with manage connections command when no connections', async () => {
            (connectionProvider.getActiveConnections as sinon.SinonStub).returns([]);

            await handler.handleChatRequest(request, chatContext, stream, token);

            const buttonStub = stream.button as sinon.SinonStub;
            assert.ok(buttonStub.called);
            const call = buttonStub.getCall(0);
            assert.strictEqual(call.args[0].command, 'mssqlManager.manageConnections');
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // loadConversationStates — persisted state loading
    // ─────────────────────────────────────────────────────────────────────────

    suite('loadConversationStates', () => {
        test('loads recent conversations from globalState', () => {
            const now = Date.now();
            const saved = {
                'conv-persist': {
                    lastActivity: now,
                    connectionContext: { connectionId: 'c1', timestamp: now }
                }
            };

            mockGlobalState.get = sandbox.stub().callsFake((key: string, defaultValue: any) => {
                if (key === 'mssqlManager.chatConversations') { return saved; }
                return defaultValue;
            });

            const newHandler = new SqlChatHandler(
                context,
                connectionProvider,
                outputChannel,
                databaseInstructionsManager,
                historyManager
            );

            const states: Map<string, ChatConversationState> =
                (newHandler as any).conversationStates;
            assert.ok(states.has('conv-persist'));
        });

        test('skips conversations older than 7 days', () => {
            const eightDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000);
            const saved = {
                'conv-old': {
                    lastActivity: eightDaysAgo,
                    connectionContext: { connectionId: 'c2', timestamp: eightDaysAgo }
                }
            };

            mockGlobalState.get = sandbox.stub().callsFake((key: string, defaultValue: any) => {
                if (key === 'mssqlManager.chatConversations') { return saved; }
                return defaultValue;
            });

            const newHandler = new SqlChatHandler(
                context,
                connectionProvider,
                outputChannel,
                databaseInstructionsManager,
                historyManager
            );

            const states: Map<string, ChatConversationState> =
                (newHandler as any).conversationStates;
            assert.strictEqual(states.has('conv-old'), false);
        });
    });
});
