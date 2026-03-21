import * as vscode from 'vscode';
import { ConnectionProvider } from './connectionProvider';
import { QueryExecutor } from './queryExecutor';
import { DBPool } from './dbClient';

interface DashboardOverview {
    serverName: string;
    databaseName: string;
    sampledAt: string;
    cpuUtilizationPct: number;
    memoryUtilizationPct: number;
    topWaitType: string;
    topWaitMs: number;
    blockingSessions: number;
    runningJobs: number;
}

interface TrendPoint {
    sampledAt: string;
    value: number;
}

interface DashboardTrends {
    cpu: TrendPoint[];
    memory: TrendPoint[];
    blocking: TrendPoint[];
}

interface ServerHealthCard {
    connectionId: string;
    name: string;
    server: string;
    database: string;
    cpuUtilizationPct: number;
    memoryUtilizationPct: number;
    blockingSessions: number;
    status: 'healthy' | 'warning' | 'critical';
}

interface DbStorage {
    usedMb: number;
    allocatedMb: number;
    maxMb: number;
    usedPct: number;
}

interface DashboardPayload {
    overview: DashboardOverview;
    trends: DashboardTrends;
    servers: ServerHealthCard[];
    storage: DbStorage;
}

interface DashboardMessage {
    type: string;
    intervalSeconds?: number;
}

