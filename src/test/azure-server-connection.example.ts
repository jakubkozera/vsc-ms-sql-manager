/**
 * Test example: Azure server connection with empty database
 * 
 * This example shows how Azure SQL Server connections should work
 * with empty database string instead of 'master'
 */

// Simulated Azure connection from discovery
const azureConnection = {
    id: 'azure-12345-myserver',
    name: 'myserver [Try user: sqladmin]',
    server: 'myserver.database.windows.net',
    database: '', // Empty - user chooses database after connecting
    authType: 'sql',
    username: 'sqladmin',
    password: 'password123',
    encrypt: true,
    trustServerCertificate: false,
    port: 1433,
    serverGroup: 'Azure',
    connectionType: 'server' // This triggers server-level connection logic
};

// Expected connection string behavior:
// OLD: Server=myserver.database.windows.net;Database=master;User ID=sqladmin;Password=password123;
// NEW: Server=myserver.database.windows.net;Database=;User ID=sqladmin;Password=password123;

// This allows the user to:
// 1. Connect to the server without specifying a specific database
// 2. Choose any available database after connecting
// 3. Access all databases on the server (if permissions allow)

console.log('Azure connection example:', azureConnection);