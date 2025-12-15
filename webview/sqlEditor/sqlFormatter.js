// ========================================
// SQL Formatter Integration
// ========================================

// Default formatting options
let formattingOptions = {
    language: 'tsql',
    tabWidth: 2,
    keywordCase: 'upper',
    dataTypeCase: 'upper',
    functionCase: 'upper',
    linesBetweenQueries: 1,
    indentStyle: 'standard',
    logicalOperatorNewline: 'before',
    formatBeforeRun: false
};

// Initialize format button and popup
function initializeFormatButton() {
    const formatButton = document.getElementById('formatButton');
    const formatOptionsButton = document.getElementById('formatOptionsButton');
    const formatOptionsPopup = document.getElementById('formatOptionsPopup');
    const closePopupButton = document.getElementById('closePopupButton');
    const applyFormatButton = document.getElementById('applyFormatButton');
    
    if (!formatButton) {
        console.log('[SQL-FORMATTER] Format button not found');
        return;
    }
    
    console.log('[SQL-FORMATTER] Initializing format button');
    
    // Format button click - format SQL immediately with current options
    formatButton.addEventListener('click', () => {
        console.log('[SQL-FORMATTER] Format button clicked');
        formatSqlCode();
    });
    
    // Format options button click - show popup
    if (formatOptionsButton) {
        formatOptionsButton.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('[SQL-FORMATTER] Options button clicked');
            showFormatOptionsPopup();
        });
    }
    
    // Close popup button
    if (closePopupButton) {
        closePopupButton.addEventListener('click', () => {
            hideFormatOptionsPopup();
        });
    }
    
    // Apply format button - save options and format
    if (applyFormatButton) {
        applyFormatButton.addEventListener('click', () => {
            saveFormattingOptions();
            formatSqlCode();
            hideFormatOptionsPopup();
        });
    }
    
    // Close popup when clicking outside
    if (formatOptionsPopup) {
        document.addEventListener('click', (e) => {
            if (formatOptionsPopup.style.display === 'block' && 
                !formatOptionsPopup.contains(e.target) && 
                !formatButton.contains(e.target) &&
                (!formatOptionsButton || !formatOptionsButton.contains(e.target))) {
                hideFormatOptionsPopup();
            }
        });
    }
    
    // Load saved options from localStorage
    loadFormattingOptions();
}

function showFormatOptionsPopup() {
    const popup = document.getElementById('formatOptionsPopup');
    if (!popup) return;
    
    // Populate form with current options
    const languageOption = document.getElementById('languageOption');
    const indentOption = document.getElementById('indentOption');
    const uppercaseOption = document.getElementById('uppercaseOption');
    const linesBetweenQueriesOption = document.getElementById('linesBetweenQueriesOption');
    const keywordCaseOption = document.getElementById('keywordCaseOption');
    const dataTypeOption = document.getElementById('dataTypeOption');
    const functionCaseOption = document.getElementById('functionCaseOption');
    const indentStyleOption = document.getElementById('indentStyleOption');
    const logicalOperatorNewlineOption = document.getElementById('logicalOperatorNewlineOption');
    const formatBeforeRunOption = document.getElementById('formatBeforeRunOption');
    
    if (languageOption) languageOption.value = formattingOptions.language;
    if (indentOption) indentOption.value = formattingOptions.tabWidth;
    if (linesBetweenQueriesOption) linesBetweenQueriesOption.value = formattingOptions.linesBetweenQueries;
    if (keywordCaseOption) keywordCaseOption.value = formattingOptions.keywordCase;
    if (dataTypeOption) dataTypeOption.value = formattingOptions.dataTypeCase;
    if (functionCaseOption) functionCaseOption.value = formattingOptions.functionCase;
    if (indentStyleOption) indentStyleOption.value = formattingOptions.indentStyle;
    if (logicalOperatorNewlineOption) logicalOperatorNewlineOption.value = formattingOptions.logicalOperatorNewline;
    if (formatBeforeRunOption) formatBeforeRunOption.checked = formattingOptions.formatBeforeRun;
    
    // Show popup
    popup.style.display = 'block';
    console.log('[SQL-FORMATTER] Options popup shown');
}