export class PerformanceDashboardWebview {
    private panel: vscode.WebviewPanel | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;
    private refreshIntervalSeconds = 15;
    private connectionId: string | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly connectionProvider: ConnectionProvider,
        private readonly queryExecutor: QueryExecutor,
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    public show(connectionId?: string): void {
        this.connectionId = connectionId;
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            // Re-push snapshot with the potentially new connection
            void this.pushSnapshot();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'mssqlManager.performanceDashboard',
            'SQL Performance Dashboard',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'webview')
                ]
            }
        );

        this.panel.iconPath = {
            light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'database-light.svg'),
            dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'database-dark.svg')
        };

        this.panel.webview.html = this.getHtml(this.panel.webview);

        this.panel.webview.onDidReceiveMessage(async (message: DashboardMessage) => {
            await this.handleMessage(message);
        });

        this.panel.onDidDispose(() => {
            this.stopRefreshTimer();
            this.panel = undefined;
        });

        this.startRefreshTimer();
    }

    private async handleMessage(message: DashboardMessage): Promise<void> {
        switch (message.type) {
            case 'ready':
                await this.pushSnapshot();
                break;
            case 'refreshNow':
                await this.pushSnapshot();
                break;
            case 'setRefreshInterval':
                if (typeof message.intervalSeconds === 'number') {
                    const normalized = Math.max(5, Math.min(120, Math.floor(message.intervalSeconds)));
                    this.refreshIntervalSeconds = normalized;
                    this.startRefreshTimer();
                    this.outputChannel.appendLine(`[PerformanceDashboard] Refresh interval set to ${normalized}s`);
                }
                break;
            default:
                break;
        }
    }

    private startRefreshTimer(): void {
        this.stopRefreshTimer();
        this.refreshTimer = setInterval(() => {
            void this.pushSnapshot();
        }, this.refreshIntervalSeconds * 1000);
    }

    private stopRefreshTimer(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
    }

    private async pushSnapshot(): Promise<void> {
        if (!this.panel) {
            return;
        }

        try {
            const payload = await this.fetchDashboardPayload();
            if (!payload) {
                this.panel.webview.postMessage({
                    type: 'dashboardError',
                    error: 'No active SQL connection. Connect to a server first.'
                });
                return;
            }

            this.panel.webview.postMessage({
                type: 'dashboardSnapshot',
                data: payload
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown dashboard error';
            this.outputChannel.appendLine(`[PerformanceDashboard] Snapshot error: ${message}`);
            this.panel.webview.postMessage({
                type: 'dashboardError',
                error: message
            });
        }
    }

    private resolveConnection(): { connection: DBPool; connectionId: string } | null {
        // 1. Use explicitly requested connection ID (from right-click context menu)
        if (this.connectionId) {
            const conn = this.connectionProvider.getConnection(this.connectionId);
            if (conn) {
                return { connection: conn, connectionId: this.connectionId };
            }
        }
        // 2. Fall back to whichever connection is currently active (last clicked)
        const active = this.connectionProvider.getActiveConnectionInfo();
        if (active) {
            const conn = this.connectionProvider.getConnection(active.id);
            if (conn) {
                return { connection: conn, connectionId: active.id };
            }
        }
        // 3. Use the first available connection when nothing is explicitly active
        const all = this.connectionProvider.getAllActiveConnections();
        if (all.length > 0) {
            return { connection: all[0].connection, connectionId: all[0].id };
        }
        return null;
    }

    private async fetchDashboardPayload(): Promise<DashboardPayload | null> {
        const resolved = this.resolveConnection();
        if (!resolved) {
            return null;
        }
        const { connection, connectionId } = resolved;
        const activeConfig = this.connectionProvider.getConnectionConfig(connectionId);
        if (!activeConfig) {
            return null;
        }

        // CPU — from ring buffer (works on SQL Server on-prem and Azure SQL DB)
        const cpuResult = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT TOP (1)
    sql_cpu_pct = ISNULL(CAST(CAST(rb.record AS xml).value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS int), 0)
FROM sys.dm_os_ring_buffers AS rb
WHERE rb.ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
AND rb.record LIKE N'%<SystemHealth>%'
ORDER BY rb.timestamp DESC;
`, connection, undefined, true);

        // Memory — sys.dm_os_sys_memory is only available on SQL Server on-prem, not Azure SQL DB
        let totalMemoryMb = 0;
        let availableMemoryMb = 0;
        try {
            const memResult = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT TOP (1)
    total_memory_mb = ISNULL(CAST(total_physical_memory_kb / 1024 AS bigint), 0),
    available_memory_mb = ISNULL(CAST(available_physical_memory_kb / 1024 AS bigint), 0)
FROM sys.dm_os_sys_memory;
`, connection, undefined, true);
            const memRow = memResult.recordsets[0]?.[0] as unknown[] | undefined;
            totalMemoryMb = this.toNumber(memRow?.[0]);
            availableMemoryMb = this.toNumber(memRow?.[1]);
        } catch {
            // Azure SQL DB does not expose sys.dm_os_sys_memory — memory stays at 0
        }

        const waitStats = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT TOP (1)
    wait_type,
    wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_type NOT LIKE N'SLEEP%'
AND wait_type NOT IN (N'BROKER_EVENTHANDLER', N'BROKER_RECEIVE_WAITFOR', N'BROKER_TASK_STOP', N'BROKER_TO_FLUSH', N'BROKER_TRANSMITTER', N'CHECKPOINT_QUEUE', N'CLR_AUTO_EVENT', N'CLR_MANUAL_EVENT', N'DBMIRROR_EVENTS_QUEUE', N'FT_IFTS_SCHEDULER_IDLE_WAIT', N'LAZYWRITER_SLEEP', N'LOGMGR_QUEUE', N'ONDEMAND_TASK_QUEUE', N'REQUEST_FOR_DEADLOCK_SEARCH', N'SLEEP_TASK', N'SQLTRACE_BUFFER_FLUSH', N'WAITFOR', N'XE_DISPATCHER_JOIN', N'XE_DISPATCHER_WAIT', N'XE_TIMER_EVENT')
ORDER BY wait_time_ms DESC;
`, connection, undefined, true);

        const blocking = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT
    blocking_sessions = COUNT(*)
FROM sys.dm_exec_requests
WHERE blocking_session_id > 0;
`, connection, undefined, true);

        const runningJobs = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

BEGIN TRY
    EXEC sp_executesql N'SELECT running_jobs = COUNT(*) FROM msdb.dbo.sysjobactivity AS sja WHERE sja.start_execution_date IS NOT NULL AND sja.stop_execution_date IS NULL;';
