import * as assert from 'assert';
import * as sinon from 'sinon';
import { AmbiguousTargetError, TargetSelectionCancelledError } from '../ai/databaseToolsService';
import { createServiceFixture } from './helpers/databaseToolsFixtures';

suite('DatabaseToolsService', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('listTargets expands server connections into databases and flags system databases', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['master', 'Sales'] },
            { id: 'db', name: 'Azure', server: 'x.database.windows.net', connectionType: 'database', database: 'Crm' }
        ]);
        const targets = await service.listTargets();
        assert.deepStrictEqual(targets.map(t => [t.connectionId, t.database, t.isSystemDatabase]), [
            ['srv', 'master', true],
            ['srv', 'Sales', false],
            ['db', 'Crm', false]
        ]);
    });

    test('resolveTarget picks the only database of a direct connection without asking', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'db', name: 'Azure', server: 'srv', connectionType: 'database', database: 'Crm' }
        ]);
        const picker = { pickTarget: sandbox.stub() };
        const target = await service.resolveTarget({}, picker);
        assert.strictEqual(target.database, 'Crm');
        sinon.assert.notCalled(picker.pickTarget);
    });

    test('resolveTarget throws AmbiguousTargetError listing candidates when no picker is available', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['Sales', 'Hr'] }
        ]);
        await assert.rejects(service.resolveTarget({}), (error: unknown) => {
            assert.ok(error instanceof AmbiguousTargetError);
            assert.strictEqual(error.candidates.length, 2);
            assert.ok(error.message.includes('database="Hr"'));
            return true;
        });
    });

    test('resolveTarget asks the picker once and remembers the choice for follow-up calls', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'a', name: 'A', server: 'a', connectionType: 'database', database: 'Sales' },
            { id: 'b', name: 'B', server: 'b', connectionType: 'database', database: 'Crm' }
        ]);
        const picker = { pickTarget: sandbox.stub().callsFake(async candidates => candidates[1]) };

        const first = await service.resolveTarget({}, picker);
        const second = await service.resolveTarget({}, picker);

        assert.strictEqual(first.connectionId, 'b');
        assert.strictEqual(second.connectionId, 'b');
        sinon.assert.calledOnce(picker.pickTarget);
    });

    test('resolveTarget reports cancellation of the picker', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'a', name: 'A', server: 'a', connectionType: 'database', database: 'Sales' },
            { id: 'b', name: 'B', server: 'b', connectionType: 'database', database: 'Crm' }
        ]);
        await assert.rejects(service.resolveTarget({}, { pickTarget: async () => undefined }), TargetSelectionCancelledError);
    });

    test('resolveTarget uses the database selected in the active SQL editor', async () => {
        const fixture = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['Sales', 'Hr'] }
        ]);
        fixture.setEditorHint({ connectionId: 'srv', database: 'Hr' });
        const target = await fixture.service.resolveTarget({});
        assert.strictEqual(target.database, 'Hr');
    });

    test('explicit parameters win over remembered targets', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['Sales', 'Hr'] }
        ]);
        service.setPreferredTarget({ connectionId: 'srv', database: 'Sales' });
        const target = await service.resolveTarget({ database: 'Hr' });
        assert.strictEqual(target.database, 'Hr');
    });

    test('resolveTarget fails with a helpful message when nothing is connected', async () => {
        const { service } = createServiceFixture(sandbox, []);
        await assert.rejects(service.resolveTarget({}), /no active SQL Server connections/i);
    });

    test('getSchemaContext combines schema, server info and database instructions', async () => {
        const fixture = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['Sales'] }
        ]);
        fixture.instructionsManager.loadInstructions.resolves('Always filter soft-deleted rows (IsDeleted = 0).');

        const target = await fixture.service.resolveTarget({});
        const text = await fixture.service.getSchemaContext(target, ['Orders']);

        sinon.assert.calledWith(fixture.schemaContextBuilder.buildSchemaContext, 'srv', 'Sales');
        sinon.assert.calledWith(fixture.instructionsManager.loadInstructions, 'srv', 'Sales');
        assert.ok(text.includes('connectionId="srv", database="Sales"'));
        assert.ok(text.includes('SQL Server 16.0.1000.6'));
        assert.ok(text.includes('compatibility level 160'));
        assert.ok(text.includes('Always filter soft-deleted rows'));
        assert.ok(text.includes('CREATE TABLE [dbo].[Orders]'));
        assert.ok(!text.includes('[dbo].[Customers]'));
        assert.ok(text.includes('Never guess names'));
    });

    test('getSchemaContext loads instructions by connection only for direct database connections', async () => {
        const fixture = createServiceFixture(sandbox, [
            { id: 'db', name: 'Azure', server: 'srv', connectionType: 'database', database: 'Crm' }
        ]);
        const target = await fixture.service.resolveTarget({});
        const text = await fixture.service.getSchemaContext(target);
        sinon.assert.calledWith(fixture.instructionsManager.loadInstructions, 'db', undefined);
        assert.ok(!text.includes('Database-specific instructions'));
    });

    test('runQuery uses a database pool for server connections', async () => {
        const fixture = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['Sales'] }
        ]);
        const target = await fixture.service.resolveTarget({});
        const text = await fixture.service.runQuery(target, 'SELECT Id, Name FROM dbo.Customers');

        sinon.assert.calledWith(fixture.connectionProvider.ensureConnectionAndGetDbPool, 'srv', 'Sales');
        sinon.assert.calledWith(fixture.dbPool.query, 'SELECT Id, Name FROM dbo.Customers');
        assert.ok(text.includes('"Name": "Alice"'));
    });

    test('runQuery uses the main pool for direct database connections', async () => {
        const fixture = createServiceFixture(sandbox, [
            { id: 'db', name: 'Azure', server: 'srv', connectionType: 'database', database: 'Crm' }
        ]);
        const target = await fixture.service.resolveTarget({});
        await fixture.service.runQuery(target, 'SELECT 1');
        sinon.assert.notCalled(fixture.connectionProvider.ensureConnectionAndGetDbPool);
        sinon.assert.calledWith(fixture.pools.get('db')!.query, 'SELECT 1');
    });

    test('runQuery rejects empty SQL', async () => {
        const fixture = createServiceFixture(sandbox, [
            { id: 'db', name: 'Azure', server: 'srv', connectionType: 'database', database: 'Crm' }
        ]);
        const target = await fixture.service.resolveTarget({});
        await assert.rejects(fixture.service.runQuery(target, '   '), /empty/);
    });

    test('describeTargets marks the current target', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['master', 'Sales'] }
        ]);
        service.setPreferredTarget({ connectionId: 'srv', database: 'Sales' });
        const text = service.describeTargets(await service.listTargets());
        assert.ok(text.includes('database="master"') && text.includes('[system]'));
        assert.ok(/database="Sales".*\[current\]/.test(text));
    });
});
