
function initTabs() {
    // Tab switching
    document.querySelectorAll('.results-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;

            // Show/hide appropriate container
            const resultsContent = document.getElementById('resultsContent');
            const messagesContent = document.getElementById('messagesContent');
            const pendingChangesContent = document.getElementById('pendingChangesContent');
            const queryPlanContent = document.getElementById('queryPlanContent');
            const planTreeContent = document.getElementById('planTreeContent');
            const topOperationsContent = document.getElementById('topOperationsContent');
            
            // Hide all
            if (resultsContent) resultsContent.style.display = 'none';
            if (messagesContent) messagesContent.style.display = 'none';
            if (pendingChangesContent) pendingChangesContent.style.display = 'none';
            if (queryPlanContent) queryPlanContent.style.display = 'none';
            if (planTreeContent) planTreeContent.style.display = 'none';
            if (topOperationsContent) topOperationsContent.style.display = 'none';
            
            // Show selected
            if (currentTab === 'results') {
                if (resultsContent) resultsContent.style.display = 'block';
            } else if (currentTab === 'messages') {
                if (messagesContent) messagesContent.style.display = 'block';
            } else if (currentTab === 'pendingChanges') {
                if (pendingChangesContent) {
                    pendingChangesContent.style.display = 'block';
                    if (typeof renderPendingChanges === 'function') {
                        renderPendingChanges();
                    }
                }
            } else if (currentTab === 'queryPlan') {
                if (queryPlanContent) queryPlanContent.style.display = 'block';
            } else if (currentTab === 'planTree') {
                if (planTreeContent) planTreeContent.style.display = 'block';
            } else if (currentTab === 'topOperations') {
                if (topOperationsContent) topOperationsContent.style.display = 'block';
            }
        });
    });
}

/**
 * Switch to a specific tab
 */
function switchTab(tabName) {
    const tab = document.querySelector(`[data-tab="${tabName}"]`);
    if (tab) {
        tab.click();
    }
}
