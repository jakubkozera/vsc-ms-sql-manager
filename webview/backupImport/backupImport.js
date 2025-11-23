// VS Code API
const vscode = acquireVsCodeApi();

// Global variables
let originalDatabaseName = '';
let backupAnalyzed = false;
let defaultDataPath = '';
let defaultLogPath = '';

// DOM elements
const form = document.getElementById('importForm');
const selectFileBtn = document.getElementById('selectFileBtn');
const analyzeBtn = document.getElementById('analyzeBtn');
const importBtn = document.getElementById('importBtn');
const cancelBtn = document.getElementById('cancelBtn');
const messageSection = document.getElementById('messageSection');
const messageText = document.getElementById('messageText');
const existingDatabases = document.getElementById('existingDatabases');
const targetDatabaseInput = document.getElementById('targetDatabase');
const backupPathInput = document.getElementById('backupPath');
const databaseExistsWarning = document.getElementById('databaseExistsWarning');
const backupInfoSection = document.getElementById('backupInfoSection');
const backupInfo = document.getElementById('backupInfo');
const suggestNewNameBtn = document.getElementById('suggestNewNameBtn');
const useOriginalNameBtn = document.getElementById('useOriginalNameBtn');
const backdrop = document.getElementById('backdrop');
const loaderMessage = document.getElementById('loaderMessage');
const loaderDetail = document.getElementById('loaderDetail');

// New elements for target database switch and collapsible sections
const newDatabaseOption = document.getElementById('newDatabaseOption');
const existingDatabaseOption = document.getElementById('existingDatabaseOption');
const newDatabaseGroup = document.getElementById('newDatabaseGroup');
const existingDatabaseGroup = document.getElementById('existingDatabaseGroup');
const advancedToggle = document.getElementById('advancedToggle');
const advancedContent = document.getElementById('advancedContent');
const collapsibleIcon = advancedToggle.querySelector('.collapsible-icon');

let currentTargetMode = 'new'; // 'new' or 'existing'

// Event listeners
form.addEventListener('submit', handleSubmit);
selectFileBtn.addEventListener('click', handleSelectFile);
analyzeBtn.addEventListener('click', handleAnalyzeBackup);
cancelBtn.addEventListener('click', handleCancel);
existingDatabases.addEventListener('change', handleDatabaseSelection);
targetDatabaseInput.addEventListener('input', handleTargetDatabaseChange);
backupPathInput.addEventListener('input', handleBackupPathChange);

// New event listeners
newDatabaseOption.addEventListener('click', () => switchTargetMode('new'));
existingDatabaseOption.addEventListener('click', () => switchTargetMode('existing'));
advancedToggle.addEventListener('click', toggleAdvancedOptions);

suggestNewNameBtn.addEventListener('click', handleSuggestNewName);
useOriginalNameBtn.addEventListener('click', handleUseOriginalName);

function handleSubmit(e) {
    e.preventDefault();
    
    hideMessage();

    // Get target database based on current mode
    let targetDatabase = '';
    if (currentTargetMode === 'new') {
        targetDatabase = document.getElementById('targetDatabase').value.trim();
    } else {
        targetDatabase = document.getElementById('existingDatabases').value;
    }

    const options = {
        fileFormat: document.getElementById('fileFormat').value,
        backupPath: document.getElementById('backupPath').value.trim(),
        targetDatabase: targetDatabase,
        replace: currentTargetMode === 'existing', // Always true for existing mode
        checksum: document.getElementById('checksum').checked,
        continueAfterError: document.getElementById('continueAfterError').checked,
        noRecovery: document.getElementById('noRecovery').checked,
        relocateData: document.getElementById('relocateData').value.trim(),
        relocateLog: document.getElementById('relocateLog').value.trim(),
        timeout: 600000 // 10 minutes
    };

    // Basic validation
    if (!options.backupPath) {
        showMessage('Backup file path is required', 'error');
        return;
    }

    if (!options.targetDatabase) {
        const fieldName = currentTargetMode === 'new' ? 'Target database name' : 'Existing database selection';
        showMessage(fieldName + ' is required', 'error');
        return;
    }

    const fileFormat = document.getElementById('fileFormat').value;
    const expectedExt = fileFormat === 'bak' ? '.bak' : '.bacpac';
    
    if (!options.backupPath.toLowerCase().endsWith(expectedExt)) {
        showMessage('File must have ' + expectedExt + ' extension for ' + fileFormat.toUpperCase() + ' format', 'error');
        return;
    }

    // For BAK format, if creating a new database and file paths are not specified,
    // automatically generate them. BACPAC imports don't need file relocation.
    if (currentTargetMode === 'new' && fileFormat === 'bak' && (!options.relocateData || !options.relocateLog)) {
        // Auto-generate file paths instead of showing error
        vscode.postMessage({
            type: 'autoGenerateFilePaths',
            databaseName: options.targetDatabase
        });
        return;
    }

    setImporting(true);
    // showProgress replaced by backdrop loader in setImporting

    vscode.postMessage({
        type: 'importBackup',
        options: options
    });
}

