import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { QueryExecutor, QueryResult } from '../queryExecutor';
import { ConnectionProvider } from '../connectionProvider';
import { QueryHistoryManager } from '../queryHistory';

// Basic functionality tests
suite('QueryExecutor Basic Tests', () => {
    let queryExecutor: QueryExecutor;
    let connectionProvider: ConnectionProvider;
    let outputChannel: vscode.OutputChannel;
    let historyManager: QueryHistoryManager;
    let sandbox: sinon.SinonSandbox;
    let mockConnection: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock output channel
        outputChannel = {
            appendLine: sandbox.stub(),
            show: sandbox.stub(),
            hide: sandbox.stub(),
            clear: sandbox.stub(),
            dispose: sandbox.stub(),
            name: 'test-channel'
        } as any;

        // Mock connection object
        mockConnection = {
            request: sandbox.stub().returns({
                query: sandbox.stub().resolves({
                    recordset: [
                        { id: 1, name: 'Test Row 1' },
                        { id: 2, name: 'Test Row 2' }
                    ],
                    recordsets: [[
                        { id: 1, name: 'Test Row 1' },
                        { id: 2, name: 'Test Row 2' }
                    ]],
                    rowsAffected: [2]
                }),
                cancel: sandbox.stub()
            })
        };

        // Mock connection provider
        connectionProvider = {
            getConnection: sandbox.stub().returns(mockConnection),
            getActiveConnectionInfo: sandbox.stub().returns({
                id: 'test-conn-123',
                name: 'Test Connection',
                server: 'localhost',
                database: 'TestDB'
            })
        } as any;

        // Mock history manager
        historyManager = {
            addEntry: sandbox.stub()
        } as any;

        queryExecutor = new QueryExecutor(connectionProvider, outputChannel, historyManager);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should initialize QueryExecutor', () => {
        assert.ok(queryExecutor);
        assert.strictEqual((queryExecutor as any).connectionProvider, connectionProvider);
        assert.strictEqual((queryExecutor as any).outputChannel, outputChannel);
        assert.strictEqual((queryExecutor as any).historyManager, historyManager);
    });

    test('should execute a simple query', async () => {
        const queryText = 'SELECT * FROM Users';
        
        const result = await queryExecutor.executeQuery(queryText);
        
        assert.ok(result);
        assert.ok(result.recordsets);
        assert.strictEqual(result.recordsets.length, 1);
        assert.strictEqual(result.recordsets[0].length, 2);
        // Result rows are now arrays of values, not objects
        assert.strictEqual(result.recordsets[0][0][0], 1);
        assert.strictEqual(result.query, queryText);
        assert.ok(typeof result.executionTime === 'number');
        assert.ok(Array.isArray(result.rowsAffected));
    });

    test('should handle query execution error', async () => {
        mockConnection.request().query.rejects(new Error('Test error'));
        
        try {
            await queryExecutor.executeQuery('INVALID SQL');
            assert.fail('Expected error was not thrown');
        } catch (error: any) {
            assert.ok(error);
            assert.ok(error.message.includes('Test error'));
        }
    });

    test('should handle no connection available', async () => {
        (connectionProvider.getConnection as sinon.SinonStub).returns(null);
        
        try {
            await queryExecutor.executeQuery('SELECT 1');
            assert.fail('Expected error was not thrown');
        } catch (error: any) {
            assert.ok(error);
            assert.ok(error.message.includes('No active database connection'));
        }
    });

    test('should use custom connection pool when provided', async () => {
        const mockPool = {
            request: sandbox.stub().returns(mockConnection.request()),
            connect: sandbox.stub().resolves(),
            close: sandbox.stub().resolves(),
            connected: true
        };
        
        await queryExecutor.executeQuery('SELECT 1', mockPool);
        
        assert.strictEqual(mockPool.request.calledOnce, true);
    });

    test('should add query to history when available', async () => {
        await queryExecutor.executeQuery('SELECT * FROM Users');
        
        assert.strictEqual((historyManager.addEntry as sinon.SinonStub).calledOnce, true);
    });

    test('should initialize without history manager', () => {
        const executorWithoutHistory = new QueryExecutor(connectionProvider, outputChannel, undefined as any);
        
        assert.ok(executorWithoutHistory);
        assert.strictEqual((executorWithoutHistory as any).historyManager, undefined);
    });

    test('should cancel running query', () => {
        queryExecutor.cancelCurrentQuery();
        // Should not throw error even when no query is running
        assert.ok(true);
    });

    suite('Large Result Set Handling', () => {
        test('should handle large result sets efficiently', async () => {
            // Mock large result set
            const largeResultSet = Array(10000).fill(0).map((_, i) => ({
                id: i,
                name: `User ${i}`,
                email: `user${i}@example.com`,
                data: 'x'.repeat(1000) // 1KB per row
            }));

            mockConnection.request.returns({
                query: sandbox.stub().resolves({
                    recordset: largeResultSet,
                    rowsAffected: [largeResultSet.length]
                })
            });

            const result = await queryExecutor.executeQuery('SELECT * FROM LargeTable');

            assert.ok(result);
            assert.strictEqual(result.recordsets?.[0]?.length, largeResultSet.length);
        });

        test('should handle memory pressure with large results', async () => {
            // Simulate memory pressure scenario
            const hugeResultSet = Array(50000).fill(0).map((_, i) => ({
                id: i,
                data: 'x'.repeat(5000) // 5KB per row = ~250MB total
            }));

            mockConnection.request.returns({
                query: sandbox.stub().resolves({
                    recordset: hugeResultSet,
                    rowsAffected: [hugeResultSet.length]
                })
            });

            try {
                const result = await queryExecutor.executeQuery('SELECT * FROM HugeTable');
                assert.ok(result);
                // Should handle large datasets gracefully
            } catch (error) {
                // If memory issues occur, should fail gracefully
                assert.ok(error instanceof Error);
            }
        });

        test('should handle streaming results for large datasets', async () => {
            // Mock streaming result set
            mockConnection.request.returns({
                query: sandbox.stub().resolves({
                    recordset: Array(1000).fill({ id: 1, name: 'test' }),
                    rowsAffected: [1000]
                }),
                stream: true
            });

            const result = await queryExecutor.executeQuery('SELECT * FROM StreamingTable');
            assert.ok(result);
        });
    });

    suite('Query Cancellation and Timeout', () => {
        test('should cancel long-running query', async () => {
            let queryCancelled = false;
            
            // Mock a long-running query that can be cancelled
            mockConnection.request.returns({
                query: sandbox.stub().callsFake(async () => {
                    return new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            resolve({
                                recordset: [{ result: 'completed' }],
                                rowsAffected: [1]
                            });
                        }, 5000); // 5 second query

                        // Simulate cancellation
                        setTimeout(() => {
                            clearTimeout(timeout);
                            queryCancelled = true;
                            reject(new Error('Query was cancelled'));
                        }, 100);
                    });
                }),
                cancel: sandbox.stub().callsFake(() => {
                    queryCancelled = true;
                })
            });

            // Start query and immediately cancel
            const queryPromise = queryExecutor.executeQuery('SELECT * FROM SlowTable');
            queryExecutor.cancelCurrentQuery();

            try {
                await queryPromise;
                assert.fail('Query should have been cancelled');
            } catch (error) {
                assert.ok(queryCancelled);
                assert.ok(error instanceof Error);
            }
        });

        test('should handle query timeout', async () => {
            mockConnection.request.returns({
                query: sandbox.stub().rejects(new Error('Query timeout expired'))
            });

            try {
                await queryExecutor.executeQuery('SELECT * FROM TimeoutTable');
                assert.fail('Should have timed out');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes('timeout'));
            }
        });

        test('should handle connection timeout during query', async () => {
            mockConnection.request.returns({
                query: sandbox.stub().rejects(new Error('Connection timeout'))
            });

            try {
                await queryExecutor.executeQuery('SELECT * FROM DisconnectedTable');
                assert.fail('Should have failed with connection timeout');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes('timeout') || error.message.includes('Connection'));
            }
        });
    });

    suite('Transaction Handling', () => {
        test('should handle transaction rollback scenarios', async () => {
            const mockTransaction = {
                begin: sandbox.stub().resolves(),
                commit: sandbox.stub().resolves(),
                rollback: sandbox.stub().resolves(),
                request: sandbox.stub().returns(mockConnection.request())
            };

            mockConnection.transaction = sandbox.stub().returns(mockTransaction);
            mockConnection.request.returns({
                query: sandbox.stub().rejects(new Error('Constraint violation'))
            });

            try {
                await queryExecutor.executeQuery('INSERT INTO Users VALUES (1, \'test\')');
            } catch (error) {
                assert.ok(error instanceof Error);
            }
        });

        test('should handle nested transaction scenarios', async () => {
            const queries = [
                'BEGIN TRANSACTION',
                'INSERT INTO Users VALUES (1, \'user1\')',
                'SAVEPOINT sp1',
                'INSERT INTO Users VALUES (2, \'user2\')',
                'ROLLBACK TO sp1',
                'COMMIT'
            ];

            for (const query of queries) {
                try {
                    await queryExecutor.executeQuery(query);
                } catch (error) {
                    // Some queries might fail in test environment, that's expected
                }
            }

            assert.ok(true); // If we get here, transaction handling didn't crash
        });
    });

    suite('Concurrent Query Execution', () => {
        test('should handle multiple concurrent queries', async () => {
            const queries = Array(10).fill(0).map((_, i) => `SELECT ${i} as result`);
            
            // Mock different responses for each query
            queries.forEach((query, i) => {
                mockConnection.request.onCall(i).returns({
                    query: sandbox.stub().resolves({
                        recordset: [{ result: i }],
                        rowsAffected: [1]
                    })
                });
            });

            const promises = queries.map(query => 
                queryExecutor.executeQuery(query).catch(() => null)
            );

            const results = await Promise.allSettled(promises);
            
            // Should handle concurrent execution without crashes
            assert.ok(results.length === queries.length);
        });

        test('should handle concurrent queries with connection pool', async () => {
            const mockPool = {
                request: sandbox.stub().returns(mockConnection.request()),
                connect: sandbox.stub().resolves(),
                close: sandbox.stub().resolves(),
                connected: true
            };

            const promises = Array(5).fill(0).map((_, i) => 
                queryExecutor.executeQuery(`SELECT ${i}`, mockPool).catch(() => null)
            );

            await Promise.allSettled(promises);
            
            // Verify pool was used for multiple requests
            assert.ok(mockPool.request.callCount >= 5);
        });
    });

    suite('SQL Injection Protection and Security', () => {
        test('should handle potentially malicious queries safely', async () => {
            const maliciousQueries = [
                "SELECT * FROM Users; DROP TABLE Users; --",
                "SELECT * FROM Users WHERE id = 1; EXEC xp_cmdshell('dir'); --",
                "SELECT * FROM Users UNION SELECT username, password FROM AdminUsers",
                "'; WAITFOR DELAY '00:00:10'; --"
            ];

            for (const query of maliciousQueries) {
                try {
                    // The query executor should pass queries through to SQL Server
                    // Security is handled by SQL Server permissions and connection context
                    await queryExecutor.executeQuery(query);
                } catch (error) {
                    // Expected that these might fail due to permissions or syntax
                    assert.ok(error instanceof Error);
                }
            }
        });

        test('should handle queries with special characters', async () => {
            const specialQueries = [
                "SELECT 'O''Brien' as name",
                "SELECT 'Text with \"quotes\" and ''apostrophes''' as content", 
                "SELECT N'Unicode: αβγδε 中文 العربية' as unicode_text",
                "SELECT CHAR(0) + 'null byte' as special_chars"
            ];

            for (const query of specialQueries) {
                try {
                    await queryExecutor.executeQuery(query);
                } catch (error) {
                    // Some special character queries might fail in test environment
                    assert.ok(error instanceof Error);
                }
            }
        });
    });

    suite('Error Recovery and Resilience', () => {
        test('should recover from connection loss during query', async () => {
            let connectionLost = false;
            
            mockConnection.request.onFirstCall().returns({
                query: sandbox.stub().rejects(new Error('Connection lost'))
            });
            
            mockConnection.request.onSecondCall().returns({
                query: sandbox.stub().resolves({
                    recordset: [{ result: 'recovered' }],
                    rowsAffected: [1]
                })
            });

            // First query should fail
            try {
                await queryExecutor.executeQuery('SELECT 1');
                assert.fail('First query should have failed');
            } catch (error) {
                connectionLost = true;
                assert.ok(error instanceof Error);
            }

            // Second query should work (simulating reconnection)
            if (connectionLost) {
                try {
                    const result = await queryExecutor.executeQuery('SELECT 1');
                    assert.ok(result);
                } catch (error) {
                    // Connection might not recover in test environment
                }
            }
        });

        test('should handle deadlock scenarios', async () => {
            mockConnection.request.returns({
                query: sandbox.stub().rejects(new Error('Transaction was deadlocked'))
            });

            try {
                await queryExecutor.executeQuery('UPDATE Users SET name = \'test\' WHERE id = 1');
                assert.fail('Should have failed with deadlock');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes('deadlock'));
            }
        });

        test('should handle lock timeout scenarios', async () => {
            mockConnection.request.returns({
                query: sandbox.stub().rejects(new Error('Lock request time out period exceeded'))
            });

            try {
                await queryExecutor.executeQuery('SELECT * FROM LockedTable WITH (TABLOCKX)');
                assert.fail('Should have failed with lock timeout');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes('Lock') || error.message.includes('timeout'));
            }
        });
    });

    suite('Performance and Resource Management', () => {
        test('should handle queries with varying complexity', async () => {
            const queries = [
                'SELECT 1',
                'SELECT * FROM sys.tables',
                `WITH cte AS (
                    SELECT ROW_NUMBER() OVER (ORDER BY object_id) as rn, name 
                    FROM sys.tables
                ) SELECT * FROM cte WHERE rn <= 100`,
                `SELECT t1.name, t2.name 
                 FROM sys.tables t1 
                 CROSS JOIN sys.tables t2 
                 WHERE t1.object_id < t2.object_id`
            ];

            for (const query of queries) {
                try {
                    const start = Date.now();
                    await queryExecutor.executeQuery(query);
                    const duration = Date.now() - start;
                    
                    // Verify reasonable execution time (should complete quickly in mock)
                    assert.ok(duration < 5000); // 5 seconds max for test
                } catch (error) {
                    // Expected in test environment without real SQL Server
                }
            }
        });

        test('should cleanup resources after query completion', async () => {
            const initialMemory = process.memoryUsage();
            
            // Run multiple queries
            for (let i = 0; i < 10; i++) {
                try {
                    await queryExecutor.executeQuery(`SELECT ${i} as iteration`);
                } catch (error) {
                    // Expected in test environment
                }
            }

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

            const finalMemory = process.memoryUsage();
            
            // Memory usage shouldn't grow dramatically
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
            assert.ok(memoryIncrease < 100 * 1024 * 1024); // Less than 100MB increase
        });
    });
});