END TRY
BEGIN CATCH
    SELECT running_jobs = 0;
END CATCH;
`, connection, undefined, true);

        const cpuRow = cpuResult.recordsets[0]?.[0] as unknown[] | undefined;
        const waitRow = waitStats.recordsets[0]?.[0] as unknown[] | undefined;
        const blockingRow = blocking.recordsets[0]?.[0] as unknown[] | undefined;
        const jobsRow = runningJobs.recordsets[0]?.[0] as unknown[] | undefined;

        const sqlCpu = this.toNumber(cpuRow?.[0]);
        const usedMemoryPct = totalMemoryMb > 0
            ? Math.max(0, Math.min(100, Math.round(((totalMemoryMb - availableMemoryMb) / totalMemoryMb) * 100)))
            : 0;

        const overview: DashboardOverview = {
            serverName: activeConfig.server,
            databaseName: this.connectionProvider.getCurrentDatabase(connectionId) || activeConfig.database || 'master',
            sampledAt: new Date().toISOString(),
            cpuUtilizationPct: sqlCpu,
            memoryUtilizationPct: usedMemoryPct,
            topWaitType: this.toString(waitRow?.[0], 'N/A'),
            topWaitMs: this.toNumber(waitRow?.[1]),
            blockingSessions: this.toNumber(blockingRow?.[0]),
            runningJobs: this.toNumber(jobsRow?.[0])
        };

        const [cpuTrend, memoryTrend, blockingTrend, servers, storage] = await Promise.all([
            this.fetchCpuTrend(connection),
            this.fetchMemoryTrend(connection),
            this.fetchBlockingTrend(connection),
            this.fetchServerHealthCards(),
            this.fetchStorageInfo(connection),
        ]);

        return {
            overview,
            trends: {
                cpu: cpuTrend,
                memory: memoryTrend,
                blocking: blockingTrend,
            },
            servers,
            storage,
        };
    }

    private async fetchCpuTrend(connection: DBPool): Promise<TrendPoint[]> {
        try {
            const result = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

IF OBJECT_ID(N'collect.cpu_utilization_stats', N'U') IS NOT NULL
BEGIN
    SELECT TOP (24)
        sampled_at = collection_time,
        metric_value = CONVERT(float, sqlserver_cpu_utilization)
    FROM collect.cpu_utilization_stats
    ORDER BY collection_time DESC;
END
ELSE
BEGIN
    SELECT TOP (24)
        sampled_at = DATEADD(ms, -1 * (si.ms_ticks - rb.timestamp), SYSUTCDATETIME()),
        metric_value = CONVERT(float, CAST(rb.record AS xml).value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int'))
    FROM sys.dm_os_ring_buffers AS rb
    CROSS JOIN sys.dm_os_sys_info AS si
    WHERE rb.ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
    AND rb.record LIKE N'%<SystemHealth>%'
    ORDER BY rb.timestamp DESC;
END
`, connection, undefined, true);

            return this.mapTrendRows(result.recordsets[0]);
        } catch {
            return [];
        }
    }

    private async fetchMemoryTrend(connection: DBPool): Promise<TrendPoint[]> {
        try {
            const result = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

IF OBJECT_ID(N'collect.memory_stats', N'U') IS NOT NULL
BEGIN
    SELECT TOP (24)
        sampled_at = collection_time,
        metric_value = CONVERT(float, memory_utilization_percentage)
    FROM collect.memory_stats
    ORDER BY collection_time DESC;
END
ELSE
BEGIN
    SELECT
        sampled_at = SYSUTCDATETIME(),
        metric_value = CONVERT(float,
            CASE
                WHEN os.total_physical_memory_kb > 0
                THEN ((os.total_physical_memory_kb - os.available_physical_memory_kb) * 100.0) / os.total_physical_memory_kb
                ELSE 0
            END
        )
    FROM sys.dm_os_sys_memory AS os;
END
`, connection, undefined, true);

            return this.mapTrendRows(result.recordsets[0]);
        } catch {
            return [];
        }
    }

    private async fetchBlockingTrend(connection: DBPool): Promise<TrendPoint[]> {
        try {
            const result = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

IF OBJECT_ID(N'collect.blocking_deadlock_stats', N'U') IS NOT NULL
BEGIN
    SELECT TOP (24)
        sampled_at = collection_time,
        metric_value = CONVERT(float, SUM(ISNULL(blocking_event_count_delta, blocking_event_count)))
    FROM collect.blocking_deadlock_stats
    GROUP BY collection_time
    ORDER BY collection_time DESC;
END
ELSE
BEGIN
    SELECT
        sampled_at = SYSUTCDATETIME(),
        metric_value = CONVERT(float, COUNT(*))
    FROM sys.dm_exec_requests
    WHERE blocking_session_id > 0;
END
`, connection, undefined, true);

            return this.mapTrendRows(result.recordsets[0]);
        } catch {
            return [];
        }
    }

    private mapTrendRows(rows: unknown[] | undefined): TrendPoint[] {
        const trendRows = Array.isArray(rows) ? rows : [];
        const points: TrendPoint[] = [];

        for (const row of trendRows) {
            const valueRow = row as unknown[];
            points.push({
                sampledAt: this.toString(valueRow[0], new Date().toISOString()),
                value: this.toNumber(valueRow[1]),
            });
        }

        return points.reverse();
    }

    private async fetchStorageInfo(connection: DBPool): Promise<DbStorage> {
        const fallback: DbStorage = { usedMb: 0, allocatedMb: 0, maxMb: 0, usedPct: 0 };
        try {
            // Single query: page counts from sys.dm_db_file_space_usage (SQL Server 2008+ and Azure SQL DB)
            // Max size via DATABASEPROPERTYEX — works on both on-prem and Azure SQL DB without
            // requiring cross-database access or edition-specific DMVs.
            const result = await this.queryExecutor.executeQuery(`
SELECT
    used_mb      = CAST(SUM(u.used_extent_page_count)      * 8.0 / 1024 AS decimal(18,2)),
    allocated_mb = CAST(SUM(u.allocated_extent_page_count) * 8.0 / 1024 AS decimal(18,2)),
    max_mb       = CAST(ISNULL(
                       CAST(DATABASEPROPERTYEX(DB_NAME(), N'MaxSizeInBytes') AS bigint) / 1048576.0,
                       0
                   ) AS decimal(18,2))
FROM sys.dm_db_file_space_usage AS u;
`, connection, undefined, true);

            const row = result.recordsets[0]?.[0] as unknown[] | undefined;
            if (!row) {
                return fallback;
            }

            const usedMb = this.toDecimal(row[0]);
            const allocatedMb = this.toDecimal(row[1]);
            const maxMb = this.toDecimal(row[2]);
            const usedPct = maxMb > 0 ? Math.max(0, Math.min(100, Math.round((usedMb / maxMb) * 100))) : 0;

            return { usedMb, allocatedMb, maxMb, usedPct };
        } catch {
            return fallback;
        }
    }

    private async fetchServerHealthCards(): Promise<ServerHealthCard[]> {
        const activeConnections = this.connectionProvider.getAllActiveConnections();
        const cards: ServerHealthCard[] = [];

        for (const entry of activeConnections) {
            try {
                const cpuResult = await this.queryExecutor.executeQuery(`
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT TOP (1)
    sql_cpu_pct = ISNULL(CAST(CAST(rb.record AS xml).value('(./Record/SchedulerMonitorEvent/SystemHealth/ProcessUtilization)[1]', 'int') AS int), 0),
    blocking_sessions = (SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id > 0)
FROM sys.dm_os_ring_buffers AS rb
WHERE rb.ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
AND rb.record LIKE N'%<SystemHealth>%'
ORDER BY rb.timestamp DESC;
`, entry.connection, undefined, true);

                const cpuRow = cpuResult.recordsets[0]?.[0] as unknown[] | undefined;
                const cpu = this.toNumber(cpuRow?.[0]);
                const blocking = this.toNumber(cpuRow?.[1]);

                let memory = 0;
                try {
                    const memResult = await this.queryExecutor.executeQuery(`
SELECT TOP (1)
    total_memory_mb = ISNULL(CAST(total_physical_memory_kb / 1024 AS bigint), 0),
    available_memory_mb = ISNULL(CAST(available_physical_memory_kb / 1024 AS bigint), 0)
FROM sys.dm_os_sys_memory;
`, entry.connection, undefined, true);
                    const memRow = memResult.recordsets[0]?.[0] as unknown[] | undefined;
                    const totalMb = this.toNumber(memRow?.[0]);
                    const availMb = this.toNumber(memRow?.[1]);
                    memory = totalMb > 0
                        ? Math.max(0, Math.min(100, Math.round(((totalMb - availMb) / totalMb) * 100)))
                        : 0;
                } catch {
                    // Azure SQL DB — memory not available
                }

                cards.push({
                    connectionId: entry.id,
                    name: entry.config.name,
                    server: entry.config.server,
                    database: this.connectionProvider.getCurrentDatabase(entry.id) || entry.config.database || 'master',
                    cpuUtilizationPct: cpu,
                    memoryUtilizationPct: memory,
                    blockingSessions: blocking,
                    status: this.calculateStatus(cpu, memory, blocking),
                });
            } catch {
                cards.push({
                    connectionId: entry.id,
                    name: entry.config.name,
                    server: entry.config.server,
                    database: entry.config.database || 'master',
                    cpuUtilizationPct: 0,
                    memoryUtilizationPct: 0,
                    blockingSessions: 0,
                    status: 'warning',
                });
            }
        }

        return cards;
    }

    private calculateStatus(cpu: number, memory: number, blocking: number): 'healthy' | 'warning' | 'critical' {
        if (blocking > 0 || cpu >= 85 || memory >= 90) {
            return 'critical';
        }
        if (cpu >= 65 || memory >= 75) {
            return 'warning';
        }
        return 'healthy';
    }

    private toNumber(value: unknown): number {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string') {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                return parsed;
            }
        }
        return 0;
    }

    private toDecimal(value: unknown): number {
        const n = this.toNumber(value);
        return Math.round(n * 100) / 100;
    }

    private toString(value: unknown, fallback: string): string {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value;
        }
        return fallback;
    }

    private getHtml(webview: vscode.Webview): string {
        const cacheBuster = Date.now();
        const reactDistPath = vscode.Uri.joinPath(this.context.extensionUri, 'webview', 'sqlEditor-react', 'dist');
        const scriptPath = vscode.Uri.joinPath(reactDistPath, 'performanceDashboard.js');
        const stylePath = vscode.Uri.joinPath(reactDistPath, 'performanceDashboard.css');
        const globalScriptPath = vscode.Uri.joinPath(reactDistPath, 'global.js');
        const globalStylePath = vscode.Uri.joinPath(reactDistPath, 'global.css');

        const scriptUri = webview.asWebviewUri(scriptPath).toString() + `?v=${cacheBuster}`;
        const styleUri = webview.asWebviewUri(stylePath).toString() + `?v=${cacheBuster}`;
        const globalScriptUri = webview.asWebviewUri(globalScriptPath).toString() + `?v=${cacheBuster}`;
        const globalStyleUri = webview.asWebviewUri(globalStylePath).toString() + `?v=${cacheBuster}`;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; 
        style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net; 
        font-src ${webview.cspSource} https://cdn.jsdelivr.net data:; 
        script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net blob:; 
        img-src ${webview.cspSource} data:;
        worker-src blob:;
        connect-src ${webview.cspSource} https://cdn.jsdelivr.net;">
    <title>SQL Performance Dashboard</title>
    <link rel="stylesheet" href="${globalStyleUri}">
    <link rel="stylesheet" href="${styleUri}">
    <link rel="modulepreload" href="${globalScriptUri}">
    <style>
        html, body, #root {
            height: 100%;
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script type="module" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
