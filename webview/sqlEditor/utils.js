// Initialize global state
const vscode = acquireVsCodeApi();
window.vscode = vscode;

window.dbSchema = { tables: [], views: [], foreignKeys: [] };
window.lastResults = null;
window.lastColumnNames = null;
window.lastMessages = [];
window.currentQueryPlan = null;
window.editor = null;
window.isUpdatingFromExtension = false;
window.currentTab = 'results';
window.isResizing = false;
window.activeConnections = [];
window.currentConnectionId = null;
window.currentDatabaseName = null;
window.validationTimeout = null;
window.actualPlanEnabled = false;
window.sqlSnippets = [];
window.completionProvider = null;
window.colorPrimaryForeignKeys = '#007acc'; // Default value

// Helper function to check if string is valid JSON
function escapeHtml(text) {
    if (!text) return text;
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function isValidJSON(str) {
    if (typeof str !== 'string' || !str.trim()) return false;
    const trimmed = str.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

// Helper function to remove execution summary comments from query text
function removeExecutionComments(queryText) {
    if (!queryText) return queryText;
    
    const lines = queryText.split('\n');
    const resultLines = [];
    let skipComments = false;
    
    for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Check if this line starts an execution summary comment block
        if (trimmedLine.startsWith('-- Query from history')) {
            skipComments = true;
            continue;
        }
        
        // If we're in a comment block, skip lines that look like execution metadata
        if (skipComments) {
            if (trimmedLine.startsWith('-- Executed:') || 
                trimmedLine.startsWith('-- Connection:') || 
                trimmedLine.startsWith('-- Result Sets:') ||
                trimmedLine === '') { // Also skip empty lines that are part of the comment block
                continue;
            } else {
                // Found a non-comment line, stop skipping
                skipComments = false;
            }
        }
        
        // If we're not skipping, add the line
        if (!skipComments) {
            resultLines.push(line);
        }
    }
    
    // Join the lines back together and trim any trailing whitespace
    return resultLines.join('\n').trimEnd();
}

// Helper function to check if string is valid XML
function isValidXML(str) {
    if (typeof str !== 'string' || !str.trim()) return false;
    const trimmed = str.trim();
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(trimmed, 'text/xml');
            const parseError = xmlDoc.querySelector('parsererror');
            return !parseError;
        } catch (e) {
            return false;
        }
    }
    return false;
}

// Helper function to format JSON
function formatJSON(str) {
    try {
        const parsed = JSON.parse(str.trim());
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        return str;
    }
}

// Helper function to format XML
function formatXML(str) {
    try {
        const xmlDoc = new DOMParser().parseFromString(str.trim(), 'text/xml');
        const serializer = new XMLSerializer();
        const formatted = serializer.serializeToString(xmlDoc);
        // Add basic indentation
        return formatted.replace(/(>)(<)(\/?)/g, '$1\n$2$3');
    } catch (e) {
        return str;
    }
}

// Function to open content in new editor
function openInNewEditor(content, language) {
    if (window.vscode) {
        window.vscode.postMessage({
            type: 'openInNewEditor',
            content: content,
            language: language
        });
    } else {
        console.error('vscode API not available');
    }
}