function handleSelectFile() {
    const currentFormat = document.getElementById('fileFormat')?.value || 'bak';
    vscode.postMessage({ 
        type: 'selectBackupFile',
        fileFormat: currentFormat
    });
}

function handleAnalyzeBackup() {
    const backupPath = backupPathInput.value.trim();
    if (!backupPath) {
        showMessage('Please select a backup file first', 'error');
        return;
    }

    const format = document.getElementById('fileFormat').value;
    const expectedExt = format === 'bak' ? '.bak' : '.bacpac';
    
    if (!backupPath.toLowerCase().endsWith(expectedExt)) {
        showMessage('File must have ' + expectedExt + ' extension for ' + format.toUpperCase() + ' format', 'error');
        return;
    }

    hideMessage();
    showBackdrop('Analyzing backup file...', 'This may take a moment...');
    vscode.postMessage({
        type: 'analyzeBackup',
        backupPath: backupPath
    });
}

function handleBackupPathChange() {
    const hasPath = backupPathInput.value.trim().length > 0;
    analyzeBtn.disabled = !hasPath;
    
    if (!hasPath) {
        backupAnalyzed = false;
        backupInfoSection.style.display = 'none';
        useOriginalNameBtn.disabled = true;
        originalDatabaseName = '';
    }
}

function handleSuggestNewName() {
    const baseName = originalDatabaseName || 'MyDatabase';
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');
    const suggestedName = baseName + '_Restored_' + timestamp;
    targetDatabaseInput.value = suggestedName;
    
    // Auto-suggest file paths for new database
    autoSuggestFilePaths(suggestedName);
    
    handleTargetDatabaseChange();
}

function autoSuggestFilePaths(databaseName) {
    // Use C:\Temp directory that SQL Server Express can definitely access  
    const basePath = defaultDataPath || 'C:\\Temp\\sql-restore-files\\';
    const logBasePath = defaultLogPath || basePath;
    
    const dataPath = basePath + databaseName + '.mdf';
    const logPath = logBasePath + databaseName + '_log.ldf';
    
    document.getElementById('relocateData').value = dataPath;
    document.getElementById('relocateLog').value = logPath;
    
    // Show info about automatic file path generation
    showMessage('File paths automatically generated for new database. You can modify them in Advanced Options if needed.', 'info');
    setTimeout(() => hideMessage(), 5000);
}

function handleUseOriginalName() {
    if (originalDatabaseName) {
        targetDatabaseInput.value = originalDatabaseName;
        showDatabaseExistsWarning(false); // Will be checked again by handleTargetDatabaseChange
        handleTargetDatabaseChange();
    }
}

function handleCancel() {
    vscode.postMessage({ type: 'cancel' });
}

function switchTargetMode(mode) {
    currentTargetMode = mode;
    
    // Update button states
    if (mode === 'new') {
        newDatabaseOption.classList.add('active');
        newDatabaseOption.classList.remove('inactive');
        existingDatabaseOption.classList.remove('active');
        existingDatabaseOption.classList.add('inactive');
        
        // Show/hide relevant groups
        newDatabaseGroup.style.display = 'block';
        existingDatabaseGroup.style.display = 'none';
        
        // Clear existing database selection
        existingDatabases.value = '';
        
    } else { // existing
        existingDatabaseOption.classList.add('active');
        existingDatabaseOption.classList.remove('inactive');
        newDatabaseOption.classList.remove('active');
        newDatabaseOption.classList.add('inactive');
        
        // Show/hide relevant groups
        newDatabaseGroup.style.display = 'none';
        existingDatabaseGroup.style.display = 'block';
        
        // Clear new database name
        targetDatabaseInput.value = '';
        hideMessage();
    }
}

function toggleAdvancedOptions() {
    const isExpanded = advancedContent.classList.contains('expanded');
    
    if (isExpanded) {
        // Collapse
        advancedContent.classList.remove('expanded');
        collapsibleIcon.classList.remove('expanded');
        collapsibleIcon.classList.add('collapsed');
    } else {
        // Expand
        advancedContent.classList.add('expanded');
        collapsibleIcon.classList.remove('collapsed');
        collapsibleIcon.classList.add('expanded');
    }
}

