import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { hasDmlWithoutWhere, containsDml, dryRunAffectedRows, checkDmlProtection } from '../utils/dmlProtection';

// ──────────────────────────────────────────────────────────────────────
// Unit tests – pure functions (no VS Code API needed)
// ──────────────────────────────────────────────────────────────────────
suite('DML Protection — hasDmlWithoutWhere', () => {
    test('detects DELETE without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM Users'), true);
    });

    test('detects UPDATE without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE Users SET Active = 0'), true);
    });

    test('allows DELETE with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM Users WHERE Id = 1'), false);
    });

    test('allows UPDATE with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE Users SET Active = 0 WHERE Id = 1'), false);
    });

    test('ignores DELETE inside comments', () => {
        assert.strictEqual(hasDmlWithoutWhere('/* DELETE FROM Users */ SELECT 1'), false);
    });

    test('ignores DELETE inside line comments', () => {
        assert.strictEqual(hasDmlWithoutWhere('-- DELETE FROM Users\nSELECT 1'), false);
    });

    test('ignores DELETE inside string literals', () => {
        assert.strictEqual(hasDmlWithoutWhere("SELECT 'DELETE FROM Users'"), false);
    });

    test('handles mixed statements — flags when one lacks WHERE', () => {
        const sql = 'DELETE FROM Logs WHERE Id < 10; DELETE FROM Audit';
        assert.strictEqual(hasDmlWithoutWhere(sql), true);
    });

    test('does not flag SELECT queries', () => {
        assert.strictEqual(hasDmlWithoutWhere('SELECT * FROM Users'), false);
    });

    test('does not flag INSERT statements', () => {
        assert.strictEqual(hasDmlWithoutWhere("INSERT INTO Users (Name) VALUES ('Test')"), false);
    });

    test('case insensitive detection', () => {
        assert.strictEqual(hasDmlWithoutWhere('delete from Users'), true);
        assert.strictEqual(hasDmlWithoutWhere('update Users set Name = 1'), true);
    });

    test('allows UPDATE with WHERE (case insensitive)', () => {
        assert.strictEqual(hasDmlWithoutWhere('update Users set Name = 1 where Id = 5'), false);
    });
});

suite('DML Protection — hasDmlWithoutWhere (schema-qualified table names)', () => {

    // ── DELETE variants ────────────────────────────────────────────────

    test('flags DELETE FROM dbo.Users without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM dbo.Users'), true);
    });

    test('flags DELETE FROM [dbo].Users without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM [dbo].Users'), true);
    });

    test('flags DELETE FROM dbo.[Users] without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM dbo.[Users]'), true);
    });

    test('flags DELETE FROM [dbo].[Users] without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM [dbo].[Users]'), true);
    });

    test('allows DELETE FROM dbo.Users with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM dbo.Users WHERE Id = 1'), false);
    });

    test('allows DELETE FROM [dbo].Users with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM [dbo].Users WHERE Id = 1'), false);
    });

    test('allows DELETE FROM dbo.[Users] with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM dbo.[Users] WHERE Id = 1'), false);
    });

    test('allows DELETE FROM [dbo].[Users] with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('DELETE FROM [dbo].[Users] WHERE Id = 1'), false);
    });

    // ── UPDATE variants ────────────────────────────────────────────────

    test('flags UPDATE dbo.Users without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE dbo.Users SET Active = 0'), true);
    });

    test('flags UPDATE [dbo].Users without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE [dbo].Users SET Active = 0'), true);
    });

    test('flags UPDATE dbo.[Users] without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE dbo.[Users] SET Active = 0'), true);
    });

    test('flags UPDATE [dbo].[Users] without WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE [dbo].[Users] SET Active = 0'), true);
    });

    test('allows UPDATE dbo.Users with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE dbo.Users SET Active = 0 WHERE Id = 1'), false);
    });

    test('allows UPDATE [dbo].Users with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE [dbo].Users SET Active = 0 WHERE Id = 1'), false);
    });

    test('allows UPDATE dbo.[Users] with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE dbo.[Users] SET Active = 0 WHERE Id = 1'), false);
    });

    test('allows UPDATE [dbo].[Users] with WHERE', () => {
        assert.strictEqual(hasDmlWithoutWhere('UPDATE [dbo].[Users] SET Active = 0 WHERE Id = 1'), false);
    });
});

suite('DML Protection — containsDml', () => {
    test('detects UPDATE', () => {
        assert.strictEqual(containsDml('UPDATE Users SET Active = 0 WHERE Id = 1'), true);
    });

    test('detects DELETE', () => {
        assert.strictEqual(containsDml('DELETE FROM Users WHERE Id = 1'), true);
    });

    test('does not flag SELECT', () => {
        assert.strictEqual(containsDml('SELECT * FROM Users'), false);
    });

    test('does not flag INSERT', () => {
        assert.strictEqual(containsDml("INSERT INTO Users (Name) VALUES ('Test')"), false);
    });

    test('ignores DML inside comments', () => {
        assert.strictEqual(containsDml('/* UPDATE Users SET X=1 */ SELECT 1'), false);
    });

    test('ignores DML inside string literals', () => {
        assert.strictEqual(containsDml("SELECT 'DELETE FROM Users'"), false);
    });
});

// ──────────────────────────────────────────────────────────────────────
// Integration-level tests (mock DB pool and VS Code API)
// ──────────────────────────────────────────────────────────────────────
suite('DML Protection — dryRunAffectedRows', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('returns sum of rowsAffected from rolled-back transaction', async () => {
        const mockPool: any = {
            runInTransaction: async (fn: any) => {
                const req = {
                    query: sandbox.stub().resolves({ rowsAffected: [42] })
                };
                return fn(() => req);
            }
        };
        const result = await dryRunAffectedRows('DELETE FROM Users WHERE Id < 100', mockPool);
        assert.strictEqual(result, 42);
    });

    test('returns 0 when pool has no runInTransaction', async () => {
        const mockPool: any = {};
        const result = await dryRunAffectedRows('DELETE FROM Users', mockPool);
        assert.strictEqual(result, 0);
    });
});