function hideFormatOptionsPopup() {
    const popup = document.getElementById('formatOptionsPopup');
    if (popup) {
        popup.style.display = 'none';
        console.log('[SQL-FORMATTER] Options popup hidden');
    }
}

function saveFormattingOptions() {
    const languageOption = document.getElementById('languageOption');
    const indentOption = document.getElementById('indentOption');
    const linesBetweenQueriesOption = document.getElementById('linesBetweenQueriesOption');
    const keywordCaseOption = document.getElementById('keywordCaseOption');
    const dataTypeOption = document.getElementById('dataTypeOption');
    const functionCaseOption = document.getElementById('functionCaseOption');
    const indentStyleOption = document.getElementById('indentStyleOption');
    const logicalOperatorNewlineOption = document.getElementById('logicalOperatorNewlineOption');
    const formatBeforeRunOption = document.getElementById('formatBeforeRunOption');
    
    if (languageOption) formattingOptions.language = languageOption.value;
    if (indentOption) formattingOptions.tabWidth = parseInt(indentOption.value, 10);
    if (linesBetweenQueriesOption) formattingOptions.linesBetweenQueries = parseInt(linesBetweenQueriesOption.value, 10);
    if (keywordCaseOption) formattingOptions.keywordCase = keywordCaseOption.value;
    if (dataTypeOption) formattingOptions.dataTypeCase = dataTypeOption.value;
    if (functionCaseOption) formattingOptions.functionCase = functionCaseOption.value;
    if (indentStyleOption) formattingOptions.indentStyle = indentStyleOption.value;
    if (logicalOperatorNewlineOption) formattingOptions.logicalOperatorNewline = logicalOperatorNewlineOption.value;
    if (formatBeforeRunOption) formattingOptions.formatBeforeRun = formatBeforeRunOption.checked;
    
    // Save to localStorage
    try {
        localStorage.setItem('sqlFormattingOptions', JSON.stringify(formattingOptions));
        console.log('[SQL-FORMATTER] Options saved:', formattingOptions);
    } catch (e) {
        console.error('[SQL-FORMATTER] Failed to save options:', e);
    }
}

function loadFormattingOptions() {
    try {
        const saved = localStorage.getItem('sqlFormattingOptions');
        if (saved) {
            formattingOptions = JSON.parse(saved);
            console.log('[SQL-FORMATTER] Options loaded:', formattingOptions);
        }
    } catch (e) {
        console.error('[SQL-FORMATTER] Failed to load options:', e);
    }
}

