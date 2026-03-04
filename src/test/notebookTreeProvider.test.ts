import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotebookTreeProvider, NotebookTreeItem } from '../notebookTreeProvider';

suite('NotebookTreeProvider Test Suite', () => {
    let tempRootDir: string;
    let notebookFolder: string;
    let context: vscode.ExtensionContext;

    setup(() => {
        tempRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mssql-notebooks-'));
        notebookFolder = path.join(tempRootDir, 'notebooks');
        fs.mkdirSync(notebookFolder, { recursive: true });

        const globalStateMock = {
            get: (_key: string, _defaultValue: string[]) => [notebookFolder],
            update: async () => undefined
        };

        context = {
            globalState: globalStateMock as any,
            subscriptions: [],
            workspaceState: {} as any,
            extensionUri: vscode.Uri.file(tempRootDir),
            extensionPath: tempRootDir,
            storagePath: tempRootDir,
            globalStoragePath: tempRootDir,
            logPath: tempRootDir,
            storageUri: vscode.Uri.file(tempRootDir),
            globalStorageUri: vscode.Uri.file(tempRootDir),
            logUri: vscode.Uri.file(tempRootDir),
            extensionMode: vscode.ExtensionMode.Test,
            secrets: {} as any,
            extension: {} as any,
            languageModelAccessInformation: {} as any,
            asAbsolutePath: (relativePath: string) => path.join(tempRootDir, relativePath),
            environmentVariableCollection: {} as any
        } as vscode.ExtensionContext;
    });

    teardown(() => {
        fs.rmSync(tempRootDir, { recursive: true, force: true });
    });

    test('hides invalid .ipynb files and removes extension from valid file label', () => {
        fs.writeFileSync(path.join(notebookFolder, 'valid-notebook.ipynb'), '{"cells": []}', 'utf8');
        fs.writeFileSync(path.join(notebookFolder, 'broken-notebook.ipynb'), '{"cells": [', 'utf8');

        const provider = new NotebookTreeProvider(context);
        const rootItems = provider.getChildren();

        assert.strictEqual(rootItems.length, 1, 'One configured notebook folder should be shown at root level');

        const children = provider.getChildren(rootItems[0]);
        const files = children.filter((item: NotebookTreeItem) => item.itemType === 'notebookFile');

        assert.strictEqual(files.length, 1, 'Only valid notebook file should be shown');
        assert.strictEqual(files[0].label, 'valid-notebook', 'Notebook label should not include .ipynb extension');
        assert.ok(files[0].fsPath.endsWith('valid-notebook.ipynb'), 'Notebook path should still include .ipynb extension');
    });

    test('hides subfolders that only contain invalid notebooks', () => {
        const badSubfolder = path.join(notebookFolder, 'broken-subfolder');
        const goodSubfolder = path.join(notebookFolder, 'valid-subfolder');
        fs.mkdirSync(badSubfolder, { recursive: true });
        fs.mkdirSync(goodSubfolder, { recursive: true });

        fs.writeFileSync(path.join(badSubfolder, 'bad.ipynb'), '{', 'utf8');
        fs.writeFileSync(path.join(goodSubfolder, 'good.ipynb'), '{"cells": []}', 'utf8');

        const provider = new NotebookTreeProvider(context);
        const rootItems = provider.getChildren();
        const children = provider.getChildren(rootItems[0]);
        const subfolders = children.filter((item: NotebookTreeItem) => item.itemType === 'notebookSubfolder');

        assert.strictEqual(subfolders.length, 1, 'Only subfolders with at least one valid notebook should be shown');
        assert.strictEqual(subfolders[0].label, 'valid-subfolder');
    });
});
