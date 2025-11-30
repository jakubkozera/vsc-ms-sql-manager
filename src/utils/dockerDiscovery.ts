import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DockerSqlContainer {
    containerId: string;
    containerName: string;
    image: string;
    status: string;
    port: number;
    saPassword: string | null;
    createdAt: string;
}

// List of SQL Server images that support T-SQL
const SQL_SERVER_IMAGES = [
    'mcr.microsoft.com/mssql/server',
    'mcr.microsoft.com/azure-sql-edge',
    'mssql/server'
];

/**
 * Check if Docker is installed and accessible
 */
export async function isDockerInstalled(outputChannel: vscode.OutputChannel): Promise<boolean> {
    try {
        outputChannel.appendLine('[Docker Discovery] Checking if Docker is installed...');
        const { stdout } = await execAsync('docker --version');
        outputChannel.appendLine(`[Docker Discovery] Docker found: ${stdout.trim()}`);
        return true;
    } catch (error) {
        outputChannel.appendLine(`[Docker Discovery] Docker not found: ${error}`);
        return false;
    }
}

/**
 * Check if image matches any SQL Server image pattern
 */
function isSqlServerImage(image: string): boolean {
    return SQL_SERVER_IMAGES.some(pattern => image.includes(pattern));
}

/**
 * Extract SA password from container environment variables
 */
async function extractSaPassword(
    containerId: string,
    outputChannel: vscode.OutputChannel
): Promise<string | null> {
    try {
        outputChannel.appendLine(`[Docker Discovery] Extracting SA password for container ${containerId}...`);
        
        const { stdout } = await execAsync(
            `docker inspect --format "{{range .Config.Env}}{{println .}}{{end}}" ${containerId}`
        );
        
        const lines = stdout.split('\n');
        for (const line of lines) {
            if (line.startsWith('MSSQL_SA_PASSWORD=') || line.startsWith('SA_PASSWORD=')) {
                const password = line.split('=')[1]?.trim();
                if (password) {
                    outputChannel.appendLine(`[Docker Discovery] SA password found for container ${containerId}`);
                    return password;
                }
            }
        }
        
        outputChannel.appendLine(`[Docker Discovery] No SA password found in environment for container ${containerId}`);
        return null;
    } catch (error) {
        outputChannel.appendLine(`[Docker Discovery] Error extracting SA password: ${error}`);
        return null;
    }
}

/**
 * Extract port mapping for SQL Server (1433)
 */
async function extractPortMapping(
    containerId: string,
    outputChannel: vscode.OutputChannel
): Promise<number | null> {
    try {
        outputChannel.appendLine(`[Docker Discovery] Extracting port mapping for container ${containerId}...`);
        
        const { stdout } = await execAsync(`docker port ${containerId} 1433`);
        
        if (stdout.trim()) {
            // Format: 0.0.0.0:1433 or [::]:1433 or 0.0.0.0:14330
            const match = stdout.match(/:(\d+)/);
            if (match && match[1]) {
                const port = parseInt(match[1], 10);
                outputChannel.appendLine(`[Docker Discovery] Port mapping found: 1433 -> ${port}`);
                return port;
            }
        }
        
        outputChannel.appendLine(`[Docker Discovery] No port mapping found for 1433, using default`);
        return 1433;
    } catch (error) {
        outputChannel.appendLine(`[Docker Discovery] Error extracting port: ${error}. Using default 1433`);
        return 1433;
    }
}

/**
 * Parse container info from docker ps JSON output
 */
async function parseContainerInfo(
    containerJson: any,
    outputChannel: vscode.OutputChannel
): Promise<DockerSqlContainer | null> {
    try {
        const containerId = containerJson.ID || containerJson.Id;
        const containerName = containerJson.Names?.replace(/^\//, '') || containerJson.Name?.replace(/^\//, '') || 'Unknown';
        const image = containerJson.Image;
        const status = containerJson.Status || containerJson.State;
        const created = containerJson.CreatedAt || containerJson.Created || '';

        if (!isSqlServerImage(image)) {
            return null;
        }

        outputChannel.appendLine(`[Docker Discovery] Found SQL Server container: ${containerName} (${image})`);

        const port = await extractPortMapping(containerId, outputChannel);
        const saPassword = await extractSaPassword(containerId, outputChannel);

        return {
            containerId,
            containerName,
            image,
            status,
            port: port || 1433,
            saPassword,
            createdAt: created
        };
    } catch (error) {
        outputChannel.appendLine(`[Docker Discovery] Error parsing container info: ${error}`);
        return null;
    }
}

/**
 * Discover all running SQL Server containers
 */
export async function discoverDockerSqlServers(
    outputChannel: vscode.OutputChannel
): Promise<DockerSqlContainer[]> {
    const containers: DockerSqlContainer[] = [];

    try {
        outputChannel.appendLine('[Docker Discovery] Starting Docker SQL Server discovery...');

        // Check if Docker is installed
        const dockerInstalled = await isDockerInstalled(outputChannel);
        if (!dockerInstalled) {
            outputChannel.appendLine('[Docker Discovery] Docker is not installed or not accessible');
            return containers;
        }

        // Get all running containers in JSON format
        outputChannel.appendLine('[Docker Discovery] Listing running containers...');
        const { stdout } = await execAsync('docker ps --format "{{json .}}"');

        if (!stdout.trim()) {
            outputChannel.appendLine('[Docker Discovery] No running containers found');
            return containers;
        }

        // Parse each line as JSON (docker ps outputs one JSON object per line)
        const lines = stdout.trim().split('\n');
        outputChannel.appendLine(`[Docker Discovery] Found ${lines.length} running container(s)`);

        for (const line of lines) {
            try {
                const containerJson = JSON.parse(line);
                const containerInfo = await parseContainerInfo(containerJson, outputChannel);
                
                if (containerInfo) {
                    containers.push(containerInfo);
                    outputChannel.appendLine(
                        `[Docker Discovery] Added container: ${containerInfo.containerName} ` +
                        `(${containerInfo.image}) on port ${containerInfo.port}`
                    );
                }
            } catch (parseError) {
                outputChannel.appendLine(`[Docker Discovery] Error parsing container line: ${parseError}`);
            }
        }

        outputChannel.appendLine(`[Docker Discovery] Discovery complete. Found ${containers.length} SQL Server container(s)`);
    } catch (error) {
        outputChannel.appendLine(`[Docker Discovery] Error during discovery: ${error}`);
    }

    return containers;
}
