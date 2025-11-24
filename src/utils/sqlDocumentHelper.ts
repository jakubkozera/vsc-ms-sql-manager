import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Opens SQL content in the custom SQL editor.
 * Creates a .sql file in the extension's scripts folder to ensure the custom editor is used.
 */
export async function openSqlInCustomEditor(
    content: string, 
    filename?: string, 
    context?: vscode.ExtensionContext,
    connectionId?: string,
    database?: string
): Promise<vscode.TextEditor> {
    // Get the extension's global storage path (creates folder if it doesn't exist)
    const storageUri = context?.globalStorageUri || vscode.Uri.file(path.join(__dirname, '..', '..', 'scripts'));
    
    // Ensure the scripts directory exists
    try {
        await vscode.workspace.fs.stat(storageUri);
    } catch {
        await vscode.workspace.fs.createDirectory(storageUri);
    }

    // Create filename - use exact name if provided (for files like history.sql that should be reused)
    // Otherwise create unique filename
    let fileName: string;
    if (filename && (filename === 'history.sql' || filename.includes('history'))) {
        // For history files, use exact name to enable reuse
        fileName = filename;
    } else {
        // For other files, create unique name
        const timestamp = Date.now();
        const randomSuffix = Math.random().toString(36).substring(2, 8);
        fileName = filename || `query_${timestamp}_${randomSuffix}.sql`;
    }
    const filePath = path.join(storageUri.fsPath, fileName);
    const uri = vscode.Uri.file(filePath);

    // Write the content to the file
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));

    // Open the file with the custom editor explicitly
    await vscode.commands.executeCommand('vscode.openWith', uri, 'mssqlManager.sqlEditor');
    
    // Return the active text editor (which will be the custom editor)
    return vscode.window.activeTextEditor!;
}
