import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Manages database-specific instructions that are included in SQL chat context
 */
export class DatabaseInstructionsManager {
    private instructionsPath: string;
    private databaseInstructionsKey = 'mssqlManager.databaseInstructions';
    private instructionsCache = new Map<string, string>();
    private fileWatcher?: vscode.FileSystemWatcher;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        // Create instructions directory in globalStorage
        this.instructionsPath = path.join(context.globalStorageUri.fsPath, 'instructions');
        this.ensureInstructionsDirectory();
        this.setupFileWatcher();
        this.validateInstructionsIntegrity();
    }

    /**
     * Ensure instructions directory exists
     */
    private ensureInstructionsDirectory(): void {
        if (!fs.existsSync(this.instructionsPath)) {
            fs.mkdirSync(this.instructionsPath, { recursive: true });
            this.outputChannel.appendLine(`[DatabaseInstructions] Created instructions directory: ${this.instructionsPath}`);
        }
    }

    /**
     * Setup file watcher to reload instructions when files change
     */
    private setupFileWatcher(): void {
        const pattern = new vscode.RelativePattern(this.instructionsPath, '*.md');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.fileWatcher.onDidChange((uri) => {
            const instructionName = path.basename(uri.fsPath, '.md');
            this.outputChannel.appendLine(`[DatabaseInstructions] File changed: ${instructionName}`);
            this.instructionsCache.delete(instructionName);
        });

        this.fileWatcher.onDidDelete((uri) => {
            const instructionName = path.basename(uri.fsPath, '.md');
            this.outputChannel.appendLine(`[DatabaseInstructions] File deleted: ${instructionName}`);
            this.instructionsCache.delete(instructionName);
            this.handleDeletedInstruction(instructionName);
        });

        this.context.subscriptions.push(this.fileWatcher);
    }

    /**
     * Validate that all linked instructions still exist, unlink if file is missing
     */
    private async validateInstructionsIntegrity(): Promise<void> {
        const mappings = this.getDatabaseInstructionMappings();
        let hasChanges = false;

        for (const [databaseKey, instructionName] of Object.entries(mappings)) {
            const filePath = path.join(this.instructionsPath, `${instructionName}.md`);
            if (!fs.existsSync(filePath)) {
                this.outputChannel.appendLine(`[DatabaseInstructions] Missing file for ${databaseKey}, unlinking: ${instructionName}`);
                delete mappings[databaseKey];
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await this.saveDatabaseInstructionMappings(mappings);
        }
    }

    /**
     * Handle deleted instruction file - unlink from all databases
     */
    private async handleDeletedInstruction(instructionName: string): Promise<void> {
        const mappings = this.getDatabaseInstructionMappings();
        let hasChanges = false;

        for (const [databaseKey, linkedInstruction] of Object.entries(mappings)) {
            if (linkedInstruction === instructionName) {
                this.outputChannel.appendLine(`[DatabaseInstructions] Unlinking deleted instruction from ${databaseKey}`);
                delete mappings[databaseKey];
                hasChanges = true;
            }
        }

        if (hasChanges) {
            await this.saveDatabaseInstructionMappings(mappings);
            vscode.window.showInformationMessage(`Instruction "${instructionName}" was deleted. All database links have been removed.`);
        }
    }

    /**
     * Get database key for storing mappings
     */
    private getDatabaseKey(connectionId: string, database?: string): string {
        return database ? `${connectionId}::${database}` : connectionId;
    }

    /**
     * Get all database-instruction mappings
     */
    private getDatabaseInstructionMappings(): Record<string, string> {
        return this.context.globalState.get<Record<string, string>>(this.databaseInstructionsKey, {});
    }

    /**
     * Save database-instruction mappings
     */
    private async saveDatabaseInstructionMappings(mappings: Record<string, string>): Promise<void> {
        await this.context.globalState.update(this.databaseInstructionsKey, mappings);
    }

    /**
     * List all available instruction files
     */
    listAvailableInstructions(): string[] {
        if (!fs.existsSync(this.instructionsPath)) {
            return [];
        }

        const files = fs.readdirSync(this.instructionsPath);
        return files
            .filter(f => f.endsWith('.md'))
            .map(f => path.basename(f, '.md'));
    }

    /**
     * Check if database has linked instructions
     */
    hasInstructions(connectionId: string, database?: string): boolean {
        const key = this.getDatabaseKey(connectionId, database);
        const mappings = this.getDatabaseInstructionMappings();
        return key in mappings;
    }

    /**
     * Get instruction name linked to database
     */
    getLinkedInstructionName(connectionId: string, database?: string): string | undefined {
        const key = this.getDatabaseKey(connectionId, database);
        const mappings = this.getDatabaseInstructionMappings();
        return mappings[key];
    }

    /**
     * Load instruction content for database
     */
    async loadInstructions(connectionId: string, database?: string): Promise<string | null> {
        const key = this.getDatabaseKey(connectionId, database);
        const mappings = this.getDatabaseInstructionMappings();
        const instructionName = mappings[key];

        this.outputChannel.appendLine(`[DatabaseInstructions] loadInstructions called with key: ${key}`);
        this.outputChannel.appendLine(`[DatabaseInstructions] Available mappings: ${JSON.stringify(mappings)}`);

        if (!instructionName) {
            return null;
        }

        // Check cache first
        if (this.instructionsCache.has(instructionName)) {
            return this.instructionsCache.get(instructionName)!;
        }

        // Load from file
        const filePath = path.join(this.instructionsPath, `${instructionName}.md`);
        
        if (!fs.existsSync(filePath)) {
            this.outputChannel.appendLine(`[DatabaseInstructions] Instruction file not found: ${filePath}`);
            // Unlink missing instruction
            delete mappings[key];
            await this.saveDatabaseInstructionMappings(mappings);
            return null;
        }

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            this.instructionsCache.set(instructionName, content);
            return content;
        } catch (error) {
            this.outputChannel.appendLine(`[DatabaseInstructions] Error reading instruction file: ${error}`);
            return null;
        }
    }

    /**
     * Create new instruction file
     */
    async createInstruction(name: string): Promise<string | null> {
        const fileName = `${name}.md`;
        const filePath = path.join(this.instructionsPath, fileName);

        if (fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`Instruction "${name}" already exists.`);
            return null;
        }

        try {
            const template = `# Database Instructions: ${name}

Add your custom instructions for this database here.

These instructions will be included in the context of every @sql chat query for linked databases.

## Example Instructions:

- Always use explicit column names instead of SELECT *
- Prefer stored procedures for complex operations
- Use appropriate indexes for better performance
- Follow naming conventions: PascalCase for tables, camelCase for columns
`;

            fs.writeFileSync(filePath, template, 'utf-8');
            this.outputChannel.appendLine(`[DatabaseInstructions] Created new instruction: ${filePath}`);
            return filePath;
        } catch (error) {
            this.outputChannel.appendLine(`[DatabaseInstructions] Error creating instruction file: ${error}`);
            vscode.window.showErrorMessage(`Failed to create instruction: ${error}`);
            return null;
        }
    }

    /**
     * Link instruction to database
     */
    async linkInstruction(connectionId: string, instructionName: string, database?: string): Promise<boolean> {
        const key = this.getDatabaseKey(connectionId, database);
        const mappings = this.getDatabaseInstructionMappings();

        // Verify instruction file exists
        const filePath = path.join(this.instructionsPath, `${instructionName}.md`);
        if (!fs.existsSync(filePath)) {
            vscode.window.showErrorMessage(`Instruction file not found: ${instructionName}`);
            return false;
        }

        mappings[key] = instructionName;
        await this.saveDatabaseInstructionMappings(mappings);
        
        // Clear cache to force reload
        this.instructionsCache.delete(instructionName);
        
        this.outputChannel.appendLine(`[DatabaseInstructions] Linked ${instructionName} to ${key}`);
        return true;
    }

    /**
     * Unlink instruction from database
     */
    async unlinkInstruction(connectionId: string, database?: string): Promise<boolean> {
        const key = this.getDatabaseKey(connectionId, database);
        const mappings = this.getDatabaseInstructionMappings();

        if (!(key in mappings)) {
            return false;
        }

        const instructionName = mappings[key];
        delete mappings[key];
        await this.saveDatabaseInstructionMappings(mappings);
        
        this.outputChannel.appendLine(`[DatabaseInstructions] Unlinked ${instructionName} from ${key}`);
        return true;
    }

    /**
     * Show UI for adding database instructions
     */
    async showAddInstructionsDialog(connectionId: string, database?: string): Promise<void> {
        const existingInstructions = this.listAvailableInstructions();
        
        const items: vscode.QuickPickItem[] = [
            {
                label: '$(add) New instructions',
                description: 'Create a new instruction file',
                alwaysShow: true
            },
            ...existingInstructions.map(name => ({
                label: name,
                description: 'Existing instruction file'
            }))
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select or create instructions for this database',
            title: 'Add Database Instructions',
            ignoreFocusOut: true
        });

        if (!selected) {
            return;
        }

        let instructionName: string;

        if (selected.label === '$(add) New instructions') {
            // Create new instruction
            const name = await vscode.window.showInputBox({
                prompt: 'Enter a name for the new instruction',
                placeHolder: 'e.g., production-db-rules',
                title: 'New Database Instructions',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Name cannot be empty';
                    }
                    if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
                        return 'Name can only contain letters, numbers, hyphens and underscores';
                    }
                    if (existingInstructions.includes(value)) {
                        return 'An instruction with this name already exists';
                    }
                    return null;
                }
            });

            if (!name) {
                return;
            }

            const filePath = await this.createInstruction(name);
            if (!filePath) {
                return;
            }

            instructionName = name;

            // Open the newly created file in editor
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
        } else {
            instructionName = selected.label;
        }

        // Link instruction to database
        const success = await this.linkInstruction(connectionId, instructionName, database);
        
        if (success) {
            const dbName = database || 'server';
            vscode.window.showInformationMessage(`Instructions "${instructionName}" linked to ${dbName}`);
        }
    }

    /**
     * Show UI for unlinking database instructions
     */
    async showUnlinkInstructionsDialog(connectionId: string, database?: string): Promise<void> {
        const instructionName = this.getLinkedInstructionName(connectionId, database);
        
        if (!instructionName) {
            vscode.window.showWarningMessage('No instructions linked to this database');
            return;
        }

        const answer = await vscode.window.showWarningMessage(
            `Unlink instructions "${instructionName}" from this database?`,
            { modal: true },
            'Unlink'
        );

        if (answer === 'Unlink') {
            const success = await this.unlinkInstruction(connectionId, database);
            if (success) {
                vscode.window.showInformationMessage(`Instructions unlinked from database`);
            }
        }
    }

    /**
     * Get the file path for linked instructions (for editing)
     */
    async getInstructionsFilePath(connectionId: string, database?: string): Promise<vscode.Uri | null> {
        const instructionName = this.getLinkedInstructionName(connectionId, database);
        
        if (!instructionName) {
            return null;
        }

        const filePath = path.join(this.instructionsPath, `${instructionName}.md`);
        
        if (!fs.existsSync(filePath)) {
            // File was deleted - unlink it
            await this.handleDeletedInstruction(instructionName);
            return null;
        }

        return vscode.Uri.file(filePath);
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