suite('DML Protection — checkDmlProtection', () => {
    let sandbox: sinon.SinonSandbox;
    let outputChannel: any;
    let mockPool: any;

    setup(() => {
        sandbox = sinon.createSandbox();
        outputChannel = {
            appendLine: sandbox.stub()
        };
    });

    teardown(() => {
        sandbox.restore();
    });

    test('proceeds for SELECT queries without any prompts', async () => {
        // Both settings on — but query is pure SELECT
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, def: any) => {
                if (key === 'warnOnMissingWhere') { return true; }
                if (key === 'limitAffectedRows') { return true; }
                if (key === 'maxAffectedRows') { return 100; }
                return def;
            }
        } as any);

        mockPool = {};
        const result = await checkDmlProtection('SELECT * FROM Users', mockPool, outputChannel);
        assert.strictEqual(result.proceed, true);
    });

    test('warns on DELETE without WHERE and blocks when cancelled', async () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, def: any) => {
                if (key === 'warnOnMissingWhere') { return true; }
                if (key === 'limitAffectedRows') { return false; }
                return def;
            }
        } as any);

        sandbox.stub(vscode.window, 'showWarningMessage').resolves('Cancel' as any);

        mockPool = {};
        const result = await checkDmlProtection('DELETE FROM Users', mockPool, outputChannel);
        assert.strictEqual(result.proceed, false);
    });

    test('warns on DELETE without WHERE and proceeds when confirmed', async () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, def: any) => {
                if (key === 'warnOnMissingWhere') { return true; }
                if (key === 'limitAffectedRows') { return false; }
                return def;
            }
        } as any);

        sandbox.stub(vscode.window, 'showWarningMessage').resolves('Execute' as any);

        mockPool = {};
        const result = await checkDmlProtection('DELETE FROM Users', mockPool, outputChannel);
        assert.strictEqual(result.proceed, true);
    });

    test('blocks when affected rows exceed threshold', async () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, def: any) => {
                if (key === 'warnOnMissingWhere') { return false; }
                if (key === 'limitAffectedRows') { return true; }
                if (key === 'maxAffectedRows') { return 50; }
                return def;
            }
        } as any);

        const showWarning = sandbox.stub(vscode.window, 'showWarningMessage').resolves('Cancel' as any);

        mockPool = {
            runInTransaction: async (fn: any) => {
                const req = { query: sandbox.stub().resolves({ rowsAffected: [200] }) };
                return fn(() => req);
            }
        };

        const result = await checkDmlProtection('DELETE FROM Users WHERE Active = 0', mockPool, outputChannel);
        assert.strictEqual(result.proceed, false);
        assert.ok(showWarning.calledOnce);
        assert.ok((showWarning.firstCall.args[0] as string).includes('200'));
    });

    test('proceeds when affected rows within threshold', async () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, def: any) => {
                if (key === 'warnOnMissingWhere') { return false; }
                if (key === 'limitAffectedRows') { return true; }
                if (key === 'maxAffectedRows') { return 50; }
                return def;
            }
        } as any);

        mockPool = {
            runInTransaction: async (fn: any) => {
                const req = { query: sandbox.stub().resolves({ rowsAffected: [10] }) };
                return fn(() => req);
            }
        };

        const result = await checkDmlProtection('DELETE FROM Users WHERE Id = 1', mockPool, outputChannel);
        assert.strictEqual(result.proceed, true);
    });

    test('skips all checks when both settings are disabled', async () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, def: any) => {
                if (key === 'warnOnMissingWhere') { return false; }
                if (key === 'limitAffectedRows') { return false; }
                return def;
            }
        } as any);

        mockPool = {};
        const result = await checkDmlProtection('DELETE FROM Users', mockPool, outputChannel);
        assert.strictEqual(result.proceed, true);
    });

    test('proceeds when dry-run fails (lets real execution surface the error)', async () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, def: any) => {
                if (key === 'warnOnMissingWhere') { return false; }
                if (key === 'limitAffectedRows') { return true; }
                if (key === 'maxAffectedRows') { return 50; }
                return def;
            }
        } as any);

        mockPool = {
            runInTransaction: sandbox.stub().rejects(new Error('Syntax error'))
        };

        const result = await checkDmlProtection('DELETE FROM Users WHERE Id = 1', mockPool, outputChannel);
        assert.strictEqual(result.proceed, true);
    });

    test('affected rows check confirms and proceeds', async () => {
        sandbox.stub(vscode.workspace, 'getConfiguration').returns({
            get: (key: string, def: any) => {
                if (key === 'warnOnMissingWhere') { return false; }
                if (key === 'limitAffectedRows') { return true; }
                if (key === 'maxAffectedRows') { return 50; }
                return def;
            }
        } as any);

        sandbox.stub(vscode.window, 'showWarningMessage').resolves('Execute' as any);

        mockPool = {
            runInTransaction: async (fn: any) => {
                const req = { query: sandbox.stub().resolves({ rowsAffected: [200] }) };
                return fn(() => req);
            }
        };

        const result = await checkDmlProtection('UPDATE Users SET Active = 0 WHERE Active = 1', mockPool, outputChannel);
        assert.strictEqual(result.proceed, true);
        assert.strictEqual(result.confirmed, true);
    });
});
