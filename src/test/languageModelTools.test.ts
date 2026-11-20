import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { GetSchemaTool, LM_TOOL_NAMES, ListDatabasesTool, OpenQueryTool, RunQueryTool } from '../ai/languageModelTools';
import { createServiceFixture } from './helpers/databaseToolsFixtures';

const invocation = <T>(input: T) => ({ input, toolInvocationToken: undefined }) as vscode.LanguageModelToolInvocationOptions<T>;
const prepare = <T>(input: T) => ({ input }) as vscode.LanguageModelToolInvocationPrepareOptions<T>;
const resultText = (result: vscode.LanguageModelToolResult) =>
    result.content.map(part => (part instanceof vscode.LanguageModelTextPart ? part.value : '')).join('');

suite('Language model tools', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test('package.json contributes every tool and no chat participant', () => {
        const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
        const contributed = (packageJson.contributes.languageModelTools as { name: string; modelDescription: string }[]).map(t => t.name);
        assert.deepStrictEqual(contributed.sort(), Object.values(LM_TOOL_NAMES).sort());
        assert.strictEqual(packageJson.contributes.chatParticipants, undefined);
        const schemaTool = packageJson.contributes.languageModelTools.find((t: { name: string }) => t.name === LM_TOOL_NAMES.getSchema);
        assert.ok(/ALWAYS call this before writing/.test(schemaTool.modelDescription));
    });

    test('list databases tool describes all active targets', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['Sales', 'Hr'] }
        ]);
        const text = resultText(await new ListDatabasesTool(service).invoke());
        assert.ok(text.includes('Active databases (2)'));
        assert.ok(text.includes('database="Hr"'));
    });

    test('schema tool asks the user to pick a database when several are connected', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'a', name: 'A', server: 'a', connectionType: 'database', database: 'Sales' },
            { id: 'b', name: 'B', server: 'b', connectionType: 'database', database: 'Crm' }
        ]);
        const picker = { pickTarget: sandbox.stub().callsFake(async candidates => candidates.find((c: { database: string }) => c.database === 'Crm')) };
        const tool = new GetSchemaTool(service, picker);

        const text = resultText(await tool.invoke(invocation({})));

        sinon.assert.calledOnce(picker.pickTarget);
        assert.ok(text.includes('database="Crm"'));
        assert.ok(text.includes('CREATE TABLE'));
    });

    test('schema tool does not ask when the database is given explicitly', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'a', name: 'A', server: 'a', connectionType: 'database', database: 'Sales' },
            { id: 'b', name: 'B', server: 'b', connectionType: 'database', database: 'Crm' }
        ]);
        const picker = { pickTarget: sandbox.stub() };
        const text = resultText(await new GetSchemaTool(service, picker).invoke(invocation({ database: 'Sales' })));
        sinon.assert.notCalled(picker.pickTarget);
        assert.ok(text.includes('database="Sales"'));
    });

    test('run query tool returns results', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'db', name: 'Azure', server: 'srv', connectionType: 'database', database: 'Crm' }
        ]);
        const text = resultText(await new RunQueryTool(service).invoke(invocation({ sql: 'SELECT Id, Name FROM dbo.Customers' })));
        assert.ok(text.includes('"Name": "Alice"'));
    });

    test('run query confirmation warns about data-modifying statements', () => {
        const { service } = createServiceFixture(sandbox, []);
        const tool = new RunQueryTool(service);

        const read = tool.prepareInvocation(prepare({ sql: 'SELECT 1', database: 'Sales' }));
        const write = tool.prepareInvocation(prepare({ sql: 'DELETE FROM dbo.Orders' }));

        assert.strictEqual(read.confirmationMessages?.title, 'Run SQL query on Sales?');
        assert.strictEqual(write.confirmationMessages?.title, 'Run data-modifying SQL?');
        const message = write.confirmationMessages?.message as vscode.MarkdownString;
        assert.ok(message.value.includes('may modify data'));
        assert.ok(message.value.includes('DELETE FROM dbo.Orders'));
    });

    test('open query tool opens the SQL editor for the resolved database', async () => {
        const { service } = createServiceFixture(sandbox, [
            { id: 'srv', name: 'Local', server: 'localhost', connectionType: 'server', databases: ['Sales'] }
        ]);
        const executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);

        const text = resultText(await new OpenQueryTool(service).invoke(invocation({ sql: 'SELECT 1', execute: true })));

        sinon.assert.calledWith(executeCommand, 'mssqlManager.newQuery',
            sinon.match({ connectionId: 'srv', database: 'Sales' }), 'SELECT 1', true);
        assert.ok(text.includes('started executing'));
    });

    test('open query tool only asks for confirmation when executing', () => {
        const { service } = createServiceFixture(sandbox, []);
        const tool = new OpenQueryTool(service);
        assert.strictEqual(tool.prepareInvocation(prepare({ sql: 'SELECT 1' })).confirmationMessages, undefined);
        assert.ok(tool.prepareInvocation(prepare({ sql: 'SELECT 1', execute: true })).confirmationMessages);
    });
});
