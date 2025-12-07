
function executeQuery() {
    if (!currentConnectionId) {
        if (window.vscode) {
            window.vscode.postMessage({
                type: 'showMessage',
                level: 'error',
                message: 'Please select a connection first'
            });
        }
        return;
    }

    let query = '';
    if (editor) {
        const selection = editor.getSelection();
        if (selection && !selection.isEmpty()) {
            query = editor.getModel().getValueInRange(selection);
        } else {
            query = editor.getValue();
        }
    }

    if (!query || !query.trim()) {
        return;
    }

    // Check for actual plan
    const actualPlanCheckbox = document.getElementById('actualPlanCheckbox');
    const includeActualPlan = actualPlanCheckbox ? actualPlanCheckbox.checked : false;

    if (window.vscode) {
        window.vscode.postMessage({
            type: 'executeQuery',
            query: query,
            connectionId: currentConnectionId,
            databaseName: currentDatabaseName,
            includeActualPlan: includeActualPlan
        });
    }

    if (typeof showLoading === 'function') {
        showLoading();
    }
}

function executeEstimatedPlan() {
    if (!currentConnectionId) {
        if (window.vscode) {
            window.vscode.postMessage({
                type: 'showMessage',
                level: 'error',
                message: 'Please select a connection first'
            });
        }
        return;
    }

    let query = '';
    if (editor) {
        const selection = editor.getSelection();
        if (selection && !selection.isEmpty()) {
            query = editor.getModel().getValueInRange(selection);
        } else {
            query = editor.getValue();
        }
    }

    if (!query || !query.trim()) {
        return;
    }

    if (window.vscode) {
        window.vscode.postMessage({
            type: 'executeEstimatedPlan',
            query: query,
            connectionId: currentConnectionId,
            databaseName: currentDatabaseName
        });
    }

    if (typeof showLoading === 'function') {
        showLoading();
    }
}

function executeRevertAll() {
    // Revert all pending changes
    if (typeof pendingChanges !== 'undefined') {
        pendingChanges.clear();
    }
    
    if (typeof updatePendingChangesCount === 'function') {
        updatePendingChangesCount();
    }
    
    // Remove all cell-modified classes
    document.querySelectorAll('.cell-modified').forEach(cell => {
        cell.classList.remove('cell-modified');
    });
    
    // Refresh the grid to show original values
    if (typeof lastResults !== 'undefined' && lastResults && typeof displayResults === 'function') {
        displayResults(lastResults, null, typeof lastColumnNames !== 'undefined' ? lastColumnNames : null);
    }
}

function handleRelationResults(message) {
    // Placeholder for relation results handling
    console.log('Relation results received:', message);
    // This would typically open a new tab or modal with the related data
}