function formatSqlCode() {
    if (!editor) {
        console.error('[SQL-FORMATTER] Editor not initialized');
        return;
    }
    
    // Check if sql-formatter is available - try multiple possible names
    // The library might be available as window.sqlFormatter, window.SqlFormatter, or just sqlFormatter
    let formatter = null;
    
    if (typeof window !== 'undefined') {
        // Try different possible exports from sql-formatter library
        formatter = window.sqlFormatter || window.SqlFormatter || window.sqlFormat;
    }
    
    // Also try global scope
    if (!formatter && typeof sqlFormatter !== 'undefined') {
        formatter = sqlFormatter;
    }
    
    // Debug: log all window properties containing 'sql' or 'format'
    if (!formatter) {
        console.error('[SQL-FORMATTER] sql-formatter library not loaded');
        if (typeof window !== 'undefined') {
            const sqlRelated = Object.keys(window).filter(k => 
                k.toLowerCase().includes('sql') || k.toLowerCase().includes('format')
            );
            console.log('[SQL-FORMATTER] Window properties related to sql/format:', sqlRelated);
            console.log('[SQL-FORMATTER] Checking all exported modules...');
            
            // Log a sample of window properties to debug
            for (let key of sqlRelated) {
                console.log(`[SQL-FORMATTER] window.${key}:`, typeof window[key], window[key]);
            }
        }
        alert('SQL Formatter library not loaded. Please check browser console for CSP errors and refresh the page.');
        return;
    }
    
    try {
        const currentCode = editor.getValue();
        
        if (!currentCode || currentCode.trim().length === 0) {
            console.log('[SQL-FORMATTER] No code to format');
            return;
        }
        
        console.log('[SQL-FORMATTER] Formatting SQL with options:', formattingOptions);
        console.log('[SQL-FORMATTER] Using formatter:', formatter);
        
        // Prepare options for sql-formatter
        const formatOptions = {
            language: formattingOptions.language,
            tabWidth: formattingOptions.tabWidth,
            keywordCase: formattingOptions.keywordCase,
            dataTypeCase: formattingOptions.dataTypeCase,
            functionCase: formattingOptions.functionCase,
            linesBetweenQueries: formattingOptions.linesBetweenQueries,
            indentStyle: formattingOptions.indentStyle,
            logicalOperatorNewline: formattingOptions.logicalOperatorNewline
        };
        
        // Format the SQL - the library might have format as a method or be a function itself
        let formattedCode;
        if (typeof formatter.format === 'function') {
            console.log('[SQL-FORMATTER] Using formatter.format()');
            formattedCode = formatter.format(currentCode, formatOptions);
        } else if (typeof formatter === 'function') {
            console.log('[SQL-FORMATTER] Using formatter() directly');
            formattedCode = formatter(currentCode, formatOptions);
        } else {
            console.error('[SQL-FORMATTER] formatter object:', formatter);
            throw new Error('sql-formatter does not have a format method. Type: ' + typeof formatter);
        }
        
        // Get current cursor position
        const currentPosition = editor.getPosition();
        
        // Update editor content
        editor.setValue(formattedCode);
        
        // Try to restore cursor position (approximate)
        if (currentPosition) {
            try {
                editor.setPosition(currentPosition);
            } catch (e) {
                // If position is invalid after formatting, just set to start
                editor.setPosition({ lineNumber: 1, column: 1 });
            }
        }
        
        console.log('[SQL-FORMATTER] SQL formatted successfully');
        
    } catch (error) {
        console.error('[SQL-FORMATTER] Error formatting SQL:', error);
        alert('Error formatting SQL: ' + error.message);
    }
}

// Debug: Log what's available in window scope when this script loads
console.log('[SQL-FORMATTER] Script loaded, checking for sql-formatter library...');
console.log('[SQL-FORMATTER] window.sqlFormatter:', typeof window.sqlFormatter);
console.log('[SQL-FORMATTER] All window props with "sql":', Object.keys(window).filter(k => k.toLowerCase().includes('sql')));
console.log('[SQL-FORMATTER] All window props with "format":', Object.keys(window).filter(k => k.toLowerCase().includes('format')));

// Export functions globally so they can be used by other scripts
window.formatSqlCode = formatSqlCode;
window.getFormattingOptions = function() { return formattingOptions; };
window.shouldFormatBeforeRun = function() { return formattingOptions.formatBeforeRun; };

// Call initialization when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[SQL-FORMATTER] DOM loaded, waiting for all scripts...');
        // Wait a bit to ensure sql-formatter is loaded from CDN
        setTimeout(() => {
            console.log('[SQL-FORMATTER] After delay - window.sqlFormatter:', typeof window.sqlFormatter);
            initializeFormatButton();
        }, 1000);
    });
} else {
    // DOM already loaded
    console.log('[SQL-FORMATTER] DOM already loaded, waiting for scripts...');
    setTimeout(() => {
        console.log('[SQL-FORMATTER] After delay - window.sqlFormatter:', typeof window.sqlFormatter);
        if (typeof editor !== 'undefined' && editor) {
            initializeFormatButton();
        } else {
            // Wait more for editor initialization
            setTimeout(initializeFormatButton, 1000);
        }
    }, 1000);
}
