import * as vscode from 'vscode';
import { ServerGroup } from './connectionProvider';

export class ServerGroupWebview {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private onGroupCreated: (group: ServerGroup) => void
    ) {}

    async show(editGroup?: ServerGroup): Promise<void> {
        const title = editGroup ? `Edit Server Group: ${editGroup.name}` : 'Create Server Group';
        
        this.panel = vscode.window.createWebviewPanel(
            'serverGroupForm',
            title,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getWebviewContent(editGroup);
        
        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'submit':
                    if (this.validateGroup(message.data)) {
                        this.onGroupCreated(message.data);
                        this.panel?.dispose();
                    }
                    break;
                case 'cancel':
                    this.panel?.dispose();
                    break;
            }
        });
    }

    private validateGroup(group: ServerGroup): boolean {
        if (!group.name?.trim()) {
            vscode.window.showErrorMessage('Server group name is required');
            return false;
        }
        
        if (!group.color) {
            vscode.window.showErrorMessage('Please select a color for the server group');
            return false;
        }
        
        return true;
    }

    private getWebviewContent(editGroup?: ServerGroup): string {
        const groupData = editGroup ? JSON.stringify(editGroup) : 'null';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Server Group</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            margin: 0;
        }

        .form-container {
            max-width: 500px;
            margin: 0 auto;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        input[type="text"], textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            box-sizing: border-box;
        }

        input[type="text"]:focus, textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        textarea {
            resize: vertical;
            min-height: 60px;
        }

        .color-picker {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 10px;
            margin-top: 8px;
        }

        .color-option {
            width: 40px;
            height: 40px;
            border-radius: 8px;
            border: 2px solid transparent;
            cursor: pointer;
            transition: border-color 0.2s;
            position: relative;
        }

        .color-option:hover {
            border-color: var(--vscode-focusBorder);
        }

        .color-option.selected {
            border-color: var(--vscode-button-background);
            box-shadow: 0 0 0 2px var(--vscode-button-background);
        }

        .color-option.selected::after {
            content: '✓';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-weight: bold;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        }

        .buttons {
            display: flex;
            gap: 10px;
            margin-top: 30px;
            justify-content: flex-end;
        }

        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            transition: background-color 0.2s;
        }

        .primary-button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .primary-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .secondary-button {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .secondary-button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .required {
            color: var(--vscode-errorForeground);
        }

        .preview {
            margin-top: 20px;
            padding: 15px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background-color: var(--vscode-editor-lineHighlightBackground);
        }

        .preview-title {
            font-weight: 600;
            margin-bottom: 10px;
        }

        .preview-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 0;
        }

        .preview-icon {
            width: 16px;
            height: 16px;
            border-radius: 2px;
        }
    </style>
</head>
<body>
    <div class="form-container">
        <h2>${editGroup ? 'Edit Server Group' : 'Add Server Group'}</h2>
        
        <form id="serverGroupForm">
            <div class="form-group">
                <label for="groupName">Server group name <span class="required">*</span></label>
                <input type="text" id="groupName" name="name" required 
                       placeholder="Enter server group name">
            </div>

            <div class="form-group">
                <label for="groupDescription">Group description</label>
                <textarea id="groupDescription" name="description" 
                         placeholder="Optional description for this server group"></textarea>
            </div>

            <div class="form-group">
                <label>Group color <span class="required">*</span></label>
                <div class="color-picker">
                    <div class="color-option" data-color="#A16340" style="background-color: #A16340;"></div>
                    <div class="color-option" data-color="#7F0000" style="background-color: #7F0000;"></div>
                    <div class="color-option" data-color="#914576" style="background-color: #914576;"></div>
                    <div class="color-option" data-color="#6E9859" style="background-color: #6E9859;"></div>
                    <div class="color-option" data-color="#5F82A5" style="background-color: #5F82A5;"></div>
                    <div class="color-option" data-color="#4452A6" style="background-color: #4452A6;"></div>
                    <div class="color-option" data-color="#6A6599" style="background-color: #6A6599;"></div>
                    <div class="color-option" data-color="#515151" style="background-color: #515151;"></div>
                    <div class="color-option custom-color-option" style="background: none; display: flex; align-items: center; justify-content: center; border-style: dashed;">
                        <input type="color" id="customColorInput" title="Pick custom color" style="width: 32px; height: 32px; border: none; background: none; padding: 0; cursor: pointer;" />
                    </div>
                </div>
                <div style="margin-top: 8px; font-size: 0.95em; color: var(--vscode-descriptionForeground);">You can pick a custom color or select one of the presets above.</div>
            </div>

            <div class="preview" id="preview" style="display: none;">
                <div class="preview-title">Preview:</div>
                <div class="preview-item">
                    <div class="preview-icon" id="previewIcon"></div>
                    <span id="previewName">Server Group Name</span>
                </div>
            </div>

            <div class="buttons">
                <button type="button" class="secondary-button" onclick="cancel()">Cancel</button>
                <button type="submit" class="primary-button">${editGroup ? 'Update' : 'Create'}</button>
            </div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let selectedColor = '';
        let editingGroup = ${groupData};

        // Initialize form if editing
        if (editingGroup) {
            document.getElementById('groupName').value = editingGroup.name;
            document.getElementById('groupDescription').value = editingGroup.description || '';
            selectedColor = editingGroup.color;
            
            // Select the color
            const colorOption = document.querySelector('[data-color="' + editingGroup.color + '"]');
            if (colorOption) {
                colorOption.classList.add('selected');
                updatePreview();
            }
        }


        // Color selection for preset colors
        document.querySelectorAll('.color-option').forEach(option => {
            // Skip the custom color input
            if (option.classList.contains('custom-color-option')) return;
            option.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
                selectedColor = option.dataset.color;
                // Reset custom color input
                document.getElementById('customColorInput').value = '';
                updatePreview();
            });
        });

        // Custom color picker logic
        const customColorInput = document.getElementById('customColorInput');
        customColorInput.addEventListener('input', (e) => {
            const color = e.target.value;
            selectedColor = color;
            // Remove selection from all preset options
            document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            // Highlight the custom color box
            customColorInput.parentElement.classList.add('selected');
            updatePreview();
        });

        // If editing and color is not a preset, set custom color input
        if (editingGroup && editingGroup.color) {
            const presetColors = ["#A16340","#7F0000","#914576","#6E9859","#5F82A5","#4452A6","#6A6599","#515151"];
            if (!presetColors.includes(editingGroup.color)) {
                customColorInput.value = editingGroup.color;
                customColorInput.parentElement.classList.add('selected');
            }
        }

        // Form submission
        document.getElementById('serverGroupForm').addEventListener('submit', (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const groupData = {
                id: editingGroup ? editingGroup.id : generateId(),
                name: formData.get('name'),
                description: formData.get('description'),
                color: selectedColor
            };
            
            if (!groupData.name || !groupData.color) {
                alert('Please fill in all required fields');
                return;
            }
            
            vscode.postMessage({
                command: 'submit',
                data: groupData
            });
        });

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }

        function updatePreview() {
            const nameInput = document.getElementById('groupName');
            const preview = document.getElementById('preview');
            const previewIcon = document.getElementById('previewIcon');
            const previewName = document.getElementById('previewName');
            
            if (nameInput.value && selectedColor) {
                preview.style.display = 'block';
                previewIcon.style.backgroundColor = selectedColor;
                previewName.textContent = nameInput.value;
            } else {
                preview.style.display = 'none';
            }
        }

        function generateId() {
            return 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }

        // Update preview on name change
        document.getElementById('groupName').addEventListener('input', updatePreview);
    </script>
</body>
</html>`;
    }
}