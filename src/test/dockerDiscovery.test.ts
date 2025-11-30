import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

// Mock the child_process module before importing the module under test
const mockExecAsync = sinon.stub();
const mockChildProcess = {
    exec: sinon.stub()
};

const mockUtil = {
    promisify: sinon.stub().returns(mockExecAsync)
};

// Use require with cache manipulation to ensure our mocks are used
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id: string) {
    if (id === 'child_process') {
        return mockChildProcess;
    }
    if (id === 'util') {
        return mockUtil;
    }
    return originalRequire.apply(this, arguments);
};

// Now import the module under test after setting up mocks
const { discoverDockerSqlServers, isDockerInstalled } = require('../utils/dockerDiscovery');

suite('Docker Discovery Test Suite', () => {
    let outputChannel: vscode.OutputChannel;

    setup(() => {
        outputChannel = vscode.window.createOutputChannel('MS SQL Manager Test');
        // Reset stubs before each test
        mockExecAsync.reset();
        mockChildProcess.exec.reset();
        mockUtil.promisify.reset();
        mockUtil.promisify.returns(mockExecAsync);
    });

    teardown(() => {
        // Clean up
        outputChannel.dispose();
        // Reset all stubs
        mockExecAsync.reset();
        mockChildProcess.exec.reset();
        mockUtil.promisify.reset();
    });

    test('isDockerInstalled returns true when Docker is available', async () => {
        // Mock successful Docker version check
        mockExecAsync.resolves({ stdout: 'Docker version 24.0.0', stderr: '' });

        const result = await isDockerInstalled(outputChannel);
        
        assert.strictEqual(result, true);
    });

    test('isDockerInstalled returns false when Docker is not available', async () => {
        // Mock failed Docker version check
        mockExecAsync.rejects(new Error('command not found'));

        const result = await isDockerInstalled(outputChannel);
        
        assert.strictEqual(result, false);
    });

    test('discoverDockerSqlServers returns empty array when Docker is not installed', async () => {
        // Mock Docker not available
        mockExecAsync.rejects(new Error('command not found'));

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 0);
    });

    test('discoverDockerSqlServers returns empty array when no containers are running', async () => {
        // First call: docker --version (success)
        mockExecAsync.onFirstCall().resolves({ stdout: 'Docker version 24.0.0', stderr: '' });
        // Second call: docker ps (no containers)
        mockExecAsync.onSecondCall().resolves({ stdout: '', stderr: '' });

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 0);
    });

    test('discoverDockerSqlServers filters only SQL Server images', async () => {
        // Mock docker --version
        mockExecAsync.onCall(0).resolves({ stdout: 'Docker version 24.0.0', stderr: '' });
        
        // Mock docker ps with mixed containers (SQL and non-SQL)
        const dockerPsOutput = [
            '{"ID":"abc123","Names":"sql-server-1","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up 2 hours","CreatedAt":"2024-01-01"}',
            '{"ID":"def456","Names":"nginx-1","Image":"nginx:latest","Status":"Up 1 hour","CreatedAt":"2024-01-01"}',
            '{"ID":"ghi789","Names":"azure-sql-edge-1","Image":"mcr.microsoft.com/azure-sql-edge:latest","Status":"Up 3 hours","CreatedAt":"2024-01-01"}'
        ].join('\n');
        
        mockExecAsync.onCall(1).resolves({ stdout: dockerPsOutput, stderr: '' });
        
        // Mock docker port for SQL containers
        mockExecAsync.withArgs('docker port abc123 1433').resolves({ stdout: '0.0.0.0:1433', stderr: '' });
        mockExecAsync.withArgs('docker port ghi789 1433').resolves({ stdout: '0.0.0.0:14330', stderr: '' });
        
        // Mock docker inspect for environment variables (no password)
        mockExecAsync.withArgs(sinon.match(/docker inspect.*abc123/)).resolves({ stdout: 'ACCEPT_EULA=Y\n', stderr: '' });
        mockExecAsync.withArgs(sinon.match(/docker inspect.*ghi789/)).resolves({ stdout: 'ACCEPT_EULA=Y\n', stderr: '' });

        const containers = await discoverDockerSqlServers(outputChannel);
        
        // Should find 2 SQL containers, not the nginx container
        assert.strictEqual(containers.length, 2);
        assert.strictEqual(containers[0].containerId, 'abc123');
        assert.strictEqual(containers[0].image, 'mcr.microsoft.com/mssql/server:2022-latest');
        assert.strictEqual(containers[1].containerId, 'ghi789');
        assert.strictEqual(containers[1].image, 'mcr.microsoft.com/azure-sql-edge:latest');
    });

    test('discoverDockerSqlServers extracts SA password from environment', async () => {
        // Mock docker --version
        mockExecAsync.onCall(0).resolves({ stdout: 'Docker version 24.0.0', stderr: '' });
        
        // Mock docker ps with one SQL container
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-test","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        mockExecAsync.onCall(1).resolves({ stdout: dockerPsOutput, stderr: '' });
        
        // Mock docker port
        mockExecAsync.withArgs('docker port abc123 1433').resolves({ stdout: '0.0.0.0:1433', stderr: '' });
        
        // Mock docker inspect with SA password
        const envOutput = 'ACCEPT_EULA=Y\nMSSQL_SA_PASSWORD=MyStrongP@ssw0rd\nMSSQL_PID=Developer\n';
        mockExecAsync.withArgs(sinon.match(/docker inspect.*abc123/)).resolves({ stdout: envOutput, stderr: '' });

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].saPassword, 'MyStrongP@ssw0rd');
    });

    test('discoverDockerSqlServers handles missing SA password gracefully', async () => {
        // Mock docker --version
        mockExecAsync.onCall(0).resolves({ stdout: 'Docker version 24.0.0', stderr: '' });
        
        // Mock docker ps
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-test","Image":"mssql/server:2019-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        mockExecAsync.onCall(1).resolves({ stdout: dockerPsOutput, stderr: '' });
        
        // Mock docker port
        mockExecAsync.withArgs('docker port abc123 1433').resolves({ stdout: '0.0.0.0:1433', stderr: '' });
        
        // Mock docker inspect without SA password
        mockExecAsync.withArgs(sinon.match(/docker inspect.*abc123/)).resolves({ stdout: 'ACCEPT_EULA=Y\n', stderr: '' });

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].saPassword, null);
    });

    test('discoverDockerSqlServers extracts custom port mapping', async () => {
        // Mock docker --version
        mockExecAsync.onCall(0).resolves({ stdout: 'Docker version 24.0.0', stderr: '' });
        
        // Mock docker ps
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-custom-port","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        mockExecAsync.onCall(1).resolves({ stdout: dockerPsOutput, stderr: '' });
        
        // Mock docker port with custom port 14330
        mockExecAsync.withArgs('docker port abc123 1433').resolves({ stdout: '0.0.0.0:14330', stderr: '' });
        
        // Mock docker inspect
        mockExecAsync.withArgs(sinon.match(/docker inspect.*abc123/)).resolves({ stdout: 'ACCEPT_EULA=Y\n', stderr: '' });

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].port, 14330);
    });

    test('discoverDockerSqlServers handles docker port error with default port', async () => {
        // Mock docker --version
        mockExecAsync.onCall(0).resolves({ stdout: 'Docker version 24.0.0', stderr: '' });
        
        // Mock docker ps
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-test","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        mockExecAsync.onCall(1).resolves({ stdout: dockerPsOutput, stderr: '' });
        
        // Mock docker port failing
        mockExecAsync.withArgs('docker port abc123 1433').rejects(new Error('port mapping not found'));
        
        // Mock docker inspect
        mockExecAsync.withArgs(sinon.match(/docker inspect.*abc123/)).resolves({ stdout: 'ACCEPT_EULA=Y\n', stderr: '' });

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].port, 1433); // Should default to 1433
    });

    test('discoverDockerSqlServers handles malformed JSON gracefully', async () => {
        // Mock docker --version
        mockExecAsync.onCall(0).resolves({ stdout: 'Docker version 24.0.0', stderr: '' });
        
        // Mock docker ps with malformed JSON
        const dockerPsOutput = [
            '{"ID":"abc123","Names":"sql-good","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}',
            '{this is not valid json}',
            '{"ID":"def456","Names":"sql-good-2","Image":"mcr.microsoft.com/azure-sql-edge","Status":"Up","CreatedAt":"2024-01-01"}'
        ].join('\n');
        
        mockExecAsync.onCall(1).resolves({ stdout: dockerPsOutput, stderr: '' });
        
        // Mock docker port
        mockExecAsync.withArgs('docker port abc123 1433').resolves({ stdout: '0.0.0.0:1433', stderr: '' });
        mockExecAsync.withArgs('docker port def456 1433').resolves({ stdout: '0.0.0.0:1433', stderr: '' });
        
        // Mock docker inspect
        mockExecAsync.withArgs(sinon.match(/docker inspect.*abc123/)).resolves({ stdout: 'ACCEPT_EULA=Y\n', stderr: '' });
        mockExecAsync.withArgs(sinon.match(/docker inspect.*def456/)).resolves({ stdout: 'ACCEPT_EULA=Y\n', stderr: '' });

        const containers = await discoverDockerSqlServers(outputChannel);
        
        // Should successfully parse 2 valid containers and skip the malformed one
        assert.strictEqual(containers.length, 2);
    });

    test('discoverDockerSqlServers recognizes SA_PASSWORD environment variable', async () => {
        // Mock docker --version
        mockExecAsync.onCall(0).resolves({ stdout: 'Docker version 24.0.0', stderr: '' });
        
        // Mock docker ps
        const dockerPsOutput = '{"ID":"abc123","Names":"sql-test","Image":"mcr.microsoft.com/mssql/server:2022-latest","Status":"Up","CreatedAt":"2024-01-01"}';
        mockExecAsync.onCall(1).resolves({ stdout: dockerPsOutput, stderr: '' });
        
        // Mock docker port
        mockExecAsync.withArgs('docker port abc123 1433').resolves({ stdout: '0.0.0.0:1433', stderr: '' });
        
        // Mock docker inspect with SA_PASSWORD (alternative format)
        const envOutput = 'ACCEPT_EULA=Y\nSA_PASSWORD=AlternativeP@ss\n';
        mockExecAsync.withArgs(sinon.match(/docker inspect.*abc123/)).resolves({ stdout: envOutput, stderr: '' });

        const containers = await discoverDockerSqlServers(outputChannel);
        
        assert.strictEqual(containers.length, 1);
        assert.strictEqual(containers[0].saPassword, 'AlternativeP@ss');
    });

    // Restore the original require function after all tests
    suiteTeardown(() => {
        Module.prototype.require = originalRequire;
    });
});
