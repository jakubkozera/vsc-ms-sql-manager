// VS Code API
const vscode = acquireVsCodeApi();

// DOM elements
const form = document.getElementById('exportForm');
const selectPathBtn = document.getElementById('selectPathBtn');
const exportBtn = document.getElementById('exportBtn');
const cancelBtn = document.getElementById('cancelBtn');
const progressSection = document.getElementById('progressSection');
const progressMessage = document.getElementById('progressMessage');
const messageSection = document.getElementById('messageSection');
const messageText = document.getElementById('messageText');
const backdrop = document.getElementById('backdrop');
const loaderMessage = document.getElementById('loaderMessage');
const loaderDetail = document.getElementById('loaderDetail');

// Event listeners
form.addEventListener('submit', handleSubmit);
selectPathBtn.addEventListener('click', handleSelectPath);
cancelBtn.addEventListener('click', handleCancel);

function handleSubmit(e) {
    e.preventDefault();
    
    hideMessage();
    hideProgress();

    const formData = new FormData(form);
    const options = {
        fileFormat: document.getElementById('fileFormat').value,
        backupPath: document.getElementById('backupPath').value.trim(),
        backupName: document.getElementById('backupName').value.trim(),
        description: document.getElementById('description').value.trim(),
        compression: document.getElementById('compression').checked,
        checksum: document.getElementById('checksum').checked,
        copyOnly: document.getElementById('copyOnly').checked,
        continueAfterError: document.getElementById('continueAfterError').checked,
        timeout: 300000 // 5 minutes
    };

    // Basic validation
    if (!options.backupPath) {
        showMessage('Backup file path is required', 'error');
        return;
    }

    const fileFormat = document.getElementById('fileFormat').value;
    const expectedExt = fileFormat === 'bak' ? '.bak' : '.bacpac';
    
    if (!options.backupPath.toLowerCase().endsWith(expectedExt)) {
        showMessage('File must have ' + expectedExt + ' extension for ' + fileFormat.toUpperCase() + ' format', 'error');
        return;
    }

    setExporting(true);

    vscode.postMessage({
        type: 'exportBackup',
        options: options
    });
}

function handleSelectPath() {
    vscode.postMessage({ type: 'selectPath' });
}

function handleCancel() {
    // Close the webview panel
    vscode.postMessage({ type: 'cancel' });
}

function setExporting(exporting) {
    exportBtn.disabled = exporting;
    if (exporting) {
        exportBtn.textContent = 'Exporting...';
        showBackdrop('Preparing export...', 'Please wait, this may take several minutes');
    } else {
        exportBtn.innerHTML = 'Export Backup';
        hideBackdrop();
    }
    
    // Disable form inputs during export
    const inputs = form.querySelectorAll('input, textarea, select, button');
    inputs.forEach(input => {
        if (input.id !== 'cancelBtn') {
            input.disabled = exporting;
        }
    });
}

function showProgress(message) {
    progressMessage.textContent = message;
    progressSection.classList.add('visible');
}

function hideProgress() {
    progressSection.classList.remove('visible');
}

function showBackdrop(message, detail) {
    loaderMessage.textContent = message;
    loaderDetail.textContent = detail || '';
    backdrop.classList.add('visible');
}

function hideBackdrop() {
    backdrop.classList.remove('visible');
}

function updateBackdropMessage(message, detail) {
    loaderMessage.textContent = message;
    if (detail) {
        loaderDetail.textContent = detail;
    }
}

function updateFormatOptions() {
    const format = document.getElementById('fileFormat').value;
    const pathInput = document.getElementById('backupPath');
    const formatHelp = document.getElementById('formatHelp');
    const pathHelp = document.getElementById('pathHelp');
    const advancedOptionsSection = document.getElementById('advancedOptionsSection');
    
    // Update path extension if user hasn't manually modified it
    const currentPath = pathInput.value;
    if (currentPath) {
        const pathWithoutExt = currentPath.replace(/\.(bak|bacpac)$/i, '');
        const newExtension = format === 'bak' ? '.bak' : '.bacpac';
        pathInput.value = pathWithoutExt + newExtension;
    }
    
    if (format === 'bak') {
        pathInput.placeholder = 'C:\\Users\\YourName\\Documents\\database_backup.bak';
        formatHelp.textContent = 'BAK: Full database backup including schema, data, and transaction logs';
        pathHelp.textContent = 'Choose where to save the backup file (.bak extension)';
        
        // Show Advanced Options for BAK (compression, checksum, etc.)
        if (advancedOptionsSection) {
            advancedOptionsSection.style.display = 'block';
        }
        
    } else { // BACPAC
        pathInput.placeholder = 'C:\\Users\\YourName\\Documents\\database_export.bacpac';
        formatHelp.textContent = 'BACPAC: Logical export of database schema and data (portable format). Note: May require additional SSL configuration for SQL Server Express.';
        pathHelp.textContent = 'Choose where to save the export file (.bacpac extension)';
        
        // Hide Advanced Options for BACPAC (not applicable to SqlPackage export)
        if (advancedOptionsSection) {
            advancedOptionsSection.style.display = 'none';
        }
    }
}

function showMessage(message, type) {
    messageText.textContent = message;
    messageSection.className = 'message visible ' + type;
}

function hideMessage() {
    messageSection.classList.remove('visible');
}

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.type) {
        case 'initialData':
            document.getElementById('connectionName').textContent = message.data.connectionName;
            document.getElementById('serverName').textContent = message.data.serverName;
            document.getElementById('databaseName').textContent = message.data.databaseName;
            document.getElementById('backupPath').value = message.data.suggestedPath;
            break;
            
        case 'pathSelected':
            document.getElementById('backupPath').value = message.path;
            break;
            
        case 'progress':
            updateBackdropMessage(message.message, 'Processing...');
            break;
            
        case 'success':
            setExporting(false);
            updateBackdropMessage('Export completed successfully!', 'Closing export window...');
            showMessage(message.message, 'success');
            break;
            
        case 'error':
            setExporting(false);
            hideBackdrop();
            showMessage(message.message, 'error');
            break;
    }
});

// Initialize
updateFormatOptions(); // Set initial UI state
vscode.postMessage({ type: 'ready' });