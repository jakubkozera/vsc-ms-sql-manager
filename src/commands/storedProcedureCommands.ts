import * as vscode from 'vscode';
import { ConnectionProvider } from '../connectionProvider';
import { ResultWebviewProvider } from '../resultWebview';

export function registerStoredProcedureCommands(
    connectionProvider: ConnectionProvider,
    resultWebviewProvider: ResultWebviewProvider,
    outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // New Stored Procedure... - opens template for creating new procedure
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.newStoredProcedure', async (node) => {
            if (!node || !node.connectionId || !node.database) {
                vscode.window.showErrorMessage('No database selected');
                return;
            }

            const procedureName = await vscode.window.showInputBox({
                prompt: 'Enter stored procedure name',
                placeHolder: 'ProcedureName',
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Procedure name cannot be empty';
                    }
                    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                        return 'Invalid procedure name. Use only letters, numbers, and underscores.';
                    }
                    return null;
                }
            });

            if (!procedureName) {
                return;
            }

            const schema = node.schema || 'dbo';
            const template = `-- Create Stored Procedure: ${schema}.${procedureName}
USE [${node.database}];
GO

CREATE PROCEDURE [${schema}].[${procedureName}]
    -- Add parameters here
    -- @Parameter1 INT,
    -- @Parameter2 NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    -- Add your T-SQL statements here
    -- SELECT @Parameter1, @Parameter2;
END
GO
`;

            const doc = await vscode.workspace.openTextDocument({
                content: template,
                language: 'sql'
            });
            await vscode.window.showTextDocument(doc);
        })
    );

    // Modify - opens procedure code in edit mode (ALTER PROCEDURE)
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.modifyStoredProcedure', async (node) => {
            if (!node || !node.connectionId || !node.database || !node.schema || !node.name) {
                vscode.window.showErrorMessage('Invalid stored procedure node');
                return;
            }

            try {
                const connection = connectionProvider.getConnection(node.connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('Connection not found');
                    return;
                }

                // Get procedure definition
                const query = `
                    SELECT OBJECT_DEFINITION(OBJECT_ID('${node.schema}.${node.name}')) AS definition
                `;

                const result = await connection.request().query(query);
                
                if (result && result.recordset && result.recordset.length > 0 && result.recordset[0].definition) {
                    let definition = result.recordset[0].definition as string;
                    
                    // Replace CREATE with ALTER
                    definition = definition.replace(/CREATE\s+PROCEDURE/i, 'ALTER PROCEDURE');
                    
                    // Add USE database statement
                    const content = `USE [${node.database}];\nGO\n\n${definition}\nGO\n`;

                    const doc = await vscode.workspace.openTextDocument({
                        content: content,
                        language: 'sql'
                    });
                    await vscode.window.showTextDocument(doc);
                } else {
                    vscode.window.showErrorMessage('Could not retrieve procedure definition');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Error retrieving procedure: ${error}`);
                outputChannel.appendLine(`Error in modifyStoredProcedure: ${error}`);
            }
        })
    );

    // Execute Stored Procedure... - runs wizard with parameters
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.executeStoredProcedure', async (node) => {
            if (!node || !node.connectionId || !node.database || !node.schema || !node.name) {
                vscode.window.showErrorMessage('Invalid stored procedure node');
                return;
            }

            try {
                const connection = connectionProvider.getConnection(node.connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('Connection not found');
                    return;
                }

                // Get procedure parameters
                const paramsQuery = `
                    SELECT 
                        p.name AS parameter_name,
                        TYPE_NAME(p.user_type_id) AS data_type,
                        p.max_length,
                        p.is_output
                    FROM sys.parameters p
                    WHERE p.object_id = OBJECT_ID('${node.schema}.${node.name}')
                    ORDER BY p.parameter_id
                `;

                const paramsResult = await connection.request().query(paramsQuery);
                const params = paramsResult.recordset;

                let execStatement = `USE [${node.database}];\nGO\n\nEXEC [${node.schema}].[${node.name}]`;
                
                if (params && params.length > 0) {
                    const paramValues: string[] = [];
                    
                    for (const param of params) {
                        const paramName = param.parameter_name as string;
                        const dataType = param.data_type as string;
                        const isOutput = param.is_output as boolean;
                        
                        const value = await vscode.window.showInputBox({
                            prompt: `Enter value for ${paramName} (${dataType})${isOutput ? ' OUTPUT' : ''}`,
                            placeHolder: isOutput ? 'NULL (will be output parameter)' : 'Enter value'
                        });

                        if (value === undefined) {
                            return; // User cancelled
                        }

                        if (isOutput) {
                            paramValues.push(`${paramName} OUTPUT`);
                        } else {
                            // Add quotes for string types
                            const needsQuotes = ['varchar', 'nvarchar', 'char', 'nchar', 'text', 'ntext', 'datetime', 'date', 'time'].some(t => dataType.toLowerCase().includes(t));
                            paramValues.push(`${paramName} = ${needsQuotes && value !== 'NULL' ? "'" + value + "'" : value}`);
                        }
                    }
                    
                    execStatement += '\n    ' + paramValues.join(',\n    ');
                }
                
                execStatement += ';\nGO\n';

                const doc = await vscode.workspace.openTextDocument({
                    content: execStatement,
                    language: 'sql'
                });
                const editor = await vscode.window.showTextDocument(doc);
                
                // Auto-execute
                await vscode.commands.executeCommand('mssqlManager.executeQuery');
                
            } catch (error) {
                vscode.window.showErrorMessage(`Error executing procedure: ${error}`);
                outputChannel.appendLine(`Error in executeStoredProcedure: ${error}`);
            }
        })
    );

    // Script Stored Procedure as CREATE To New Query Editor Window
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureCreateToWindow', async (node) => {
            await scriptProcedureTo(node, 'CREATE', 'window', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as CREATE To File
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureCreateToFile', async (node) => {
            await scriptProcedureTo(node, 'CREATE', 'file', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as CREATE To Clipboard
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureCreateToClipboard', async (node) => {
            await scriptProcedureTo(node, 'CREATE', 'clipboard', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as ALTER To New Query Editor Window
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureAlterToWindow', async (node) => {
            await scriptProcedureTo(node, 'ALTER', 'window', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as ALTER To File
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureAlterToFile', async (node) => {
            await scriptProcedureTo(node, 'ALTER', 'file', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as ALTER To Clipboard
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureAlterToClipboard', async (node) => {
            await scriptProcedureTo(node, 'ALTER', 'clipboard', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as DROP To New Query Editor Window
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureDropToWindow', async (node) => {
            await scriptProcedureTo(node, 'DROP', 'window', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as DROP To File
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureDropToFile', async (node) => {
            await scriptProcedureTo(node, 'DROP', 'file', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as DROP To Clipboard
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureDropToClipboard', async (node) => {
            await scriptProcedureTo(node, 'DROP', 'clipboard', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as EXECUTE To New Query Editor Window
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureExecuteToWindow', async (node) => {
            await scriptProcedureTo(node, 'EXECUTE', 'window', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as EXECUTE To File
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureExecuteToFile', async (node) => {
            await scriptProcedureTo(node, 'EXECUTE', 'file', connectionProvider, outputChannel);
        })
    );

    // Script Stored Procedure as EXECUTE To Clipboard
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.scriptProcedureExecuteToClipboard', async (node) => {
            await scriptProcedureTo(node, 'EXECUTE', 'clipboard', connectionProvider, outputChannel);
        })
    );

    // View Dependencies
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.viewProcedureDependencies', async (node) => {
            if (!node || !node.connectionId || !node.database || !node.schema || !node.name) {
                vscode.window.showErrorMessage('Invalid stored procedure node');
                return;
            }

            try {
                const connection = connectionProvider.getConnection(node.connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('Connection not found');
                    return;
                }

                const query = `
                    SELECT 
                        OBJECT_SCHEMA_NAME(referencing_id) AS referencing_schema,
                        OBJECT_NAME(referencing_id) AS referencing_object,
                        o.type_desc AS object_type,
                        'References' AS dependency_type
                    FROM sys.sql_expression_dependencies sed
                    INNER JOIN sys.objects o ON sed.referencing_id = o.object_id
                    WHERE referenced_id = OBJECT_ID('${node.schema}.${node.name}')
                    
                    UNION ALL
                    
                    SELECT 
                        OBJECT_SCHEMA_NAME(referenced_id) AS referenced_schema,
                        OBJECT_NAME(referenced_id) AS referenced_object,
                        o.type_desc AS object_type,
                        'Referenced by' AS dependency_type
                    FROM sys.sql_expression_dependencies sed
                    INNER JOIN sys.objects o ON sed.referenced_id = o.object_id
                    WHERE referencing_id = OBJECT_ID('${node.schema}.${node.name}')
                    ORDER BY dependency_type, referencing_schema, referencing_object
                `;

                const result = await connection.request().query(query);
                
                if (result && result.recordset && result.recordset.length > 0) {
                    await resultWebviewProvider.showResults(result.recordset);
                } else {
                    vscode.window.showInformationMessage(`No dependencies found for ${node.schema}.${node.name}`);
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Error retrieving dependencies: ${error}`);
                outputChannel.appendLine(`Error in viewProcedureDependencies: ${error}`);
            }
        })
    );

    // Rename
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.renameStoredProcedure', async (node) => {
            if (!node || !node.connectionId || !node.database || !node.schema || !node.name) {
                vscode.window.showErrorMessage('Invalid stored procedure node');
                return;
            }

            const newName = await vscode.window.showInputBox({
                prompt: 'Enter new stored procedure name',
                value: node.name,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Procedure name cannot be empty';
                    }
                    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
                        return 'Invalid procedure name. Use only letters, numbers, and underscores.';
                    }
                    return null;
                }
            });

            if (!newName || newName === node.name) {
                return;
            }

            try {
                const connection = connectionProvider.getConnection(node.connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('Connection not found');
                    return;
                }

                const query = `EXEC sp_rename '${node.schema}.${node.name}', '${newName}', 'OBJECT'`;
                await connection.request().query(query);
                
                vscode.window.showInformationMessage(`Stored procedure renamed to ${newName}`);
                vscode.commands.executeCommand('mssqlManager.refresh');
            } catch (error) {
                vscode.window.showErrorMessage(`Error renaming procedure: ${error}`);
                outputChannel.appendLine(`Error in renameStoredProcedure: ${error}`);
            }
        })
    );

    // Delete
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.deleteStoredProcedure', async (node) => {
            if (!node || !node.connectionId || !node.database || !node.schema || !node.name) {
                vscode.window.showErrorMessage('Invalid stored procedure node');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to delete stored procedure ${node.schema}.${node.name}?`,
                { modal: true },
                'Delete'
            );

            if (confirm !== 'Delete') {
                return;
            }

            try {
                const connection = connectionProvider.getConnection(node.connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('Connection not found');
                    return;
                }

                const query = `DROP PROCEDURE [${node.schema}].[${node.name}]`;
                await connection.request().query(query);
                
                vscode.window.showInformationMessage(`Stored procedure ${node.name} deleted`);
                vscode.commands.executeCommand('mssqlManager.refresh');
            } catch (error) {
                vscode.window.showErrorMessage(`Error deleting procedure: ${error}`);
                outputChannel.appendLine(`Error in deleteStoredProcedure: ${error}`);
            }
        })
    );

    // Properties
    disposables.push(
        vscode.commands.registerCommand('mssqlManager.showStoredProcedureProperties', async (node) => {
            if (!node || !node.connectionId || !node.database || !node.schema || !node.name) {
                vscode.window.showErrorMessage('Invalid stored procedure node');
                return;
            }

            try {
                const connection = connectionProvider.getConnection(node.connectionId);
                if (!connection) {
                    vscode.window.showErrorMessage('Connection not found');
                    return;
                }

                const query = `
                    SELECT 
                        p.name AS procedure_name,
                        SCHEMA_NAME(p.schema_id) AS schema_name,
                        p.create_date,
                        p.modify_date,
                        USER_NAME(p.principal_id) AS owner,
                        (SELECT COUNT(*) FROM sys.parameters WHERE object_id = p.object_id) AS parameter_count,
                        LEN(OBJECT_DEFINITION(p.object_id)) AS definition_length
                    FROM sys.procedures p
                    WHERE p.object_id = OBJECT_ID('${node.schema}.${node.name}')
                    
                    SELECT 
                        par.name AS parameter_name,
                        TYPE_NAME(par.user_type_id) AS data_type,
                        par.max_length,
                        par.precision,
                        par.scale,
                        par.is_output,
                        par.has_default_value
                    FROM sys.parameters par
                    WHERE par.object_id = OBJECT_ID('${node.schema}.${node.name}')
                    ORDER BY par.parameter_id
                `;

                const result = await connection.request().query(query);
                
                if (result && result.recordset && result.recordset.length > 0) {
                    await resultWebviewProvider.showResults(result.recordset);
                } else {
                    vscode.window.showErrorMessage('Could not retrieve procedure properties');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Error retrieving properties: ${error}`);
                outputChannel.appendLine(`Error in showStoredProcedureProperties: ${error}`);
            }
        })
    );

    return disposables;
}

