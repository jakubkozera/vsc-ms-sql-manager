import * as assert from 'assert';
import * as vscode from 'vscode';
import { discoverDockerSqlServers, isDockerInstalled } from '../utils/dockerDiscovery';
import * as sinon from 'sinon';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

suite('Docker Discovery Test Suite', () => {
    let outputChannel: vscode.OutputChannel;
    let execStub: sinon.SinonStub;

    setup(() => {
        outputChannel = vscode.window.createOutputChannel('MS SQL Manager Test');
        // Stub the exec function from child_process module
        execStub = sinon.stub();
    });

    teardown(() => {
        sinon.restore();
        outputChannel.dispose();
    });

    test('isDockerInstalled returns true when Docker is available', async () => {
        // Mock successful Docker version check
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec').yields(null, { stdout: 'Docker version 24.0.0' }, null);

        const result = await isDockerInstalled(outputChannel);
        
        assert.strictEqual(result, true);
        stub.restore();
    });

    test('isDockerInstalled returns false when Docker is not available', async () => {
        // Mock failed Docker version check
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec').yields(new Error('command not found'), null, null);

        const result = await isDockerInstalled(outputChannel);
        
        assert.strictEqual(result, false);
        stub.restore();
    });

    test('discoverDockerSqlServers returns empty array when Docker is not installed', async () => {
        // Mock Docker not available
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec').yields(new Error('command not found'), null, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 0);
        stub.restore();
    });

    test('discoverDockerSqlServers returns empty array when no containers are running', async () => {
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec');
        
        // First call: docker --version (success)
        stub.onFirstCall().yields(null, { stdout: 'Docker version 24.0.0' }, null);
        // Second call: docker ps (no containers)
        stub.onSecondCall().yields(null, { stdout: '' }, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 0);
        stub.restore();
    });

    test('discoverDockerSqlServers filters only SQL Server images', async () => {
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec');
        
        // Mock docker --version
        stub.onFirstCall().yields(null, { stdout: 'Docker version 24.0.0' }, null);
        
        // Mock docker ps with mixed containers (SQL and non-SQL)
        const dockerPsOutput = [
            '{"ID":"abc123","Names":"sql-server-1","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up 2 hours","CreatedAt":"2024-01-01"}',
            '{"ID":"def456","Names":"nginx-1","Image":"nginx:latest","Status":"Up 1 hour","CreatedAt":"2024-01-01"}',
            '{"ID":"ghi789","Names":"azure-sql-edge-1","Image":"mcr.microsoft.com/azure-sql-edge:latest","Status":"Up 3 hours","CreatedAt":"2024-01-01"}'
        ].join('\n');
        
        stub.onSecondCall().yields(null, { stdout: dockerPsOutput }, null);
        
        // Mock docker port for SQL containers
        stub.withArgs('docker port abc123 1433').yields(null, { stdout: '0.0.0.0:1433' }, null);
        stub.withArgs('docker port ghi789 1433').yields(null, { stdout: '0.0.0.0:14330' }, null);
        
        // Mock docker inspect for environment variables (no password)
        stub.withArgs(sinon.match(/docker inspect.*abc123/)).yields(null, { stdout: 'ACCEPT_EULA=Y\n' }, null);
        stub.withArgs(sinon.match(/docker inspect.*ghi789/)).yields(null, { stdout: 'ACCEPT_EULA=Y\n' }, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        // Should find 2 SQL containers, not the nginx container
        assert.strictEqual(containers.length, 2);
        assert.strictEqual(containers[0].containerId, 'abc123');
        assert.strictEqual(containers[0].image, 'mcr.microsoft.com/mssql/server:2022-latest');
        assert.strictEqual(containers[1].containerId, 'ghi789');
        assert.strictEqual(containers[1].image, 'mcr.microsoft.com/azure-sql-edge:latest');
        
        stub.restore();
    });

    test('discoverDockerSqlServers extracts SA password from environment', async () => {
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec');
        
        // Mock docker --version
        stub.onFirstCall().yields(null, { stdout: 'Docker version 24.0.0' }, null);
        
        // Mock docker ps with one SQL container
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-test","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        stub.onSecondCall().yields(null, { stdout: dockerPsOutput }, null);
        
        // Mock docker port
        stub.withArgs('docker port abc123 1433').yields(null, { stdout: '0.0.0.0:1433' }, null);
        
        // Mock docker inspect with SA password
        const envOutput = 'ACCEPT_EULA=Y\nMSSQL_SA_PASSWORD=MyStrongP@ssw0rd\nMSSQL_PID=Developer\n';
        stub.withArgs(sinon.match(/docker inspect.*abc123/)).yields(null, { stdout: envOutput }, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].saPassword, 'MyStrongP@ssw0rd');
        
        stub.restore();
    });

    test('discoverDockerSqlServers handles missing SA password gracefully', async () => {
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec');
        
        // Mock docker --version
        stub.onFirstCall().yields(null, { stdout: 'Docker version 24.0.0' }, null);
        
        // Mock docker ps
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-test","Image":"mssql/server:2019-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        stub.onSecondCall().yields(null, { stdout: dockerPsOutput }, null);
        
        // Mock docker port
        stub.withArgs('docker port abc123 1433').yields(null, { stdout: '0.0.0.0:1433' }, null);
        
        // Mock docker inspect without SA password
        stub.withArgs(sinon.match(/docker inspect.*abc123/)).yields(null, { stdout: 'ACCEPT_EULA=Y\n' }, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].saPassword, null);
        
        stub.restore();
    });

    test('discoverDockerSqlServers extracts custom port mapping', async () => {
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec');
        
        // Mock docker --version
        stub.onFirstCall().yields(null, { stdout: 'Docker version 24.0.0' }, null);
        
        // Mock docker ps
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-custom-port","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        stub.onSecondCall().yields(null, { stdout: dockerPsOutput }, null);
        
        // Mock docker port with custom port 14330
        stub.withArgs('docker port abc123 1433').yields(null, { stdout: '0.0.0.0:14330' }, null);
        
        // Mock docker inspect
        stub.withArgs(sinon.match(/docker inspect.*abc123/)).yields(null, { stdout: 'ACCEPT_EULA=Y\n' }, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].port, 14330);
        
        stub.restore();
    });

    test('discoverDockerSqlServers handles docker port error with default port', async () => {
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec');
        
        // Mock docker --version
        stub.onFirstCall().yields(null, { stdout: 'Docker version 24.0.0' }, null);
        
        // Mock docker ps
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-test","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        stub.onSecondCall().yields(null, { stdout: dockerPsOutput }, null);
        
        // Mock docker port failing
        stub.withArgs('docker port abc123 1433').yields(new Error('port mapping not found'), null, null);
        
        // Mock docker inspect
        stub.withArgs(sinon.match(/docker inspect.*abc123/)).yields(null, { stdout: 'ACCEPT_EULA=Y\n' }, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].port, 1433); // Should default to 1433
        
        stub.restore();
    });

    test('discoverDockerSqlServers handles malformed JSON gracefully', async () => {
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec');
        
        // Mock docker --version
        stub.onFirstCall().yields(null, { stdout: 'Docker version 24.0.0' }, null);
        
        // Mock docker ps with malformed JSON
        const dockerPsOutput = [
            '{"ID":"abc123","Names":"sql-good","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}',
            '{this is not valid json}',
            '{"ID":"def456","Names":"sql-good-2","Image":"mcr.microsoft.com/azure-sql-edge","Status":"Up","CreatedAt":"2024-01-01"}'
        ].join('\n');
        
        stub.onSecondCall().yields(null, { stdout: dockerPsOutput }, null);
        
        // Mock docker port
        stub.withArgs('docker port abc123 1433').yields(null, { stdout: '0.0.0.0:1433' }, null);
        stub.withArgs('docker port def456 1433').yields(null, { stdout: '0.0.0.0:1433' }, null);
        
        // Mock docker inspect
        stub.withArgs(sinon.match(/docker inspect.*abc123/)).yields(null, { stdout: 'ACCEPT_EULA=Y\n' }, null);
        stub.withArgs(sinon.match(/docker inspect.*def456/)).yields(null, { stdout: 'ACCEPT_EULA=Y\n' }, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        // Should successfully parse 2 valid containers and skip the malformed one
        assert.strictEqual(containers.length, 2);
        
        stub.restore();
    });

    test('discoverDockerSqlServers recognizes SA_PASSWORD environment variable', async () => {
        const childProcess = require('child_process');
        const stub = sinon.stub(childProcess, 'exec');
        
        // Mock docker --version
        stub.onFirstCall().yields(null, { stdout: 'Docker version 24.0.0' }, null);
        
        // Mock docker ps
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-test","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        stub.onSecondCall().yields(null, { stdout: dockerPsOutput }, null);
        
        // Mock docker port
        stub.withArgs('docker port abc123 1433').yields(null, { stdout: '0.0.0.0:1433' }, null);
        
        // Mock docker inspect with SA_PASSWORD (alternative format)
        const envOutput = 'ACCEPT_EULA=Y\nSA_PASSWORD=AlternativeP@ss\n';
        stub.withArgs(sinon.match(/docker inspect.*abc123/)).yields(null, { stdout: envOutput }, null);

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].saPassword, 'AlternativeP@ss');
        
        stub.restore();
    });
});
