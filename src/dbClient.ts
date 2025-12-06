import * as os from 'os';

// Lightweight abstraction over two strategies:
// - 'mssql' ConnectionPool for SQL auth
// - 'msnodesqlv8' direct queries for Windows Integrated auth

export interface DBRequest {
    query(sql: string): Promise<any>;
    execute?(proc: string, params?: any): Promise<any>;
    // mssql.Request has `input` for parameters; optional here for msnodesqlv8 wrapper
    input?: (name: string, value: any) => void;
    setArrayRowMode?(enabled: boolean): void;
}

export interface DBPool {
    connect(): Promise<void>;
    close(): Promise<void>;
    request(): DBRequest;
    connected: boolean;
}

// Create a connection string suitable for msnodesqlv8 when using Windows auth
function buildMsNodeSqlv8ConnectionString(cfg: any) {
    // Prefer ODBC Driver 17+ if running on modern systems, fallback to SQL Server Native Client
    const driver = cfg.driver || 'ODBC Driver 17 for SQL Server';
    const server = cfg.server || cfg.dataSource || 'localhost';
    const database = cfg.database;

    // Build connection string with SSL settings optimized for SQL Server Express
    let connectionString = `Driver={${driver}};Server=${server};`;
    if (database && database.trim() !== '') {
        connectionString += `Database=${database};`;
    }
    connectionString += 'Trusted_Connection=Yes;';
    
    // Add SSL settings for SQL Server Express compatibility
    connectionString += 'Encrypt=No;TrustServerCertificate=Yes;';
    
    return connectionString;
}

export async function createPoolForConfig(cfg: any): Promise<DBPool> {
    // If explicitly using a connection string and authType===windows, prefer msnodesqlv8
    if (cfg.authType === 'windows') {
        // Lazy require so bundlers don't force inclusion unless used at runtime
        // Try to require msnodesqlv8 dynamically so bundlers don't try to resolve it at build-time
        let msnv8: any;
        try {
            // use eval to hide from bundlers
            const req: any = eval('require');
            msnv8 = req('msnodesqlv8');
        } catch (err) {
            throw new Error('msnodesqlv8 driver is required for Windows authentication connections. Please install msnodesqlv8.');
        }

        const connectionString = cfg.useConnectionString && cfg.connectionString
            ? cfg.connectionString
            : buildMsNodeSqlv8ConnectionString(cfg);

        let closed = false;

        const pool: DBPool = {
            connected: false,
            async connect() {
                // msnodesqlv8 does not have an explicit connect for pooled usage here — mark connected
                this.connected = true;
            },
            async close() {
                closed = true;
                this.connected = false;
            },
            request() {
                return {
                    query(sqlText: string) {
                        return new Promise((resolve, reject) => {
                            if (closed) {
                                return reject(new Error('Connection closed'));
                            }
                            
                            // Set timeout based on configuration (0 means no timeout)
                            const timeoutMs = cfg.queryTimeout > 0 ? cfg.queryTimeout * 1000 : 0;
                            const queryOptions = timeoutMs > 0 ? { timeoutMs } : {};
                            
                            if (timeoutMs > 0) {
                                msnv8.query(connectionString, sqlText, queryOptions, (err: any, rows: any) => {
                                    if (err) { return reject(err); }
                                    // Normalize result to match mssql result shape
                                    const recs = Array.isArray(rows) ? rows : (rows ? [rows] : []);
                                    resolve({ recordset: recs, recordsets: [recs], rowsAffected: [recs.length] });
                                });
                            } else {
                                // No timeout
                                msnv8.query(connectionString, sqlText, (err: any, rows: any) => {
                                    if (err) { return reject(err); }
                                    // Normalize result to match mssql result shape
                                    const recs = Array.isArray(rows) ? rows : (rows ? [rows] : []);
                                    resolve({ recordset: recs, recordsets: [recs], rowsAffected: [recs.length] });
                                });
                            }
                        });
                    },
                    execute(proc: string /*, params? */) {
                        // Execute stored procedure by running EXEC procName; params not supported here
                        const execSql = `EXEC ${proc}`;
                        return new Promise((resolve, reject) => {
                            if (closed) { return reject(new Error('Connection closed')); }
                            
                            // Set timeout based on configuration (0 means no timeout)
                            const timeoutMs = cfg.queryTimeout > 0 ? cfg.queryTimeout * 1000 : 0;
                            const queryOptions = timeoutMs > 0 ? { timeoutMs } : {};
                            
                            if (timeoutMs > 0) {
                                msnv8.query(connectionString, execSql, queryOptions, (err: any, rows: any) => {
                                    if (err) { return reject(err); }
                                    const recs = Array.isArray(rows) ? rows : (rows ? [rows] : []);
                                    resolve({ recordset: recs, recordsets: [recs], rowsAffected: [recs.length] });
                                });
                            } else {
                                // No timeout
                                msnv8.query(connectionString, execSql, (err: any, rows: any) => {
                                    if (err) { return reject(err); }
                                    const recs = Array.isArray(rows) ? rows : (rows ? [rows] : []);
                                    resolve({ recordset: recs, recordsets: [recs], rowsAffected: [recs.length] });
                                });
                            }
                        });
                    }
                } as DBRequest;
            }
        };

        return pool;
    }

    // Default: use mssql ConnectionPool for SQL auth or other types
    const mssql = require('mssql');

    const mssqlConfig: any = {};
    if (cfg.connectionString && cfg.useConnectionString) {
        mssqlConfig.connectionString = cfg.connectionString;
    } else {
        mssqlConfig.server = cfg.server;
        if (cfg.database && cfg.database.trim() !== '') {
            mssqlConfig.database = cfg.database;
        }
        mssqlConfig.options = {
            encrypt: cfg.encrypt === true, // Default to false for SQL Server Express
            trustServerCertificate: cfg.trustServerCertificate !== false,
            enableArithAbort: true // Required for some SQL Server versions
        };
        if (cfg.port) {
            mssqlConfig.port = cfg.port;
        }
        if (cfg.authType === 'sql') {
            mssqlConfig.user = cfg.username;
            mssqlConfig.password = cfg.password;
        }
    }

    // Set request timeout based on configuration (0 means no timeout)
    if (cfg.queryTimeout > 0) {
        mssqlConfig.requestTimeout = cfg.queryTimeout * 1000; // Convert seconds to milliseconds
    } else {
        mssqlConfig.requestTimeout = 0; // No timeout
    }

    const poolInstance = new mssql.ConnectionPool(mssqlConfig);

    const wrapped: DBPool = {
        connected: false,
        async connect() {
            await poolInstance.connect();
            this.connected = poolInstance.connected;
        },
        async close() {
            try {
                await poolInstance.close();
            } finally {
                this.connected = false;
            }
        },
        request() {
            const request = poolInstance.request();
            return {
                setArrayRowMode(enabled: boolean) {
                    (request as any).arrayRowMode = enabled;
                },
                query(sqlText: string) {
                    return request.query(sqlText);
                },
                execute(proc: string, params?: any) {
                    // Primitive execute wrapper: attach params if provided
                    if (params && typeof params === 'object') {
                        for (const [k, v] of Object.entries(params)) {
                            request.input(k, v as any);
                        }
                    }
                    return request.execute(proc);
                }
            } as DBRequest;
        }
    };

    return wrapped;
}