async function scriptProcedureTo(
    node: any,
    scriptType: 'CREATE' | 'ALTER' | 'DROP' | 'EXECUTE',
    destination: 'window' | 'file' | 'clipboard',
    connectionProvider: ConnectionProvider,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    if (!node || !node.connectionId || !node.database || !node.schema || !node.name) {
        vscode.window.showErrorMessage('Invalid stored procedure node');
        return;
    }

    try {
        const connection = connectionProvider.getConnection(node.connectionId);
        if (!connection) {
            vscode.window.showErrorMessage('Connection not found');
            return;
        }

        let script = '';

        if (scriptType === 'DROP') {
            script = `USE [${node.database}];\nGO\n\nDROP PROCEDURE [${node.schema}].[${node.name}];\nGO\n`;
        } else if (scriptType === 'EXECUTE') {
            // Get parameters for EXEC statement
            const paramsQuery = `
                SELECT 
                    p.name AS parameter_name,
                    TYPE_NAME(p.user_type_id) AS data_type,
                    p.is_output
                FROM sys.parameters p
                WHERE p.object_id = OBJECT_ID('${node.schema}.${node.name}')
                ORDER BY p.parameter_id
            `;

            const paramsResult = await connection.request().query(paramsQuery);
            const params = paramsResult.recordset;

            script = `USE [${node.database}];\nGO\n\nEXEC [${node.schema}].[${node.name}]`;
            
            if (params && params.length > 0) {
                const paramValues: string[] = [];
                for (const param of params) {
                    const paramName = param.parameter_name as string;
                    const dataType = param.data_type as string;
                    const isOutput = param.is_output as boolean;
                    
                    if (isOutput) {
                        paramValues.push(`${paramName} = @${paramName.substring(1)} OUTPUT`);
                    } else {
                        paramValues.push(`${paramName} = <${dataType}, , >`);
                    }
                }
                script += '\n    ' + paramValues.join(',\n    ');
            }
            
            script += ';\nGO\n';
        } else {
            // CREATE or ALTER
            const query = `SELECT OBJECT_DEFINITION(OBJECT_ID('${node.schema}.${node.name}')) AS definition`;
            const result = await connection.request().query(query);
            
            if (result && result.recordset && result.recordset.length > 0 && result.recordset[0].definition) {
                let definition = result.recordset[0].definition as string;
                
                if (scriptType === 'ALTER') {
                    definition = definition.replace(/CREATE\s+PROCEDURE/i, 'ALTER PROCEDURE');
                }
                
                script = `USE [${node.database}];\nGO\n\n${definition}\nGO\n`;
            } else {
                vscode.window.showErrorMessage('Could not retrieve procedure definition');
                return;
            }
        }

        // Handle destination
        if (destination === 'window') {
            const doc = await vscode.workspace.openTextDocument({
                content: script,
                language: 'sql'
            });
            await vscode.window.showTextDocument(doc);
        } else if (destination === 'file') {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`${node.name}_${scriptType.toLowerCase()}.sql`),
                filters: { 'SQL Files': ['sql'] }
            });
            
            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(script, 'utf8'));
                vscode.window.showInformationMessage(`Script saved to ${uri.fsPath}`);
            }
        } else if (destination === 'clipboard') {
            await vscode.env.clipboard.writeText(script);
            vscode.window.showInformationMessage(`Script copied to clipboard`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Error generating script: ${error}`);
        outputChannel.appendLine(`Error in scriptProcedureTo: ${error}`);
    }
}