function handleDatabaseSelection() {
    const selectedDb = existingDatabases.value;
    if (selectedDb && currentTargetMode === 'existing') {
        // In existing mode, this represents the target database to replace
        targetDatabaseInput.value = selectedDb;
        hideMessage();
    }
}

function handleTargetDatabaseChange() {
    const databaseName = targetDatabaseInput.value.trim();
    if (databaseName && currentTargetMode === 'new') {
        // Only check for existence when in new database mode
        clearTimeout(window.dbCheckTimeout);
        window.dbCheckTimeout = setTimeout(() => {
            vscode.postMessage({
                type: 'checkDatabaseExists',
                databaseName: databaseName
            });
        }, 500);
    } else {
        showDatabaseExistsWarning(false);
    }
}

function showDatabaseExistsWarning(show) {
    if (show) {
        databaseExistsWarning.style.display = 'block';
    } else {
        databaseExistsWarning.style.display = 'none';
    }
}

function setImporting(importing) {
    if (importing) {
        showBackdrop('Importing database backup...', 'Please wait, this may take several minutes');
    } else {
        hideBackdrop();
    }
    
    importBtn.disabled = importing;
    if (importing) {
        importBtn.textContent = 'Importing...';
    } else {
        importBtn.innerHTML = '📥 Import Backup';
    }
    
    // Disable form inputs during import
    const inputs = form.querySelectorAll('input, select, button');
    inputs.forEach(input => {
        if (input.id !== 'cancelBtn') {
            input.disabled = importing;
        }
    });
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
    const format = document.getElementById('fileFormat')?.value;
    const pathInput = document.getElementById('backupPath');
    const formatHelp = document.getElementById('formatHelp');
    const pathHelp = document.getElementById('pathHelp');
    
    // Get references to format-specific elements
    const restoreOptionsSection = document.getElementById('restoreOptionsSection');
    const fileRelocationSection = document.getElementById('fileRelocationSection');
    const advancedSection = document.getElementById('advancedSection');
    
    if (!format || !pathInput) {
        return; // Exit early if essential elements are not found
    }
    
    // Update path extension if user hasn't manually modified it
    const currentPath = pathInput.value;
    if (currentPath) {
        const pathWithoutExt = currentPath.replace(/\.(bak|bacpac)$/i, '');
        const newExtension = format === 'bak' ? '.bak' : '.bacpac';
        pathInput.value = pathWithoutExt + newExtension;
    }
    
    if (format === 'bak') {
        // BAK restore configuration
        pathInput.placeholder = 'C:\\backup\\database_backup.bak';
        if (formatHelp) {
            formatHelp.textContent = 'BAK: Database backup for restore operation - supports full backup/restore with transaction logs';
        }
        if (pathHelp) {
            pathHelp.textContent = 'Select the .bak file to restore from';
        }
        
        // Show BAK-specific options
        if (advancedSection) {
            advancedSection.style.display = 'block';
        }
        if (restoreOptionsSection) {
            restoreOptionsSection.style.display = 'block';
            // Update restore options help text for BAK
            const restoreHelp = restoreOptionsSection.querySelector('.help-text');
            if (restoreHelp) {
                restoreHelp.textContent = 'Checksum verifies backup integrity. No recovery leaves database in restoring state for log shipping.';
            }
        }
        
        if (fileRelocationSection) {
            fileRelocationSection.style.display = 'block';
        }
        
        // Update button text for BAK
        const importBtn = document.getElementById('importBtn');
        if (importBtn) {
            importBtn.textContent = 'Restore Database';
        }
        
    } else { // BACPAC
        // BACPAC import configuration
        pathInput.placeholder = 'C:\\export\\database_export.bacpac';
        if (formatHelp) {
            formatHelp.textContent = 'BACPAC: Data-tier application import - schema and data only (no transaction logs). SSL optimized for SQL Server Express.';
        }
        if (pathHelp) {
            pathHelp.textContent = 'Select the .bacpac file to import from';
        }
        
        // Hide BAK-specific options that don't apply to BACPAC
        if (advancedSection) {
            advancedSection.style.display = 'none';
        }
        if (restoreOptionsSection) {
            restoreOptionsSection.style.display = 'none';
        }
        
        if (fileRelocationSection) {
            fileRelocationSection.style.display = 'none';
        }
        
        // Update button text for BACPAC
        const importBtn = document.getElementById('importBtn');
        if (importBtn) {
            importBtn.textContent = 'Import BACPAC';
        }
    }
}

