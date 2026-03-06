import * as vscode from 'vscode';

/**
 * Opens SQL content in the custom SQL editor.
 * Uses New Query flow when connection context is provided, otherwise opens an untitled .sql document.
 */
export async function openSqlInCustomEditor(
    content: string, 
    filename?: string, 
    context?: vscode.ExtensionContext,
    connectionId?: string,
    database?: string
): Promise<void> {
    if (connectionId) {
        await vscode.commands.executeCommand(
            'mssqlManager.newQuery',
            { connectionId, database },
            content,
            false
        );
        return;
    }

    const baseName = filename && filename.trim().length > 0
        ? filename
        : `query_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.sql`;
    const untitledUri = vscode.Uri.parse(`untitled:${baseName}`);

    const doc = await vscode.workspace.openTextDocument(untitledUri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), content);
    await vscode.workspace.applyEdit(edit);

    await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'mssqlManager.sqlEditor');
}
