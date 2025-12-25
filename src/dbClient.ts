import * as os from 'os';

// Lightweight abstraction over two strategies:
// - 'mssql' ConnectionPool for SQL auth
// - 'msnodesqlv8' direct queries for Windows Integrated auth

export interface DBRequest {
    query(sql: string): Promise<any>;
    execute?(proc: string, params?: any): Promise<any>;
    cancel?(): void;
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

// Cache for the last working ODBC driver
let cachedWorkingDriver: string | null = null;
let extensionContext: any = null;

export function initializeDbClient(context: any): void {
    extensionContext = context;
    console.log('[ODBC] DbClient initialized with extension context');
}

export function setCachedOdbcDriver(driver: string): void {
    cachedWorkingDriver = driver;
    console.log(`[ODBC] Cached working driver: ${driver}`);
    
    // Persist to storage if context is available
    if (extensionContext) {
        extensionContext.globalState.update('mssqlManager.cachedOdbcDriver', driver)
            .then(() => {
                console.log(`[ODBC] Driver cached to storage: ${driver}`);
            })
            .catch((err: any) => {
                console.error(`[ODBC] Failed to cache driver to storage:`, err);
            });
    }
}

export function getCachedOdbcDriver(): string | null {
    return cachedWorkingDriver;
}

// Create a connection string suitable for msnodesqlv8 when using Windows auth
function buildMsNodeSqlv8ConnectionString(cfg: any, driver: string) {
    const server = cfg.server || cfg.dataSource || 'localhost';
    const database = cfg.database;

    console.log(`[ODBC] Building connection string with driver: ${driver}`);
    
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

        // List of drivers to try in order
        const allDrivers = [
            'ODBC Driver 18 for SQL Server',
            'ODBC Driver 17 for SQL Server',
            'ODBC Driver 13.1 for SQL Server',
            'ODBC Driver 13 for SQL Server',
            'ODBC Driver 11 for SQL Server',
            'SQL Server Native Client 11.0',
            'SQL Server Native Client 10.0',
            'SQL Server'
        ];

        let driversToTry: string[] = [];
        let lastError: any = null;
        
        // If user specified a driver, try only that one
        if (cfg.driver) {
            driversToTry.push(cfg.driver);
        } else {
            // Try cached driver first if available
            const cached = getCachedOdbcDriver();
            if (cached) {
                console.log(`[ODBC] Trying cached driver first: ${cached}`);
                driversToTry.push(cached);
                // Add all other drivers except the cached one
                driversToTry.push(...allDrivers.filter(d => d !== cached));
            } else {
                driversToTry = [...allDrivers];
            }
        }

        for (const driver of driversToTry) {
            try {
                console.log(`[ODBC] Attempting connection with driver: ${driver}`);
                
                const connectionString = cfg.useConnectionString && cfg.connectionString
                    ? cfg.connectionString
                    : buildMsNodeSqlv8ConnectionString(cfg, driver);

                let closed = false;
                let connectionHandle: any = null;

                const pool: DBPool = {
                    connected: false,
                    async connect() {
                        // Test connection by opening and immediately verifying
                        console.log('[msnodesqlv8] Attempting to connect with connection string:', 
                            connectionString.replace(/Password=[^;]+/i, 'Password=***'));
                        
                        return new Promise<void>((resolve, reject) => {
                            try {
                                msnv8.open(connectionString, (err: any, conn: any) => {
                                    if (err) {
                                        console.error('[msnodesqlv8] Connection failed:', err);
                                        console.error('[msnodesqlv8] Error details:', JSON.stringify(err, null, 2));
                                        this.connected = false;
                                        return reject(new Error(`msnodesqlv8 connection failed: ${err.message || JSON.stringify(err)}`));
                                    }
                                    console.log('[msnodesqlv8] Connection established successfully');
                                    connectionHandle = conn;
                                    this.connected = true;
                                    resolve();
                                });
                            } catch (syncErr) {
                                console.error('[msnodesqlv8] Synchronous error during open:', syncErr);
                                this.connected = false;
                                reject(syncErr);
                            }
                        });
                    },
                    async close() {
                        return new Promise<void>((resolve) => {
                            closed = true;
                            this.connected = false;
                            
                            if (connectionHandle) {
                                try {
                                    connectionHandle.close((err: any) => {
                                        if (err) {
                                            // Log but don't throw - we're closing anyway
                                            console.warn('[msnodesqlv8] Warning during close:', err);
                                        }
                                        connectionHandle = null;
                                        resolve();
                                    });
                                } catch (err) {
                                    // Ignore errors during close
                                    connectionHandle = null;
                                    resolve();
                                }
                            } else {
                                resolve();
                            }
                        });
                    },
                    request() {
                        return {
                            query(sqlText: string) {
                                return new Promise((resolve, reject) => {
                                    if (closed || !connectionHandle) {
                                        console.error('[msnodesqlv8] Query attempted on closed/unestablished connection');
                                        return reject(new Error('Connection closed or not established'));
                                    }
                                    
                                    console.log('[msnodesqlv8] Executing query:', sqlText.substring(0, 100));
                                    console.log(`[msnodesqlv8] Query input length: ${sqlText.length}`);
                                    
                                    // Split by GO statements (SQL Server batch separator)
                                    // GO must be separated from other statements (preceded and followed by newline or string boundaries)
                                    const goRegex = /(?:^|[\r\n]+)\s*GO\s*(?:--[^\r\n]*)?(?=[\r\n]+|$)/gmi;
                                    
                                    // Test if GO exists in the query
                                    const hasGo = goRegex.test(sqlText);
                                    goRegex.lastIndex = 0; // Reset regex state after test
                                    
                                    const batches = sqlText.split(goRegex)
                                        .map(batch => batch.trim())
                                        .filter(batch => batch.length > 0);
                                    
                                    // If split resulted in only 1 batch, it means no GO was found
                                    if (batches.length <= 1) {
                                        
                                        // Set timeout based on configuration (0 means no timeout)
                                        const timeoutMs = cfg.queryTimeout > 0 ? cfg.queryTimeout * 1000 : 0;
                                        const queryOptions = timeoutMs > 0 ? { timeoutMs } : {};
                                        
                                        const recordsets: any[][] = [];
                                        
                                        const queryCallback = (err: any, rows: any, more: boolean) => {
                                            if (err) { 
                                                console.error('[msnodesqlv8] Query error:', err);
                                                return reject(err); 
                                            }
                                            
                                            // Normalize result to match mssql result shape
                                            const recs = Array.isArray(rows) ? rows : (rows ? [rows] : []);
                                            recordsets.push(recs);
                                            
                                            if (!more) {
                                                resolve({ 
                                                    recordset: recordsets[0], 
                                                    recordsets: recordsets, 
                                                    rowsAffected: recordsets.map(r => r.length) 
                                                });
                                            }
                                        };

                                        try {
                                            if (timeoutMs > 0) {
                                                connectionHandle.query(sqlText, queryOptions, queryCallback);
                                            } else {
                                                connectionHandle.query(sqlText, queryCallback);
                                            }
                                        } catch (err) {
                                            reject(err);
                                        }
                                        return;
                                    }
                                    
                                    console.log(`[msnodesqlv8] Split into ${batches.length} batch(es) by GO statements`);
                                    
                                    // Set timeout based on configuration (0 means no timeout)
                                    const timeoutMs = cfg.queryTimeout > 0 ? cfg.queryTimeout * 1000 : 0;
                                    const queryOptions = timeoutMs > 0 ? { timeoutMs } : {};
                                    
                                    const allRecordsets: any[][] = [];
                                    let batchIndex = 0;
                                    
                                    // Execute batches sequentially
                                    const executeBatch = () => {
                                        if (batchIndex >= batches.length) {
                                            // All batches executed successfully
                                            resolve({ 
                                                recordset: allRecordsets[0] || [], 
                                                recordsets: allRecordsets, 
                                                rowsAffected: allRecordsets.map(r => r.length) 
                                            });
                                            return;
                                        }
                                        
                                        const currentBatch = batches[batchIndex];
                                        console.log(`[msnodesqlv8] Executing batch ${batchIndex + 1}/${batches.length}`);
                                        
                                        const recordsets: any[][] = [];
                                        
                                        const queryCallback = (err: any, rows: any, more: boolean) => {
                                            if (err) { 
                                                console.error('[msnodesqlv8] Query error:', err);
                                                return reject(err); 
                                            }
                                            
                                            // Normalize result to match mssql result shape
                                            const recs = Array.isArray(rows) ? rows : (rows ? [rows] : []);
                                            recordsets.push(recs);
                                            
                                            if (!more) {
                                                // Add this batch's recordsets to all recordsets
                                                allRecordsets.push(...recordsets);
                                                
                                                // Move to next batch
                                                batchIndex++;
                                                executeBatch();
                                            }
                                        };

                                        try {
                                            if (timeoutMs > 0) {
                                                connectionHandle.query(currentBatch, queryOptions, queryCallback);
                                            } else {
                                                connectionHandle.query(currentBatch, queryCallback);
                                            }
                                        } catch (err) {
                                            reject(err);
                                        }
                                    };
                                    
                                    // Start executing batches
                                    executeBatch();
                                });
                            },
                            execute(proc: string /*, params? */) {
                                // Execute stored procedure by running EXEC procName; params not supported here
                                const execSql = `EXEC ${proc}`;
                                return new Promise((resolve, reject) => {
                                    if (closed || !connectionHandle) { 
                                        return reject(new Error('Connection closed or not established')); 
                                    }
                                    
                                    // Set timeout based on configuration (0 means no timeout)
                                    const timeoutMs = cfg.queryTimeout > 0 ? cfg.queryTimeout * 1000 : 0;
                                    const queryOptions = timeoutMs > 0 ? { timeoutMs } : {};
                                    
                                    const recordsets: any[][] = [];
                                    
                                    const queryCallback = (err: any, rows: any, more: boolean) => {
                                        if (err) { return reject(err); }
                                        
                                        const recs = Array.isArray(rows) ? rows : (rows ? [rows] : []);
                                        recordsets.push(recs);
                                        
                                        if (!more) {
                                            resolve({ 
                                                recordset: recordsets[0], 
                                                recordsets: recordsets, 
                                                rowsAffected: recordsets.map(r => r.length) 
                                            });
                                        }
                                    };

                                    try {
                                        if (timeoutMs > 0) {
                                            connectionHandle.query(execSql, queryOptions, queryCallback);
                                        } else {
                                            connectionHandle.query(execSql, queryCallback);
                                        }
                                    } catch (err) {
                                        reject(err);
                                    }
                                });
                            },
                            cancel() {
                                // Cancellation not yet implemented for msnodesqlv8 wrapper
                                // We just prevent the crash here
                            }
                        } as DBRequest;
                    }
                };

                // Try to connect with this driver
                try {
                    await pool.connect();
                    console.log(`[ODBC] Successfully connected using driver: ${driver}`);
                    
                    // Cache this working driver for future connections (if not user-specified)
                    if (!cfg.driver) {
                        setCachedOdbcDriver(driver);
                    }
                    
                    // Success! Return this pool
                    return pool;
                } catch (connectErr) {
                    // This driver didn't work, try the next one
                    lastError = connectErr;
                    const errMsg = connectErr instanceof Error ? connectErr.message : String(connectErr);
                    
                    // Check if it's a driver not found error
                    if (errMsg.includes('Data source name not found') || errMsg.includes('IM002')) {
                        console.log(`[ODBC] Driver '${driver}' not found, trying next driver...`);
                        continue;
                    } else {
                        // It's a different error (like authentication), don't try other drivers
                        console.error(`[ODBC] Connection failed with driver '${driver}':`, errMsg);
                        throw connectErr;
                    }
                }
            } catch (err) {
                lastError = err;
                // If this is not a "driver not found" error, rethrow immediately
                const errMsg = err instanceof Error ? err.message : String(err);
                if (!errMsg.includes('Data source name not found') && !errMsg.includes('IM002')) {
                    throw err;
                }
            }
        }

        // If we get here, none of the drivers worked
        const driverList = driversToTry.join(', ');
        throw new Error(
            `Could not connect using any available ODBC driver. Tried: ${driverList}. ` +
            `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}. ` +
            `Please install an ODBC driver for SQL Server from: https://docs.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server`
        );
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
                async query(sqlText: string) {
                    console.log(`[mssql] Query input length: ${sqlText.length}, first 200 chars:`, sqlText.substring(0, 200).replace(/\r/g, '\\r').replace(/\n/g, '\\n'));
                    
                    // Split by GO statements (SQL Server batch separator)
                    // GO must be separated from other statements (preceded and followed by newline or string boundaries)
                    // This regex looks for GO with optional whitespace, preceded by newline (or start) and followed by newline (or end)
                    const goRegex = /(?:^|[\r\n]+)\s*GO\s*(?:--[^\r\n]*)?(?=[\r\n]+|$)/gmi;
                    
                    // Test if GO exists in the query
                    const hasGo = goRegex.test(sqlText);
                    goRegex.lastIndex = 0; // Reset regex state after test
                    
                    if (!hasGo) {
                        return request.query(sqlText);
                    }
                    
                    const batches = sqlText.split(goRegex)
                        .map(batch => batch.trim())
                        .filter(batch => batch.length > 0);
                    
                    console.log(`[mssql] Split into ${batches.length} batch(es) by GO statements`);
                    batches.forEach((batch, idx) => {
                        console.log(`[mssql] Batch ${idx + 1} length: ${batch.length}, starts: ${batch.substring(0, 50).replace(/\r/g, '\\r').replace(/\n/g, '\\n')}`);
                    });
                    
                    if (batches.length <= 1) {
                        console.log('[mssql] Only 1 batch after split, executing as single query');
                        return request.query(sqlText);
                    }
                    
                    // Multiple batches - execute sequentially and aggregate results
                    const allRecordsets: any[][] = [];
                    const allRowsAffected: number[] = [];
                    
                    for (let i = 0; i < batches.length; i++) {
                        const batch = batches[i];
                        console.log(`[mssql] Executing batch ${i + 1}/${batches.length}`);
                        const batchRequest = poolInstance.request();
                        if ((request as any).arrayRowMode) {
                            (batchRequest as any).arrayRowMode = true;
                        }
                        
                        const result = await batchRequest.query(batch);
                        
                        // Aggregate recordsets
                        if (result.recordsets && result.recordsets.length > 0) {
                            allRecordsets.push(...result.recordsets);
                        } else if (result.recordset) {
                            allRecordsets.push(result.recordset);
                        }
                        
                        // Aggregate rows affected
                        if (Array.isArray(result.rowsAffected)) {
                            allRowsAffected.push(...result.rowsAffected);
                        } else if (typeof result.rowsAffected === 'number') {
                            allRowsAffected.push(result.rowsAffected);
                        }
                    }
                    
                    // Return aggregated results in mssql format
                    return {
                        recordset: allRecordsets[0] || [],
                        recordsets: allRecordsets,
                        rowsAffected: allRowsAffected,
                        output: {},
                        returnValue: 0
                    };
                },
                execute(proc: string, params?: any) {
                    // Primitive execute wrapper: attach params if provided
                    if (params && typeof params === 'object') {
                        for (const [k, v] of Object.entries(params)) {
                            request.input(k, v as any);
                        }
                    }
                    return request.execute(proc);
                },
                cancel() {
                    request.cancel();
                }
            } as DBRequest;
        }
    };

    return wrapped;
}
