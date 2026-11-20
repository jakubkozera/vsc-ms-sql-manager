import * as assert from 'assert';
import {
    DatabaseTarget,
    extractObjectNames,
    filterSchemaText,
    formatQueryResult,
    isReadOnlySql,
    limitSchemaText,
    parseCompositeConnectionId,
    selectTarget
} from '../ai/sqlAgentCore';
import { SAMPLE_SCHEMA } from './helpers/databaseToolsFixtures';

const target = (connectionId: string, database: string, overrides: Partial<DatabaseTarget> = {}): DatabaseTarget => ({
    connectionId,
    connectionName: overrides.connectionName ?? connectionId,
    server: overrides.server ?? 'localhost',
    connectionType: overrides.connectionType ?? 'server',
    database,
    isSystemDatabase: ['master', 'tempdb', 'model', 'msdb'].includes(database.toLowerCase()),
    ...overrides
});

suite('SQL agent core', () => {
    suite('selectTarget', () => {
        test('returns none when there are no connections', () => {
            const result = selectTarget([], {});
            assert.strictEqual(result.kind, 'none');
        });

        test('resolves a single direct database connection', () => {
            const only = target('db1', 'Sales', { connectionType: 'database' });
            const result = selectTarget([only], {});
            assert.deepStrictEqual(result, { kind: 'resolved', target: only });
        });

        test('ignores system databases of a server connection when inferring', () => {
            const all = [target('srv', 'master'), target('srv', 'msdb'), target('srv', 'Sales')];
            const result = selectTarget(all, {});
            assert.strictEqual(result.kind, 'resolved');
            assert.strictEqual(result.kind === 'resolved' && result.target.database, 'Sales');
        });

        test('allows a system database when explicitly requested', () => {
            const all = [target('srv', 'master'), target('srv', 'Sales')];
            const result = selectTarget(all, { database: 'MASTER' });
            assert.strictEqual(result.kind === 'resolved' && result.target.database, 'master');
        });

        test('is ambiguous for a server with many user databases', () => {
            const all = [target('srv', 'master'), target('srv', 'Sales'), target('srv', 'Hr')];
            const result = selectTarget(all, {});
            assert.strictEqual(result.kind, 'ambiguous');
            assert.deepStrictEqual(result.kind === 'ambiguous' && result.candidates.map(c => c.database), ['Sales', 'Hr']);
        });

        test('is ambiguous for several open connections', () => {
            const all = [target('a', 'Sales', { connectionType: 'database' }), target('b', 'Crm', { connectionType: 'database' })];
            assert.strictEqual(selectTarget(all, {}).kind, 'ambiguous');
        });

        test('narrows by database name across connections', () => {
            const all = [target('a', 'Sales', { connectionType: 'database' }), target('b', 'Crm', { connectionType: 'database' })];
            const result = selectTarget(all, { database: 'crm' });
            assert.strictEqual(result.kind === 'resolved' && result.target.connectionId, 'b');
        });

        test('stays ambiguous when the same database exists on two servers', () => {
            const all = [target('a', 'Sales'), target('b', 'Sales')];
            assert.strictEqual(selectTarget(all, { database: 'Sales' }).kind, 'ambiguous');
        });

        test('matches connectionId by connection name', () => {
            const all = [target('id-1', 'Sales', { connectionName: 'Production' }), target('id-2', 'Sales', { connectionName: 'Dev' })];
            const result = selectTarget(all, { connectionId: 'dev', database: 'Sales' });
            assert.strictEqual(result.kind === 'resolved' && result.target.connectionId, 'id-2');
        });

        test('reports unknown connection and database with available targets', () => {
            const all = [target('a', 'Sales')];
            const unknownConn = selectTarget(all, { connectionId: 'nope' });
            assert.strictEqual(unknownConn.kind, 'none');
            assert.ok(unknownConn.kind === 'none' && unknownConn.message.includes('connectionId="a"'));
            const unknownDb = selectTarget(all, { database: 'Nope' });
            assert.strictEqual(unknownDb.kind, 'none');
            assert.ok(unknownDb.kind === 'none' && unknownDb.message.includes('database="Sales"'));
        });

        test('uses the first matching hint to break ties', () => {
            const all = [target('a', 'Sales'), target('a', 'Hr'), target('b', 'Crm')];
            const result = selectTarget(all, {}, [undefined, { connectionId: 'a', database: 'hr' }]);
            assert.strictEqual(result.kind === 'resolved' && result.target.database, 'Hr');
        });

        test('ignores hints that do not identify a single candidate', () => {
            const all = [target('a', 'Sales'), target('a', 'Hr')];
            assert.strictEqual(selectTarget(all, {}, [{ connectionId: 'a' }, { connectionId: 'zzz', database: 'Sales' }]).kind, 'ambiguous');
        });

        test('hint with system database does not override user database inference', () => {
            const all = [target('a', 'master'), target('a', 'Sales'), target('a', 'Hr')];
            assert.strictEqual(selectTarget(all, {}, [{ connectionId: 'a', database: 'master' }]).kind, 'ambiguous');
        });
    });

    suite('parseCompositeConnectionId', () => {
        test('parses composite and plain ids', () => {
            assert.deepStrictEqual(parseCompositeConnectionId('conn::Sales'), { connectionId: 'conn', database: 'Sales' });
            assert.deepStrictEqual(parseCompositeConnectionId('conn'), { connectionId: 'conn' });
            assert.strictEqual(parseCompositeConnectionId(null), undefined);
        });
    });

    suite('isReadOnlySql', () => {
        const readOnly = [
            'SELECT * FROM dbo.Orders',
            'WITH x AS (SELECT 1 AS a) SELECT a FROM x',
            "SELECT 'DELETE FROM t' AS text",
            'SELECT 1 -- drop table Orders',
            'SELECT 1 /* UPDATE x SET y = 1 */',
            'SELECT [Update], LastUpdated, CreatedAt FROM dbo.T',
            'DECLARE @x INT = 1; SELECT @x'
        ];
        const writes = [
            'INSERT INTO dbo.T VALUES (1)',
            'update dbo.T set a = 1',
            'DELETE dbo.T',
            'SELECT * INTO #tmp FROM dbo.T',
            'EXEC dbo.DoSomething',
            'sp_rename \'a\', \'b\'',
            'DROP TABLE dbo.T',
            "SELECT 'x--'; DELETE FROM dbo.T",
            'TRUNCATE TABLE dbo.T',
            'MERGE dbo.T AS t USING s ON 1=1 WHEN MATCHED THEN DELETE;',
            ''
        ];

        for (const sql of readOnly) {
            test(`read-only: ${sql}`, () => assert.strictEqual(isReadOnlySql(sql), true));
        }
        for (const sql of writes) {
            test(`not read-only: ${sql || '(empty)'}`, () => assert.strictEqual(isReadOnlySql(sql), false));
        }
    });

    suite('schema helpers', () => {
        test('filterSchemaText keeps only the requested table', () => {
            const filtered = filterSchemaText(SAMPLE_SCHEMA, ['Orders']);
            assert.ok(filtered.includes('CREATE TABLE [dbo].[Orders]'));
            assert.ok(!filtered.includes('[Customers]'));
            assert.ok(!filtered.includes('-- TABLES'));
            assert.ok(filtered.startsWith('-- Database Schema for: Sales'));
        });

        test('filterSchemaText supports schema-qualified names, brackets and wildcards', () => {
            const filtered = filterSchemaText(SAMPLE_SCHEMA, ['[report].[OrderTotals]', 'dbo.Cust*', 'dbo.Get%']);
            assert.ok(filtered.includes('[report].[OrderTotals]'));
            assert.ok(filtered.includes('[dbo].[Customers]'));
            assert.ok(filtered.includes('-- EXEC [dbo].[GetCustomer]'));
            assert.ok(!filtered.includes('DeleteOrder'));
            assert.ok(!filtered.includes('[dbo].[Orders]'));
        });

        test('filterSchemaText respects the schema part', () => {
            const filtered = filterSchemaText(SAMPLE_SCHEMA, ['report.Orders']);
            assert.ok(filtered.includes('No objects matched'));
            assert.ok(filtered.includes('dbo.Orders (table)'));
        });

        test('extractObjectNames lists all objects', () => {
            assert.deepStrictEqual(extractObjectNames(SAMPLE_SCHEMA), [
                'dbo.Customers (table)',
                'dbo.Orders (table)',
                'report.OrderTotals (view)',
                'dbo.GetCustomer (procedure)',
                'dbo.DeleteOrder (procedure)',
                'dbo.fnTotal (function)'
            ]);
        });

        test('limitSchemaText returns small schema unchanged and summarizes large ones', () => {
            assert.strictEqual(limitSchemaText(SAMPLE_SCHEMA), SAMPLE_SCHEMA);
            const limited = limitSchemaText(SAMPLE_SCHEMA, 100);
            assert.ok(limited.includes('too large'));
            assert.ok(limited.includes('dbo.Orders (table)'));
            assert.ok(!limited.includes('CREATE TABLE'));
        });
    });

    suite('formatQueryResult', () => {
        test('formats rows and truncates to maxRows', () => {
            const rows = Array.from({ length: 5 }, (_, i) => ({ Id: i }));
            const text = formatQueryResult({ recordsets: [rows], rowsAffected: [5] }, 12, 2);
            assert.ok(text.includes('Execution time: 12ms'));
            assert.ok(text.includes('Result: 5 row(s)'));
            assert.ok(text.includes('Columns: Id'));
            assert.ok(text.includes('Showing first 2 of 5 rows'));
            assert.ok(!text.includes('"Id": 2'));
        });

        test('formats multiple result sets and empty sets', () => {
            const text = formatQueryResult({ recordsets: [[{ a: 1 }], []] }, 1, 10);
            assert.ok(text.includes('Result set 1: 1 row(s)'));
            assert.ok(text.includes('Result set 2: 0 rows'));
        });

        test('reports affected rows for statements without result sets', () => {
            const text = formatQueryResult({ recordsets: [], rowsAffected: [2, 3] }, 1, 10);
            assert.ok(text.includes('Rows affected: 5'));
        });

        test('serializes binary and bigint values', () => {
            const text = formatQueryResult({ recordset: [{ bin: Buffer.from([1, 255]), big: BigInt(5) }] }, 1, 10);
            assert.ok(text.includes('"0x01ff"'));
            assert.ok(text.includes('"5"'));
        });
    });
});