function showMessage(message, type) {
    if (messageText) {
        messageText.textContent = message;
    }
    if (messageSection) {
        messageSection.className = 'message visible ' + type;
    }
}

function hideMessage() {
    if (messageSection) {
        messageSection.classList.remove('visible');
    }
}

function populateDatabases(databases) {
    existingDatabases.innerHTML = '<option value="">-- Select existing database --</option>';
    databases.forEach(db => {
        const option = document.createElement('option');
        option.value = db;
        option.textContent = db;
        existingDatabases.appendChild(option);
    });
}

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    
    switch (message.type) {
        case 'initialData':
            const connectionNameEl = document.getElementById('connectionName');
            const serverNameEl = document.getElementById('serverName');
            if (connectionNameEl) { connectionNameEl.textContent = message.data.connectionName; }
            if (serverNameEl) { serverNameEl.textContent = message.data.serverName; }
            // Request list of existing databases and default paths
            vscode.postMessage({ type: 'listDatabases' });
            vscode.postMessage({ type: 'getDefaultDataPath' });
            break;

        case 'defaultDataPath':
            defaultDataPath = message.dataPath;
            defaultLogPath = message.logPath;
            break;
            
        case 'backupFileSelected':
            backupPathInput.value = message.path;
            
            // Auto-detect file format based on extension
            const fileExtension = message.path.toLowerCase();
            const fileFormatSelect = document.getElementById('fileFormat');
            if (fileExtension.endsWith('.bacpac')) {
                fileFormatSelect.value = 'bacpac';
            } else if (fileExtension.endsWith('.bak')) {
                fileFormatSelect.value = 'bak';
            }
            
            // Update format options and handle path change
            updateFormatOptions();
            handleBackupPathChange();
            break;

        case 'backupInfo':
            originalDatabaseName = message.originalDatabaseName;
            backupAnalyzed = true;
            useOriginalNameBtn.disabled = false;
            
            let infoText = 'Original DB: ' + message.originalDatabaseName;
            if (message.backupDate) {
                infoText += '<br>Backup Date: ' + new Date(message.backupDate).toLocaleString();
            }
            if (message.backupSize) {
                const sizeMB = Math.round(message.backupSize / 1024 / 1024 * 100) / 100;
                infoText += '<br>Size: ' + sizeMB + ' MB';
            }
            
            backupInfo.innerHTML = infoText;
            backupInfoSection.style.display = 'block';
            hideBackdrop(); // Hide analyze progress
            
            // Suggest a name if target is empty
            if (!targetDatabaseInput.value.trim()) {
                handleSuggestNewName();
            }
            break;

        case 'databasesListed':
            populateDatabases(message.databases);
            break;

        case 'databaseExistsResult':
            if (message.exists && message.databaseName === targetDatabaseInput.value.trim()) {
                showDatabaseExistsWarning(true);
            } else {
                showDatabaseExistsWarning(false);
            }
            break;

        case 'autoGenerateFilePaths':
            // Extension is requesting auto-generation of file paths
            vscode.postMessage({
                type: 'autoGenerateFilePaths', 
                databaseName: message.databaseName
            });
            break;

        case 'filePathsGenerated':
            // Auto-generated file paths received, populate form and retry import
            document.getElementById('relocateData').value = message.dataPath;
            document.getElementById('relocateLog').value = message.logPath;
            
            showMessage('File paths automatically generated. Proceeding with restore...', 'info');
            
            // Expand advanced options to show the generated paths
            if (!advancedContent.classList.contains('expanded')) {
                toggleAdvancedOptions();
            }
            
            // Retry the import with generated paths
            setTimeout(() => {
                form.dispatchEvent(new Event('submit'));
            }, 1000);
            break;
            
        case 'progress':
            updateBackdropMessage(message.message, 'Processing...');
            break;
            
        case 'success':
            setImporting(false);
            updateBackdropMessage('Import completed successfully!', 'Closing import window...');
            showMessage(message.message, 'success');
            // Window will close automatically after 2 seconds
            break;
            
        case 'error':
            setImporting(false);
            showMessage(message.message, 'error');
            break;
    }
});

// Initialize
// Wait for DOM to be fully loaded before setting up UI
setTimeout(() => {
    updateFormatOptions(); // Set initial UI state based on default format
}, 100);
vscode.postMessage({ type: 'ready' });