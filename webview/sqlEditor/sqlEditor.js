const vscode = acquireVsCodeApi();
window.vscode = vscode;
console.log('SQL Editor Webview loaded');
let editor;
let isUpdatingFromExtension = false;
let currentTab = 'results';
let lastResults = null;
let lastMessages = [];
let isResizing = false;
let activeConnections = [];
var currentConnectionId = null;
var currentDatabaseName = null;
let dbSchema = { tables: [], views: [], foreignKeys: [] };
let validationTimeout = null;
let currentQueryPlan = null;
let actualPlanEnabled = false;
let sqlSnippets = []; // SQL snippets loaded from VS Code
let completionProvider = null; // Reference to current completion provider
let completionProviderRegistered = false; // Flag to track registration
let colorPrimaryForeignKeys = true; // Configuration for PK/FK column coloring

// Built-in SQL snippets
const builtInSnippets = [
    {
        name: "Script Header",
        prefix: "header",
        body: "-- =================================================================\n-- Author      : ${1:Your Name}\n-- Create date : ${CURRENT_YEAR}-${CURRENT_MONTH}-${CURRENT_DATE}\n-- Description : ${2:Short description}\n-- Version     : 1.0\n-- =================================================================\n",
        description: "Standard script/procedure header"
    },
    {
        name: "CREATE OR ALTER PROCEDURE",
        prefix: "proc",
        body: "CREATE OR ALTER PROCEDURE dbo.usp_${1:ProcedureName}\n\t${2:@Param} ${3:int} = NULL${4:, @Param2 nvarchar(100) = NULL}\nAS\nBEGIN\n\tSET NOCOUNT ON;\n\tSET XACT_ABORT ON;\n\n\t${0:-- TODO: implementation}\nEND\nGO",
        description: "Modern stored procedure (CREATE OR ALTER)"
    },
    {
        name: "CREATE OR ALTER PROCEDURE",
        prefix: "procedure",
        body: "CREATE OR ALTER PROCEDURE dbo.usp_${1:ProcedureName}\n\t${2:@Param} ${3:int} = NULL${4:, @Param2 nvarchar(100) = NULL}\nAS\nBEGIN\n\tSET NOCOUNT ON;\n\tSET XACT_ABORT ON;\n\n\t${0:-- TODO: implementation}\nEND\nGO",
        description: "Modern stored procedure (CREATE OR ALTER)"
    },
    {
        name: "CREATE OR ALTER PROCEDURE",
        prefix: "usp",
        body: "CREATE OR ALTER PROCEDURE dbo.usp_${1:ProcedureName}\n\t${2:@Param} ${3:int} = NULL${4:, @Param2 nvarchar(100) = NULL}\nAS\nBEGIN\n\tSET NOCOUNT ON;\n\tSET XACT_ABORT ON;\n\n\t${0:-- TODO: implementation}\nEND\nGO",
        description: "Modern stored procedure (CREATE OR ALTER)"
    },
    {
        name: "CREATE OR ALTER VIEW",
        prefix: "vw",
        body: "CREATE OR ALTER VIEW dbo.v_${1:ViewName}\nAS\n${0:-- SELECT …}\nGO",
        description: "CREATE OR ALTER VIEW template"
    },
    {
        name: "CREATE OR ALTER VIEW",
        prefix: "view",
        body: "CREATE OR ALTER VIEW dbo.v_${1:ViewName}\nAS\n${0:-- SELECT …}\nGO",
        description: "CREATE OR ALTER VIEW template"
    },
    {
        name: "CREATE OR ALTER VIEW",
        prefix: "v_",
        body: "CREATE OR ALTER VIEW dbo.v_${1:ViewName}\nAS\n${0:-- SELECT …}\nGO",
        description: "CREATE OR ALTER VIEW template"
    },
    {
        name: "CREATE OR ALTER FUNCTION (Scalar)",
        prefix: "funcs",
        body: "CREATE OR ALTER FUNCTION dbo.uf_${1:FunctionName} (@${2:Param} int)\nRETURNS ${3:int}\nAS\nBEGIN\n\tRETURN ${0:0}\nEND\nGO",
        description: "CREATE OR ALTER SCALAR FUNCTION"
    },
    {
        name: "CREATE OR ALTER FUNCTION (Scalar)",
        prefix: "scalar",
        body: "CREATE OR ALTER FUNCTION dbo.uf_${1:FunctionName} (@${2:Param} int)\nRETURNS ${3:int}\nAS\nBEGIN\n\tRETURN ${0:0}\nEND\nGO",
        description: "CREATE OR ALTER SCALAR FUNCTION"
    },
    {
        name: "CREATE OR ALTER FUNCTION (Table-Valued)",
        prefix: "func",
        body: "CREATE OR ALTER FUNCTION dbo.uf_${1:FunctionName} (@${2:Param} int = NULL)\nRETURNS TABLE\nAS\nRETURN (\n\tSELECT ${0:1} AS Result\n)\nGO",
        description: "CREATE OR ALTER TABLE-VALUED FUNCTION"
    },
    {
        name: "CREATE OR ALTER FUNCTION (Table-Valued)",
        prefix: "tvf",
        body: "CREATE OR ALTER FUNCTION dbo.uf_${1:FunctionName} (@${2:Param} int = NULL)\nRETURNS TABLE\nAS\nRETURN (\n\tSELECT ${0:1} AS Result\n)\nGO",
        description: "CREATE OR ALTER TABLE-VALUED FUNCTION"
    },
    {
        name: "CREATE OR ALTER FUNCTION (Table-Valued)",
        prefix: "uf",
        body: "CREATE OR ALTER FUNCTION dbo.uf_${1:FunctionName} (@${2:Param} int = NULL)\nRETURNS TABLE\nAS\nRETURN (\n\tSELECT ${0:1} AS Result\n)\nGO",
        description: "CREATE OR ALTER TABLE-VALUED FUNCTION"
    },
    {
        name: "CREATE OR ALTER TRIGGER",
        prefix: "trig",
        body: "CREATE OR ALTER TRIGGER dbo.tr_${1:Table}_${2:Insert}\nON dbo.${3:Table}\nAFTER ${4:INSERT}\nAS\nBEGIN\n\tSET NOCOUNT ON;\n\t${0:-- TODO}\nEND\nGO",
        description: "CREATE OR ALTER TRIGGER"
    },
    {
        name: "CREATE OR ALTER TRIGGER",
        prefix: "trigger",
        body: "CREATE OR ALTER TRIGGER dbo.tr_${1:Table}_${2:Insert}\nON dbo.${3:Table}\nAFTER ${4:INSERT}\nAS\nBEGIN\n\tSET NOCOUNT ON;\n\t${0:-- TODO}\nEND\nGO",
        description: "CREATE OR ALTER TRIGGER"
    },
    {
        name: "CREATE TABLE",
        prefix: "ct",
        body: "CREATE TABLE dbo.${1:TableName}\n(\n\t${2:Id} int IDENTITY(1,1) NOT NULL,\n\t${3:Column} nvarchar(100) NULL,\n\tCONSTRAINT PK_${1:TableName} PRIMARY KEY CLUSTERED (${2:Id})\n)\nGO",
        description: "CREATE TABLE with primary key"
    },
    {
        name: "CREATE TABLE",
        prefix: "table",
        body: "CREATE TABLE dbo.${1:TableName}\n(\n\t${2:Id} int IDENTITY(1,1) NOT NULL,\n\t${3:Column} nvarchar(100) NULL,\n\tCONSTRAINT PK_${1:TableName} PRIMARY KEY CLUSTERED (${2:Id})\n)\nGO",
        description: "CREATE TABLE with primary key"
    },
    {
        name: "SELECT * FROM",
        prefix: "sel",
        body: "SELECT ${1:*} FROM ${2:dbo}.${3:Table} ${4:AS t}${0}",
        description: "Basic SELECT statement"
    },
    {
        name: "SELECT with NOLOCK",
        prefix: "self",
        body: "SELECT * FROM ${1:dbo}.${2:Table} WITH (NOLOCK)${0}",
        description: "SELECT with NOLOCK hint"
    },
    {
        name: "SELECT with NOLOCK",
        prefix: "nolock",
        body: "SELECT * FROM ${1:dbo}.${2:Table} WITH (NOLOCK)${0}",
        description: "SELECT with NOLOCK hint"
    },
    {
        name: "SELECT TOP 1000",
        prefix: "top",
        body: "SELECT TOP (1000) ${1:*}",
        description: "Quick preview"
    },
    {
        name: "COUNT(*)",
        prefix: "selc",
        body: "SELECT COUNT(*) FROM ${1:dbo}.${2:Table}${0}",
        description: "Count all records"
    },
    {
        name: "INSERT INTO",
        prefix: "ins",
        body: "INSERT INTO ${1:dbo}.${2:Table} (${3:Column}) VALUES (${4:value})${0}",
        description: "Basic INSERT statement"
    },
    {
        name: "INSERT SELECT",
        prefix: "insel",
        body: "INSERT INTO ${1:dbo}.${2:Target} (${3:Columns})\nSELECT ${4:Columns} FROM ${5:dbo}.${6:Source}${0}",
        description: "INSERT with SELECT"
    },
    {
        name: "UPDATE",
        prefix: "upd",
        body: "UPDATE ${1:t}\nSET ${2:t.Column = value}\nFROM ${3:dbo}.${4:Table} AS t${5: WHERE <condition>}${0}",
        description: "UPDATE with FROM clause"
    },
    {
        name: "DELETE",
        prefix: "del",
        body: "DELETE FROM ${1:dbo}.${2:Table} WHERE ${3:Id = @Id}${0}",
        description: "Basic DELETE statement"
    },
    {
        name: "TRUNCATE TABLE",
        prefix: "trunc",
        body: "TRUNCATE TABLE ${1:dbo}.${2:Table}",
        description: "Truncate table (fast delete)"
    },
    {
        name: "MERGE",
        prefix: "merge",
        body: "MERGE ${1:dbo}.${2:Target} AS t\nUSING ${3:Source} AS s ON t.${4:Key} = s.${4:Key}\nWHEN MATCHED THEN UPDATE SET ${5:t.Col = s.Col}\nWHEN NOT MATCHED BY TARGET THEN INSERT (${6:Cols}) VALUES (${7:s.Cols})\nWHEN NOT MATCHED BY SOURCE THEN DELETE;\nGO",
        description: "MERGE statement (UPSERT)"
    },
    {
        name: "Common Table Expression",
        prefix: "cte",
        body: "WITH ${1:cteName} AS (\n\t${2:-- query}\n)\nSELECT * FROM ${1:cteName}${0}",
        description: "CTE (Common Table Expression)"
    },
    {
        name: "IF EXISTS",
        prefix: "exists",
        body: "IF EXISTS (SELECT 1 FROM ${1:dbo}.${2:Table} WHERE ${3:Id = @Id})\nBEGIN\n\t${0:-- code}\nEND",
        description: "IF EXISTS conditional block"
    },
    {
        name: "Temp Table",
        prefix: "#t",
        body: "CREATE TABLE #${1:TempName} (\n\t${2:Id} int,\n\t${3:Name} nvarchar(100)\n)${0}",
        description: "Create temporary table"
    },
    {
        name: "Table Variable",
        prefix: "@t",
        body: "DECLARE @${1:Table} TABLE (\n\t${2:Id} int,\n\t${3:Name} nvarchar(100)\n)${0}",
        description: "Declare table variable"
    },
    {
        name: "BEGIN TRANSACTION",
        prefix: "tran",
        body: "BEGIN TRANSACTION;\nBEGIN TRY\n\t${0:-- your code}\n\tCOMMIT TRANSACTION;\nEND TRY\nBEGIN CATCH\n\tIF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;\n\tTHROW;\nEND CATCH",
        description: "Transaction with error handling"
    },
    {
        name: "TRY CATCH",
        prefix: "try",
        body: "BEGIN TRY\n\t${0:-- code}\nEND TRY\nBEGIN CATCH\n\tSELECT ERROR_NUMBER() AS ErrorNumber, ERROR_MESSAGE() AS ErrorMessage;\n\tTHROW;\nEND CATCH",
        description: "TRY...CATCH block"
    },
    {
        name: "THROW Error",
        prefix: "throw",
        body: "THROW 50000, '${1:Error message}', 1;",
        description: "Throw custom error"
    },
    {
        name: "Pagination (OFFSET/FETCH)",
        prefix: "offset",
        body: "ORDER BY ${1:Id}\nOFFSET ${2:@PageSize} * (${3:@PageNumber} - 1) ROWS\nFETCH NEXT ${2:@PageSize} ROWS ONLY",
        description: "ROW_NUMBER() pagination"
    },
    {
        name: "Missing Indexes Query",
        prefix: "missing",
        body: "-- Top missing indexes\nSELECT TOP 25\n\tmigs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) AS Impact,\n\tmid.statement,\n\t'CREATE INDEX ix_' + OBJECT_NAME(mid.object_id) + '_' + REPLACE(ISNULL(mid.equality_columns,''), ', ', '_') + ISNULL('_' + mid.inequality_columns, '')\n\t\t+ ' INCLUDE (' + ISNULL(mid.included_columns, '') + ');' AS CreateIndexStatement\nFROM sys.dm_db_missing_index_groups mig\nJOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle\nJOIN sys.dm_db_missing_index_details mid ON mig.index_handle = mid.index_handle\nORDER BY Impact DESC;",
        description: "Query to find missing indexes"
    },
    {
        name: "Enable Execution Plan",
        prefix: "plan",
        body: "SET STATISTICS IO, TIME ON;\nSET SHOWPLAN_XML ON;\n-- SET STATISTICS XML ON;\nGO",
        description: "Enable execution plan and statistics"
    },
    {
        name: "Dynamic SQL",
        prefix: "dyn",
        body: "DECLARE @sql nvarchar(max) = N'${1:SELECT * FROM dbo.Table WHERE Id = @Id}';\nEXEC sp_executesql @sql, N'@Id int', @Id = ${2:1};",
        description: "Execute dynamic SQL with parameters"
    },
    {
        name: "FOR JSON PATH",
        prefix: "json",
        body: "FOR JSON PATH${1:, ROOT('data')}${2:, INCLUDE_NULL_VALUES}",
        description: "Format results as JSON"
    },
    {
        name: "OPENJSON",
        prefix: "openjson",
        body: "OPENJSON(@json) WITH (\n\t${1:Id} int '$.id',\n\t${2:Name} nvarchar(100) '$.name'\n)${0}",
        description: "Parse JSON data"
    },
    {
        name: "Rebuild Indexes",
        prefix: "reindex",
        body: "ALTER INDEX ALL ON ${1:dbo}.${2:Table} REBUILD WITH (ONLINE = ON, SORT_IN_TEMPDB = ON);",
        description: "Rebuild all indexes on table"
    },
    {
        name: "Update Statistics",
        prefix: "stats",
        body: "UPDATE STATISTICS ${1:dbo}.${2:Table} WITH FULLSCAN;",
        description: "Update table statistics"
    },
    {
        name: "sp_who2",
        prefix: "spwho",
        body: "EXEC sp_who2;",
        description: "Show active connections"
    },
    {
        name: "Azure Elastic Query – External Table",
        prefix: "elastic",
        body: "-- Example external table (Azure SQL cross-database)\n\tCREATE EXTERNAL DATA SOURCE RemoteDb WITH (\n\t\\tTYPE = RDBMS,\n\t\\tLOCATION = 'server.database.windows.net',\n\t\\tDATABASE_NAME = 'RemoteDb',\n\t\\tCREDENTIAL = ElasticCredential\n\t);\n\tCREATE EXTERNAL TABLE dbo.${1:RemoteTable} (\n\t\\t${2:Id} int\n\t) WITH (DATA_SOURCE = RemoteDb);",
        description: "Azure Elastic Query - External Table"
    },
    {
        name: "CETAS (Synapse/Fabric)",
        prefix: "cetas",
        body: "CREATE EXTERNAL TABLE ${1:ExternalTable}\n\tWITH (\n\t\\tLOCATION = '${2:folder/file.parquet}',\n\t\\tDATA_SOURCE = ${3:storage},\n\t\\tFILE_FORMAT = ${4:ParquetFormat}\n\t) AS\n\tSELECT ${0:*} FROM ${5:SourceTable};",
        description: "CREATE EXTERNAL TABLE AS SELECT (Synapse/Fabric)"
    },
    {
        name: "Print Long String (>4000 chars)",
        prefix: "printlong",
        body: "DECLARE @i int = 1, @len int = LEN(@LongString);\n\tWHILE @i <= @len BEGIN\n\t\\tPRINT SUBSTRING(@LongString, @i, 4000);\n\t\\tSET @i += 4000;\n\tEND",
        description: "Print strings longer than 4000 characters"
    }
];

// Query execution timer
let queryStartTime = null;
let queryTimerInterval = null;

// Editable result sets support
let resultSetMetadata = []; // Metadata for each result set
let originalQuery = ''; // Original SELECT query for UPDATE generation
let pendingChanges = new Map(); // Map<resultSetIndex, Array<ChangeRecord>>
let currentEditingCell = null; // Currently editing cell reference

// Helper function to check if string is valid JSON
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
    vscode.postMessage({
        type: 'openInNewEditor',
        content: content,
        language: language
    });
}

// Global selection state for all tables in results
let globalSelection = {
    type: null, // 'row', 'column', or 'cell'
    tableContainer: null, // reference to the specific table container
    selections: [], // Array of selected items: {rowIndex, columnIndex, cellValue}
    columnDef: null,
    data: null,
    columnDefs: null,
    lastClickedIndex: null // Last clicked row/column index for Shift selection
};

// Initialize Monaco Editor
require.config({ 
    paths: { 
        vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' 
    }
});

require(['vs/editor/editor.main'], function () {
    // Detect VS Code theme
    function detectTheme() {
        const body = document.body;
        if (body.classList.contains('vscode-dark') || body.classList.contains('vscode-high-contrast')) {
            return 'vs-dark';
        }
        return 'vs';
    }
    
    const theme = detectTheme();
    
    const editorElement = document.getElementById('editor');
    if (editorElement) {
        editor = monaco.editor.create(editorElement, {
            value: '',
            language: 'sql',
            theme: theme,
            automaticLayout: true,
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 14,
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 4,
            insertSpaces: true
        });

        // Watch for theme changes
        const observer = new MutationObserver(() => {
            const newTheme = detectTheme();
            if (editor) {
                monaco.editor.setTheme(newTheme);
            }
        });
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    // Listen for content changes
    editor.onDidChangeModelContent(() => {
        if (!isUpdatingFromExtension) {
            vscode.postMessage({
                type: 'documentChanged',
                content: editor.getValue()
            });
            
            // Validate SQL after a short delay
            clearTimeout(validationTimeout);
            validationTimeout = setTimeout(() => {
                validateSql();
            }, 500);
        }
    });

    // Remember right-click position so context-menu 'Go to definition' can use it
    let lastContextPosition = null;
    editor.onMouseDown(function(e) {
        try {
            // e.event.rightButton is true for right-clicks
            // Robust detection: check common event properties for right click
            var isRight = false;
            try {
                if (e.event) {
                    // PointerEvent / MouseEvent properties
                    isRight = !!(e.event.rightButton || e.event.button === 2 || e.event.which === 3);
                }
            } catch (inner) {
                isRight = false;
            }

            if (isRight) {
                if (e.target && e.target.position) {
                    lastContextPosition = e.target.position;
                } else {
                    lastContextPosition = editor.getPosition();
                }
                console.log('[editor.onMouseDown] right-click at position', lastContextPosition);
            }
        } catch (err) {
            console.error('[editor.onMouseDown] error', err);
        }
    });

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyCode.F5, () => {
        executeQuery();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE, () => {
        executeQuery();
    });

    // Register SQL completion provider (initial registration)
    registerCompletionProvider();

    // Register SQL hover provider - shows table/column details using dbSchema
    console.log('[SQL-HOVER] Registering hover provider');
    monaco.languages.registerHoverProvider('sql', {
        provideHover: (model, position) => {
            try {
                const fullText = model.getValue();
                const tablesInQuery = extractTablesFromQuery(fullText) || [];
                const line = model.getLineContent(position.lineNumber);
                const beforeCursor = line.substring(0, position.column - 1);

                // Helper to render a table's columns as markdown table
                function renderTableMarkdown(schemaName, tableName, cols) {
                    var md = '| Column | Type | Nullable |\n';
                    md += '|---|---|---|\n';
                    for (var i = 0; i < cols.length; i++) {
                        var c = cols[i];
                        var type = c.type + (c.maxLength ? '(' + c.maxLength + ')' : '');
                        var nullable = c.nullable ? 'YES' : 'NO';
                        md += '| ' + c.name + ' | ' + type + ' | ' + nullable + ' |\n';
                    }
                    return '**' + schemaName + '.' + tableName + '**\n\n' + md;
                }

                // Detect alias.column or table.column pattern before cursor
                var aliasColMatch = beforeCursor.match(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]*)$/);
                if (aliasColMatch) {
                    var alias = aliasColMatch[1];
                    var colName = aliasColMatch[2];

                    // Resolve alias to table
                    var tableInfo = findTableForAlias(fullText, alias) || findTable(alias);
                    if (tableInfo) {
                        var cols = getColumnsForTable(tableInfo.schema, tableInfo.table) || [];
                        var col = cols.find(function(c) { return c.name.toLowerCase() === colName.toLowerCase(); });
                        if (col) {
                            var mdSingle = '| Property | Value |\n|---|---:|\n';
                            mdSingle += '| Table | ' + tableInfo.schema + '.' + tableInfo.table + ' |\n';
                            mdSingle += '| Column | ' + col.name + ' |\n';
                            mdSingle += '| Type | ' + col.type + (col.maxLength ? '(' + col.maxLength + ')' : '') + ' |\n';
                            mdSingle += '| Nullable | ' + (col.nullable ? 'YES' : 'NO') + ' |\n';
                            var matchText = aliasColMatch[0];
                            var startCol = beforeCursor.lastIndexOf(matchText) + 1;
                            var range = new monaco.Range(position.lineNumber, startCol, position.lineNumber, startCol + matchText.length);
                            return { contents: [{ value: mdSingle }], range: range };
                        }

                        // Column not found - show top columns preview as table
                        var previewCols = cols.slice(0, 12);
                        var tableMd = renderTableMarkdown(tableInfo.schema, tableInfo.table, previewCols);
                        var startCol2 = beforeCursor.lastIndexOf(alias) + 1;
                        var range2 = new monaco.Range(position.lineNumber, startCol2, position.lineNumber, startCol2 + alias.length);
                        return { contents: [{ value: tableMd }], range: range2 };
                    }
                }

                // No alias dot - check standalone word under cursor
                var wordObj = model.getWordAtPosition(position);
                if (wordObj && wordObj.word) {
                    var w = wordObj.word;

                    // If it's a table name, show full table definition as markdown table
                    var table = findTable(w);
                    if (table) {
                        var cols2 = getColumnsForTable(table.schema, table.table) || [];
                        var md2 = renderTableMarkdown(table.schema, table.table, cols2);
                        // (removed inline link) user can use the editor context menu 'Go to definition'
                        var range3 = new monaco.Range(position.lineNumber, wordObj.startColumn, position.lineNumber, wordObj.endColumn);
                        return { contents: [{ value: md2 }], range: range3 };
                    }

                    // If it's a column name present in multiple tables, prefer tables present in the current query
                    var matching = dbSchema.tables.filter(function(t){ return t.columns.some(function(c){ return c.name.toLowerCase() === w.toLowerCase(); }); });
                    if (matching.length > 1) {
                        // filter by tables present in query
                        var inQuery = matching.filter(function(t){
                            return tablesInQuery.some(function(q){ return q.table.toLowerCase() === t.name.toLowerCase() && (q.schema ? q.schema === t.schema : true); });
                        });
                        var effective = inQuery.length > 0 ? inQuery : matching;

                        // Build a markdown table listing each matching table and the column details
                        var mdMulti = '| Table | Column | Type | Nullable |\n';
                        mdMulti += '|---|---|---|---|\n';
                        for (var mi = 0; mi < effective.length; mi++) {
                            var mt = effective[mi];
                            var mc = mt.columns.find(function(c){ return c.name.toLowerCase() === w.toLowerCase(); });
                            if (mc) {
                                var type = mc.type + (mc.maxLength ? '(' + mc.maxLength + ')' : '');
                                var nullable = mc.nullable ? 'YES' : 'NO';
                                mdMulti += '| ' + mt.schema + '.' + mt.name + ' | ' + mc.name + ' | ' + type + ' | ' + nullable + ' |\n';
                            }
                        }
                        var range5 = new monaco.Range(position.lineNumber, wordObj.startColumn, position.lineNumber, wordObj.endColumn);
                        // (removed inline link) user can use the editor context menu 'Go to definition'
                        return { contents: [{ value: mdMulti }], range: range5 };
                    }

                    // If it's a column name present in exactly one table in schema, show that column
                    if (matching.length === 1) {
                        var t = matching[0];
                        var col = t.columns.find(function(c){ return c.name.toLowerCase() === w.toLowerCase(); });
                        var md3 = '| Property | Value |\n|---|---:|\n';
                        md3 += '| Table | ' + t.schema + '.' + t.name + ' |\n';
                        md3 += '| Column | ' + col.name + ' |\n';
                        md3 += '| Type | ' + col.type + (col.maxLength ? '(' + col.maxLength + ')' : '') + ' |\n';
                        md3 += '| Nullable | ' + (col.nullable ? 'YES' : 'NO') + ' |\n';
                        var range4 = new monaco.Range(position.lineNumber, wordObj.startColumn, position.lineNumber, wordObj.endColumn);
                        // (removed inline link) user can use the editor context menu 'Go to definition'
                        return { contents: [{ value: md3 }], range: range4 };
                    }
                }
            } catch (err) {
                console.error('[SQL-HOVER] Error in hover provider', err);
            }

            return null;
        }
    });

    // Notify extension that webview is ready
    vscode.postMessage({ type: 'ready' });
    
    // Request SQL snippets from extension
    vscode.postMessage({ type: 'getSnippets' });

    // Ensure Go-to-definition action is registered after editor is created
    try {
        if (typeof registerGoToDefinitionAction === 'function') {
            registerGoToDefinitionAction();
            console.log('[GoToDef] Registered action inside require callback');
        }
    } catch (e) {
        console.error('[GoToDef] Failed to register inside require callback', e);
    }
    
    // Register Create Snippet action
    try {
        registerCreateSnippetAction();
        console.log('[SNIPPETS] Create snippet action registered');
    } catch (e) {
        console.error('[SNIPPETS] Failed to register create snippet action:', e);
    }

    // Add global keyboard listener for CTRL+C to copy table selections
    setupGlobalKeyboardHandlers();
});

// Toolbar buttons
const executeButton = document.getElementById('executeButton');
if (executeButton) {
    executeButton.addEventListener('click', () => {
        executeQuery();
    });
}

// Execute button dropdown functionality
const executeDropdownToggle = document.getElementById('executeDropdownToggle');
const executeDropdownMenu = document.getElementById('executeDropdownMenu');

if (executeDropdownToggle && executeDropdownMenu) {
    executeDropdownToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        executeDropdownMenu.classList.toggle('show');
        executeDropdownToggle.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        const buttonContainer = executeDropdownToggle.closest('.button-container');
        if (buttonContainer && !buttonContainer.contains(e.target)) {
            executeDropdownMenu.classList.remove('show');
            executeDropdownToggle.classList.remove('open');
        }
    });
}


// Register a Monaco editor action that appears in the context menu for "Go to definition"
// This uses the editor selection/word under cursor to build the payload and forwards it to the extension
function registerGoToDefinitionAction() {
    // Helper: build a simple CREATE TABLE DDL from an entry in dbSchema
    function buildTableDDL(table) {
        try {
            var lines = [];
            lines.push('-- Generated table definition');
            lines.push('CREATE TABLE ' + table.schema + '.' + table.name + ' (');
            for (var i = 0; i < table.columns.length; i++) {
                var c = table.columns[i];
                var colType = c.type + (c.maxLength ? '(' + c.maxLength + ')' : '');
                var nullable = c.nullable ? 'NULL' : 'NOT NULL';
                lines.push('    ' + c.name + ' ' + colType + ' ' + nullable + (i < table.columns.length - 1 ? ',' : ''));
            }
            lines.push(');');

            // Append any foreign keys that reference or are defined on this table
            if (dbSchema && Array.isArray(dbSchema.foreignKeys)) {
                var fks = dbSchema.foreignKeys.filter(function(f) {
                    return (f.fromSchema === table.schema && f.fromTable === table.name) || (f.toSchema === table.schema && f.toTable === table.name);
                });
                if (fks.length > 0) {
                    lines.push('\n-- Foreign key relationships (summary):');
                    for (var j = 0; j < fks.length; j++) {
                        var fk = fks[j];
                        lines.push('-- ' + fk.constraintName + ': ' + fk.fromSchema + '.' + fk.fromTable + '(' + fk.fromColumn + ') -> ' + fk.toSchema + '.' + fk.toTable + '(' + fk.toColumn + ')');
                    }
                }
            }

            return lines.join('\n');
        } catch (err) {
            console.error('[buildTableDDL] error', err);
            return '-- Unable to generate definition';
        }
    }

    editor.addAction({
        id: 'mssqlmanager.goToDefinition',
        label: 'Go to definition',
        keybindings: [],
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.5,
        run: function(ed) {
            try {
            // Prefer lastContextPosition (right-click) when available
            const position = (typeof lastContextPosition !== 'undefined' && lastContextPosition) ? lastContextPosition : ed.getPosition();
                const model = ed.getModel();
                if (!model || !position) return;

                console.log('[GoToDef.run] invoked. position=', position);

                // Get the token/word at position
                const wordInfo = model.getWordAtPosition(position);
                console.log('[GoToDef.run] wordInfo=', wordInfo);
                const line = model.getLineContent(position.lineNumber);
                const before = line.substring(0, position.column - 1);

                // Try alias.column pattern first
                const aliasColMatch = before.match(/([A-Za-z0-9_]+)\.([A-Za-z0-9_]*)$/);
                if (aliasColMatch) {
                    const alias = aliasColMatch[1];
                    const colName = aliasColMatch[2];
                    const fullText = model.getValue();
                    const tableInfo = findTableForAlias(fullText, alias) || findTable(alias);
                    if (tableInfo) {
                        vscode.postMessage({ type: 'goToDefinition', objectType: 'column', schema: tableInfo.schema, table: tableInfo.table, column: colName, connectionId: currentConnectionId, database: currentDatabaseName });
                        return;
                    }
                }

                // Fallback to word under cursor
                if (wordInfo && wordInfo.word) {
                    // Helper to parse qualified identifiers and strip brackets/quotes
                    function stripIdentifierPart(part) {
                        if (!part) return part;
                        // Remove square brackets or double quotes if present
                        part = part.trim();
                        if ((part.startsWith('[') && part.endsWith(']')) || (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))) {
                            return part.substring(1, part.length - 1);
                        }
                        return part;
                    }

                    function parseQualifiedIdentifier(name) {
                        if (!name) return { schema: null, table: null };
                        // If it contains a dot, split into parts (handles [schema].[table] and schema.table)
                        const parts = name.split('.');
                        if (parts.length === 2) {
                            return { schema: stripIdentifierPart(parts[0]), table: stripIdentifierPart(parts[1]) };
                        }
                        // If single part, strip any brackets
                        return { schema: null, table: stripIdentifierPart(name) };
                    }

                    const rawWord = wordInfo.word;
                    const fullText = model.getValue();

                    // parse possible qualified identifier
                    const parsed = parseQualifiedIdentifier(rawWord);

                    // If we have schema + table from the token itself, try to use it
                    if (parsed.table && parsed.schema) {
                        // Prefer asking the extension to script authoritative CREATE for this table
                        vscode.postMessage({ type: 'scriptTableCreate', schema: parsed.schema, table: parsed.table, connectionId: currentConnectionId, database: currentDatabaseName });
                        return;
                    }

                    // If raw token is just table name (possibly bracketed), normalize and try to find
                    const normalizedTableName = parsed.table;
                    // Attempt to find table by name (findTable handles case-insensitive match)
                    const table = findTable(normalizedTableName);
                    if (table) {
                        // Try to build a DDL preview from the in-memory schema and open in a new editor
                        var schemaTable = dbSchema.tables.find(function(t){ return t.schema === table.schema && (t.name === table.table || t.name === table.name); });
                        if (schemaTable) {
                            // Still prefer extension script for full fidelity, but if no extension available fallback to local DDL
                            try {
                                vscode.postMessage({ type: 'scriptTableCreate', schema: schemaTable.schema, table: schemaTable.name, connectionId: currentConnectionId, database: currentDatabaseName });
                                return;
                            } catch (e) {
                                var ddl = buildTableDDL(schemaTable);
                                openInNewEditor(ddl, 'sql');
                                return;
                            }
                        }

                        // Fallback to extension reveal if schema not available
                        vscode.postMessage({ type: 'goToDefinition', objectType: 'table', schema: table.schema, table: table.table, connectionId: currentConnectionId, database: currentDatabaseName });
                        return;
                    }

                    // If it's a column in a single table, go to that column
                    const matching = dbSchema.tables.filter(function(t){ return t.columns.some(function(c){ return c.name.toLowerCase() === normalizedTableName.toLowerCase(); }); });
                    // Prefer tables found in the query
                    const tablesInQuery = extractTablesFromQuery(fullText) || [];
                    if (matching.length > 0) {
                        const inQuery = matching.filter(function(t){ return tablesInQuery.some(function(q){ return q.table.toLowerCase() === t.name.toLowerCase() && (q.schema ? q.schema === t.schema : true); }); });
                        const effective = inQuery.length > 0 ? inQuery : matching;
                        // If exactly one table match, reveal that column
                        if (effective.length === 1) {
                            // Open table DDL and include a marker for the column
                            var only = effective[0];
                            var schemaTable2 = dbSchema.tables.find(function(t){ return t.schema === only.schema && t.name === only.name; });
                            if (schemaTable2) {
                                var ddl2 = buildTableDDL(schemaTable2);
                                ddl2 += '\n\n-- Column: ' + normalizedTableName;
                                openInNewEditor(ddl2, 'sql');
                                return;
                            }

                            // Fallback to extension reveal
                            vscode.postMessage({ type: 'goToDefinition', objectType: 'column', schema: effective[0].schema, table: effective[0].name, column: normalizedTableName, connectionId: currentConnectionId, database: currentDatabaseName });
                            return;
                        }
                        // Otherwise, send a column-list type so extension can fall back to best guess
                        vscode.postMessage({ type: 'goToDefinition', objectType: 'column-list', column: normalizedTableName, connectionId: currentConnectionId, database: currentDatabaseName });
                        return;
                    }
                }
            } catch (err) {
                console.error('[GoToDefAction] Error building goToDefinition payload', err);
            }
        }
    });
}

// Register the action once the editor is ready
if (typeof editor !== 'undefined' && editor) {
    registerGoToDefinitionAction();
} else {
    // If editor not yet ready, try to register later in the monaco loader callback
    // (the editor is created in require(['vs/editor/editor.main'], ... ) earlier)
}

// Prevent dropdown from closing when clicking inside
executeDropdownMenu.addEventListener('click', (e) => {
    e.stopPropagation();
});

const cancelButton = document.getElementById('cancelButton');
if (cancelButton) {
    cancelButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'cancelQuery' });
    });
}

const connectButton = document.getElementById('connectButton');
if (connectButton) {
    connectButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'manageConnections' });
    });
}

const estimatedPlanButton = document.getElementById('estimatedPlanButton');
if (estimatedPlanButton) {
    estimatedPlanButton.addEventListener('click', () => {
        executeEstimatedPlan();
    });
}

const actualPlanCheckbox = document.getElementById('actualPlanCheckbox');
if (actualPlanCheckbox) {
    actualPlanCheckbox.addEventListener('change', (e) => {
        actualPlanEnabled = e.target.checked;
    });
}

// Custom Dropdown Class for Connection and Database Selectors
class CustomDropdown {
    constructor(containerId, onSelect) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.warn(`CustomDropdown: Container with id '${containerId}' not found`);
            return;
        }
        
        this.trigger = this.container.querySelector('.dropdown-trigger');
        this.menu = this.container.querySelector('.dropdown-menu');
        this.onSelect = onSelect;
        this.selectedValue = null;

        if (this.trigger && this.menu) {
            this.init();
        } else {
            console.warn(`CustomDropdown: Required elements not found in container '${containerId}'`);
        }
    }

    init() {
        if (!this.trigger || !this.container) return;
        
        // Toggle dropdown on trigger click
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    toggle() {
        if (!this.menu || !this.trigger) return;
        
        const isOpen = this.menu.classList.contains('open');

        // Close all other dropdowns
        document.querySelectorAll('.dropdown-menu.open').forEach(menu => {
            menu.classList.remove('open');
        });
        document.querySelectorAll('.dropdown-trigger.open').forEach(trigger => {
            trigger.classList.remove('open');
        });

        if (!isOpen) {
            this.open();
        } else {
            this.close();
        }
    }

    open() {
        if (!this.menu || !this.trigger) return;
        
        this.menu.classList.add('open');
        this.trigger.classList.add('open');
    }

    close() {
        if (!this.menu || !this.trigger) return;
        
        this.menu.classList.remove('open');
        this.trigger.classList.remove('open');
    }

    setItems(items) {
        if (!this.menu || !this.trigger) return;
        
        // items should be array of {value, text, selected}
        this.menu.innerHTML = '';
        
        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';
            div.textContent = item.text;
            div.dataset.value = item.value;
            
            if (item.selected) {
                div.classList.add('selected');
                this.trigger.textContent = item.text;
                this.selectedValue = item.value;
            }
            
            div.addEventListener('click', () => {
                this.selectItem(item.value, item.text);
            });
            
            this.menu.appendChild(div);
        });
    }

    selectItem(value, text) {
        if (!this.menu || !this.trigger) return;
        
        // Remove selected class from all items
        this.menu.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('selected'));

        // Add selected class to clicked item
        const selectedItem = this.menu.querySelector(`[data-value="${value}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }

        // Update trigger text
        this.trigger.textContent = text;
        this.selectedValue = value;

        // Close dropdown
        this.close();

        // Call the callback
        if (this.onSelect) {
            this.onSelect(value);
        }
    }

    setValue(value, text) {
        this.trigger.textContent = text;
        this.selectedValue = value;
        
        // Update selected state in menu
        this.menu.querySelectorAll('.dropdown-item').forEach(i => {
            i.classList.remove('selected');
            if (i.dataset.value === value) {
                i.classList.add('selected');
            }
        });
    }

    setDisabled(disabled) {
        this.trigger.disabled = disabled;
    }

    show() {
        this.container.style.display = 'inline-block';
    }

    hide() {
        this.container.style.display = 'none';
    }
}

// Initialize custom dropdowns
const connectionDropdown = new CustomDropdown('connection-dropdown', (connectionId) => {
    currentConnectionId = connectionId;
    
    if (connectionId) {
        // Find connection config to check type
        const connection = activeConnections.find(c => c.id === connectionId);
        
        if (connection && connection.connectionType === 'server') {
            // Show database selector and request database list
            const databaseLabel = document.getElementById('databaseLabel');
            if (databaseLabel) {
                databaseLabel.style.display = 'inline-block';
            }
            databaseDropdown.show();
            
            vscode.postMessage({
                type: 'switchConnection',
                connectionId: connectionId
            });
        } else {
            // Hide database selector for direct database connections
            const databaseLabel = document.getElementById('databaseLabel');
            if (databaseLabel) {
                databaseLabel.style.display = 'none';
            }
            databaseDropdown.hide();
            currentDatabaseName = null;
            
            vscode.postMessage({
                type: 'switchConnection',
                connectionId: connectionId
            });
        }
    } else {
        const databaseLabel = document.getElementById('databaseLabel');
        if (databaseLabel) {
            databaseLabel.style.display = 'none';
        }
        databaseDropdown.hide();
    }
});

const databaseDropdown = new CustomDropdown('database-dropdown', (databaseName) => {
    currentDatabaseName = databaseName;
    
    if (currentConnectionId && databaseName) {
        vscode.postMessage({
            type: 'switchDatabase',
            connectionId: currentConnectionId,
            databaseName: databaseName
        });
    }
});

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
        resultsContent.style.display = 'none';
        messagesContent.style.display = 'none';
        if (pendingChangesContent) pendingChangesContent.style.display = 'none';
        queryPlanContent.style.display = 'none';
        planTreeContent.style.display = 'none';
        topOperationsContent.style.display = 'none';
        
        // Show selected
        if (currentTab === 'results') {
            resultsContent.style.display = 'block';
        } else if (currentTab === 'messages') {
            messagesContent.style.display = 'block';
        } else if (currentTab === 'pendingChanges') {
            if (pendingChangesContent) {
                pendingChangesContent.style.display = 'block';
                renderPendingChanges();
            }
        } else if (currentTab === 'queryPlan') {
            queryPlanContent.style.display = 'block';
        } else if (currentTab === 'planTree') {
            planTreeContent.style.display = 'block';
        } else if (currentTab === 'topOperations') {
            topOperationsContent.style.display = 'block';
        }
    });
});

// Resizer functionality
const resizer = document.getElementById('resizer');
const resultsContainer = document.getElementById('resultsContainer');
const editorContainer = document.getElementById('editorContainer');
const container = document.getElementById('container');

if (resizer && resultsContainer && editorContainer && container) {
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizer.classList.add('active');
        if (document.body) {
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        }
        e.preventDefault();
    });
}

document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const containerRect = container.getBoundingClientRect();
    const newResultsHeight = containerRect.bottom - e.clientY;
    const minHeight = 100;
    const maxResultsHeight = containerRect.height - minHeight - 40; // 40 for toolbar

    if (newResultsHeight >= minHeight && newResultsHeight <= maxResultsHeight) {
        resultsContainer.style.flex = `0 0 ${newResultsHeight}px`;
    }
});

document.addEventListener('mouseup', () => {
    if (isResizing) {
        isResizing = false;
        resizer.classList.remove('active');
        if (document.body) {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    }
});

function executeQuery() {
    if (!editor) return;

    // Clear pending changes immediately when starting new query
    pendingChanges.clear();
    
    // Hide and clear Pending Changes UI
    const pendingTab = document.querySelector('[data-tab="pendingChanges"]');
    const pendingBadge = document.getElementById('pendingChangesCount');
    const pendingContent = document.getElementById('pendingChangesContent');
    if (pendingTab) pendingTab.style.display = 'none';
    if (pendingBadge) pendingBadge.style.display = 'none';
    if (pendingContent) pendingContent.innerHTML = '';
    
    // Remove all cell-modified classes
    document.querySelectorAll('.cell-modified').forEach(cell => {
        cell.classList.remove('cell-modified');
    });

    const selection = editor.getSelection();
    let queryText;

    // If there's a selection, execute only the selected text
    if (selection && !selection.isEmpty()) {
        queryText = editor.getModel().getValueInRange(selection);
    } else {
        queryText = editor.getValue();
    }

    // Remove any existing execution summary comments before executing
    queryText = removeExecutionComments(queryText);

    // Build composite connection ID if database is selected
    let connectionId = currentConnectionId;
    if (currentConnectionId && currentDatabaseName) {
        connectionId = `${currentConnectionId}::${currentDatabaseName}`;
    }

    vscode.postMessage({
        type: 'executeQuery',
        query: queryText,
        connectionId: connectionId,
        includeActualPlan: actualPlanEnabled
    });
}

function executeEstimatedPlan() {
    if (!editor) return;

    const selection = editor.getSelection();
    let queryText;

    // If there's a selection, execute only the selected text
    if (selection && !selection.isEmpty()) {
        queryText = editor.getModel().getValueInRange(selection);
    } else {
        queryText = editor.getValue();
    }

    // Remove any existing execution summary comments before executing
    queryText = removeExecutionComments(queryText);

    // Build composite connection ID if database is selected
    let connectionId = currentConnectionId;
    if (currentConnectionId && currentDatabaseName) {
        connectionId = `${currentConnectionId}::${currentDatabaseName}`;
    }

    vscode.postMessage({
        type: 'executeEstimatedPlan',
        query: queryText,
        connectionId: connectionId
    });
}

// SQL Completion Provider Function
function provideSqlCompletions(model, position) {
    console.log('[SQL-COMPLETION] provideSqlCompletions called');
    console.log('[SQL-COMPLETION] dbSchema tables count:', dbSchema?.tables?.length || 0);
    console.log('[SQL-COMPLETION] dbSchema:', JSON.stringify(dbSchema, null, 2));
    
    const textUntilPosition = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
    });

    console.log('[SQL-COMPLETION] Text until position:', textUntilPosition);
    
    const word = model.getWordUntilPosition(position);
    console.log('[SQL-COMPLETION] Word at position:', word);
    const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
    };

    // Check if we're after a dot (for column suggestions)
    const lineUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
    });

    const dotMatch = lineUntilPosition.match(/(\\w+)\\\.\\w*$/);
    
    if (dotMatch) {
        // User is typing after a dot, suggest columns
        const prefix = dotMatch[1].toLowerCase();
        
        // Find table/alias in the query
        const tableAlias = findTableForAlias(textUntilPosition, prefix);
        
        if (tableAlias) {
            const columns = getColumnsForTable(tableAlias.schema, tableAlias.table);
            return {
                suggestions: columns.map(col => ({
                    label: col.name,
                    kind: monaco.languages.CompletionItemKind.Field,
                    detail: `${col.type}${col.nullable ? ' (nullable)' : ''}`,
                    insertText: col.name,
                    range: range
                }))
            };
        }
    }

    // Analyze SQL context for intelligent suggestions
    const lowerText = textUntilPosition.toLowerCase();
    
    console.log('[SQL-COMPLETION] Checking context - lowerText:', lowerText);
    
    // Analyze the current SQL context
    const sqlContext = analyzeSqlContext(textUntilPosition, lineUntilPosition);
    console.log('[SQL-COMPLETION] SQL Context analysis:', sqlContext);
    
    // Handle different SQL contexts
    switch (sqlContext.type) {
        case 'JOIN_TABLE':
            console.log('[SQL-COMPLETION] In JOIN context, suggesting related tables');
            const tablesInQuery = extractTablesFromQuery(textUntilPosition);
            console.log('[SQL-COMPLETION] Tables in query for JOIN:', tablesInQuery);
            
            if (tablesInQuery.length > 0) {
                const relatedTables = getRelatedTables(tablesInQuery);
                console.log('[SQL-COMPLETION] Related tables:', relatedTables.map(t => ({ name: t.name, hasFKInfo: !!t.foreignKeyInfo })));
                
                return {
                    suggestions: relatedTables.map(table => {
                        const fullName = table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`;
                        
                        // Generate smart alias
                        const tableAlias = generateSmartAlias(table.name);
                        
                        // Build the ON clause with FK relationship
                        let insertText = `${fullName} ${tableAlias}`;
                        let detailText = `Table (${table.columns?.length || 0} columns)`;
                        
                        if (table.foreignKeyInfo) {
                            const fkInfo = table.foreignKeyInfo;
                            const toAlias = tableAlias;
                            const fromAlias = fkInfo.fromAlias;
                            
                            if (fkInfo.direction === 'to') {
                                insertText = `${fullName} ${toAlias} ON ${fromAlias}.${fkInfo.fromColumn} = ${toAlias}.${fkInfo.toColumn}`;
                                detailText = `Join on ${fromAlias}.${fkInfo.fromColumn} = ${toAlias}.${fkInfo.toColumn}`;
                            } else {
                                insertText = `${fullName} ${toAlias} ON ${toAlias}.${fkInfo.fromColumn} = ${fromAlias}.${fkInfo.toColumn}`;
                                detailText = `Join on ${toAlias}.${fkInfo.fromColumn} = ${fromAlias}.${fkInfo.toColumn}`;
                            }
                        }
                        
                        return {
                            label: fullName,
                            kind: monaco.languages.CompletionItemKind.Class,
                            detail: detailText,
                            insertText: insertText,
                            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                            range: range,
                            sortText: `0_${fullName}`
                        };
                    })
                };
            }
            break;
            
        case 'ON_CONDITION':
            console.log('[SQL-COMPLETION] In ON clause, suggesting join conditions');
            return getJoinConditionSuggestions(textUntilPosition, range);
            
        case 'ORDER_BY':
            console.log('[SQL-COMPLETION] In ORDER BY clause, suggesting columns and sort options');
            return getOrderBySuggestions(textUntilPosition, range);
            
        case 'GROUP_BY':
            console.log('[SQL-COMPLETION] In GROUP BY clause, suggesting columns');
            return getGroupBySuggestions(textUntilPosition, range);
            
        case 'HAVING':
            console.log('[SQL-COMPLETION] In HAVING clause, suggesting aggregate conditions');
            return getHavingSuggestions(textUntilPosition, range);
            
        case 'INSERT_COLUMNS':
            console.log('[SQL-COMPLETION] In INSERT columns, suggesting table columns');
            return getInsertColumnSuggestions(textUntilPosition, range);
            
        case 'INSERT_VALUES':
            console.log('[SQL-COMPLETION] In INSERT VALUES, suggesting value formats');
            return getInsertValueSuggestions(textUntilPosition, range);
            
        case 'UPDATE_SET':
            console.log('[SQL-COMPLETION] In UPDATE SET, suggesting column assignments');
            return getUpdateSetSuggestions(textUntilPosition, range);
    }
    
    // Detect context: SELECT, WHERE, or FROM clause with enhanced analysis
    const inSelectClause = sqlContext.type === 'SELECT';
    const inWhereClause = sqlContext.type === 'WHERE';
    const inFromClause = sqlContext.type === 'FROM';
    const afterFromClause = sqlContext.type === 'AFTER_FROM';
    
    console.log('[SQL-COMPLETION] Enhanced context detection:', {
        type: sqlContext.type,
        confidence: sqlContext.confidence,
        inSelect: inSelectClause,
        inWhere: inWhereClause,
        inFrom: inFromClause,
        afterFrom: afterFromClause
    });
    
    // Handle WHERE clause with operator suggestions
    if (inWhereClause && sqlContext.suggestOperators) {
        console.log('[SQL-COMPLETION] In WHERE clause, suggesting operators');
        return {
            suggestions: getSqlOperators(range)
        };
    }
    
    // If we're in SELECT, WHERE, or after a complete FROM, suggest columns from tables in query
    if (inSelectClause || inWhereClause || afterFromClause) {
        console.log('[SQL-COMPLETION] Should suggest columns - context type:', sqlContext.type);
        
        // Get all tables/aliases from the FULL query (not just textUntilPosition)
        const fullText = model.getValue();
        const tablesInQuery = extractTablesFromQuery(fullText);
        
        console.log('[SQL-COMPLETION] Tables extracted from query:', tablesInQuery);
        
        if (tablesInQuery.length > 0) {
            const suggestions = [];
            
            // Add columns from all tables in the query
            tablesInQuery.forEach(tableInfo => {
                const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
                console.log(`[SQL-COMPLETION] Columns for ${tableInfo.schema}.${tableInfo.table}:`, columns.length);
                
                // Use the actual alias if available, otherwise use table name
                const displayAlias = tableInfo.alias || tableInfo.table;
                console.log(`[SQL-COMPLETION] Using alias "${displayAlias}" for table ${tableInfo.table} (hasExplicitAlias: ${tableInfo.hasExplicitAlias})`);
                
                columns.forEach(col => {
                    // For SELECT/WHERE context, prioritize the alias-prefixed suggestions
                    if (tableInfo.hasExplicitAlias || tablesInQuery.length > 1) {
                        // When there's an explicit alias or multiple tables, prioritize prefixed columns
                        suggestions.push({
                            label: `${displayAlias}.${col.name}`,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${col.type}${col.nullable ? ' (nullable)' : ''} - from ${tableInfo.table}`,
                            insertText: `${displayAlias}.${col.name}`,
                            range: range,
                            sortText: `0_${displayAlias}_${col.name}` // Highest priority for alias-prefixed
                        });
                        
                        // Also suggest without prefix but with lower priority
                        suggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${displayAlias}.${col.name} (${col.type})`,
                            insertText: col.name,
                            range: range,
                            sortText: `1_${col.name}` // Lower priority for non-prefixed
                        });
                    } else {
                        // Single table without explicit alias - prioritize non-prefixed columns
                        suggestions.push({
                            label: col.name,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${displayAlias}.${col.name} (${col.type})`,
                            insertText: col.name,
                            range: range,
                            sortText: `0_${col.name}` // Prioritize non-prefixed columns
                        });
                        
                        // Also suggest with table prefix
                        suggestions.push({
                            label: `${displayAlias}.${col.name}`,
                            kind: monaco.languages.CompletionItemKind.Field,
                            detail: `${col.type}${col.nullable ? ' (nullable)' : ''}`,
                            insertText: `${displayAlias}.${col.name}`,
                            range: range,
                            sortText: `1_${displayAlias}_${col.name}`
                        });
                    }
                });
            });
            
            // Add SQL keywords too
            const keywords = ['AS', 'AND', 'OR', 'DISTINCT', 'TOP', 'ORDER BY', 'GROUP BY'];
            keywords.forEach(keyword => {
                suggestions.push({
                    label: keyword,
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: keyword,
                    range: range,
                    sortText: `9_${keyword}` // Lower priority
                });
            });
            
            console.log('[SQL-COMPLETION] Returning', suggestions.length, 'column suggestions');
            return { suggestions };
        } else {
            console.log('[SQL-COMPLETION] No tables in query, cannot suggest columns');
        }
    }

    // Default: suggest tables and views
    const suggestions = [];
    
    // Check if this is a new/empty query for special table suggestions
    const isNewQuery = isNewOrEmptyQuery(textUntilPosition);
    console.log('[SQL-COMPLETION] Is new query:', isNewQuery);
    console.log('[SQL-COMPLETION] Available snippets:', sqlSnippets.map(s => s.prefix).join(', '));

    // Add tables
    dbSchema.tables.forEach(table => {
        const fullName = table.schema === 'dbo' ? table.name : `${table.schema}.${table.name}`;
        
        // Regular table suggestion
        suggestions.push({
            label: fullName,
            kind: monaco.languages.CompletionItemKind.Class,
            detail: `🗂️ Table (${table.columns.length} columns)`,
            insertText: fullName,
            range: range,
            sortText: `2_${fullName}` // Lower priority than special options
        });
        
        // Add special script generation options only for new queries
        if (isNewQuery) {
            const table100Label = `${table.name}100`;
            const tableAllLabel = `${table.name}*`;
            
            // Check if user has custom snippets with same prefixes
            const hasConflict100 = sqlSnippets.some(s => s.prefix.toLowerCase() === table100Label.toLowerCase());
            const hasConflictAll = sqlSnippets.some(s => s.prefix.toLowerCase() === tableAllLabel.toLowerCase());
            
            // Only add if no conflict with user snippets (user snippets take priority)
            if (!hasConflict100) {
                suggestions.push({
                    label: table100Label,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `\uD83D\uDCC5 Generate SELECT TOP 100 from ${fullName}`,
                    insertText: `SELECT TOP 100 *\nFROM ${fullName}`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range,
                    sortText: `0_${table.name}_100`, // High priority
                    documentation: {
                        value: `**Quick Script**: SELECT TOP 100 rows from ${fullName}\n\nThis will generate a complete SELECT statement to view the first 100 rows from the table.`
                    }
                });
            }
            
            if (!hasConflictAll) {
                suggestions.push({
                    label: tableAllLabel,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `\uD83D\uDCC5 Generate SELECT * from ${fullName}`,
                    insertText: `SELECT *\nFROM ${fullName}`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range,
                    sortText: `0_${table.name}_all`,
                    documentation: {
                        value: `**Quick Script**: SELECT all rows from ${fullName}\n\n⚠️ **Warning**: This will return ALL rows from the table.`
                    }
                });
            }
        }
    });

    // Add views
    dbSchema.views.forEach(view => {
        const fullName = view.schema === 'dbo' ? view.name : `${view.schema}.${view.name}`;
        
        // Regular view suggestion
        suggestions.push({
            label: fullName,
            kind: monaco.languages.CompletionItemKind.Interface,
            detail: `👁️ View (${view.columns.length} columns)`,
            insertText: fullName,
            range: range,
            sortText: `2_${fullName}` // Lower priority than special options
        });
        
        // Add special script generation options only for new queries
        if (isNewQuery) {
            const view100Label = `${view.name}100`;
            const viewAllLabel = `${view.name}*`;
            
            // Check if user has custom snippets with same prefixes
            const hasConflict100 = sqlSnippets.some(s => s.prefix.toLowerCase() === view100Label.toLowerCase());
            const hasConflictAll = sqlSnippets.some(s => s.prefix.toLowerCase() === viewAllLabel.toLowerCase());
            
            // Only add if no conflict with user snippets
            if (!hasConflict100) {
                suggestions.push({
                    label: view100Label,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `\uD83D\uDCC5 Generate SELECT TOP 100 from ${fullName} (View)`,
                    insertText: `SELECT TOP 100 *\nFROM ${fullName}`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range,
                    sortText: `0_${view.name}_100`,
                    documentation: {
                        value: `**Quick Script**: SELECT TOP 100 rows from view ${fullName}`
                    }
                });
            }
            
            if (!hasConflictAll) {
                suggestions.push({
                    label: viewAllLabel,
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    detail: `\uD83D\uDCC5 Generate SELECT * from ${fullName} (View)`,
                    insertText: `SELECT *\nFROM ${fullName}`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range,
                    sortText: `0_${view.name}_all`,
                    documentation: {
                        value: `**Quick Script**: SELECT all rows from view ${fullName}`
                    }
                });
            }
        }
    });

    // Add SQL keywords
    const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 
                    'ON', 'AND', 'OR', 'ORDER BY', 'GROUP BY', 'HAVING', 'INSERT', 'UPDATE', 
                    'DELETE', 'CREATE', 'ALTER', 'DROP', 'AS', 'DISTINCT', 'TOP', 'LIMIT'];
    
    keywords.forEach(keyword => {
        suggestions.push({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: `🔑 SQL Keyword`,
            insertText: keyword,
            range: range,
            sortText: `9_${keyword}` // Low priority for keywords
        });
    });
    
    // Combine user snippets with built-in snippets
    const allSnippets = [...sqlSnippets, ...builtInSnippets];
    console.log('[SQL-COMPLETION] Adding snippets:', sqlSnippets.length, 'user +', builtInSnippets.length, 'built-in =', allSnippets.length, 'total');
    
    const existingLabels = new Set(suggestions.map(s => s.label.toLowerCase()));
    
    allSnippets.forEach(snippet => {
        // Skip snippets that conflict with existing table suggestions
        if (existingLabels.has(snippet.prefix.toLowerCase())) {
            console.log('[SQL-COMPLETION] Skipping duplicate snippet:', snippet.prefix);
            return;
        }
        
        // Determine if this is a user snippet or built-in
        const isUserSnippet = sqlSnippets.some(userSnippet => userSnippet.prefix === snippet.prefix);
        const snippetType = isUserSnippet ? 'User' : 'Built-in';
        const iconPrefix = isUserSnippet ? '\uD83D\uDCDD' : '\u26A1';
        const sortPrefix = isUserSnippet ? '00_user' : '01_builtin';
        
        suggestions.push({
            label: snippet.prefix,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: `${iconPrefix} ${snippet.description}`,
            insertText: snippet.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range: range,
            sortText: `${sortPrefix}_snippet_${snippet.prefix}`,
            documentation: {
                value: `**${snippetType} Snippet**: ${snippet.name}\n\n${snippet.description || 'SQL snippet'}\n\n---\n*${isUserSnippet ? 'Loaded from snippets file' : 'Built into MS SQL Manager'}*`
            }
        });
        existingLabels.add(snippet.prefix.toLowerCase());
    });

    // Final deduplication based on label (case-insensitive)
    const uniqueSuggestions = [];
    const seenLabels = new Set();
    
    for (const suggestion of suggestions) {
        const labelKey = suggestion.label.toLowerCase();
        if (!seenLabels.has(labelKey)) {
            uniqueSuggestions.push(suggestion);
            seenLabels.add(labelKey);
        } else {
            console.log('[SQL-COMPLETION] Skipping duplicate suggestion:', suggestion.label);
        }
    }
    
    console.log('[SQL-COMPLETION] Returning', uniqueSuggestions.length, 'unique suggestions (removed', suggestions.length - uniqueSuggestions.length, 'duplicates)');
    return { suggestions: uniqueSuggestions };
}

// Register completion provider (can be called multiple times to update snippets)
function registerCompletionProvider() {
    if (!monaco || !monaco.languages) {
        console.log('[SNIPPETS] Monaco not ready, skipping completion provider registration');
        return;
    }
    
    // Only register once - Monaco doesn't support clean disposal/re-registration
    if (completionProviderRegistered) {
        console.log('[SNIPPETS] Completion provider already registered, snippets will be updated automatically');
        return;
    }
    
    console.log('[SNIPPETS] Registering completion provider for the first time with', sqlSnippets.length, 'snippets');
    
    // Configure Monaco Editor for better snippet support (only set once)
    try {
        monaco.languages.setLanguageConfiguration('sql', {
            wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
        });
    } catch (e) {
        // Language config might already be set, ignore error
        console.log('[SNIPPETS] Language config already set:', e.message);
    }
    
    // Register completion provider and store reference
    completionProvider = monaco.languages.registerCompletionItemProvider('sql', {
        triggerCharacters: ['.', ' '], // Trigger on dot and space for better snippet matching
        provideCompletionItems: (model, position) => {
            console.log('[SQL-COMPLETION] provideCompletionItems called at position:', position);
            console.log('[SQL-COMPLETION] Current dbSchema:', dbSchema);
            return provideSqlCompletions(model, position);
        }
    });
    
    completionProviderRegistered = true;
    console.log('[SNIPPETS] Completion provider registered successfully');
}

// Debug function to reset completion provider (for development)
function resetCompletionProvider() {
    console.log('[DEBUG] Resetting completion provider...');
    completionProviderRegistered = false;
    if (completionProvider) {
        try {
            completionProvider.dispose();
        } catch (e) {
            console.log('[DEBUG] Error disposing completion provider:', e);
        }
        completionProvider = null;
    }
    registerCompletionProvider();
    console.log('[DEBUG] Completion provider reset complete');
}

// Make reset function available globally for debugging
window.resetCompletionProvider = resetCompletionProvider;

// Register Monaco Editor context menu action for creating snippets
function registerCreateSnippetAction() {
    if (!monaco || !monaco.editor || !editor) {
        console.log('[SNIPPETS] Monaco or editor not ready for context menu registration');
        return;
    }

    try {
        editor.addAction({
            id: 'create-snippet',
            label: 'Create Snippet...',
            contextMenuGroupId: '9_cutcopypaste',
            contextMenuOrder: 1.5,
            precondition: 'editorHasSelection',
            run: async function(editor) {
                const selection = editor.getSelection();
                const selectedText = editor.getModel().getValueInRange(selection);
                
                if (!selectedText || selectedText.trim().length === 0) {
                    console.log('[SNIPPETS] No text selected');
                    return;
                }
                
                console.log('[SNIPPETS] Creating snippet from selection:', selectedText.length, 'characters');
                await createSnippetFromSelection(selectedText.trim());
            }
        });
        console.log('[SNIPPETS] Create snippet action registered successfully');
    } catch (error) {
        console.error('[SNIPPETS] Failed to register create snippet action:', error);
    }
}

// Function to handle snippet creation from selected text
async function createSnippetFromSelection(selectedText) {
    try {
        console.log('[SNIPPETS] Starting snippet creation process...');
        
        // Send message to extension to get user input
        vscode.postMessage({
            type: 'requestSnippetInput',
            selectedText: selectedText
        });
        
    } catch (error) {
        console.error('[SNIPPETS] Error creating snippet:', error);
    }
}

function analyzeSqlContext(textUntilPosition, lineUntilPosition) {
    const lowerText = textUntilPosition.toLowerCase();
    const lowerLine = lineUntilPosition.toLowerCase();
    
    // Find positions of key SQL keywords
    const lastSelectPos = lowerText.lastIndexOf('select');
    const lastFromPos = lowerText.lastIndexOf('from');
    const lastWherePos = lowerText.lastIndexOf('where');
    const lastOrderByPos = lowerText.lastIndexOf('order by');
    const lastGroupByPos = lowerText.lastIndexOf('group by');
    const lastHavingPos = lowerText.lastIndexOf('having');
    const lastInsertPos = lowerText.lastIndexOf('insert');
    const lastUpdatePos = lowerText.lastIndexOf('update');
    const lastSetPos = lowerText.lastIndexOf('set');
    const lastValuesPos = lowerText.lastIndexOf('values');
    
    // Check for JOIN context
    const joinMatch = /\b((?:inner|left|right|full|cross)\s+)?join\s*$/i.exec(lowerLine);
    if (joinMatch) {
        return { type: 'JOIN_TABLE', confidence: 'high' };
    }
    
    // Check for ON clause context (after JOIN table alias)
    const onMatch = /\bjoin\s+(?:\w+\.)?(\w+)(?:\s+(?:as\s+)?(\w+))?\s+on\s*/i.exec(lowerLine);
    if (onMatch || /\bon\s*$/i.test(lowerLine)) {
        return { type: 'ON_CONDITION', confidence: 'high' };
    }
    
    // Check for ORDER BY context
    if (lastOrderByPos !== -1 && (lastOrderByPos > lastWherePos || lastWherePos === -1)) {
        const textAfterOrderBy = lowerText.substring(lastOrderByPos + 8); // +8 for "order by".length
        // Check if we're still in ORDER BY or have moved to next clause
        if (!/\b(limit|offset|fetch|for|union|intersect|except)\b/.test(textAfterOrderBy)) {
            return { type: 'ORDER_BY', confidence: 'high' };
        }
    }
    
    // Check for GROUP BY context
    if (lastGroupByPos !== -1 && lastGroupByPos > Math.max(lastWherePos, lastOrderByPos, lastHavingPos)) {
        return { type: 'GROUP_BY', confidence: 'high' };
    }
    
    // Check for HAVING context
    if (lastHavingPos !== -1 && lastHavingPos > Math.max(lastWherePos, lastGroupByPos)) {
        const textAfterHaving = lowerText.substring(lastHavingPos + 6); // +6 for "having".length
        if (!/\b(order|limit|union|intersect|except)\b/.test(textAfterHaving)) {
            const shouldSuggestOperators = analyzeHavingContext(textAfterHaving);
            return { 
                type: 'HAVING', 
                confidence: 'high',
                suggestOperators: shouldSuggestOperators
            };
        }
    }
    
    // Check for INSERT context
    if (lastInsertPos !== -1 && lastInsertPos > Math.max(lastSelectPos, lastUpdatePos)) {
        // Check if we're in column list: INSERT INTO table (col1, col2...)
        const insertMatch = /insert\s+into\s+(?:\w+\.)?(\w+)\s*\(\s*([^)]*)?$/i.exec(lowerLine);
        if (insertMatch) {
            return { type: 'INSERT_COLUMNS', confidence: 'high', tableName: insertMatch[1] };
        }
        
        // Check if we're in VALUES clause
        if (lastValuesPos !== -1 && lastValuesPos > lastInsertPos) {
            return { type: 'INSERT_VALUES', confidence: 'high' };
        }
    }
    
    // Check for UPDATE SET context
    if (lastUpdatePos !== -1 && lastSetPos !== -1 && lastSetPos > lastUpdatePos) {
        const textAfterSet = lowerText.substring(lastSetPos + 3); // +3 for "set".length
        if (!/\bwhere\b/.test(textAfterSet) || lastWherePos === -1 || lastWherePos < lastSetPos) {
            return { type: 'UPDATE_SET', confidence: 'high' };
        }
    }
    
    // Check for WHERE context
    if (lastWherePos !== -1 && lastWherePos > Math.max(lastFromPos, lastSetPos)) {
        const textAfterWhere = lowerText.substring(lastWherePos + 5); // +5 for "where".length
        const shouldSuggestOperators = analyzeWhereContext(textAfterWhere);
        return { 
            type: 'WHERE', 
            confidence: 'high',
            suggestOperators: shouldSuggestOperators
        };
    }
    
    // Check for SELECT context
    if (lastSelectPos !== -1) {
        if (lastFromPos === -1 || lastSelectPos > lastFromPos) {
            return { type: 'SELECT', confidence: 'medium' };
        } else if (lastFromPos !== -1 && lastSelectPos < lastFromPos) {
            // Check if FROM clause is complete
            const textAfterFrom = lowerText.substring(lastFromPos);
            if (textAfterFrom.match(/from\s+(?:\w+\.)?(\w+)(?:\s+(?:as\s+)?(\w+))?/)) {
                return { type: 'AFTER_FROM', confidence: 'medium' };
            } else {
                return { type: 'FROM', confidence: 'high' };
            }
        }
    }
    
    // Default context
    return { type: 'DEFAULT', confidence: 'low' };
}

function analyzeWhereContext(textAfterWhere) {
    // Analyze WHERE clause to determine if we should suggest operators
    const trimmedText = textAfterWhere.trim();
    
    if (!trimmedText) {
        return false;
    }
    
    const conditions = trimmedText.split(/\s+(?:and|or)\s+/i);
    const currentCondition = conditions[conditions.length - 1].trim();
    
    // Check if current condition has a column/value but no operator yet
    const columnPatterns = [
        /^(?:\w+\.)*\w+\s*$/,  // Column name (e.g., "p.Id ", "columnName ")
        /^['"]\w*$/,  // Starting a string literal
        /^\d+\.?\d*$/  // Number
    ];
    
    for (const pattern of columnPatterns) {
        if (pattern.test(currentCondition)) {
            const hasOperator = /\s*(=|<>|!=|<|>|<=|>=|like|in|not\s+in|is\s+null|is\s+not\s+null|between)\s*/i.test(currentCondition);
            return !hasOperator;
        }
    }
    
    return false;
}

function analyzeHavingContext(textAfterHaving) {
    // Similar to WHERE clause analysis but for HAVING (typically with aggregates)
    const trimmedText = textAfterHaving.trim();
    
    if (!trimmedText) {
        return false;
    }
    
    const conditions = trimmedText.split(/\s+(?:and|or)\s+/i);
    const currentCondition = conditions[conditions.length - 1].trim();
    
    // Check for aggregate function followed by space (e.g., "COUNT(*) ", "SUM(price) ")
    const aggregatePatterns = [
        /^(?:count|sum|avg|min|max|stddev|variance)\s*\([^)]*\)\s*$/i,
        /^(?:\w+\.)*\w+\s*$/  // Column name
    ];
    
    for (const pattern of aggregatePatterns) {
        if (pattern.test(currentCondition)) {
            const hasOperator = /\s*(=|<>|!=|<|>|<=|>=|like|in|not\s+in|is\s+null|is\s+not\s+null|between)\s*/i.test(currentCondition);
            return !hasOperator;
        }
    }
    
    return false;
}

function getJoinConditionSuggestions(textUntilPosition, range) {
    const tablesInQuery = extractTablesFromQuery(textUntilPosition);
    const suggestions = [];
    
    if (tablesInQuery.length >= 2) {
        // Get the last two tables for join condition suggestions
        const table1 = tablesInQuery[tablesInQuery.length - 2];
        const table2 = tablesInQuery[tablesInQuery.length - 1];
        
        // Find foreign key relationships between these tables
        if (dbSchema.foreignKeys) {
            dbSchema.foreignKeys.forEach(fk => {
                if ((fk.fromTable.toLowerCase() === table1.table.toLowerCase() && 
                     fk.toTable.toLowerCase() === table2.table.toLowerCase()) ||
                    (fk.fromTable.toLowerCase() === table2.table.toLowerCase() && 
                     fk.toTable.toLowerCase() === table1.table.toLowerCase())) {
                    
                    const leftAlias = table1.alias;
                    const rightAlias = table2.alias;
                    
                    suggestions.push({
                        label: `${leftAlias}.${fk.fromColumn} = ${rightAlias}.${fk.toColumn}`,
                        kind: monaco.languages.CompletionItemKind.Reference,
                        detail: `Foreign key relationship`,
                        insertText: `${leftAlias}.${fk.fromColumn} = ${rightAlias}.${fk.toColumn}`,
                        range: range,
                        sortText: `0_fk`
                    });
                }
            });
        }
        
        // Suggest all possible column combinations
        const table1Columns = getColumnsForTable(table1.schema, table1.table);
        const table2Columns = getColumnsForTable(table2.schema, table2.table);
        
        table1Columns.forEach(col1 => {
            table2Columns.forEach(col2 => {
                if (col1.name.toLowerCase() === col2.name.toLowerCase() || 
                    col1.name.toLowerCase().includes('id') && col2.name.toLowerCase().includes('id')) {
                    
                    suggestions.push({
                        label: `${table1.alias}.${col1.name} = ${table2.alias}.${col2.name}`,
                        kind: monaco.languages.CompletionItemKind.Reference,
                        detail: `Join on matching columns`,
                        insertText: `${table1.alias}.${col1.name} = ${table2.alias}.${col2.name}`,
                        range: range,
                        sortText: `1_match_${col1.name}`
                    });
                }
            });
        });
    }
    
    return { suggestions };
}

function getOrderBySuggestions(textUntilPosition, range) {
    const suggestions = [];
    const tablesInQuery = extractTablesFromQuery(textUntilPosition);
    
    // Add column suggestions
    tablesInQuery.forEach(tableInfo => {
        const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
        const displayAlias = tableInfo.alias || tableInfo.table;
        
        columns.forEach(col => {
            // Column only
            suggestions.push({
                label: `${displayAlias}.${col.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Order by column`,
                insertText: `${displayAlias}.${col.name}`,
                range: range,
                sortText: `0_${col.name}`
            });
            
            // Column with ASC
            suggestions.push({
                label: `${displayAlias}.${col.name} ASC`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Ascending order`,
                insertText: `${displayAlias}.${col.name} ASC`,
                range: range,
                sortText: `1_${col.name}_asc`
            });
            
            // Column with DESC
            suggestions.push({
                label: `${displayAlias}.${col.name} DESC`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Descending order`,
                insertText: `${displayAlias}.${col.name} DESC`,
                range: range,
                sortText: `1_${col.name}_desc`
            });
        });
    });
    
    // Add sort direction keywords
    ['ASC', 'DESC'].forEach(direction => {
        suggestions.push({
            label: direction,
            kind: monaco.languages.CompletionItemKind.Keyword,
            detail: `Sort direction`,
            insertText: direction,
            range: range,
            sortText: `9_${direction}`
        });
    });
    
    return { suggestions };
}

function getGroupBySuggestions(textUntilPosition, range) {
    const suggestions = [];
    const tablesInQuery = extractTablesFromQuery(textUntilPosition);
    
    tablesInQuery.forEach(tableInfo => {
        const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
        const displayAlias = tableInfo.alias || tableInfo.table;
        
        columns.forEach(col => {
            suggestions.push({
                label: `${displayAlias}.${col.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Group by column`,
                insertText: `${displayAlias}.${col.name}`,
                range: range,
                sortText: `0_${col.name}`
            });
        });
    });
    
    return { suggestions };
}

function getHavingSuggestions(textUntilPosition, range) {
    const suggestions = [];
    
    // Check if we should suggest operators
    const lowerText = textUntilPosition.toLowerCase();
    const lastHavingPos = lowerText.lastIndexOf('having');
    
    if (lastHavingPos !== -1) {
        const textAfterHaving = textUntilPosition.substring(lastHavingPos + 6);
        const shouldSuggestOperators = analyzeHavingContext(textAfterHaving);
        
        if (shouldSuggestOperators) {
            return { suggestions: getSqlOperators(range) };
        }
    }
    
    // Suggest aggregate functions
    const aggregateFunctions = [
        { name: 'COUNT(*)', detail: 'Count all rows' },
        { name: 'COUNT(column)', detail: 'Count non-null values' },
        { name: 'SUM(column)', detail: 'Sum of values' },
        { name: 'AVG(column)', detail: 'Average of values' },
        { name: 'MIN(column)', detail: 'Minimum value' },
        { name: 'MAX(column)', detail: 'Maximum value' },
        { name: 'STDDEV(column)', detail: 'Standard deviation' },
        { name: 'VARIANCE(column)', detail: 'Variance' }
    ];
    
    aggregateFunctions.forEach(func => {
        suggestions.push({
            label: func.name,
            kind: monaco.languages.CompletionItemKind.Function,
            detail: func.detail,
            insertText: func.name,
            range: range,
            sortText: `0_${func.name}`
        });
    });
    
    // Also suggest columns for grouping expressions
    const tablesInQuery = extractTablesFromQuery(textUntilPosition);
    tablesInQuery.forEach(tableInfo => {
        const columns = getColumnsForTable(tableInfo.schema, tableInfo.table);
        const displayAlias = tableInfo.alias || tableInfo.table;
        
        columns.forEach(col => {
            suggestions.push({
                label: `${displayAlias}.${col.name}`,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Column for aggregate`,
                insertText: `${displayAlias}.${col.name}`,
                range: range,
                sortText: `1_${col.name}`
            });
        });
    });
    
    return { suggestions };
}

function getInsertColumnSuggestions(textUntilPosition, range) {
    const suggestions = [];
    
    // Extract table name from INSERT statement
    const insertMatch = /insert\s+into\s+(?:(\w+)\.)?(\w+)\s*\(/i.exec(textUntilPosition);
    if (insertMatch) {
        const schema = insertMatch[1] || 'dbo';
        const tableName = insertMatch[2];
        
        const columns = getColumnsForTable(schema, tableName);
        columns.forEach(col => {
            suggestions.push({
                label: col.name,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type}${col.nullable ? ' (nullable)' : ' (required)'}`,
                insertText: col.name,
                range: range,
                sortText: col.nullable ? `1_${col.name}` : `0_${col.name}` // Required columns first
            });
        });
    }
    
    return { suggestions };
}

function getInsertValueSuggestions(textUntilPosition, range) {
    const suggestions = [];
    
    // Suggest common value patterns
    const valuePatterns = [
        { label: 'NULL', detail: 'Null value', insertText: 'NULL' },
        { label: "'text'", detail: 'Text value', insertText: "''" },
        { label: '0', detail: 'Number value', insertText: '0' },
        { label: 'GETDATE()', detail: 'Current date/time', insertText: 'GETDATE()' },
        { label: 'NEWID()', detail: 'New GUID', insertText: 'NEWID()' }
    ];
    
    valuePatterns.forEach(pattern => {
        suggestions.push({
            label: pattern.label,
            kind: monaco.languages.CompletionItemKind.Value,
            detail: pattern.detail,
            insertText: pattern.insertText,
            range: range,
            sortText: `0_${pattern.label}`
        });
    });
    
    return { suggestions };
}

function getUpdateSetSuggestions(textUntilPosition, range) {
    const suggestions = [];
    
    // Extract table name from UPDATE statement
    const updateMatch = /update\s+(?:(\w+)\.)?(\w+)\s+set/i.exec(textUntilPosition);
    if (updateMatch) {
        const schema = updateMatch[1] || 'dbo';
        const tableName = updateMatch[2];
        
        const columns = getColumnsForTable(schema, tableName);
        columns.forEach(col => {
            // Suggest column = value pattern
            suggestions.push({
                label: `${col.name} = `,
                kind: monaco.languages.CompletionItemKind.Field,
                detail: `${col.type} - Set column value`,
                insertText: `${col.name} = `,
                range: range,
                sortText: `0_${col.name}`
            });
        });
    }
    
    return { suggestions };
}

function isNewOrEmptyQuery(textUntilPosition) {
    // Check if the query is essentially empty or just starting
    const trimmedText = textUntilPosition.trim();
    
    // Empty or just whitespace
    if (!trimmedText) {
        return true;
    }
    
    // Check if we're at the very beginning of a statement
    // Remove comments and check if there's any substantial SQL content
    const withoutComments = trimmedText
        .replace(/--.*$/gm, '') // Remove line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
        .trim();
    
    if (!withoutComments) {
        return true;
    }
    
    // Check if we only have incomplete statement starters
    const incompletePatterns = [
        /^\s*$/, // Empty
        /^\s*select\s*$/i, // Just "SELECT"
        /^\s*insert\s*$/i, // Just "INSERT"
        /^\s*update\s*$/i, // Just "UPDATE"
        /^\s*delete\s*$/i, // Just "DELETE"
        /^\s*with\s*$/i, // Just "WITH" (CTE)
        /^\s*create\s*$/i, // Just "CREATE"
        /^\s*alter\s*$/i, // Just "ALTER"
        /^\s*drop\s*$/i // Just "DROP"
    ];
    
    for (const pattern of incompletePatterns) {
        if (pattern.test(withoutComments)) {
            return true;
        }
    }
    
    // Check if we're at the start of a new statement after semicolon
    const statements = withoutComments.split(';');
    const lastStatement = statements[statements.length - 1].trim();
    
    // If the last statement is empty or just a keyword, consider it new
    if (!lastStatement || incompletePatterns.some(pattern => pattern.test(lastStatement))) {
        return true;
    }
    
    // Check if we have a very short incomplete statement (less than 20 characters)
    // This catches cases like "SEL" or "SELECT " without much content
    if (lastStatement.length < 20) {
        // Check if it's just keywords without table names or substantial content
        const hasSubstantialContent = /\b(?:from|join|where|set|into|values)\s+\w+/i.test(lastStatement);
        if (!hasSubstantialContent) {
            return true;
        }
    }
    
    return false;
}

function getSqlOperators(range) {
    const operators = [
        { label: '=', detail: 'Equal to', insertText: '= ' },
        { label: '<>', detail: 'Not equal to', insertText: '<> ' },
        { label: '!=', detail: 'Not equal to (alternative)', insertText: '!= ' },
        { label: '<', detail: 'Less than', insertText: '< ' },
        { label: '>', detail: 'Greater than', insertText: '> ' },
        { label: '<=', detail: 'Less than or equal to', insertText: '<= ' },
        { label: '>=', detail: 'Greater than or equal to', insertText: '>= ' },
        { label: 'LIKE', detail: 'Pattern matching', insertText: 'LIKE ' },
        { label: 'NOT LIKE', detail: 'Pattern not matching', insertText: 'NOT LIKE ' },
        { label: 'IN', detail: 'Value in list', insertText: 'IN (' },
        { label: 'NOT IN', detail: 'Value not in list', insertText: 'NOT IN (' },
        { label: 'IS NULL', detail: 'Is null value', insertText: 'IS NULL' },
        { label: 'IS NOT NULL', detail: 'Is not null value', insertText: 'IS NOT NULL' },
        { label: 'BETWEEN', detail: 'Between two values', insertText: 'BETWEEN ' },
        { label: 'NOT BETWEEN', detail: 'Not between two values', insertText: 'NOT BETWEEN ' },
        { label: 'EXISTS', detail: 'Subquery returns rows', insertText: 'EXISTS (' },
        { label: 'NOT EXISTS', detail: 'Subquery returns no rows', insertText: 'NOT EXISTS (' }
    ];
    
    return operators.map(op => ({
        label: op.label,
        kind: monaco.languages.CompletionItemKind.Operator,
        detail: op.detail,
        insertText: op.insertText,
        range: range,
        sortText: `0_${op.label}` // High priority for operators
    }));
}

function generateSmartAlias(tableName) {
    // Handle short table names (3 characters or less)
    if (tableName.length <= 3) {
        return tableName.toLowerCase();
    }
    
    // Remove common prefixes/suffixes
    let cleanName = tableName
        .replace(/^tbl_?/i, '')  // Remove tbl prefix
        .replace(/_?tbl$/i, '')  // Remove tbl suffix
        .replace(/^tb_?/i, '')   // Remove tb prefix
        .replace(/_?tb$/i, '');  // Remove tb suffix
    
    // Split on various word boundaries
    const words = cleanName.split(/[_\-\s]|(?=[A-Z])/)
        .filter(word => word && word.length > 0)
        .map(word => word.toLowerCase());
    
    if (words.length === 1) {
        const word = words[0];
        // For single words, use intelligent abbreviation
        if (word.length <= 3) {
            return word;
        } else if (word.length <= 6) {
            // For medium words, take first 2-3 chars
            return word.substring(0, word.length <= 4 ? 2 : 3);
        } else {
            // For long words, take first and some consonants
            const vowels = 'aeiou';
            let alias = word.charAt(0);
            for (let i = 1; i < word.length && alias.length < 3; i++) {
                if (!vowels.includes(word.charAt(i))) {
                    alias += word.charAt(i);
                }
            }
            // If we don't have enough characters, add more
            if (alias.length < 2) {
                alias = word.substring(0, 2);
            }
            return alias;
        }
    } else {
        // Multiple words: take first letter of each significant word
        let alias = '';
        
        for (const word of words) {
            if (word.length > 0) {
                alias += word.charAt(0);
            }
        }
        
        // Ensure we have at least 2 characters and at most 4
        if (alias.length === 1) {
            // If only one word or very short, use first 2-3 chars of the original
            alias = cleanName.substring(0, Math.min(3, cleanName.length)).toLowerCase();
        } else if (alias.length > 6) {
            // If too long, take first 6 letters
            alias = alias.substring(0, 6);
        }
        
        return alias.toLowerCase();
    }
}

function extractTablesFromQuery(query) {
    const tables = [];
    const lowerQuery = query.toLowerCase();
    
    console.log('[SQL-COMPLETION] extractTablesFromQuery called with:', query);
    
    // SQL keywords that should not be considered as aliases
    const sqlKeywords = ['select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'cross', 'on', 'and', 'or', 'order', 'group', 'by', 'having'];
    
    // Match FROM and JOIN clauses with optional aliases
    // Patterns: FROM schema.table alias, FROM [schema].[table] alias, FROM table alias, JOIN schema.table alias, etc.
    const patterns = [
        // Pattern for bracketed identifiers: FROM [schema].[table] alias or FROM [table] alias
        /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+(?:\[([^\]]+)\]\.)?\[([^\]]+)\](?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi,
        // Pattern for schema.table with alias (must have dot)
        /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi,
        // Pattern for just table name with alias (no schema)
        /\b(?:from|(?:inner\s+|left\s+|right\s+|full\s+|cross\s+)?join)\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(?:as\s+)?([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s+on\s+|\s+where\s+|\s+order\s+by\s+|\s+group\s+by\s+|\s+having\s+|\s*$|\s*\r?\n)/gi
    ];
    
    patterns.forEach((pattern, patternIndex) => {
        console.log(`[SQL-COMPLETION] Testing pattern ${patternIndex + 1}:`, pattern);
        // Create a new regex instance to avoid global flag issues
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(query)) !== null) {
            console.log('[SQL-COMPLETION] Regex match:', match);
            
            // Pattern-specific parsing
            let schema, table, alias;
            if (patternIndex === 0) {
                // Bracketed: [schema].[table] or [table]
                schema = match[1] || 'dbo';
                table = match[2];
                alias = match[3];
            } else if (patternIndex === 1) {
                // schema.table (with dot)
                schema = match[1];
                table = match[2];
                alias = match[3];
            } else {
                // table only (no schema)
                schema = 'dbo';
                table = match[1];
                alias = match[2];
            }
            
            console.log('[SQL-COMPLETION] Parsed - schema:', schema, 'table:', table, 'alias:', alias);
            
            // Skip if the captured alias is actually a SQL keyword
            if (alias && sqlKeywords.includes(alias.toLowerCase())) {
                console.log('[SQL-COMPLETION] Skipping alias as it\'s a SQL keyword:', alias);
                alias = undefined;
            }
            
            // Verify this is a valid table in our schema
            const tableInfo = findTable(table.toLowerCase());
            console.log('[SQL-COMPLETION] findTable result for', table, ':', tableInfo);
            
            if (tableInfo) {
                const hasExplicitAlias = !!alias;
                
                // If no explicit alias, use the table name as the alias
                if (!alias) {
                    alias = tableInfo.table;
                }
                
                // Check if table is already added to avoid duplicates
                const existingTable = tables.find(t => 
                    t.schema === tableInfo.schema && 
                    t.table === tableInfo.table
                );
                
                if (!existingTable) {
                    const tableEntry = {
                        schema: tableInfo.schema,
                        table: tableInfo.table,
                        alias: alias,
                        hasExplicitAlias: hasExplicitAlias
                    };
                    
                    tables.push(tableEntry);
                    console.log('[SQL-COMPLETION] Added table:', tableEntry);
                }
            } else {
                console.log('[SQL-COMPLETION] Table not found in schema:', table);
            }
        }
    });
    
    console.log('[SQL-COMPLETION] Final extracted tables:', tables);
    return tables;
}

function findTableForAlias(query, alias) {
    const lowerQuery = query.toLowerCase();
    const lowerAlias = alias.toLowerCase();

    // Pattern: FROM tableName alias or JOIN tableName alias
    const patterns = [
        new RegExp(`from\\\\s+(?:(\\\\w+)\\\\.)?(\\\\w+)\\\\s+(?:as\\\\s+)?${lowerAlias}(?:\\\\s|,|\\$)`, 'i'),
        new RegExp(`join\\\\s+(?:(\\\\w+)\\\\.)?(\\\\w+)\\\\s+(?:as\\\\s+)?${lowerAlias}(?:\\\\s|,|\\$)`, 'i')
    ];

    for (const pattern of patterns) {
        const match = query.match(pattern);
        if (match) {
            return {
                schema: match[1] || 'dbo',
                table: match[2]
            };
        }
    }

    // Check if alias is actually the table name itself
    const directTable = findTable(lowerAlias);
    if (directTable) {
        return directTable;
    }

    return null;
}

function findTable(tableName) {
    const lowerName = tableName.toLowerCase();
    
    // Check tables first
    for (const table of dbSchema.tables) {
        if (table.name.toLowerCase() === lowerName) {
            return { schema: table.schema, table: table.name };
        }
    }
    
    // Then check views
    for (const view of dbSchema.views) {
        if (view.name.toLowerCase() === lowerName) {
            return { schema: view.schema, table: view.name };
        }
    }
    
    return null;
}

function getColumnsForTable(schema, tableName) {
    const lowerName = tableName.toLowerCase();
    
    for (const table of dbSchema.tables) {
        if (table.name.toLowerCase() === lowerName && table.schema === schema) {
            return table.columns;
        }
    }
    
    for (const view of dbSchema.views) {
        if (view.name.toLowerCase() === lowerName && view.schema === schema) {
            return view.columns;
        }
    }
    
    return [];
}

function getRelatedTables(tablesInQuery) {
    const relatedTables = [];
    const existingTableNames = tablesInQuery.map(t => t.table.toLowerCase());
    
    // Get all tables with foreign keys
    if (dbSchema.foreignKeys) {
        tablesInQuery.forEach(tableInfo => {
            const tableName = tableInfo.table.toLowerCase();
            
            // Find foreign keys FROM this table (this table references other tables)
            dbSchema.foreignKeys.forEach(fk => {
                if (fk.fromTable.toLowerCase() === tableName && 
                    !existingTableNames.includes(fk.toTable.toLowerCase())) {
                    
                    const table = dbSchema.tables.find(t => 
                        t.name.toLowerCase() === fk.toTable.toLowerCase() && 
                        t.schema === fk.toSchema
                    );
                    
                    if (table && !relatedTables.find(rt => 
                        rt.name.toLowerCase() === table.name.toLowerCase() && 
                        rt.schema === table.schema
                    )) {
                        relatedTables.push({
                            ...table,
                            foreignKeyInfo: {
                                direction: 'to',
                                fromTable: fk.fromTable,
                                fromAlias: tableInfo.alias,
                                fromHasExplicitAlias: tableInfo.hasExplicitAlias,
                                fromColumn: fk.fromColumn,
                                toTable: fk.toTable,
                                toColumn: fk.toColumn
                            }
                        });
                    }
                }
                
                // Find foreign keys TO this table (other tables reference this table)
                if (fk.toTable.toLowerCase() === tableName && 
                    !existingTableNames.includes(fk.fromTable.toLowerCase())) {
                    
                    const table = dbSchema.tables.find(t => 
                        t.name.toLowerCase() === fk.fromTable.toLowerCase() && 
                        t.schema === fk.fromSchema
                    );
                    
                    if (table && !relatedTables.find(rt => 
                        rt.name.toLowerCase() === table.name.toLowerCase() && 
                        rt.schema === table.schema
                    )) {
                        relatedTables.push({
                            ...table,
                            foreignKeyInfo: {
                                direction: 'from',
                                fromTable: fk.fromTable,
                                fromAlias: tableInfo.alias,
                                fromHasExplicitAlias: tableInfo.hasExplicitAlias,
                                fromColumn: fk.fromColumn,
                                toTable: fk.toTable,
                                toColumn: fk.toColumn
                            }
                        });
                    }
                }
            });
        });
    }
    
    // If no related tables found or no FK info, return all tables except those already in query
    if (relatedTables.length === 0) {
        return dbSchema.tables.filter(table => 
            !existingTableNames.includes(table.name.toLowerCase())
        );
    }
    
    return relatedTables;
}

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;

    switch (message.type) {
        case 'config':
            if (message.config.colorPrimaryForeignKeys !== undefined) {
                colorPrimaryForeignKeys = message.config.colorPrimaryForeignKeys;
                console.log('[CONFIG] colorPrimaryForeignKeys set to:', colorPrimaryForeignKeys);
            }
            break;
        case 'update':
            if (editor && message.content !== editor.getValue()) {
                isUpdatingFromExtension = true;
                const position = editor.getPosition();
                editor.setValue(message.content);
                if (position) {
                    editor.setPosition(position);
                }
                isUpdatingFromExtension = false;
            }
            break;

        case 'connectionsUpdate':
            // message.connections is an array of connection configs
            updateConnectionsList(message.connections || [], message.currentConnectionId, message.currentDatabase);
            break;

        case 'databasesUpdate':
            // message.databases is an array of database names for current server connection
            updateDatabasesList(message.databases || [], message.currentDatabase);
            break;

        case 'schemaUpdate':
            console.log('[SQL-COMPLETION] Received schemaUpdate message');
            console.log('[SQL-COMPLETION] Message schema:', message.schema);
            dbSchema = message.schema || { tables: [], views: [], foreignKeys: [] };
            console.log('[SQL-COMPLETION] Schema updated:', dbSchema.tables.length, 'tables', dbSchema.views.length, 'views', dbSchema.foreignKeys.length, 'foreign keys');
            console.log('[SQL-COMPLETION] Tables:', dbSchema.tables?.map(t => `${t.schema}.${t.name}`).join(', '));
            break;

        case 'executing':
            showLoading();
            break;

        case 'results':
            // Store metadata and original query for editable result sets
            resultSetMetadata = message.metadata || [];
            originalQuery = message.originalQuery || '';
            showResults(message.resultSets, message.executionTime, message.rowsAffected, message.messages, message.planXml);
            break;

        case 'relationResults':
            // Handle FK/PK expansion query results
            handleRelationResults(message);
            break;

        case 'queryPlan':
            showQueryPlan(message.planXml, message.executionTime, message.messages, message.resultSets);
            break;

        case 'error':
            showError(message.error, message.messages);
            break;

        case 'commitSuccess':
            // Clear pending changes after successful commit
            pendingChanges.clear();
            updatePendingChangesCount();
            
            // Remove all cell-modified classes
            document.querySelectorAll('.cell-modified').forEach(cell => {
                cell.classList.remove('cell-modified');
            });
            
            // Show success message
            displayMessages([{ type: 'info', text: message.message }]);
            console.log('[EDIT] Changes committed successfully');
            break;

        case 'confirmActionResult':
            // Handle confirmation response from extension
            if (message.confirmed && message.action === 'revertAll') {
                executeRevertAll();
            }
            break;

        case 'showMessage':
            // Handle messages from extension (they're already shown by the extension)
            console.log(`[MESSAGE] ${message.level}: ${message.message}`);
            break;
            
        case 'autoExecuteQuery':
            // Auto-execute the query if conditions are met
            if (editor && currentConnectionId) {
                const content = editor.getValue().trim();
                if (content && content.toLowerCase().startsWith('select')) {
                    // Small delay to ensure the webview is fully initialized
                    setTimeout(() => {
                        executeQuery();
                    }, 50);
                }
            }
            break;
            
        case 'snippetsUpdate':
            console.log('[SNIPPETS] Received snippets:', message.snippets?.length || 0);
            const newSnippets = message.snippets || [];
            
            // Update snippets array - completion provider will use updated data automatically
            if (JSON.stringify(sqlSnippets) !== JSON.stringify(newSnippets)) {
                console.log('[SNIPPETS] Snippets changed, updating array...');
                sqlSnippets = newSnippets;
                console.log('[SNIPPETS] Snippets updated. Completion provider will use new data on next invocation.');
                
                // Register completion provider if not already registered
                if (!completionProviderRegistered) {
                    registerCompletionProvider();
                }
            } else {
                console.log('[SNIPPETS] Snippets unchanged');
            }
            break;
            
        case 'snippetInputReceived':
            // Handle snippet input from extension
            if (message.success && message.name && message.prefix) {
                console.log('[SNIPPETS] Received snippet input:', message.name, message.prefix);
                
                // Send create snippet message to extension
                vscode.postMessage({
                    type: 'createSnippet',
                    name: message.name,
                    prefix: message.prefix,
                    body: message.body,
                    description: message.description
                });
            } else {
                console.log('[SNIPPETS] Snippet creation cancelled or invalid input');
            }
            break;
    }
});

function updateConnectionsList(connections, selectedConnectionId, selectedDatabase) {
    // connections: [{ id, server, database, connectionType }]
    activeConnections = connections;
    currentConnectionId = selectedConnectionId;
    currentDatabaseName = selectedDatabase;

    const databaseLabel = document.getElementById('databaseLabel');
    
    if (!connections || connections.length === 0) {
        connectionDropdown.setItems([{
            value: '',
            text: 'Not Connected',
            selected: true
        }]);
        connectionDropdown.setDisabled(true);
        databaseDropdown.hide();
        databaseLabel.style.display = 'none';
        return;
    }

    connectionDropdown.setDisabled(false);
    
    const items = connections.map(conn => ({
        value: conn.id,
        text: conn.name,
        selected: selectedConnectionId && conn.id === selectedConnectionId
    }));
    
    connectionDropdown.setItems(items);
    
    // Handle database selector visibility
    const selectedConnection = connections.find(c => c.id === selectedConnectionId);
    if (selectedConnection && selectedConnection.connectionType === 'server') {
        databaseLabel.style.display = 'inline-block';
        databaseDropdown.show();
        // Request databases list from extension - pass current database selection
        vscode.postMessage({
            type: 'getDatabases',
            connectionId: selectedConnectionId,
            selectedDatabase: currentDatabaseName
        });
    } else {
        databaseLabel.style.display = 'none';
        databaseDropdown.hide();
        
        // Request schema for direct database connection
        if (selectedConnectionId) {
            vscode.postMessage({ 
                type: 'getSchema', 
                connectionId: selectedConnectionId 
            });
        }
    }
}

function updateDatabasesList(databases, selectedDatabase) {
    if (!databases || databases.length === 0) {
        databaseDropdown.setItems([{
            value: '',
            text: 'No databases available',
            selected: true
        }]);
        databaseDropdown.setDisabled(true);
        return;
    }
    
    databaseDropdown.setDisabled(false);
    
    const items = databases.map(dbName => ({
        value: dbName,
        text: dbName,
        selected: selectedDatabase && dbName === selectedDatabase
    }));
    
    databaseDropdown.setItems(items);
    
    // If a database is selected, request its schema
    if (selectedDatabase && currentConnectionId) {
        vscode.postMessage({ 
            type: 'getSchema', 
            connectionId: `${currentConnectionId}::${selectedDatabase}` 
        });
    }
}

function showLoading() {
    const resultsContent = document.getElementById('resultsContent');
    const statusLabel = document.getElementById('statusLabel');
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const resizer = document.getElementById('resizer');
    
    // Create loading content with spinner and timer
    const loadingHtml = `
        <div class="loading">
            <div class="loading-spinner"></div>
            <div>Executing query...</div>
            <div class="loading-timer" id="loadingTimer">00:00</div>
        </div>
    `;
    
    resultsContent.innerHTML = loadingHtml;
    resultsContainer.classList.add('visible');
    resizer.classList.add('visible');
    
    executeButton.disabled = true;
    cancelButton.disabled = false;
    statusLabel.textContent = 'Executing query...';

    // Show results panel with initial height if not already set
    if (!resultsContainer.style.flex) {
        resultsContainer.style.flex = '0 0 300px';
    }

    // Switch to results tab
    document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
    const resultsTab = document.querySelector('.results-tab[data-tab="results"]');
    if (resultsTab) {
        resultsTab.classList.add('active');
    }
    currentTab = 'results';
    
    // Ensure results container is visible and messages is hidden
    const messagesContent = document.getElementById('messagesContent');
    if (resultsContent) {
        resultsContent.style.display = 'block';
    }
    if (messagesContent) {
        messagesContent.style.display = 'none';
    }
    
    // Start the timer
    startLoadingTimer();
}

function startLoadingTimer() {
    queryStartTime = Date.now();
    
    // Clear any existing timer
    if (queryTimerInterval) {
        clearInterval(queryTimerInterval);
    }
    
    // Update timer every 100ms for smooth display
    queryTimerInterval = setInterval(() => {
        const elapsed = Date.now() - queryStartTime;
        const seconds = Math.floor(elapsed / 1000);
        const milliseconds = Math.floor((elapsed % 1000) / 100);
        
        const timerElement = document.getElementById('loadingTimer');
        if (timerElement) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            const timeString = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds}`;
            timerElement.textContent = timeString;
        }
    }, 100);
}

function stopLoadingTimer() {
    if (queryTimerInterval) {
        clearInterval(queryTimerInterval);
        queryTimerInterval = null;
    }
}

function showResults(resultSets, executionTime, rowsAffected, messages, planXml) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    
    // Stop the loading timer
    stopLoadingTimer();
    
    lastResults = resultSets;
    lastMessages = messages || [];
    
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    const totalRows = resultSets.reduce((sum, rs) => sum + rs.length, 0);
    statusLabel.textContent = `Query completed (${resultSets.length} result set(s), ${totalRows} rows)`;

    // Update aggregation stats (initially empty)
    updateAggregationStats();

    // Show/hide plan tabs based on whether we have a plan
    if (planXml) {
        // Parse and store the plan data
        currentQueryPlan = parseQueryPlan(planXml);
        
        // Show plan tabs
        document.querySelectorAll('.results-tab').forEach(tab => {
            if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
                tab.style.display = 'block';
            }
        });
        
        // Display the plan in different views
        displayQueryPlanGraphical(currentQueryPlan);
        displayPlanTree(currentQueryPlan);
        displayTopOperations(currentQueryPlan);
    } else {
        // Hide plan tabs when no plan
        document.querySelectorAll('.results-tab').forEach(tab => {
            if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
                tab.style.display = 'none';
            }
        });
    }

    // Always update both containers
    displayResults(resultSets, planXml);
    displayMessages(messages);
    
    // Determine which tab to show by default
    // If there are no result sets (queries like UPDATE, DELETE, INSERT), show Messages tab
    // Otherwise, show Results tab
    const hasResultSets = resultSets && resultSets.length > 0 && resultSets.some(rs => rs && rs.length > 0);
    
    if (!hasResultSets) {
        // Switch to Messages tab for queries without result sets
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        const messagesTab = document.querySelector('.results-tab[data-tab="messages"]');
        if (messagesTab) {
            messagesTab.classList.add('active');
        }
        currentTab = 'messages';
        
        // Show messages content, hide others
        const resultsContent = document.getElementById('resultsContent');
        const messagesContent = document.getElementById('messagesContent');
        const queryPlanContent = document.getElementById('queryPlanContent');
        const planTreeContent = document.getElementById('planTreeContent');
        const topOperationsContent = document.getElementById('topOperationsContent');
        
        if (resultsContent) resultsContent.style.display = 'none';
        if (messagesContent) messagesContent.style.display = 'block';
        if (queryPlanContent) queryPlanContent.style.display = 'none';
        if (planTreeContent) planTreeContent.style.display = 'none';
        if (topOperationsContent) topOperationsContent.style.display = 'none';
    } else {
        // Switch to Results tab for queries with result sets
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        const resultsTab = document.querySelector('.results-tab[data-tab="results"]');
        if (resultsTab) {
            resultsTab.classList.add('active');
        }
        currentTab = 'results';
        
        // Show results content, hide others
        const resultsContent = document.getElementById('resultsContent');
        const messagesContent = document.getElementById('messagesContent');
        const queryPlanContent = document.getElementById('queryPlanContent');
        const planTreeContent = document.getElementById('planTreeContent');
        
        if (resultsContent) resultsContent.style.display = 'block';
        if (messagesContent) messagesContent.style.display = 'none';
        if (queryPlanContent) queryPlanContent.style.display = 'none';
        if (planTreeContent) planTreeContent.style.display = 'none';
        const topOperationsContent = document.getElementById('topOperationsContent');
        if (topOperationsContent) topOperationsContent.style.display = 'none';
    }
}

function displayResults(resultSets, planXml) {
    console.log('[SQL EDITOR] displayResults called with', resultSets.length, 'result set(s)');
    console.log('[SQL EDITOR] planXml present:', !!planXml, 'length:', planXml ? planXml.length : 0);
    const resultsContent = document.getElementById('resultsContent');
    console.log('[SQL EDITOR] resultsContent element:', resultsContent);

    if (!resultSets || resultSets.length === 0) {
        resultsContent.innerHTML = '<div class="no-results">No rows returned</div>';
        return;
    }

    // Clear previous content
    resultsContent.innerHTML = '';
    
    // Determine if we should use single-result-set mode (100% height)
    const isSingleResultSet = resultSets.length === 1 && !planXml;
    
    // Add appropriate class to resultsContent
    if (isSingleResultSet) {
        resultsContent.classList.add('single-result-set');
        resultsContent.classList.remove('multiple-result-sets');
    } else {
        resultsContent.classList.add('multiple-result-sets');
        resultsContent.classList.remove('single-result-set');
    }

    // Create a table for each result set
    resultSets.forEach((results, index) => {
        if (!results || results.length === 0) {
            return;
        }

        // Create container for this result set
        const resultSetContainer = document.createElement('div');
        resultSetContainer.className = 'result-set-container';
        if (isSingleResultSet) {
            resultSetContainer.classList.add('full-height');
        }

        // Create table container
        const tableContainer = document.createElement('div');
        tableContainer.className = 'result-set-table';
        if (isSingleResultSet) {
            tableContainer.classList.add('full-height');
        }
        
        // Initialize AG-Grid-like table for this result set
        console.log('[SQL EDITOR] Creating table for result set', index + 1, 'with', results.length, 'rows');
        const metadata = resultSetMetadata[index];
        initAgGridTable(results, tableContainer, isSingleResultSet, index, metadata);
        
        resultSetContainer.appendChild(tableContainer);
        resultsContent.appendChild(resultSetContainer);
    });
    
    // Add execution plan as a separate result set if present
    if (planXml) {
        const planContainer = document.createElement('div');
        planContainer.className = 'result-set-container';
        planContainer.style.marginTop = '20px';
        
        const planTitle = document.createElement('h3');
        planTitle.textContent = 'Execution Plan (XML)';
        planTitle.style.marginBottom = '10px';
        planContainer.appendChild(planTitle);
        
        const planTableContainer = document.createElement('div');
        planTableContainer.className = 'result-set-table';
        
        // Create a single-cell table with the XML plan
        const planData = [{ 'Microsoft SQL Server 2005 XML Showplan': planXml }];
        initAgGridTable(planData, planTableContainer, false);
        
        planContainer.appendChild(planTableContainer);
        resultsContent.appendChild(planContainer);
    }
    
    // Check if the results content parent has overflow
    const resultsContainer = document.getElementById('resultsContainer');
    console.log('[SQL EDITOR] resultsContainer height:', resultsContainer?.offsetHeight);
    console.log('[SQL EDITOR] resultsContent height:', resultsContent?.offsetHeight, 'scrollHeight:', resultsContent?.scrollHeight);
}

// ===== FK/PK EXPANSION FUNCTIONS =====
// Moved to relationExpansion.js
// ===== END FK/PK EXPANSION FUNCTIONS =====

function initAgGridTable(rowData, container, isSingleResultSet = false, resultSetIndex = 0, metadata = null) {
    console.log('[AG-GRID] initAgGridTable called with', rowData.length, 'rows, single result set:', isSingleResultSet);
    console.log('[AG-GRID] Container element:', container, 'offsetHeight:', container.offsetHeight, 'scrollHeight:', container.scrollHeight);
    console.log('[AG-GRID] Metadata:', metadata);
    
    // Create PK/FK lookup maps from metadata columns
    // This works for all result sets, regardless of single or multiple tables
    const pkColumnSet = new Set();
    const fkColumnMap = new Map(); // Map column name to FK info
    
    if (metadata && metadata.columns) {
        metadata.columns.forEach(col => {
            if (col.isPrimaryKey) {
                pkColumnSet.add(col.name);
            }
            // Check FK from dbSchema if we have source table info
            if (col.sourceTable && col.sourceSchema && dbSchema.foreignKeys) {
                dbSchema.foreignKeys.forEach(fk => {
                    if (fk.fromTable === col.sourceTable && 
                        fk.fromSchema === col.sourceSchema && 
                        fk.fromColumn === col.name) {
                        fkColumnMap.set(col.name, fk);
                    }
                });
            }
        });
        console.log('[AG-GRID] PK columns:', Array.from(pkColumnSet));
        console.log('[AG-GRID] FK columns:', Array.from(fkColumnMap.keys()));
    }
    
    // Virtual scrolling configuration
    const ROW_HEIGHT = 30; // Fixed row height in pixels
    const VISIBLE_ROWS = 30; // Number of rows to render in viewport
    const BUFFER_ROWS = 10; // Extra rows to render above/below viewport
    const RENDER_CHUNK_SIZE = VISIBLE_ROWS + (BUFFER_ROWS * 2);
    
    // Function to calculate optimal column width based on content
    function calculateOptimalColumnWidth(columnName, columnData, type) {
        // Create a temporary canvas element for text measurement
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        
        // Set font to match table font for accurate measurement
        context.font = '13px var(--vscode-font-family, "Segoe UI", sans-serif)';
        
        // Measure header width
        const headerWidth = context.measureText(columnName).width;
        
        // Find the longest content in this column
        let maxContentWidth = 0;
        let longestContent = '';
        
        // Sample up to 100 rows for performance (or all if less than 100)
        const sampleSize = Math.min(100, columnData.length);
        const step = Math.max(1, Math.floor(columnData.length / sampleSize));
        
        for (let i = 0; i < columnData.length; i += step) {
            const value = columnData[i];
            let displayValue = '';
            
            if (value === null || value === undefined) {
                displayValue = 'NULL';
            } else if (type === 'boolean') {
                displayValue = value ? '✓' : '✗';
            } else if (type === 'number') {
                displayValue = typeof value === 'number' ? value.toLocaleString() : String(value);
            } else {
                displayValue = String(value);
            }
            
            const contentWidth = context.measureText(displayValue).width;
            if (contentWidth > maxContentWidth) {
                maxContentWidth = contentWidth;
                longestContent = displayValue;
            }
        }
        
        console.log(`[COLUMN-WIDTH] Column "${columnName}": header=${headerWidth.toFixed(1)}px, content=${maxContentWidth.toFixed(1)}px ("${longestContent.substring(0, 20)}...")`);
        
        // Calculate optimal width (max of header and content, plus padding)
        const padding = 32; // 16px padding on each side + some extra space for icons and borders
        const iconSpace = 80; // Space for sort, filter, and pin icons
        const optimalWidth = Math.max(headerWidth + iconSpace, maxContentWidth + padding);
        
        // Set reasonable min/max bounds
        const minWidth = 80;
        const maxWidth = 450;
        const paddingWidth = 36; 
        
        const finalWidth = Math.min(Math.max(optimalWidth, minWidth), maxWidth) + paddingWidth;
        console.log(`[COLUMN-WIDTH] Column "${columnName}" final width: ${finalWidth.toFixed(0)}px`);
        
        return Math.round(finalWidth);
    }

    // Detect column types and create columnDefs
    const columns = Object.keys(rowData[0]);
    console.log('[AG-GRID] Detected columns:', columns);
    
    const columnDefs = columns.map(col => {
        const sampleValue = rowData[0][col];
        let type = 'string';
        
        if (typeof sampleValue === 'number') {
            type = 'number';
        } else if (typeof sampleValue === 'boolean') {
            type = 'boolean';
        } else if (sampleValue instanceof Date || (typeof sampleValue === 'string' && !isNaN(Date.parse(sampleValue)) && sampleValue.match(/\\d{4}-\\d{2}-\\d{2}/))) {
            type = 'date';
        }
        
        // Extract column data for width calculation
        const columnData = rowData.map(row => row[col]);
        const optimalWidth = calculateOptimalColumnWidth(col, columnData, type);
        
        // Check if this column is a primary key or foreign key
        // Use PK/FK info from metadata columns (works for all result sets)
        const isPrimaryKey = pkColumnSet.has(col);
        const isForeignKey = fkColumnMap.has(col);
        
        return {
            field: col,
            headerName: col,
            type: type,
            width: optimalWidth,
            pinned: false,
            isPrimaryKey: isPrimaryKey,
            isForeignKey: isForeignKey
        };
    });

    console.log('[AG-GRID] Column definitions created:', columnDefs.map(c => ({ name: c.headerName, type: c.type, width: c.width })));

    let filteredData = [...rowData];
    let activeFilters = {};
    let currentFilterPopup = null;
    let sortConfig = { field: null, direction: null };
    
    // Virtual scrolling state
    let currentStartRow = 0;
    let scrollTimeout = null;

    // Build the table HTML structure with virtual scrolling support
    const tableId = `agGrid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const viewportClass = isSingleResultSet ? 'ag-grid-viewport full-height' : 'ag-grid-viewport';
    const tableHtml = `
        <div class="${viewportClass}" style="overflow: auto; position: relative; height: 100%; width: 100%;">
            <table id="${tableId}" class="ag-grid-table" style="border-collapse: collapse; table-layout: auto; width: 100%;">
                <thead class="ag-grid-thead"></thead>
                <tbody class="ag-grid-tbody" style="position: relative;"></tbody>
            </table>
        </div>
    `;
    
    console.log('[AG-GRID] Setting container innerHTML');
    container.innerHTML = tableHtml;
    
    const viewport = container.querySelector('.ag-grid-viewport');
    const table = container.querySelector('.ag-grid-table');
    const tbody = container.querySelector('.ag-grid-tbody');
    console.log('[AG-GRID] Table element:', table, 'border-collapse:', table?.style.borderCollapse);

    renderAgGridHeaders(columnDefs, sortConfig, activeFilters, container, filteredData);
    
    // Calculate and set table width based on column widths
    const totalTableWidth = columnDefs.reduce((sum, col) => sum + col.width, 0) + 50; // +50 for row number column
    table.style.width = `${totalTableWidth}px`;
    table.style.minWidth = `${totalTableWidth}px`;
    console.log('[AG-GRID] Table width set to:', totalTableWidth, 'px');
    
    renderAgGridRows(columnDefs, filteredData, container, 0, ROW_HEIGHT, RENDER_CHUNK_SIZE);
    
    // Set up virtual scrolling
    viewport.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            const scrollTop = viewport.scrollTop;
            const newStartRow = Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS;
            const clampedStartRow = Math.max(0, Math.min(newStartRow, filteredData.length - RENDER_CHUNK_SIZE));
            
            if (clampedStartRow !== currentStartRow) {
                currentStartRow = clampedStartRow;
                renderAgGridRows(columnDefs, filteredData, container, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);
            }
        }, 10);
    });
    
    console.log('[AG-GRID] Virtual scrolling initialized with', filteredData.length, 'total rows, rendering', RENDER_CHUNK_SIZE, 'at a time');

    function renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, data) {
        console.log('[AG-GRID] renderAgGridHeaders called with', colDefs.length, 'columns');
        const thead = containerEl.querySelector('.ag-grid-thead');
        if (!thead) {
            console.error('[AG-GRID] thead element not found!');
            return;
        }
        
        const tr = document.createElement('tr');
        
        // Add export button header
        const rowNumTh = document.createElement('th');
        rowNumTh.className = 'ag-grid-row-number-header export-header';
        rowNumTh.innerHTML = `
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="sort-to-top-icon"
            >
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                <path d="M7 9l5-5l5 5" />
                <path d="M12 4v12" />
            </svg>
            `;
        // Set styles individually to avoid cssText issues
        rowNumTh.style.width = '50px';
        rowNumTh.style.minWidth = '50px';
        rowNumTh.style.maxWidth = '50px';
        rowNumTh.style.borderBottom = '1px solid var(--vscode-panel-border, #3c3c3c)';
        rowNumTh.style.padding = '8px';
        rowNumTh.style.cursor = 'pointer';
        rowNumTh.style.userSelect = 'none';
        rowNumTh.style.textAlign = 'center';
        rowNumTh.style.position = 'relative';
        rowNumTh.title = 'Click for export options and auto-fit columns';
        
        // Add click handler to show export menu
        rowNumTh.addEventListener('click', (e) => {
            e.stopPropagation();
            showExportMenu(e.target.closest('th'), colDefs, data, containerEl, sortCfg, filters);
        });
        
        console.log('[AG-GRID] Row number header created with class:', rowNumTh.className);
        tr.appendChild(rowNumTh);
        
        const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        console.log('[AG-GRID] Table total width set to:', totalWidth);

        colDefs.forEach((col, index) => {
            const th = document.createElement('th');
            
            // Base styles - set individually to avoid cssText overriding
            th.style.width = col.width + 'px';
            th.style.minWidth = col.width + 'px';
            th.style.maxWidth = col.width + 'px';
            th.style.backgroundColor = 'var(--vscode-editorGroupHeader-tabsBackground, #252526)';
            th.style.borderBottom = '1px solid var(--vscode-panel-border, #3c3c3c)';
            th.style.borderRight = '1px solid var(--vscode-panel-border, #3c3c3c)';
            th.style.padding = '8px';
            th.style.textAlign = 'left';
            th.style.fontWeight = '600';
            th.style.userSelect = 'none';
            th.style.whiteSpace = 'nowrap';
            th.style.overflow = 'hidden';
            th.style.textOverflow = 'ellipsis';
            
            // Don't set position, top, or z-index inline - let CSS classes handle it
            console.log(`[AG-GRID] Header for column "${col.headerName}" - pinned: ${col.pinned}`);
            
            if (col.pinned) {
                const leftOffset = calculatePinnedOffset(colDefs, index);
                th.style.left = leftOffset + 'px';
                th.classList.add('ag-grid-pinned-header');
                console.log(`[AG-GRID] Pinned column "${col.headerName}" left offset:`, leftOffset);
            }
            
            th.dataset.field = col.field;

            const headerContent = document.createElement('div');
            headerContent.style.cssText = 'position: relative; width: 100%; height: 100%; display: flex; align-items: center;';

            const headerTitle = document.createElement('span');
            headerTitle.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; width: 100%; display: block;';
            headerTitle.textContent = col.headerName;

            headerTitle.onclick = (e) => {
                e.stopPropagation();
                highlightColumn(index, colDefs, containerEl, filteredData, e);
            };
            
            // Add context menu for column header
            headerTitle.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                showColumnHeaderContextMenu(e, {
                    table: containerEl.querySelector('.ag-grid-table'),
                    columnIndex: index,
                    columnDefs: colDefs,
                    data: data
                });
            };

            headerContent.appendChild(headerTitle);

            // Action buttons positioned absolutely on the right (no container)
            const sortIcon = document.createElement('span');
            const isSorted = sortCfg.field === col.field;
            sortIcon.className = 'ag-header-icon';
            sortIcon.style.cssText = `
                position: absolute;
                right: 44px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${isSorted ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            
            if (isSorted) {
                // Show chevron when sorted
                sortIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-button-background, #0e639c)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="${sortCfg.direction === 'desc' ? 'transform: rotate(180deg);' : ''}">
                        <path d="M6 15l6 -6l6 6" />
                    </svg>
                `;
            } else {
                // Show sort icon when not sorted
                sortIcon.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 9l4 -4l4 4m-4 -4v14" />
                        <path d="M21 15l-4 4l-4 -4m4 4v-14" />
                    </svg>
                `;
            }
            
            sortIcon.onclick = (e) => {
                e.stopPropagation();
                handleSort(col, colDefs, sortCfg, filters, containerEl);
            };
            
            sortIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(sortIcon);

            const pinIcon = document.createElement('span');
            pinIcon.className = 'ag-header-icon';
            pinIcon.style.cssText = `
                position: absolute;
                right: 24px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${col.pinned ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            pinIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${col.pinned ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4" />
                    <path d="M9 15l-4.5 4.5" />
                    <path d="M14.5 4l5.5 5.5" />
                </svg>
            `;
            pinIcon.onclick = (e) => {
                e.stopPropagation();
                // Preserve current vertical scroll position so user doesn't jump to top
                try {
                    const prevScrollTop = viewport.scrollTop;
                    const prevStartRow = Math.floor(prevScrollTop / ROW_HEIGHT);

                    // Toggle pinned state
                    col.pinned = !col.pinned;

                    // Re-render headers first (pinned classes may change layout)
                    renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);

                    // Re-render rows keeping the user's current view
                    currentStartRow = Math.max(0, Math.min(prevStartRow, Math.max(0, filteredData.length - RENDER_CHUNK_SIZE)));
                    renderAgGridRows(colDefs, filteredData, containerEl, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);

                    // Restore exact scroll position (in case row heights/layout changed slightly)
                    // Use requestAnimationFrame to ensure DOM was updated
                    requestAnimationFrame(() => {
                        viewport.scrollTop = prevScrollTop;
                    });
                } catch (err) {
                    // Fallback to safe behavior: render from top
                    col.pinned = !col.pinned;
                    currentStartRow = 0;
                    viewport.scrollTop = 0;
                    renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
                    renderAgGridRows(colDefs, filteredData, containerEl, 0, ROW_HEIGHT, RENDER_CHUNK_SIZE);
                }
            };
            
            pinIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(pinIcon);

            const filterIcon = document.createElement('span');
            const isFiltered = !!filters[col.field];
            filterIcon.className = 'ag-header-icon';
            filterIcon.style.cssText = `
                position: absolute;
                right: 4px;
                top: 50%;
                transform: translateY(-50%);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                padding: 4px;
                border-radius: 2px;
                opacity: ${isFiltered ? 1 : 0};
                transition: opacity 0.2s, background-color 0.2s;
                background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
                z-index: 1;
            `;
            filterIcon.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${isFiltered ? 'var(--vscode-button-background, #0e639c)' : 'currentColor'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z" />
                </svg>
            `;
            filterIcon.onclick = (e) => showAgGridFilter(e, col, th, colDefs, sortCfg, filters, containerEl);
            
            filterIcon.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            headerContent.appendChild(filterIcon);

            // Add hover effect to show icons
            th.onmouseenter = () => {
                if (!isSorted) sortIcon.style.opacity = '1';
                if (!col.pinned) pinIcon.style.opacity = '1';
                if (!isFiltered) filterIcon.style.opacity = '1';
            };
            th.onmouseleave = () => {
                if (!isSorted) sortIcon.style.opacity = '0';
                if (!col.pinned) pinIcon.style.opacity = '0';
                if (!isFiltered) filterIcon.style.opacity = '0';
            };

            // Add resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.style.cssText = `
                position: absolute;
                right: 0;
                top: 0;
                width: 4px;
                height: 100%;
                cursor: col-resize;
                background-color: transparent;
                transition: background-color 0.2s;
                z-index: 25;
            `;
            resizeHandle.title = 'Drag to resize column, double-click to auto-fit';
            resizeHandle.onmouseover = () => resizeHandle.style.backgroundColor = 'var(--vscode-button-background, #0e639c)';
            resizeHandle.onmouseout = () => resizeHandle.style.backgroundColor = 'transparent';
            resizeHandle.onmousedown = (e) => startResize(e, th, index, colDefs, sortCfg, filters, containerEl);
            
            // Add double-click to auto-fit column width
            resizeHandle.ondblclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                autoFitSingleColumn(index, colDefs, containerEl, filteredData);
            };
            
            resizeHandle.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };

            th.style.position = 'relative';
            th.appendChild(headerContent);
            th.appendChild(resizeHandle);
            tr.appendChild(th);
        });

        thead.innerHTML = '';
        thead.appendChild(tr);
    }

    // Column highlighting functionality
    function highlightColumn(colIndex, colDefs, containerEl, filteredData, event) {
        const ctrlPressed = event?.ctrlKey || event?.metaKey;
        const shiftPressed = event?.shiftKey;
        
        // Check if same table
        const sameTable = globalSelection.tableContainer === containerEl;
        const sameType = globalSelection.type === 'column';
        
        if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
            // Shift: select range from last clicked to current
            const start = Math.min(globalSelection.lastClickedIndex, colIndex);
            const end = Math.max(globalSelection.lastClickedIndex, colIndex);
            
            clearAllSelections();
            globalSelection.selections = [];
            
            for (let i = start; i <= end; i++) {
                globalSelection.selections.push({ columnIndex: i });
                applyColumnHighlightGlobal(containerEl, i);
            }
            
            globalSelection.type = 'column';
            globalSelection.tableContainer = containerEl;
            globalSelection.data = filteredData;
            globalSelection.columnDefs = colDefs;
        } else if (ctrlPressed && sameTable && sameType) {
            // Ctrl: toggle individual selection
            const existingIndex = globalSelection.selections.findIndex(s => s.columnIndex === colIndex);
            
            if (existingIndex >= 0) {
                // Remove from selection
                globalSelection.selections.splice(existingIndex, 1);
                
                if (globalSelection.selections.length === 0) {
                    // No more selections
                    clearAllSelections();
                    globalSelection = {
                        type: null,
                        tableContainer: null,
                        selections: [],
                        columnDef: null,
                        data: null,
                        columnDefs: null,
                        lastClickedIndex: null
                    };
                } else {
                    // Reapply all selections
                    clearAllSelections();
                    globalSelection.selections.forEach(s => {
                        applyColumnHighlightGlobal(containerEl, s.columnIndex);
                    });
                }
            } else {
                // Add to selection
                globalSelection.selections.push({ columnIndex: colIndex });
                applyColumnHighlightGlobal(containerEl, colIndex);
            }
            
            globalSelection.lastClickedIndex = colIndex;
        } else {
            // Normal click: single selection
            const isAlreadySelected = sameTable && sameType && 
                globalSelection.selections.length === 1 && 
                globalSelection.selections[0].columnIndex === colIndex;
            
            if (isAlreadySelected) {
                // Unselect - clear all selections
                clearAllSelections();
                globalSelection = {
                    type: null,
                    tableContainer: null,
                    selections: [],
                    columnDef: null,
                    data: null,
                    columnDefs: null,
                    lastClickedIndex: null
                };
            } else {
                // Clear all selections across all tables
                clearAllSelections();
                
                // Collect all cell values from the column
                const columnField = colDefs[colIndex].field;
                const columnSelections = filteredData.map((row, rowIndex) => ({
                    rowIndex: rowIndex,
                    columnIndex: colIndex,
                    cellValue: row[columnField]
                }));
                
                // Set global selection state
                globalSelection = {
                    type: 'column',
                    tableContainer: containerEl,
                    selections: columnSelections,
                    columnDef: colDefs[colIndex],
                    data: filteredData,
                    columnDefs: colDefs,
                    lastClickedIndex: colIndex
                };
                
                // Apply highlighting
                applyColumnHighlightGlobal(containerEl, colIndex);
            }
        }
        
        // Update aggregation stats
        updateAggregationStats();
    }

    // Column resizing functionality
    let resizingColumn = null;
    let startX = 0;
    let startWidth = 0;
    
    function doResize(e) {
        if (!resizingColumn) return;

        const diff = e.clientX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        
        resizingColumn.th.style.width = newWidth + 'px';
        resizingColumn.th.style.minWidth = newWidth + 'px';
        resizingColumn.th.style.maxWidth = newWidth + 'px';
        resizingColumn.colDefs[resizingColumn.colIndex].width = newWidth;
        
        // Update total table width
        const totalWidth = resizingColumn.colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = resizingColumn.containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        
        // Update all cells in this column (+2 because row number is first column)
        const cells = table.querySelectorAll(`td:nth-child(${resizingColumn.colIndex + 2})`);
        cells.forEach(cell => {
            cell.style.width = newWidth + 'px';
            cell.style.minWidth = newWidth + 'px';
            cell.style.maxWidth = newWidth + 'px';
        });
    }
    
    function stopResize() {
        resizingColumn = null;
        document.removeEventListener('mousemove', doResize);
        document.removeEventListener('mouseup', stopResize);
    }

    function autoFitColumnWidth(colIndex, colDefs, sortCfg, filters, containerEl, data) {
        const col = colDefs[colIndex];
        if (!col) return;
        
        console.log(`[AUTO-FIT] Auto-fitting column "${col.headerName}" (index: ${colIndex})`);
        
        // Extract current column data for recalculation
        const columnData = data.map(row => row[col.field]);
        const newWidth = calculateOptimalColumnWidth(col.headerName, columnData, col.type);
        
        // Update column definition
        col.width = newWidth;
        
        // Update header
        const th = containerEl.querySelector(`th[data-field="${col.field}"]`);
        if (th) {
            th.style.width = newWidth + 'px';
            th.style.minWidth = newWidth + 'px';
            th.style.maxWidth = newWidth + 'px';
        }
        
        // Update total table width
        const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
        const table = containerEl.querySelector('.ag-grid-table');
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
        
        // Update all cells in this column (+2 because row number is first column)
        const cells = table.querySelectorAll(`td:nth-child(${colIndex + 2})`);
        cells.forEach(cell => {
            cell.style.width = newWidth + 'px';
            cell.style.minWidth = newWidth + 'px';
            cell.style.maxWidth = newWidth + 'px';
        });
        
        console.log(`[AUTO-FIT] Column "${col.headerName}" resized to ${newWidth}px`);
    }

    function autoFitAllColumns(colDefs, sortCfg, filters, containerEl, data) {
        console.log('[AUTO-FIT] Auto-fitting all columns');
        
        // Calculate new widths for all columns
        colDefs.forEach((col, index) => {
            const columnData = data.map(row => row[col.field]);
            const newWidth = calculateOptimalColumnWidth(col.headerName, columnData, col.type);
            col.width = newWidth;
        });
        
        // Re-render headers and rows to apply new widths
        renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, data);
        
        // Preserve current scroll position
        const viewport = containerEl.querySelector('.ag-grid-viewport');
        const currentScrollTop = viewport ? viewport.scrollTop : 0;
        
        // Re-render visible rows
        const ROW_HEIGHT = 30;
        const RENDER_CHUNK_SIZE = 50;
        const newStartRow = Math.floor(currentScrollTop / ROW_HEIGHT);
        renderAgGridRows(colDefs, data, containerEl, newStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);
        
        // Restore scroll position
        if (viewport) {
            viewport.scrollTop = currentScrollTop;
        }
        
        console.log('[AUTO-FIT] All columns auto-fitted');
    }

    function startResize(e, th, colIndex, colDefs, sortCfg, filters, containerEl) {
        resizingColumn = { th, colIndex, colDefs, containerEl };
        startX = e.clientX;
        startWidth = th.offsetWidth;

        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);
        e.preventDefault();
        e.stopPropagation();
    }

    function renderAgGridRows(colDefs, data, containerEl, startRow = 0, rowHeight = 30, chunkSize = 50) {
        console.log('[AG-GRID] renderAgGridRows called - total:', data.length, 'rows, rendering from:', startRow, 'chunk:', chunkSize);
        const tbody = containerEl.querySelector('.ag-grid-tbody');
        if (!tbody) {
            console.error('[AG-GRID] tbody element not found!');
            return;
        }
        
        // Check if this is a nested table (expanded relation table)
        const isNestedTable = containerEl.classList.contains('nested-table-container');
        console.log('[AG-GRID] Is nested table:', isNestedTable);
        
        // PRESERVE EXPANDED ROWS: Detach expanded row elements before clearing (don't use innerHTML to preserve them)
        // Skip for nested tables as they shouldn't have expanded rows
        const expandedRowElements = isNestedTable ? [] : Array.from(tbody.querySelectorAll('.expanded-row-content'));
        const savedExpandedRows = expandedRowElements.map(el => {
            // Detach from DOM but keep the element
            const parent = el.parentNode;
            if (parent) {
                parent.removeChild(el);
            }
            return {
                element: el, // Keep the actual DOM element
                sourceRowIndex: parseInt(el.dataset.sourceRowIndex || '0'),
                expansionId: el.dataset.expansionId,
                expandKey: el.dataset.expandKey
            };
        });
        console.log('[AG-GRID] Preserving', savedExpandedRows.length, 'expanded rows before clearing');
        
        // Clear existing rows
        tbody.innerHTML = '';
        
        // Calculate visible range
        const endRow = Math.min(startRow + chunkSize, data.length);
        const totalHeight = data.length * rowHeight;
        const offsetY = startRow * rowHeight;
        
        // For nested tables, don't use virtual scrolling height (render all rows naturally)
        // For main tables, set tbody height to accommodate all rows (for scrolling)
        if (!isNestedTable) {
            tbody.style.height = totalHeight + 'px';
        }
        
        console.log('[AG-GRID] Rendering rows', startRow, 'to', endRow, '- offset:', offsetY, 'total height:', totalHeight);

        // Only render visible rows
        for (let i = startRow; i < endRow; i++) {
            const row = data[i];
            const rowIndex = i;
            
            const tr = document.createElement('tr');
            tr.dataset.rowIndex = rowIndex;
            
            // For nested tables, use relative positioning within the nested container
            // For main tables, use absolute positioning based on actual row index
            const rowPosition = isNestedTable ? (i - startRow) * rowHeight : i * rowHeight;
            
            // Position rows absolutely with calculated offset
            tr.style.cssText = `
                position: absolute;
                top: ${rowPosition}px;
                left: 0;
                right: 0;
                height: ${rowHeight}px;
                border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
                display: table;
                width: 100%;
                table-layout: fixed;
            `;
            // Mouse hover handling
            tr.addEventListener('mouseenter', function() {
                if (!this.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                }
            });
            tr.addEventListener('mouseleave', function() {
                if (!this.classList.contains('selected')) {
                    this.style.backgroundColor = '';
                }
            });

            // Add row number cell
            const rowNumTd = document.createElement('td');
            rowNumTd.className = 'ag-grid-row-number-cell';
            rowNumTd.textContent = rowIndex + 1;
            
            // Set styles individually to avoid cssText overriding class styles
            rowNumTd.style.width = '50px';
            rowNumTd.style.minWidth = '50px';
            rowNumTd.style.maxWidth = '50px';
            rowNumTd.style.cursor = 'pointer';
            rowNumTd.style.padding = '0 8px';
            rowNumTd.style.whiteSpace = 'nowrap';
            rowNumTd.style.overflow = 'hidden';
            rowNumTd.style.textOverflow = 'ellipsis';
            rowNumTd.style.height = rowHeight + 'px';
            rowNumTd.style.lineHeight = rowHeight + 'px';
            rowNumTd.style.display = 'table-cell';
            rowNumTd.style.verticalAlign = 'middle';
            
            rowNumTd.addEventListener('mouseenter', function() {
                if (!tr.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-list-hoverBackground, #2a2d2e)';
                }
            });
            rowNumTd.addEventListener('mouseleave', function() {
                if (!tr.classList.contains('selected')) {
                    this.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
                }
            });
            rowNumTd.addEventListener('click', function(event) {
                const ctrlPressed = event.ctrlKey || event.metaKey;
                const shiftPressed = event.shiftKey;
                
                // Check if same table
                const sameTable = globalSelection.tableContainer === containerEl;
                const sameType = globalSelection.type === 'row';
                
                if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
                    // Shift: select range from last clicked to current
                    const start = Math.min(globalSelection.lastClickedIndex, rowIndex);
                    const end = Math.max(globalSelection.lastClickedIndex, rowIndex);
                    
                    clearAllSelections();
                    globalSelection.selections = [];
                    
                    for (let i = start; i <= end; i++) {
                        globalSelection.selections.push({ rowIndex: i });
                        applyRowHighlightGlobal(containerEl, i);
                    }
                    
                    globalSelection.type = 'row';
                    globalSelection.tableContainer = containerEl;
                    globalSelection.data = data;
                    globalSelection.columnDefs = colDefs;
                } else if (ctrlPressed && sameTable && sameType) {
                    // Ctrl: toggle individual selection
                    const existingIndex = globalSelection.selections.findIndex(s => s.rowIndex === rowIndex);
                    
                    if (existingIndex >= 0) {
                        // Remove from selection
                        globalSelection.selections.splice(existingIndex, 1);
                        
                        if (globalSelection.selections.length === 0) {
                            // No more selections
                            clearAllSelections();
                            globalSelection = {
                                type: null,
                                tableContainer: null,
                                selections: [],
                                columnDef: null,
                                data: null,
                                columnDefs: null,
                                lastClickedIndex: null
                            };
                        } else {
                            // Reapply all selections
                            clearAllSelections();
                            globalSelection.selections.forEach(s => {
                                applyRowHighlightGlobal(containerEl, s.rowIndex);
                            });
                        }
                    } else {
                        // Add to selection
                        globalSelection.selections.push({ rowIndex: rowIndex });
                        applyRowHighlightGlobal(containerEl, rowIndex);
                    }
                    
                    globalSelection.lastClickedIndex = rowIndex;
                } else {
                    // Normal click: single selection
                    const isAlreadySelected = sameTable && sameType && 
                        globalSelection.selections.length === 1 && 
                        globalSelection.selections[0].rowIndex === rowIndex;
                    
                    if (isAlreadySelected) {
                        // Unselect - clear all selections
                        clearAllSelections();
                        globalSelection = {
                            type: null,
                            tableContainer: null,
                            selections: [],
                            columnDef: null,
                            data: null,
                            columnDefs: null,
                            lastClickedIndex: null
                        };
                    } else {
                        // Clear all selections across all tables
                        clearAllSelections();
                        
                        // Collect all cell values from the row
                        const rowSelections = colDefs.map((col, colIndex) => ({
                            rowIndex: rowIndex,
                            columnIndex: colIndex,
                            cellValue: row[col.field]
                        }));
                        
                        // Set global selection state
                        globalSelection = {
                            type: 'row',
                            tableContainer: containerEl,
                            selections: rowSelections,
                            data: data,
                            columnDefs: colDefs,
                            lastClickedIndex: rowIndex
                        };
                        
                        // Apply highlighting
                        applyRowHighlightGlobal(containerEl, rowIndex);
                    }
                }
                
                // Update aggregation stats
                updateAggregationStats();
            });
            
            // Add context menu for row number cell
            rowNumTd.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showRowContextMenu(e, {
                    table: containerEl.querySelector('.ag-grid-table'),
                    rowIndex: rowIndex,
                    columnDefs: colDefs,
                    data: data,
                    metadata: metadata,
                    resultSetIndex: resultSetIndex
                });
            });
            tr.appendChild(rowNumTd);

            colDefs.forEach((col, colIndex) => {
                const td = document.createElement('td');
                
                // Base styles
                td.style.width = col.width + 'px';
                td.style.minWidth = col.width + 'px';
                td.style.maxWidth = col.width + 'px';
                td.style.borderRight = '1px solid var(--vscode-panel-border, #3c3c3c)';
                td.style.padding = '0 8px';
                td.style.whiteSpace = 'nowrap';
                td.style.overflow = 'hidden';
                td.style.textOverflow = 'ellipsis';
                td.style.height = rowHeight + 'px';
                td.style.lineHeight = rowHeight + 'px';
                td.style.display = 'table-cell';
                td.style.verticalAlign = 'middle';
                
                if (col.pinned) {
                    const leftOffset = calculatePinnedOffset(colDefs, colIndex);
                    td.style.left = leftOffset + 'px';
                    td.classList.add('ag-grid-pinned-cell');
                }
                
                const value = row[col.field];
                
                if (value === null || value === undefined) {
                    td.textContent = 'NULL';
                    td.style.color = 'var(--vscode-descriptionForeground)';
                    td.style.fontStyle = 'italic';
                } else if (col.type === 'boolean') {
                    td.textContent = value ? '✓' : '✗';
                } else if (col.type === 'number') {
                    td.textContent = typeof value === 'number' ? value.toLocaleString() : value;
                    td.style.textAlign = 'right';
                } else {
                    const strValue = String(value);
                    td.textContent = strValue;
                    
                    // Check if content is valid JSON or XML
                    const isJSON = isValidJSON(strValue);
                    const isXML = !isJSON && isValidXML(strValue);
                    
                    if (isJSON || isXML) {
                        // Make it clickable
                        td.classList.add('clickable-cell');
                        td.style.cursor = 'pointer';
                        td.style.color = 'var(--vscode-textLink-foreground, #3794ff)';
                        
                        // Add hover effect
                        td.addEventListener('mouseenter', function() {
                            this.style.textDecoration = 'underline';
                        });
                        td.addEventListener('mouseleave', function() {
                            this.style.textDecoration = 'none';
                        });
                        
                        // Add click handler to open in new editor
                        const contentType = isJSON ? 'json' : 'xml';
                        td.addEventListener('click', function(e) {
                            // Prevent context menu or selection behavior
                            e.stopPropagation();
                            
                            const formatted = isJSON ? formatJSON(strValue) : formatXML(strValue);
                            openInNewEditor(formatted, contentType);
                        });
                        
                        // Update title to indicate it's clickable
                        td.title = `Click to open ${contentType.toUpperCase()} in new editor\n\n${strValue.substring(0, 200)}${strValue.length > 200 ? '...' : ''}`;
                    }
                }
                
                // Add FK/PK expansion icon for columns with foreign key references
                if (metadata && metadata.columns && (col.isPrimaryKey || col.isForeignKey)) {
                    const colMetadata = metadata.columns.find(c => c.name === col.field);
                    if (colMetadata && colMetadata.foreignKeyReferences && colMetadata.foreignKeyReferences.length > 0 && value !== null && value !== undefined) {
                        const originalContent = td.textContent;
                        td.textContent = '';
                        td.style.position = 'relative';
                        td.dataset.column = col.field;
                        
                        const wrapper = document.createElement('span');
                        wrapper.style.cssText = `
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            width: 100%;
                        `;
                        
                        const valueSpan = document.createElement('span');
                        valueSpan.textContent = originalContent;
                        valueSpan.style.cssText = `
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                            flex: 1;
                        `;
                        wrapper.appendChild(valueSpan);
                        
                        const chevron = document.createElement('span');
                        chevron.className = 'chevron-icon';
                        chevron.dataset.column = col.field;
                        chevron.style.cssText = `
                            display: none;
                            opacity: 0;
                            transition: all 0.2s;
                            cursor: pointer;
                            color: var(--vscode-button-background);
                            flex-shrink: 0;
                        `;
                        chevron.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        `;
                        
                        chevron.addEventListener('click', (e) => {
                            handleChevronClick(e, col, value, tr, rowIndex, tableId, containerEl, metadata);
                        });
                        
                        wrapper.appendChild(chevron);
                        td.appendChild(wrapper);
                        
                        // Show/hide chevron on hover
                        td.addEventListener('mouseenter', () => {
                            chevron.style.display = 'inline-flex';
                            chevron.style.opacity = '1';
                        });
                        td.addEventListener('mouseleave', () => {
                            if (!chevron.classList.contains('expanded')) {
                                chevron.style.display = 'none';
                                chevron.style.opacity = '0';
                            }
                        });
                    }
                }
                
                // Add context menu handler
                td.addEventListener('contextmenu', (e) => {
                    showContextMenu(e, {
                        table: containerEl.querySelector('.ag-grid-table'),
                        rowIndex: rowIndex,
                        columnIndex: colIndex,
                        columnDefs: colDefs,
                        data: data
                    });
                });
                
                // Add click handler for cell selection
                td.addEventListener('click', (e) => {
                    const ctrlPressed = e.ctrlKey || e.metaKey;
                    const shiftPressed = e.shiftKey;
                    
                    // Check if same table
                    const sameTable = globalSelection.tableContainer === containerEl;
                    const sameType = globalSelection.type === 'cell';
                    
                    if (shiftPressed && sameTable && sameType && globalSelection.lastClickedIndex !== null) {
                        // Shift: select rectangular range from last clicked to current
                        const lastSel = globalSelection.lastClickedIndex;
                        const startRow = Math.min(lastSel.rowIndex, rowIndex);
                        const endRow = Math.max(lastSel.rowIndex, rowIndex);
                        const startCol = Math.min(lastSel.columnIndex, colIndex);
                        const endCol = Math.max(lastSel.columnIndex, colIndex);
                        
                        clearAllSelections();
                        globalSelection.selections = [];
                        
                        for (let r = startRow; r <= endRow; r++) {
                            for (let c = startCol; c <= endCol; c++) {
                                globalSelection.selections.push({ 
                                    rowIndex: r, 
                                    columnIndex: c,
                                    cellValue: data[r][colDefs[c].field]
                                });
                                applyCellHighlightGlobal(containerEl, r, c);
                            }
                        }
                        
                        globalSelection.type = 'cell';
                        globalSelection.tableContainer = containerEl;
                        globalSelection.data = data;
                        globalSelection.columnDefs = colDefs;
                    } else if (ctrlPressed && sameTable && sameType) {
                        // Ctrl: toggle individual cell
                        const existingIndex = globalSelection.selections.findIndex(
                            s => s.rowIndex === rowIndex && s.columnIndex === colIndex
                        );
                        
                        if (existingIndex >= 0) {
                            // Remove from selection
                            globalSelection.selections.splice(existingIndex, 1);
                            
                            if (globalSelection.selections.length === 0) {
                                // No more selections
                                clearAllSelections();
                                globalSelection = {
                                    type: null,
                                    tableContainer: null,
                                    selections: [],
                                    columnDef: null,
                                    data: null,
                                    columnDefs: null,
                                    lastClickedIndex: null
                                };
                            } else {
                                // Reapply all selections
                                clearAllSelections();
                                globalSelection.selections.forEach(s => {
                                    applyCellHighlightGlobal(containerEl, s.rowIndex, s.columnIndex);
                                });
                            }
                        } else {
                            // Add to selection
                            globalSelection.selections.push({ 
                                rowIndex: rowIndex, 
                                columnIndex: colIndex,
                                cellValue: row[col.field]
                            });
                            applyCellHighlightGlobal(containerEl, rowIndex, colIndex);
                        }
                        
                        globalSelection.lastClickedIndex = { rowIndex, columnIndex };
                    } else {
                        // Normal click: single selection
                        const isAlreadySelected = sameTable && sameType && 
                            globalSelection.selections.length === 1 && 
                            globalSelection.selections[0].rowIndex === rowIndex &&
                            globalSelection.selections[0].columnIndex === colIndex;
                        
                        if (isAlreadySelected) {
                            // Unselect - clear all selections
                            clearAllSelections();
                            globalSelection = {
                                type: null,
                                tableContainer: null,
                                selections: [],
                                columnDef: null,
                                data: null,
                                columnDefs: null,
                                lastClickedIndex: null
                            };
                        } else {
                            // Clear all selections across all tables
                            clearAllSelections();
                            
                            // Set global selection state
                            globalSelection = {
                                type: 'cell',
                                tableContainer: containerEl,
                                selections: [{ 
                                    rowIndex: rowIndex, 
                                    columnIndex: colIndex,
                                    cellValue: row[col.field]
                                }],
                                columnDef: colDefs[colIndex],
                                data: data,
                                columnDefs: colDefs,
                                lastClickedIndex: { rowIndex, colIndex }
                            };
                            
                            // Apply highlighting
                            applyCellHighlightGlobal(containerEl, rowIndex, colIndex);
                        }
                    }
                    
                    // Update aggregation stats
                    updateAggregationStats();
                });

                // Apply PK/FK column styling (PK takes priority) if enabled in configuration
                if (colorPrimaryForeignKeys) {
                    if (col.isPrimaryKey) {
                        td.classList.add('pk-column');
                    } else if (col.isForeignKey) {
                        td.classList.add('fk-column');
                    }
                }

                // Add double-click handler for editing (if editable)
                if (metadata && metadata.isEditable) {
                    td.addEventListener('dblclick', (e) => {
                        e.stopPropagation();
                        enterEditMode(td, row, col, rowIndex, colIndex, data, colDefs, containerEl, resultSetIndex, metadata);
                    });
                    // Visual indicator that cell is editable
                    td.classList.add('editable-cell');
                    td.style.cursor = 'cell';
                }

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        }
        
        console.log('[AG-GRID] Rendered', endRow - startRow, 'rows successfully (from', startRow, 'to', endRow, ')');
        
        // RESTORE EXPANDED ROWS: Re-attach saved expanded row DOM elements back into tbody
        // Skip for nested tables as they shouldn't have expanded rows
        if (!isNestedTable && savedExpandedRows.length > 0) {
            console.log('[AG-GRID] Restoring', savedExpandedRows.length, 'expanded rows');
            savedExpandedRows.forEach(saved => {
                // Re-attach the actual DOM element (not a copy)
                tbody.appendChild(saved.element);
                
                // Update the reference in expandedRows map using expandKey
                if (saved.expandKey && typeof expandedRows !== 'undefined') {
                    const existingEntry = expandedRows.get(saved.expandKey);
                    if (existingEntry) {
                        existingEntry.element = saved.element;
                        console.log('[AG-GRID] Updated expandedRows map reference for key:', saved.expandKey);
                    } else {
                        console.warn('[AG-GRID] No existing entry in expandedRows map for key:', saved.expandKey);
                    }
                }
                
                console.log('[AG-GRID] Restored expanded row for source index:', saved.sourceRowIndex, 'expandKey:', saved.expandKey);
                
                // IMPORTANT: Re-apply row shifting to push rows below down by the expanded row's height
                if (typeof shiftRowsBelow !== 'undefined') {
                    const expandedHeight = parseInt(saved.element.style.height || '60');
                    shiftRowsBelow(tbody, saved.sourceRowIndex, expandedHeight);
                    console.log('[AG-GRID] Re-applied row shifting for expanded row at index:', saved.sourceRowIndex, 'height:', expandedHeight);
                }
            });
        }
        
        // Reapply selection if this is the selected table
        if (globalSelection.tableContainer === containerEl) {
            reapplySelection();
        }
    }

    function calculatePinnedOffset(colDefs, colIndex) {
        let offset = 50; // Start after row number column
        for (let i = 0; i < colIndex; i++) {
            if (colDefs[i].pinned) {
                offset += colDefs[i].width;
            }
        }
        return offset;
    }

    function handleSort(col, colDefs, sortCfg, filters, containerEl) {
        if (sortCfg.field === col.field) {
            if (sortCfg.direction === 'asc') {
                sortCfg.direction = 'desc';
            } else if (sortCfg.direction === 'desc') {
                sortCfg.field = null;
                sortCfg.direction = null;
            }
        } else {
            sortCfg.field = col.field;
            sortCfg.direction = 'asc';
        }
        
        currentStartRow = 0; // Reset to top after sort
        const viewport = containerEl.querySelector('.ag-grid-viewport');
        if (viewport) viewport.scrollTop = 0;
        
        updateFilteredData(colDefs, sortCfg, filters, containerEl);
        renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
    }

    function showAgGridFilter(e, col, th, colDefs, sortCfg, filters, containerEl) {
        e.stopPropagation();

        if (currentFilterPopup) {
            currentFilterPopup.remove();
            currentFilterPopup = null;
        }

        const popup = document.createElement('div');
        popup.style.cssText = `
            position: absolute;
            background-color: var(--vscode-dropdown-background, #3c3c3c);
            border: 1px solid var(--vscode-dropdown-border, #454545);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.4);
            padding: 12px;
            z-index: 1000;
            min-width: 200px;
            max-width: 300px;
            border-radius: 3px;
        `;

        const rect = th.getBoundingClientRect();
        popup.style.left = rect.left + 'px';
        popup.style.top = (rect.bottom + 5) + 'px';

        let html = `<h4 style="margin-bottom: 8px; font-size: 12px;">Filter: ${col.headerName}</h4>`;

        // Simple value selection for now
        const uniqueValues = [...new Set(rowData.map(row => row[col.field]))].sort();
        const currentFilter = filters[col.field];
        const selectedValues = currentFilter?.values || uniqueValues;

        html += '<input type="text" id="agFilterSearch" placeholder="Search..." style="width: 100%; padding: 4px 6px; margin-bottom: 8px; background-color: var(--vscode-input-background, #3c3c3c); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 2px; font-size: 12px;">';
        html += '<div style="font-size: 11px; color: var(--vscode-descriptionForeground, #999999); margin-bottom: 4px;">' + selectedValues.length + ' Selected</div>';
        html += '<div style="margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);">';
        html += '<label style="display: flex; align-items: center; gap: 6px; cursor: pointer;"><input type="checkbox" id="agSelectAll" ' + (selectedValues.length === uniqueValues.length ? 'checked' : '') + ' style="cursor: pointer; accent-color: var(--vscode-button-background, #0e639c);"><span style="font-size: 12px;">(Select All)</span></label>';
        html += '</div>';
        html += '<div id="agFilterValuesList" style="max-height: 200px; overflow-y: auto; margin-bottom: 8px;">';

        uniqueValues.forEach((value, idx) => {
            const displayValue = col.type === 'boolean' ? (value ? 'True' : 'False') : 
                               value === null || value === undefined ? 'NULL' : String(value);
            const checked = selectedValues.includes(value) ? 'checked' : '';
            html += `
                <label style="display: flex; align-items: center; gap: 6px; padding: 4px 0; cursor: pointer;" data-value="${displayValue.toString().toLowerCase()}">
                    <input type="checkbox" value="${value}" ${checked} class="ag-value-checkbox" style="cursor: pointer; accent-color: var(--vscode-button-background, #0e639c);">
                    <span style="flex: 1; font-size: 12px;">${displayValue}</span>
                </label>
            `;
        });

        html += '</div>';
        html += `
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="agFilterClear" style="padding: 4px 12px; background-color: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #cccccc); border: none; border-radius: 2px; cursor: pointer; font-size: 11px;">Clear</button>
                <button id="agFilterApply" style="padding: 4px 12px; background-color: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #ffffff); border: none; border-radius: 2px; cursor: pointer; font-size: 11px;">Apply</button>
            </div>
        `;

        popup.innerHTML = html;
        document.body.appendChild(popup);
        currentFilterPopup = popup;

        // Setup event listeners
        const searchInput = popup.querySelector('#agFilterSearch');
        searchInput.oninput = () => {
            const searchTerm = searchInput.value.toLowerCase();
            const items = popup.querySelectorAll('#agFilterValuesList label');
            items.forEach(item => {
                const value = item.dataset.value;
                item.style.display = value.includes(searchTerm) ? 'flex' : 'none';
            });
        };

        const selectAllCheckbox = popup.querySelector('#agSelectAll');
        const valueCheckboxes = popup.querySelectorAll('.ag-value-checkbox');
        
        selectAllCheckbox.onchange = () => {
            valueCheckboxes.forEach(cb => cb.checked = selectAllCheckbox.checked);
        };

        popup.querySelector('#agFilterClear').onclick = () => {
            delete filters[col.field];
            
            currentStartRow = 0; // Reset to top after clearing filter
            const viewport = containerEl.querySelector('.ag-grid-viewport');
            if (viewport) viewport.scrollTop = 0;
            
            updateFilteredData(colDefs, sortCfg, filters, containerEl);
            renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
            popup.remove();
            currentFilterPopup = null;
        };

        popup.querySelector('#agFilterApply').onclick = () => {
            const checkboxes = popup.querySelectorAll('.ag-value-checkbox:checked');
            const values = [...checkboxes].map(cb => {
                const val = cb.value;
                if (col.type === 'number') return parseFloat(val);
                if (col.type === 'boolean') return val === 'true';
                return val;
            });
            filters[col.field] = { values };
            
            currentStartRow = 0; // Reset to top after filter
            const viewport = containerEl.querySelector('.ag-grid-viewport');
            if (viewport) viewport.scrollTop = 0;
            
            updateFilteredData(colDefs, sortCfg, filters, containerEl);
            renderAgGridHeaders(colDefs, sortCfg, filters, containerEl, filteredData);
            popup.remove();
            currentFilterPopup = null;
        };

        setTimeout(() => {
            document.addEventListener('click', closeFilterPopup);
        }, 0);

        function closeFilterPopup(e) {
            if (currentFilterPopup && !currentFilterPopup.contains(e.target)) {
                currentFilterPopup.remove();
                currentFilterPopup = null;
                document.removeEventListener('click', closeFilterPopup);
            }
        }
    }

    function updateFilteredData(colDefs, sortCfg, filters, containerEl) {
        filteredData = rowData.filter(row => {
            return Object.entries(filters).every(([field, filter]) => {
                const value = row[field];
                return filter.values && filter.values.includes(value);
            });
        });

        if (sortCfg.field) {
            filteredData.sort((a, b) => {
                const aVal = a[sortCfg.field];
                const bVal = b[sortCfg.field];
                
                let comparison = 0;
                if (aVal < bVal) comparison = -1;
                if (aVal > bVal) comparison = 1;
                
                return sortCfg.direction === 'asc' ? comparison : -comparison;
            });
        }

        renderAgGridRows(colDefs, filteredData, containerEl, currentStartRow, ROW_HEIGHT, RENDER_CHUNK_SIZE);
    }
}

function displayMessages(messages) {
    const messagesContent = document.getElementById('messagesContent');
    
    if (!messages || messages.length === 0) {
        messagesContent.innerHTML = '<div class="message info">No messages</div>';
        return;
    }

    let messagesHtml = '';
    messages.forEach(msg => {
        const msgClass = msg.type || 'info';
        messagesHtml += `<div class="message ${msgClass}">${escapeHtml(msg.text)}</div>`;
    });
    
    messagesContent.innerHTML = messagesHtml;
}

function showError(error, messages) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    const resizer = document.getElementById('resizer');
    
    // Stop the loading timer
    stopLoadingTimer();
    
    lastResults = [];
    lastMessages = messages || [{ type: 'error', text: error }];
    
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    const isCancelled = error.includes('cancel');
    statusLabel.textContent = isCancelled ? 'Query cancelled' : 'Query failed';

    resultsContainer.classList.add('visible');
    resizer.classList.add('visible');

    // Show results panel with initial height if not already set
    if (!resultsContainer.style.flex) {
        resultsContainer.style.flex = '0 0 300px';
    }

    // Switch to messages tab to show error
    document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.results-tab[data-tab="messages"]').classList.add('active');
    currentTab = 'messages';
    
    // Show messages container, hide results
    document.getElementById('resultsContent').style.display = 'none';
    document.getElementById('messagesContent').style.display = 'block';

    displayMessages(lastMessages);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// SQL Validation
function validateSql() {
    if (!editor || !dbSchema || dbSchema.tables.length === 0) {
        return;
    }
    
    const model = editor.getModel();
    if (!model) return;
    
    const content = model.getValue();
    const markers = [];
    
    console.log('[SQL-VALIDATION] Starting validation...');
    
    // Parse SQL to find table and column references
    const lines = content.split('\n');
    
    lines.forEach((line, lineIndex) => {
        const lowerLine = line.toLowerCase();
        
        // Find FROM and JOIN clauses - supports both unquoted and bracket-quoted identifiers
        // Matches: FROM table, FROM [table], FROM schema.table, FROM [schema].[table]
        const fromMatch = /\bfrom\s+(?:\[?(\w+)\]?\.)?(\[?[\w]+\]?)/gi;
        const joinMatch = /\bjoin\s+(?:\[?(\w+)\]?\.)?(\[?[\w]+\]?)/gi;
        
        let match;
        
        // Check table names in FROM
        while ((match = fromMatch.exec(line)) !== null) {
            const schema = match[1] || 'dbo';
            let tableName = match[2];
            
            // Remove brackets if present
            const cleanSchema = schema.replace(/[\[\]]/g, '');
            const cleanTableName = tableName.replace(/[\[\]]/g, '');
            
            const tableInfo = findTableByName(`${cleanSchema}.${cleanTableName}`);
            
            if (!tableInfo) {
                // Calculate position of the table name (not schema)
                const tableNameIndex = match.index + match[0].lastIndexOf(match[2]);
                const startColumn = tableNameIndex + 1;
                markers.push({
                    severity: monaco.MarkerSeverity.Error,
                    message: `Table '${cleanSchema}.${cleanTableName}' does not exist in the database`,
                    startLineNumber: lineIndex + 1,
                    startColumn: startColumn,
                    endLineNumber: lineIndex + 1,
                    endColumn: startColumn + match[2].length
                });
                console.log('[SQL-VALIDATION] Invalid table in FROM:', `${cleanSchema}.${cleanTableName}`);
            }
        }
        
        // Check table names in JOIN
        while ((match = joinMatch.exec(line)) !== null) {
            const schema = match[1] || 'dbo';
            let tableName = match[2];
            
            // Remove brackets if present
            const cleanSchema = schema.replace(/[\[\]]/g, '');
            const cleanTableName = tableName.replace(/[\[\]]/g, '');
            
            const tableInfo = findTableByName(`${cleanSchema}.${cleanTableName}`);
            
            if (!tableInfo) {
                // Calculate position of the table name (not schema)
                const tableNameIndex = match.index + match[0].lastIndexOf(match[2]);
                const startColumn = tableNameIndex + 1;
                markers.push({
                    severity: monaco.MarkerSeverity.Error,
                    message: `Table '${cleanSchema}.${cleanTableName}' does not exist in the database`,
                    startLineNumber: lineIndex + 1,
                    startColumn: startColumn,
                    endLineNumber: lineIndex + 1,
                    endColumn: startColumn + match[2].length
                });
                console.log('[SQL-VALIDATION] Invalid table in JOIN:', `${cleanSchema}.${cleanTableName}`);
            }
        }
        
        // Check column references (table.column pattern)
        const columnMatch = /\b([\w]+)\.([\w]+)\b/g;
        while ((match = columnMatch.exec(line)) !== null) {
            const tableOrAlias = match[1];
            const columnName = match[2];
            
            // Skip if it's a schema.table reference
            if (lowerLine.includes(`from ${match[0].toLowerCase()}`) || 
                lowerLine.includes(`join ${match[0].toLowerCase()}`)) {
                continue;
            }
            
            // Find the table in the query context
            const fullQuery = content.toLowerCase();
            const tableInfo = findTableForColumnCheck(fullQuery, tableOrAlias);
            
            if (tableInfo) {
                const column = tableInfo.columns.find(col => 
                    col.name.toLowerCase() === columnName.toLowerCase()
                );
                
                if (!column) {
                    const startColumn = match.index + match[1].length + 2; // +2 for the dot
                    markers.push({
                        severity: monaco.MarkerSeverity.Error,
                        message: `Column '${columnName}' does not exist in table '${tableInfo.name}'`,
                        startLineNumber: lineIndex + 1,
                        startColumn: startColumn,
                        endLineNumber: lineIndex + 1,
                        endColumn: startColumn + columnName.length
                    });
                    console.log('[SQL-VALIDATION] Invalid column:', columnName, 'in table:', tableInfo.name);
                }
            }
        }
    });
    
    console.log('[SQL-VALIDATION] Found', markers.length, 'validation errors');
    monaco.editor.setModelMarkers(model, 'sql-validation', markers);
}

function findTableByName(tableName) {
    const parts = tableName.split('.');
    const name = parts.length > 1 ? parts[1] : parts[0];
    const schema = parts.length > 1 ? parts[0] : 'dbo';
    
    return dbSchema.tables.find(t => 
        t.name.toLowerCase() === name.toLowerCase() && 
        t.schema.toLowerCase() === schema.toLowerCase()
    );
}

function findTableForColumnCheck(query, tableOrAlias) {
    // Try to find table by alias or name in the query
    const aliasPattern = new RegExp(`from\\s+(?:(\\w+)\\.)?(\\w+)\\s+(?:as\\s+)?${tableOrAlias}\\b`, 'i');
    const directPattern = new RegExp(`from\\s+(?:(\\w+)\\.)?(${tableOrAlias})\\b`, 'i');
    
    let match = aliasPattern.exec(query) || directPattern.exec(query);
    
    if (match) {
        const schema = match[1] || 'dbo';
        const tableName = match[2];
        return findTableByName(`${schema}.${tableName}`);
    }
    
    // Try JOIN clauses
    const joinPattern = new RegExp(`join\\s+(?:(\\w+)\\.)?(\\w+)\\s+(?:as\\s+)?${tableOrAlias}\\b`, 'i');
    match = joinPattern.exec(query);
    
    if (match) {
        const schema = match[1] || 'dbo';
        const tableName = match[2];
        return findTableByName(`${schema}.${tableName}`);
    }
    
    // Try direct table name
    return findTableByName(tableOrAlias);
}

// Update editor layout when window resizes
window.addEventListener('resize', () => {
    if (editor) {
        editor.layout();
    }
});

// Context menu functionality
let contextMenu = null;
let contextMenuData = null;
let rowContextMenu = null;
let columnHeaderContextMenu = null;

// Create context menu HTML for table cells
function createContextMenu(cellData) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    const hasMultipleSelections = globalSelection.selections && globalSelection.selections.length > 1;
    
    let cellLabel = 'Copy Cell';
    let rowLabel = 'Copy Row';
    let rowHeaderLabel = 'Copy Row with Headers';
    let columnLabel = 'Copy Column';
    
    if (hasMultipleSelections) {
        if (globalSelection.type === 'cell') {
            const selectionCount = globalSelection.selections.length;
            cellLabel = `Copy ${selectionCount} Cells`;
        } else if (globalSelection.type === 'row') {
            // Count unique row indices for proper row count
            const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
            const rowCount = uniqueRowIndices.length;
            rowLabel = `Copy ${rowCount} Rows`;
            rowHeaderLabel = `Copy ${rowCount} Rows with Headers`;
        } else if (globalSelection.type === 'column') {
            // Count unique column indices for proper column count
            const uniqueColumnIndices = [...new Set(globalSelection.selections.map(sel => sel.columnIndex))];
            const columnCount = uniqueColumnIndices.length;
            columnLabel = `Copy ${columnCount} Columns`;
        }
    }
    
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-cell">${cellLabel}</div>
        <div class="context-menu-item" data-action="copy-row">${rowLabel}</div>
        <div class="context-menu-item" data-action="copy-row-header">${rowHeaderLabel}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="copy-column">${columnLabel}</div>
        <div class="context-menu-item" data-action="copy-table">Copy Table</div>
    `;
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideContextMenu();
        });
    });
    
    return menu;
}

// Create context menu HTML for row number cells
function createRowContextMenu(metadata, resultSetIndex, rowIndex, tableId) {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    let rowLabel = 'Copy Row';
    let rowHeaderLabel = 'Copy Row with Headers';
    let deleteLabel = 'Delete Row';
    
    if (globalSelection && globalSelection.selections && globalSelection.type === 'row') {
        // Count unique row indices for proper row count
        const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
        const rowCount = uniqueRowIndices.length;
        
        if (rowCount > 1) {
            rowLabel = `Copy ${rowCount} Rows`;
            rowHeaderLabel = `Copy ${rowCount} Rows with Headers`;
            deleteLabel = `Delete ${rowCount} Rows`;
        }
    }
    
    // Check if delete should be available (single table only)
    const isSingleTable = metadata && !metadata.hasMultipleTables && metadata.isEditable;
    
    let menuHtml = `
        <div class="context-menu-item" data-action="copy-row">${rowLabel}</div>
        <div class="context-menu-item" data-action="copy-row-header">${rowHeaderLabel}</div>
    `;
    
    if (isSingleTable) {
        menuHtml += `
            <div class="context-menu-separator"></div>
            <div class="context-menu-item context-menu-item-delete" data-action="delete-row">${deleteLabel}</div>
        `;
    }

    // Check expansion state
    if (typeof getRowExpansionState === 'function' && rowIndex !== undefined && tableId) {
        const state = getRowExpansionState(tableId, rowIndex);
        
        if (state.hasExpanded) {
            menuHtml += `
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="collapse-row">Collapse Row</div>
            `;
        } else if (state.hasCollapsed) {
            menuHtml += `
                <div class="context-menu-separator"></div>
                <div class="context-menu-item" data-action="expand-row">Expand Row</div>
            `;
        }
    }
    
    menu.innerHTML = menuHtml;
    menu.dataset.resultSetIndex = resultSetIndex;
    menu.dataset.metadata = JSON.stringify(metadata);
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideRowContextMenu();
        });
    });
    
    return menu;
}

// Create context menu HTML for column headers
function createColumnHeaderContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.display = 'none';
    
    // Determine labels based on selection
    let columnLabel = 'Copy Column';
    let columnHeaderLabel = 'Copy Column with Header';
    let distinctLabel = 'Copy Distinct Values';
    
    if (globalSelection && globalSelection.selections && globalSelection.type === 'column') {
        // Count unique column indices for proper column count
        const uniqueColumnIndices = [...new Set(globalSelection.selections.map(sel => sel.columnIndex))];
        const columnCount = uniqueColumnIndices.length;
        
        if (columnCount > 1) {
            columnLabel = `Copy ${columnCount} Columns`;
            columnHeaderLabel = `Copy ${columnCount} Columns with Headers`;
        }
    }
    
    menu.innerHTML = `
        <div class="context-menu-item" data-action="copy-column">${columnLabel}</div>
        <div class="context-menu-item" data-action="copy-column-header">${columnHeaderLabel}</div>
        <div class="context-menu-separator"></div>
        <div class="context-menu-item" data-action="copy-column-distinct">${distinctLabel}</div>
    `;
    document.body.appendChild(menu);
    
    // Prevent default context menu on the custom menu itself
    menu.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Add click handlers
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = item.dataset.action;
            handleContextMenuAction(action);
            hideColumnHeaderContextMenu();
        });
    });
    
    return menu;
}

function showContextMenu(e, cellData) {
    e.preventDefault();
    
    // Remove existing menu to recreate with updated labels
    if (contextMenu) {
        contextMenu.remove();
    }
    
    contextMenu = createContextMenu(cellData);
    contextMenuData = cellData;
    
    // Position menu at cursor
    contextMenu.style.display = 'block';
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = contextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        contextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        contextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideContextMenu() {
    if (contextMenu) {
        contextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function showRowContextMenu(e, cellData) {
    e.preventDefault();
    
    const { table, rowIndex, data, columnDefs } = cellData;
    
    // Check if right-clicked row is part of current selection
    const isRowSelected = globalSelection.type === 'row' && 
                         globalSelection.selections && 
                         globalSelection.selections.some(sel => sel.rowIndex === rowIndex);
    
    // If right-clicked on unselected row, clear selection and select only this row
    if (!isRowSelected) {
        clearAllSelections();
        
        // Select the right-clicked row
        globalSelection = {
            type: 'row',
            tableContainer: table.closest('.ag-grid-viewport').parentElement,
            selections: [{ rowIndex }],
            data: data,
            columnDefs: columnDefs,
            lastClickedIndex: rowIndex
        };
        
        // Apply highlighting
        const tbody = table.querySelector('.ag-grid-tbody');
        if (tbody) {
            const rows = tbody.querySelectorAll('tr');
            if (rowIndex < rows.length) {
                rows[rowIndex].classList.add('selected');
                rows[rowIndex].style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #04395e)';
            }
        }
    }
    
    // Remove existing menu to recreate with updated labels
    if (rowContextMenu) {
        rowContextMenu.remove();
    }
    
    rowContextMenu = createRowContextMenu(cellData.metadata, cellData.resultSetIndex, cellData.rowIndex, cellData.table.id);
    contextMenuData = cellData;
    
    // Position menu at cursor
    rowContextMenu.style.display = 'block';
    rowContextMenu.style.left = e.pageX + 'px';
    rowContextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = rowContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        rowContextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        rowContextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideRowContextMenu() {
    if (rowContextMenu) {
        rowContextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function showColumnHeaderContextMenu(e, cellData) {
    e.preventDefault();
    
    // Remove existing menu to recreate with updated labels
    if (columnHeaderContextMenu) {
        columnHeaderContextMenu.remove();
    }
    
    columnHeaderContextMenu = createColumnHeaderContextMenu();
    contextMenuData = cellData;
    
    // Position menu at cursor
    columnHeaderContextMenu.style.display = 'block';
    columnHeaderContextMenu.style.left = e.pageX + 'px';
    columnHeaderContextMenu.style.top = e.pageY + 'px';
    
    // Adjust if menu goes off screen
    const rect = columnHeaderContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        columnHeaderContextMenu.style.left = (e.pageX - rect.width) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        columnHeaderContextMenu.style.top = (e.pageY - rect.height) + 'px';
    }
}

function hideColumnHeaderContextMenu() {
    if (columnHeaderContextMenu) {
        columnHeaderContextMenu.style.display = 'none';
    }
    contextMenuData = null;
}

function handleContextMenuAction(action) {
    if (!contextMenuData) return;
    
    const { table, rowIndex, columnIndex, columnDefs, data } = contextMenuData;
    let textToCopy = '';
    
    switch (action) {
        case 'collapse-row':
            if (typeof collapseRowRelations === 'function') {
                collapseRowRelations(table.id, rowIndex);
            }
            return;
            
        case 'expand-row':
            if (typeof expandRowRelations === 'function') {
                expandRowRelations(table.id, rowIndex);
            }
            return;

        case 'copy-cell':
            if (globalSelection && globalSelection.selections && globalSelection.selections.length > 1 && globalSelection.type === 'cell') {
                // Copy all selected cells (tab-separated on same row, newline for different rows)
                const cellsByRow = {};
                globalSelection.selections.forEach(sel => {
                    if (!cellsByRow[sel.rowIndex]) cellsByRow[sel.rowIndex] = [];
                    cellsByRow[sel.rowIndex].push({ col: sel.columnIndex, val: sel.cellValue });
                });
                
                textToCopy = Object.keys(cellsByRow).sort((a, b) => a - b).map(rowIdx => {
                    return cellsByRow[rowIdx].sort((a, b) => a.col - b.col).map(cell => {
                        return cell.val === null ? 'NULL' : String(cell.val);
                    }).join('\t');
                }).join('\n');
            } else {
                const cellValue = data[rowIndex][columnDefs[columnIndex].field];
                textToCopy = cellValue === null ? 'NULL' : String(cellValue);
            }
            break;
            
        case 'copy-row':
            if (globalSelection && globalSelection.selections && globalSelection.type === 'row') {
                // For rows, check if we have multiple distinct rows
                const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
                
                if (uniqueRowIndices.length > 1) {
                    // Copy all selected rows (multiple distinct rows)
                    textToCopy = uniqueRowIndices.sort((a, b) => a - b).map(rowIndex => {
                        const row = data[rowIndex];
                        return columnDefs.map(col => {
                            const val = row[col.field];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                } else {
                    // Single row (even though selections array has multiple items for each column)
                    const row = data[uniqueRowIndices[0]];
                    textToCopy = columnDefs.map(col => {
                        const val = row[col.field];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }
            } else {
                const row = data[rowIndex];
                textToCopy = columnDefs.map(col => {
                    const val = row[col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
            }
            break;
            
        case 'copy-row-header':
            const headers = columnDefs.map(col => col.headerName).join('\t');
            if (globalSelection && globalSelection.selections && globalSelection.type === 'row') {
                // For rows, check if we have multiple distinct rows
                const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
                
                if (uniqueRowIndices.length > 1) {
                    // Copy all selected rows with header (multiple distinct rows)
                    const rowsData = uniqueRowIndices.sort((a, b) => a - b).map(rowIndex => {
                        const row = data[rowIndex];
                        return columnDefs.map(col => {
                            const val = row[col.field];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                    textToCopy = headers + '\n' + rowsData;
                } else {
                    // Single row with header
                    const row = data[uniqueRowIndices[0]];
                    const rowData = columnDefs.map(col => {
                        const val = row[col.field];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                    textToCopy = headers + '\n' + rowData;
                }
            } else {
                const rowData = columnDefs.map(col => {
                    const val = data[rowIndex][col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
                textToCopy = headers + '\n' + rowData;
            }
            break;
            
        case 'copy-column':
            if (globalSelection && globalSelection.selections && globalSelection.type === 'column') {
                // For columns, check if we have multiple distinct columns
                const uniqueColumnIndices = [...new Set(globalSelection.selections.map(sel => sel.columnIndex))];
                
                if (uniqueColumnIndices.length > 1) {
                    // Copy all selected columns (multiple distinct columns, tab-separated)
                    const columnValues = data.map(row => {
                        return uniqueColumnIndices.sort((a, b) => a - b).map(colIndex => {
                            const colField = columnDefs[colIndex].field;
                            const val = row[colField];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                    textToCopy = columnValues;
                } else {
                    // Single column (even though selections array has multiple items for each row)
                    const colField = columnDefs[uniqueColumnIndices[0]].field;
                    textToCopy = data.map(row => {
                        const val = row[colField];
                        return val === null ? 'NULL' : String(val);
                    }).join('\n');
                }
            } else {
                const colField = columnDefs[columnIndex].field;
                textToCopy = data.map(row => {
                    const val = row[colField];
                    return val === null ? 'NULL' : String(val);
                }).join('\n');
            }
            break;
            
        case 'copy-column-header':
            if (hasMultipleSelections && globalSelection.type === 'column') {
                // Copy all selected columns with headers
                const colHeaders = globalSelection.selections.map(sel => {
                    return columnDefs[sel.columnIndex].headerName;
                }).join('\t');
                const columnValues = data.map(row => {
                    return globalSelection.selections.map(sel => {
                        const colField = columnDefs[sel.columnIndex].field;
                        const val = row[colField];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }).join('\n');
                textToCopy = colHeaders + '\n' + columnValues;
            } else {
                const colFieldWithHeader = columnDefs[columnIndex].field;
                const colHeaderName = columnDefs[columnIndex].headerName;
                const columnValues = data.map(row => {
                    const val = row[colFieldWithHeader];
                    return val === null ? 'NULL' : String(val);
                }).join('\n');
                textToCopy = colHeaderName + '\n' + columnValues;
            }
            break;
            
        case 'copy-column-distinct':
            const colFieldDistinct = columnDefs[columnIndex].field;
            const distinctValues = [...new Set(data.map(row => {
                const val = row[colFieldDistinct];
                return val === null ? 'NULL' : String(val);
            }))].sort().join('\n');
            textToCopy = distinctValues;
            break;
            
        case 'copy-table':
            const tableHeaders = columnDefs.map(col => col.headerName).join('\t');
            const tableRows = data.map(row => {
                return columnDefs.map(col => {
                    const val = row[col.field];
                    return val === null ? 'NULL' : String(val);
                }).join('\t');
            }).join('\n');
            textToCopy = tableHeaders + '\n' + tableRows;
            break;
            
        case 'delete-row':
            // Get metadata and resultSetIndex from context menu
            const menu = document.querySelector('.context-menu');
            if (!menu) return;
            
            const resultSetIndex = parseInt(menu.dataset.resultSetIndex);
            const metadata = JSON.parse(menu.dataset.metadata);
            
            if (hasMultipleSelections && globalSelection.type === 'row') {
                // Delete multiple selected rows
                globalSelection.selections.forEach(sel => {
                    const row = data[sel.rowIndex];
                    recordRowDeletion(resultSetIndex, sel.rowIndex, row, metadata);
                    // Mark row for deletion visually
                    markRowForDeletion(table, sel.rowIndex);
                });
            } else {
                // Delete single row
                const row = data[rowIndex];
                recordRowDeletion(resultSetIndex, rowIndex, row, metadata);
                // Mark row for deletion visually
                markRowForDeletion(table, rowIndex);
            }
            return; // Don't copy to clipboard for delete action
    }
    
    // Copy to clipboard (skip for delete action)
    if (action !== 'delete-row') {
        navigator.clipboard.writeText(textToCopy).then(() => {
            console.log('[CONTEXT-MENU] Copied to clipboard:', action);
        }).catch(err => {
            console.error('[CONTEXT-MENU] Failed to copy:', err);
        });
    }
}

// Setup global keyboard handlers for copy functionality
function setupGlobalKeyboardHandlers() {
    document.addEventListener('keydown', (e) => {
        // Handle CTRL+C (or CMD+C on Mac)
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            // Check if cursor is in Monaco editor
            if (isMonacoEditorFocused()) {
                // Let Monaco handle the copy operation
                console.log('[KEYBOARD] CTRL+C ignored - Monaco editor has focus');
                return;
            }
            
            // Check if we have any table selection
            if (globalSelection && globalSelection.selections && globalSelection.selections.length > 0) {
                // Prevent default copy behavior
                e.preventDefault();
                e.stopPropagation();
                
                // Copy the selection
                copySelectionToClipboard();
                console.log('[KEYBOARD] CTRL+C handled - copied table selection');
            }
        }
    });
}

// Check if Monaco editor currently has focus
function isMonacoEditorFocused() {
    if (!editor) return false;
    
    // Check if the editor container or any of its elements has focus
    const editorElement = document.getElementById('editor');
    if (!editorElement) return false;
    
    // Check if the focused element is within the editor container
    const focusedElement = document.activeElement;
    if (!focusedElement) return false;
    
    // Monaco creates various internal elements, check if any of them is focused
    return editorElement.contains(focusedElement) || 
           focusedElement === editorElement ||
           focusedElement.classList.contains('monaco-editor') ||
           focusedElement.closest('.monaco-editor') !== null ||
           editor.hasTextFocus();
}

// Copy current table selection to clipboard using CTRL+C
function copySelectionToClipboard() {
    if (!globalSelection || !globalSelection.selections || globalSelection.selections.length === 0) {
        console.log('[COPY] No selection to copy');
        return;
    }
    
    let textToCopy = '';
    
    try {
        switch (globalSelection.type) {
            case 'cell':
                if (globalSelection.selections.length > 1) {
                    // Copy all selected cells (tab-separated on same row, newline for different rows)
                    const cellsByRow = {};
                    globalSelection.selections.forEach(sel => {
                        if (!cellsByRow[sel.rowIndex]) cellsByRow[sel.rowIndex] = [];
                        cellsByRow[sel.rowIndex].push({ col: sel.columnIndex, val: sel.cellValue });
                    });
                    
                    textToCopy = Object.keys(cellsByRow).sort((a, b) => a - b).map(rowIdx => {
                        return cellsByRow[rowIdx].sort((a, b) => a.col - b.col).map(cell => {
                            return cell.val === null ? 'NULL' : String(cell.val);
                        }).join('\t');
                    }).join('\n');
                } else {
                    // Single cell
                    const cellValue = globalSelection.selections[0].cellValue;
                    textToCopy = cellValue === null ? 'NULL' : String(cellValue);
                }
                break;
                
            case 'row':
                // For rows, check if we have multiple distinct rows
                const uniqueRowIndices = [...new Set(globalSelection.selections.map(sel => sel.rowIndex))];
                
                if (uniqueRowIndices.length > 1) {
                    // Copy all selected rows (multiple distinct rows)
                    textToCopy = uniqueRowIndices.sort((a, b) => a - b).map(rowIndex => {
                        const row = globalSelection.data[rowIndex];
                        return globalSelection.columnDefs.map(col => {
                            const val = row[col.field];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                } else {
                    // Single row (even though selections array has multiple items for each column)
                    const row = globalSelection.data[uniqueRowIndices[0]];
                    textToCopy = globalSelection.columnDefs.map(col => {
                        const val = row[col.field];
                        return val === null ? 'NULL' : String(val);
                    }).join('\t');
                }
                break;
                
            case 'column':
                // For columns, check if we have multiple distinct columns
                const uniqueColumnIndices = [...new Set(globalSelection.selections.map(sel => sel.columnIndex))];
                
                if (uniqueColumnIndices.length > 1) {
                    // Copy all selected columns (multiple distinct columns, tab-separated)
                    const columnValues = globalSelection.data.map(row => {
                        return uniqueColumnIndices.sort((a, b) => a - b).map(colIndex => {
                            const colField = globalSelection.columnDefs[colIndex].field;
                            const val = row[colField];
                            return val === null ? 'NULL' : String(val);
                        }).join('\t');
                    }).join('\n');
                    textToCopy = columnValues;
                } else {
                    // Single column (even though selections array has multiple items for each row)
                    const colField = globalSelection.columnDefs[uniqueColumnIndices[0]].field;
                    textToCopy = globalSelection.data.map(row => {
                        const val = row[colField];
                        return val === null ? 'NULL' : String(val);
                    }).join('\n');
                }
                break;
                
            default:
                console.log('[COPY] Unknown selection type:', globalSelection.type);
                return;
        }
        
        // Copy to clipboard
        navigator.clipboard.writeText(textToCopy).then(() => {
            console.log('[COPY] Successfully copied selection to clipboard:', globalSelection.type, globalSelection.selections.length, 'items');
        }).catch(err => {
            console.error('[COPY] Failed to copy to clipboard:', err);
        });
        
    } catch (error) {
        console.error('[COPY] Error while preparing text for clipboard:', error);
    }
}

// Global helper functions for selection management across all tables
function clearAllSelections() {
    // Find all result tables
    const allTables = document.querySelectorAll('.result-set-table .ag-grid-table');
    
    allTables.forEach(table => {
        // Clear column highlights
        const allCells = table.querySelectorAll('th, td');
        allCells.forEach(cell => {
            if (!cell.classList.contains('ag-grid-row-number-cell') && 
                !cell.classList.contains('ag-grid-row-number-header')) {
                cell.style.backgroundColor = '';
                cell.classList.remove('selected-cell');
            }
        });
        
        // Clear row selections
        const allRows = table.querySelectorAll('tbody tr');
        allRows.forEach(row => {
            row.classList.remove('selected');
            row.style.backgroundColor = '';
        });
        
        // Reset row number cells
        const rowNumCells = table.querySelectorAll('.ag-grid-row-number-cell');
        rowNumCells.forEach(cell => {
            cell.style.backgroundColor = 'var(--vscode-editor-background, #1e1e1e)';
        });
    });
    
    // Clear aggregation stats
    updateAggregationStats();
}

function reapplySelection() {
    if (!globalSelection.type || !globalSelection.tableContainer || !globalSelection.selections.length) {
        return;
    }
    
    globalSelection.selections.forEach(sel => {
        if (globalSelection.type === 'column' && sel.columnIndex !== undefined) {
            applyColumnHighlightGlobal(globalSelection.tableContainer, sel.columnIndex);
        } else if (globalSelection.type === 'row' && sel.rowIndex !== undefined) {
            applyRowHighlightGlobal(globalSelection.tableContainer, sel.rowIndex);
        } else if (globalSelection.type === 'cell' && sel.rowIndex !== undefined && sel.columnIndex !== undefined) {
            applyCellHighlightGlobal(globalSelection.tableContainer, sel.rowIndex, sel.columnIndex);
        }
    });
}

function applyColumnHighlightGlobal(containerEl, colIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    // Highlight the selected column (colIndex + 2 because row number is column 1)
    const columnCells = table.querySelectorAll(`th:nth-child(${colIndex + 2}), td:nth-child(${colIndex + 2})`);
    columnCells.forEach(cell => {
        cell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
    });
}

// Select all columns when clicking on row number header "#"
function selectAllColumns(colDefs, containerEl, data) {
    console.log('[SELECTION] Selecting all columns');
    
    // Clear all existing selections
    clearAllSelections();
    
    // Create selection for all columns
    const allColumnSelections = [];
    for (let colIndex = 0; colIndex < colDefs.length; colIndex++) {
        // Add all cells from this column
        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
            allColumnSelections.push({
                rowIndex: rowIndex,
                columnIndex: colIndex,
                cellValue: data[rowIndex][colDefs[colIndex].field]
            });
        }
        
        // Apply highlighting for this column
        applyColumnHighlightGlobal(containerEl, colIndex);
    }
    
    // Set global selection state for all columns
    globalSelection = {
        type: 'column',
        tableContainer: containerEl,
        selections: allColumnSelections,
        data: data,
        columnDefs: colDefs,
        lastClickedIndex: null // No specific last clicked since we selected all
    };
    
    // Update aggregation stats
    updateAggregationStats();
    
    console.log('[SELECTION] Selected all', colDefs.length, 'columns with', allColumnSelections.length, 'total cells');
}

// Show export menu when clicking on export header
function showExportMenu(headerEl, colDefs, data, containerEl, sortCfg, filters) {
    console.log('[EXPORT] Showing export menu');
    
    // Remove any existing export menu
    const existingMenu = document.querySelector('.export-dropdown-menu');
    if (existingMenu) {
        existingMenu.remove();
    }
    
    // Create dropdown menu
    const menu = document.createElement('div');
    menu.className = 'export-dropdown-menu';
    menu.innerHTML = `
        <div class="export-menu-item" data-action="autofit">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                <path d="M7 8h10" />
                <path d="M7 12h10" />
                <path d="M7 16h10" />
            </svg>
            Auto-fit all columns
        </div>
        <div style="height: 1px; background-color: var(--vscode-menu-separatorBackground); margin: 4px 0;"></div>
        <div class="export-menu-item" data-action="copy">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
            Copy to clipboard
        </div>
        <div class="export-menu-item" data-action="json">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14,2 14,8 20,8"/>
                <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/>
                <path d="M14 12a1 1 0 0 1 1 1v1a1 1 0 0 0 1 1 1 1 0 0 0-1 1v1a1 1 0 0 1-1 1"/>
            </svg>
            Export to JSON
        </div>
        <div class="export-menu-item" data-action="csv">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                <path d="M7 16.5a1.5 1.5 0 0 0 -3 0v3a1.5 1.5 0 0 0 3 0" />
                <path d="M10 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75" />
                <path d="M16 15l2 6l2 -6" />
            </svg>
            Export to CSV
        </div>
        <div class="export-menu-item" data-action="excel">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                <path d="M4 15l4 6" />
                <path d="M4 21l4 -6" />
                <path d="M17 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75" />
                <path d="M11 15v6h3" />
            </svg>
            Export to Excel
        </div>
        <div class="export-menu-item" data-action="markdown">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z" />
                <path d="M7 15v-6l2 2l2 -2v6" />
                <path d="M14 13l2 2l2 -2m-2 2v-6" />
            </svg>
            Export to Markdown
        </div>
        <div class="export-menu-item" data-action="xml">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                <path d="M4 15l4 6" />
                <path d="M4 21l4 -6" />
                <path d="M19 15v6h3" />
                <path d="M11 21v-6l2.5 3l2.5 -3v6" />
            </svg>
            Export to XML
        </div>
        <div class="export-menu-item" data-action="html">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 3v4a1 1 0 0 0 1 1h4" />
                <path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" />
                <path d="M2 21v-6" />
                <path d="M5 15v6" />
                <path d="M2 18h3" />
                <path d="M20 15v6h2" />
                <path d="M13 21v-6l2 3l2 -3v6" />
                <path d="M7.5 15h3" />
                <path d="M9 15v6" />
            </svg>
            Export to HTML
        </div>
    `;
    
    // Position the menu
    const rect = headerEl.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = rect.left + 'px';
    menu.style.zIndex = '2000';
    
    // Add to document
    document.body.appendChild(menu);
    
    // Add event listeners to menu items
    menu.querySelectorAll('.export-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const action = e.currentTarget.getAttribute('data-action');
            if (action === 'autofit') {
                autoFitAllColumns(colDefs, sortCfg, filters, containerEl, data);
            } else {
                handleExport(action, colDefs, data);
            }
            menu.remove();
        });
    });
    
    // Close menu when clicking outside
    const closeMenu = (e) => {
        if (!menu.contains(e.target) && !headerEl.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }
    };
    
    // Add a small delay to prevent immediate closure
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 100);
}

// Auto-fit single column (global function)
function autoFitSingleColumn(colIndex, colDefs, containerEl, data) {
    const col = colDefs[colIndex];
    if (!col) return;
    
    console.log(`[AUTO-FIT] Auto-fitting column "${col.headerName}" (index: ${colIndex})`);
    
    function calculateOptimalColumnWidthGlobal(columnName, columnData, type) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = '13px var(--vscode-font-family, "Segoe UI", sans-serif)';
        
        const headerWidth = context.measureText(columnName).width;
        let maxContentWidth = 0;
        
        const sampleSize = Math.min(100, columnData.length);
        const step = Math.max(1, Math.floor(columnData.length / sampleSize));
        
        for (let i = 0; i < columnData.length; i += step) {
            const value = columnData[i];
            let displayValue = '';
            
            if (value === null || value === undefined) {
                displayValue = 'NULL';
            } else if (type === 'boolean') {
                displayValue = value ? '✓' : '✗';
            } else if (type === 'number') {
                displayValue = typeof value === 'number' ? value.toLocaleString() : String(value);
            } else {
                displayValue = String(value);
            }
            
            const contentWidth = context.measureText(displayValue).width;
            if (contentWidth > maxContentWidth) {
                maxContentWidth = contentWidth;
            }
        }
        
        const padding = 32;
        const iconSpace = 80;
        const optimalWidth = Math.max(headerWidth + iconSpace, maxContentWidth + padding);
        const minWidth = 80;
        const maxWidth = 400;
        
        return Math.round(Math.min(Math.max(optimalWidth, minWidth), maxWidth));
    }
    
    // Extract column data and calculate new width
    const columnData = data.map(row => row[col.field]);
    const newWidth = calculateOptimalColumnWidthGlobal(col.headerName, columnData, col.type);
    
    // Update column definition
    col.width = newWidth;
    
    // Update header
    const th = containerEl.querySelector(`th[data-field="${col.field}"]`);
    if (th) {
        th.style.width = newWidth + 'px';
        th.style.minWidth = newWidth + 'px';
        th.style.maxWidth = newWidth + 'px';
    }
    
    // Update all cells in this column (+2 because row number is first column)
    const cells = containerEl.querySelectorAll(`td:nth-child(${colIndex + 2})`);
    cells.forEach(cell => {
        cell.style.width = newWidth + 'px';
        cell.style.minWidth = newWidth + 'px';
        cell.style.maxWidth = newWidth + 'px';
    });
    
    // Update total table width
    const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
    const table = containerEl.querySelector('.ag-grid-table');
    if (table) {
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
    }
    
    console.log(`[AUTO-FIT] Column "${col.headerName}" resized to ${newWidth}px`);
}

// Auto-fit all columns (global function for use outside initAgGridTable)
function autoFitAllColumns(colDefs, sortCfg, filters, containerEl, data) {
    console.log('[AUTO-FIT] Auto-fitting all columns (global)');
    
    // We need to find and use the calculateOptimalColumnWidth function from the table context
    // For now, we'll use a simplified version that recreates the logic
    
    function calculateOptimalColumnWidthGlobal(columnName, columnData, type) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        context.font = '13px var(--vscode-font-family, "Segoe UI", sans-serif)';
        
        const headerWidth = context.measureText(columnName).width;
        let maxContentWidth = 0;
        
        const sampleSize = Math.min(100, columnData.length);
        const step = Math.max(1, Math.floor(columnData.length / sampleSize));
        
        for (let i = 0; i < columnData.length; i += step) {
            const value = columnData[i];
            let displayValue = '';
            
            if (value === null || value === undefined) {
                displayValue = 'NULL';
            } else if (type === 'boolean') {
                displayValue = value ? '✓' : '✗';
            } else if (type === 'number') {
                displayValue = typeof value === 'number' ? value.toLocaleString() : String(value);
            } else {
                displayValue = String(value);
            }
            
            const contentWidth = context.measureText(displayValue).width;
            if (contentWidth > maxContentWidth) {
                maxContentWidth = contentWidth;
            }
        }
        
        const padding = 32;
        const iconSpace = 80;
        const optimalWidth = Math.max(headerWidth + iconSpace, maxContentWidth + padding);
        const minWidth = 80;
        const maxWidth = 400;
        
        return Math.round(Math.min(Math.max(optimalWidth, minWidth), maxWidth));
    }
    
    // Calculate new widths for all columns
    colDefs.forEach((col, index) => {
        const columnData = data.map(row => row[col.field]);
        const newWidth = calculateOptimalColumnWidthGlobal(col.headerName, columnData, col.type);
        col.width = newWidth;
    });
    
    // Update all header widths
    colDefs.forEach((col, index) => {
        const th = containerEl.querySelector(`th[data-field="${col.field}"]`);
        if (th) {
            th.style.width = col.width + 'px';
            th.style.minWidth = col.width + 'px';
            th.style.maxWidth = col.width + 'px';
        }
        
        // Update all cells in this column (+2 because row number is first column)
        const cells = containerEl.querySelectorAll(`td:nth-child(${index + 2})`);
        cells.forEach(cell => {
            cell.style.width = col.width + 'px';
            cell.style.minWidth = col.width + 'px';
            cell.style.maxWidth = col.width + 'px';
        });
    });
    
    // Update total table width
    const totalWidth = colDefs.reduce((sum, col) => sum + col.width, 0) + 50;
    const table = containerEl.querySelector('.ag-grid-table');
    if (table) {
        table.style.width = totalWidth + 'px';
        table.style.minWidth = totalWidth + 'px';
    }
    
    console.log('[AUTO-FIT] All columns auto-fitted (global)');
}

// Handle export actions
function handleExport(action, colDefs, data) {
    console.log('[EXPORT] Handling export action:', action);
    
    try {
        switch (action) {
            case 'copy':
                copyDataToClipboard(colDefs, data);
                break;
            case 'json':
                exportToJson(colDefs, data);
                break;
            case 'csv':
                exportToCsv(colDefs, data);
                break;
            case 'excel':
                exportToExcel(colDefs, data);
                break;
            case 'markdown':
                exportToMarkdown(colDefs, data);
                break;
            case 'xml':
                exportToXml(colDefs, data);
                break;
            case 'html':
                exportToHtml(colDefs, data);
                break;
            default:
                console.warn('[EXPORT] Unknown export action:', action);
        }
    } catch (error) {
        console.error('[EXPORT] Error during export:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        // Extension will handle showing error messages via saveFile response
        console.error(`[EXPORT] ${action} export failed: ${errorMessage}`);
    }
}

// Copy data to clipboard as tab-separated values
function copyDataToClipboard(colDefs, data) {
    const headers = colDefs.map(col => col.headerName || col.field).join('\t');
    const rows = data.map(row => 
        colDefs.map(col => {
            const value = row[col.field];
            return value === null || value === undefined ? '' : String(value);
        }).join('\t')
    );
    
    const clipboardData = [headers, ...rows].join('\n');
    
    navigator.clipboard.writeText(clipboardData).then(() => {
        console.log('[EXPORT] Data copied to clipboard');
        // Show info message for clipboard copy (this works in webview)
        const statusLabel = document.getElementById('statusLabel');
        if (statusLabel) {
            const originalText = statusLabel.textContent;
            statusLabel.textContent = `Copied ${data.length} rows to clipboard`;
            setTimeout(() => {
                statusLabel.textContent = originalText;
            }, 3000);
        }
    }).catch(error => {
        console.error('[EXPORT] Failed to copy to clipboard:', error);
        const statusLabel = document.getElementById('statusLabel');
        if (statusLabel) {
            const originalText = statusLabel.textContent;
            statusLabel.textContent = 'Failed to copy to clipboard';
            setTimeout(() => {
                statusLabel.textContent = originalText;
            }, 3000);
        }
    });
}

// Export data as JSON
function exportToJson(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to JSON format`);
    
    const jsonData = data.map(row => {
        const obj = {};
        colDefs.forEach(col => {
            obj[col.headerName || col.field] = row[col.field];
        });
        return obj;
    });
    
    const jsonString = JSON.stringify(jsonData, null, 2);
    
    vscode.postMessage({
        type: 'saveFile',
        content: jsonString,
        defaultFileName: 'results.json',
        fileType: 'JSON'
    });
}

// Export data as CSV
function exportToCsv(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to CSV format`);
    
    const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };
    
    const headers = colDefs.map(col => escapeCSV(col.headerName || col.field)).join(',');
    const rows = data.map(row => 
        colDefs.map(col => escapeCSV(row[col.field])).join(',')
    );
    
    const csvData = [headers, ...rows].join('\n');
    
    vscode.postMessage({
        type: 'saveFile',
        content: csvData,
        defaultFileName: 'results.csv',
        fileType: 'CSV'
    });
}

// Export data as Excel (TSV format for Excel compatibility)
function exportToExcel(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to Excel format (XLSX)`);
    
    try {
        // Check if SheetJS is available
        if (typeof XLSX === 'undefined') {
            // Fallback to CSV if SheetJS is not loaded
            console.warn('[EXPORT] SheetJS not available, falling back to CSV format');
            exportToExcelFallback(colDefs, data);
            return;
        }
        
        // Prepare data for SheetJS
        const wsData = [];
        
        // Add headers
        const headers = colDefs.map(col => col.headerName || col.field);
        wsData.push(headers);
        
        // Add data rows
        data.forEach(row => {
            const rowData = colDefs.map(col => {
                const value = row[col.field];
                if (value === null || value === undefined) return '';
                return value;
            });
            wsData.push(rowData);
        });
        
        // Create workbook and worksheet
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        
        // Auto-size columns
        const colWidths = [];
        for (let i = 0; i < headers.length; i++) {
            let maxWidth = headers[i].length;
            for (let j = 1; j < wsData.length; j++) {
                const cellValue = wsData[j][i];
                if (cellValue && cellValue.toString().length > maxWidth) {
                    maxWidth = cellValue.toString().length;
                }
            }
            colWidths.push({ wch: Math.min(maxWidth + 2, 50) }); // Max width 50 chars
        }
        ws['!cols'] = colWidths;
        
        // Add worksheet to workbook
        XLSX.utils.book_append_sheet(wb, ws, 'Query Results');
        
        // Generate Excel file as base64
        const xlsxData = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
        
        vscode.postMessage({
            type: 'saveFile',
            content: xlsxData,
            defaultFileName: 'results.xlsx',
            fileType: 'Excel',
            encoding: 'base64'
        });
        
    } catch (error) {
        console.error('[EXPORT] Excel export failed:', error);
        // Fallback to CSV
        exportToExcelFallback(colDefs, data);
    }
}

// Fallback function for CSV export when XLSX library is not available
function exportToExcelFallback(colDefs, data) {
    console.log(`[EXPORT] Using CSV fallback for Excel export`);
    
    const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    };
    
    const headers = colDefs.map(col => escapeCSV(col.headerName || col.field)).join(',');
    const rows = data.map(row => 
        colDefs.map(col => escapeCSV(row[col.field])).join(',')
    );
    
    const csvData = [headers, ...rows].join('\n');
    
    vscode.postMessage({
        type: 'saveFile',
        content: csvData,
        defaultFileName: 'results.csv',
        fileType: 'Excel'
    });
}

// Export data as Markdown table
function exportToMarkdown(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to Markdown format`);
    
    const headers = colDefs.map(col => col.headerName || col.field);
    const separator = headers.map(() => '---');
    
    const escapeMarkdown = (value) => {
        if (value === null || value === undefined) return '';
        return String(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
    };
    
    const headerRow = '| ' + headers.join(' | ') + ' |';
    const separatorRow = '| ' + separator.join(' | ') + ' |';
    const dataRows = data.map(row => 
        '| ' + colDefs.map(col => escapeMarkdown(row[col.field])).join(' | ') + ' |'
    );
    
    const markdownData = [headerRow, separatorRow, ...dataRows].join('\n');
    
    vscode.postMessage({
        type: 'saveFile',
        content: markdownData,
        defaultFileName: 'results.md',
        fileType: 'Markdown'
    });
}

// Export data as XML
function exportToXml(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to XML format`);
    
    const escapeXml = (value) => {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
    
    const sanitizeElementName = (name) => {
        // Replace invalid XML element name characters with underscores
        return String(name).replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^[^a-zA-Z_]/, '_$&');
    };
    
    let xmlData = '<?xml version="1.0" encoding="UTF-8"?>\n<results>\n';
    
    data.forEach(row => {
        xmlData += '  <row>\n';
        colDefs.forEach(col => {
            const elementName = sanitizeElementName(col.headerName || col.field);
            const value = escapeXml(row[col.field]);
            xmlData += `    <${elementName}>${value}</${elementName}>\n`;
        });
        xmlData += '  </row>\n';
    });
    
    xmlData += '</results>';
    
    vscode.postMessage({
        type: 'saveFile',
        content: xmlData,
        defaultFileName: 'results.xml',
        fileType: 'XML'
    });
}

// Export data as HTML table
function exportToHtml(colDefs, data) {
    console.log(`[EXPORT] Exporting ${data.length} rows to HTML format`);
    
    const escapeHtml = (value) => {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };
    
    let htmlData = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Query Results</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            margin-bottom: 20px;
            font-size: 24px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 12px 8px;
            text-align: left;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #495057;
        }
        tr:nth-child(even) {
            background-color: #f8f9fa;
        }
        tr:hover {
            background-color: #e9ecef;
        }
        .stats {
            margin-top: 15px;
            color: #6c757d;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Query Results</h1>
        <table>
            <thead>
                <tr>
`;
    
    // Add table headers
    colDefs.forEach(col => {
        htmlData += `                    <th>${escapeHtml(col.headerName || col.field)}</th>\n`;
    });
    
    htmlData += `                </tr>
            </thead>
            <tbody>
`;
    
    // Add table rows
    data.forEach(row => {
        htmlData += `                <tr>\n`;
        colDefs.forEach(col => {
            const value = escapeHtml(row[col.field]);
            htmlData += `                    <td>${value}</td>\n`;
        });
        htmlData += `                </tr>\n`;
    });
    
    htmlData += `            </tbody>
        </table>
        <div class="stats">
            <strong>Total rows:</strong> ${data.length} | <strong>Columns:</strong> ${colDefs.length}
        </div>
    </div>
</body>
</html>`;
    
    vscode.postMessage({
        type: 'saveFile',
        content: htmlData,
        defaultFileName: 'results.html',
        fileType: 'HTML'
    });
}

function applyRowHighlightGlobal(containerEl, rowIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Find the row by data attribute
    const targetRow = tbody.querySelector(`tr[data-row-index="${rowIndex}"]`);
    if (targetRow) {
        targetRow.classList.add('selected');
        targetRow.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
        
        const rowNumCell = targetRow.querySelector('.ag-grid-row-number-cell');
        if (rowNumCell) {
            rowNumCell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
        }
    }
}

function applyCellHighlightGlobal(containerEl, rowIndex, colIndex) {
    const table = containerEl.querySelector('.ag-grid-table');
    if (!table) return;
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Find the row by data attribute
    const targetRow = tbody.querySelector(`tr[data-row-index="${rowIndex}"]`);
    if (targetRow) {
        // Find the cell (colIndex + 2 because row number is column 1, and nth-child is 1-indexed)
        const targetCell = targetRow.querySelector(`td:nth-child(${colIndex + 2})`);
        if (targetCell) {
            targetCell.style.backgroundColor = 'var(--vscode-list-activeSelectionBackground, #094771)';
            targetCell.classList.add('selected-cell');
        }
    }
}

// Helper function to determine SQL data type category
function getDataTypeCategory(sqlType) {
    if (!sqlType) return 'unknown';
    
    const type = sqlType.toLowerCase();
    
    // Numeric types
    if (['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney'].includes(type)) {
        return 'numeric';
    }
    
    // Boolean/bit type
    if (type === 'bit') {
        return 'boolean';
    }
    
    // Date/time types
    if (['date', 'datetime', 'datetime2', 'smalldatetime', 'time', 'datetimeoffset'].includes(type)) {
        return 'datetime';
    }
    
    // Text types
    if (['char', 'varchar', 'nchar', 'nvarchar', 'text', 'ntext'].includes(type)) {
        return 'text';
    }
    
    // Binary types
    if (['binary', 'varbinary', 'image'].includes(type)) {
        return 'binary';
    }
    
    // Default to text for unknown types
    return 'text';
}

// Calculate statistics for numeric values
function calculateNumericStats(values) {
    if (values.length === 0) return null;
    
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    
    return {
        sum: sum.toFixed(2),
        avg: avg.toFixed(2),
        min: min,
        max: max
    };
}

// Calculate statistics for text values
function calculateTextStats(values) {
    if (values.length === 0) return null;
    
    const distinctValues = new Set(values);
    const lengths = values.map(v => String(v).length);
    const minLength = Math.min(...lengths);
    const maxLength = Math.max(...lengths);
    
    return {
        distinct: distinctValues.size,
        minLength: minLength,
        maxLength: maxLength
    };
}

// Calculate statistics for boolean values
function calculateBooleanStats(values) {
    if (values.length === 0) return null;
    
    let trueCount = 0;
    let falseCount = 0;
    
    for (const val of values) {
        // Handle different boolean representations
        if (val === true || val === 1 || String(val).toLowerCase() === 'true') {
            trueCount++;
        } else if (val === false || val === 0 || String(val).toLowerCase() === 'false') {
            falseCount++;
        }
    }
    
    return {
        trueCount: trueCount,
        falseCount: falseCount
    };
}

// Calculate statistics for datetime values
function calculateDateTimeStats(values) {
    if (values.length === 0) return null;
    
    const dates = values.map(v => {
        if (v instanceof Date) return v;
        return new Date(v);
    }).filter(d => !isNaN(d.getTime()));
    
    if (dates.length === 0) return null;
    
    // Sort timestamps to find min, min2, and max
    const timestamps = dates.map(d => d.getTime()).sort((a, b) => a - b);
    const min = new Date(timestamps[0]);
    const max = new Date(timestamps[timestamps.length - 1]);
    
    // Check if min is the default date (0001-01-01)
    const defaultDateThreshold = new Date('0001-01-02').getTime(); // Anything before this is considered default
    const isMinDefault = timestamps[0] < defaultDateThreshold;
    
    let min2 = null;
    let rangeStart = min;
    
    if (isMinDefault && timestamps.length > 1) {
        // Find the second minimum that's not the default date
        for (let i = 1; i < timestamps.length; i++) {
            if (timestamps[i] >= defaultDateThreshold) {
                min2 = new Date(timestamps[i]);
                rangeStart = min2; // Use min2 for range calculation
                break;
            }
        }
    }
    
    const totalDays = Math.ceil((max - rangeStart) / (1000 * 60 * 60 * 24)); // days
    
    // Format range in a human-readable way
    let rangeText;
    if (totalDays >= 365) {
        const years = Math.floor(totalDays / 365);
        const remainingDays = totalDays % 365;
        rangeText = years === 1 
            ? `1 year ${remainingDays} days` 
            : `${years} years ${remainingDays} days`;
    } else {
        rangeText = `${totalDays} days`;
    }
    
    return {
        min: min.toISOString().slice(0, 19).replace('T', ' '),
        min2: min2 ? min2.toISOString().slice(0, 19).replace('T', ' ') : null,
        max: max.toISOString().slice(0, 19).replace('T', ' '),
        range: rangeText
    };
}

function updateAggregationStats() {
    const statsPanel = document.getElementById('aggregationStats');
    if (!statsPanel) return;
    
    // If no selection or no data, hide the panel
    if (!globalSelection || !globalSelection.selections || globalSelection.selections.length === 0) {
        statsPanel.style.display = 'none';
        return;
    }
    
    const selections = globalSelection.selections;
    const columnDefs = globalSelection.columnDefs;
    const data = globalSelection.data;
    
    // Collect values and analyze data types
    const valuesByColumn = new Map(); // Map<columnIndex, {values: [], sqlType: string}>
    let nullCount = 0;
    let totalCount = 0;
    
    for (const selection of selections) {
        totalCount++;
        const value = selection.cellValue;
        
        // Count nulls
        if (value === null || value === undefined) {
            nullCount++;
            continue;
        }
        
        // Group by column if we have column information
        if (selection.columnIndex !== undefined && columnDefs) {
            if (!valuesByColumn.has(selection.columnIndex)) {
                const colDef = columnDefs[selection.columnIndex];
                
                // Try to get SQL type from metadata
                let sqlType = 'unknown';
                if (resultSetMetadata && resultSetMetadata.length > 0) {
                    const metadata = resultSetMetadata[0]; // Assuming first result set
                    const colMetadata = metadata.columns.find(c => c.name === colDef.field);
                    if (colMetadata) {
                        sqlType = colMetadata.type;
                    }
                }
                
                valuesByColumn.set(selection.columnIndex, {
                    values: [],
                    sqlType: sqlType,
                    columnName: colDef.field
                });
            }
            valuesByColumn.get(selection.columnIndex).values.push(value);
        }
    }
    
    const nonNullCount = totalCount - nullCount;
    
    // Build statistics text
    let statsText = `Count: ${nonNullCount}`;
    
    if (nullCount > 0) {
        statsText += ` | NULL: ${nullCount}`;
    }
    
    // Determine if we're selecting a single column or multiple columns/mixed selection
    if (valuesByColumn.size === 1 && globalSelection.type === 'column') {
        // Single column selection - show type-specific statistics
        const [columnIndex, columnData] = Array.from(valuesByColumn.entries())[0];
        const values = columnData.values;
        const dataTypeCategory = getDataTypeCategory(columnData.sqlType);
        
        if (dataTypeCategory === 'numeric') {
            // Numeric statistics
            const numericValues = [];
            for (const val of values) {
                if (val !== '') {
                    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
                    if (!isNaN(num)) {
                        numericValues.push(num);
                    }
                }
            }
            
            if (numericValues.length > 0) {
                const stats = calculateNumericStats(numericValues);
                statsText += ` | Avg: ${stats.avg} | Sum: ${stats.sum} | Min: ${stats.min} | Max: ${stats.max}`;
            }
            
        } else if (dataTypeCategory === 'text') {
            // Text statistics
            const stats = calculateTextStats(values);
            if (stats) {
                statsText += ` | Distinct: ${stats.distinct} | Min Length: ${stats.minLength} | Max Length: ${stats.maxLength}`;
            }
            
        } else if (dataTypeCategory === 'boolean') {
            // Boolean statistics
            const stats = calculateBooleanStats(values);
            if (stats) {
                statsText += ` | True: ${stats.trueCount} | False: ${stats.falseCount}`;
            }
            
        } else if (dataTypeCategory === 'datetime') {
            // DateTime statistics
            const stats = calculateDateTimeStats(values);
            if (stats) {
                statsText += ` | Min: ${stats.min}`;
                if (stats.min2) {
                    statsText += ` | Min2: ${stats.min2}`;
                }
                statsText += ` | Max: ${stats.max} | Range: ${stats.range}`;
            }
            
        } else {
            // Unknown type - show distinct count only
            const distinctValues = new Set(values);
            statsText += ` | Distinct: ${distinctValues.size}`;
        }
        
    } else {
        // Multiple columns or mixed selection - show general statistics
        // Calculate distinct count across all selected values
        const allValues = [];
        for (const [_, columnData] of valuesByColumn.entries()) {
            allValues.push(...columnData.values);
        }
        
        if (allValues.length > 0) {
            const distinctValues = new Set(allValues.map(v => String(v)));
            statsText += ` | Distinct: ${distinctValues.size}`;
        }
    }
    
    statsPanel.textContent = statsText;
    statsPanel.style.display = 'block';
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
        hideContextMenu();
    }
    if (rowContextMenu && !rowContextMenu.contains(e.target)) {
        hideRowContextMenu();
    }
    if (columnHeaderContextMenu && !columnHeaderContextMenu.contains(e.target)) {
        hideColumnHeaderContextMenu();
    }
});

// Hide context menu on scroll
document.addEventListener('scroll', () => {
    hideContextMenu();
    hideRowContextMenu();
    hideColumnHeaderContextMenu();
}, true);

// Query Plan Display Functions
function showQueryPlan(planXml, executionTime, messages, resultSets) {
    const executeButton = document.getElementById('executeButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusLabel = document.getElementById('statusLabel');
    const resizer = document.getElementById('resizer');
    
    // Stop the loading timer
    stopLoadingTimer();
    
    // Enable buttons
    executeButton.disabled = false;
    cancelButton.disabled = true;
    
    // Parse the XML plan
    const planData = parseQueryPlan(planXml);
    currentQueryPlan = planData;
    
    // Show plan tabs
    document.querySelectorAll('.results-tab').forEach(tab => {
        if (tab.dataset.tab === 'queryPlan' || tab.dataset.tab === 'planTree' || tab.dataset.tab === 'topOperations') {
            tab.style.display = 'block';
        }
    });
    
    // Update status
    statusLabel.textContent = resultSets ? `Query completed with execution plan` : `Estimated execution plan generated`;
    
    resultsContainer.classList.add('visible');
    resizer.classList.add('visible');
    
    // Show results panel if not visible
    if (!resultsContainer.style.flex) {
        resultsContainer.style.flex = '0 0 400px';
    }
    
    // Display the plan in different views
    displayQueryPlanGraphical(planData);
    displayPlanTree(planData);
    displayTopOperations(planData);
    
    // If we have result sets (actual plan), display them
    if (resultSets && resultSets.length > 0) {
        displayResults(resultSets, planXml);
        displayMessages(messages);
        
        // Switch to results tab first
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.results-tab[data-tab="results"]').classList.add('active');
        currentTab = 'results';
        document.getElementById('resultsContent').style.display = 'block';
        document.getElementById('messagesContent').style.display = 'none';
        document.getElementById('queryPlanContent').style.display = 'none';
        document.getElementById('planTreeContent').style.display = 'none';
        document.getElementById('topOperationsContent').style.display = 'none';
    } else {
        // For estimated plan, show XML in results
        const resultsContent = document.getElementById('resultsContent');
        resultsContent.innerHTML = `
            <div style="padding: 12px;">
                <h3 style="margin-top: 0; font-size: 14px;">ShowPlanXML</h3>
                <pre style="background-color: var(--vscode-editor-background); padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; overflow: auto; font-family: 'Courier New', monospace; font-size: 12px;">${escapeHtml(planXml)}</pre>
            </div>
        `;
        displayMessages(messages);
        
        // Switch to Query Plan tab
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.results-tab[data-tab="queryPlan"]').classList.add('active');
        currentTab = 'queryPlan';
        document.getElementById('resultsContent').style.display = 'none';
        document.getElementById('messagesContent').style.display = 'none';
        document.getElementById('queryPlanContent').style.display = 'block';
        document.getElementById('planTreeContent').style.display = 'none';
        document.getElementById('topOperationsContent').style.display = 'none';
    }
}

function parseQueryPlan(xmlString) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');
    
    const planData = {
        operations: [],
        hierarchicalOperations: [],
        topOperations: [],
        totalCost: 0
    };
    
    // Get statement info for root SELECT node
    const stmtSimple = xmlDoc.querySelector('StmtSimple');
    const statementText = stmtSimple?.getAttribute('StatementText') || 'SELECT';
    const statementCost = parseFloat(stmtSimple?.getAttribute('StatementSubTreeCost') || '0');
    
    // Find the root RelOp (usually under QueryPlan > RelOp)
    const rootRelOp = xmlDoc.querySelector('QueryPlan > RelOp, StmtSimple > QueryPlan > RelOp');
    
    if (!rootRelOp) {
        return planData;
    }
    
    // Set total cost from statement
    planData.totalCost = statementCost;
    
    let operationId = 0;
    
    // Create artificial SELECT root node
    const selectNode = {
        id: operationId++,
        level: 0,
        parent: null,
        physicalOp: 'SELECT',
        logicalOp: 'SELECT',
        estimatedCost: 0,
        estimatedRows: parseFloat(stmtSimple?.getAttribute('StatementEstRows') || '0'),
        estimatedSubtreeCost: statementCost,
        estimatedCPU: 0,
        estimatedIO: 0,
        avgRowSize: 0,
        estimatedExecutions: 1,
        actualRows: 0,
        actualExecutions: 0,
        children: [],
        details: { statement: statementText }
    };
    
    planData.operations.push(selectNode);
    
    // Recursive function to parse operation tree
    function parseOperation(relOpElement, level = 1, parent = selectNode) {
        const estimatedSubtreeCost = parseFloat(relOpElement.getAttribute('EstimatedTotalSubtreeCost') || '0');
        
        const operation = {
            id: operationId++,
            level: level,
            parent: parent,
            physicalOp: relOpElement.getAttribute('PhysicalOp') || 'Unknown',
            logicalOp: relOpElement.getAttribute('LogicalOp') || 'Unknown',
            estimatedCost: 0, // Will be calculated later
            estimatedRows: parseFloat(relOpElement.getAttribute('EstimateRows') || '0'),
            estimatedSubtreeCost: estimatedSubtreeCost,
            estimatedCPU: parseFloat(relOpElement.getAttribute('EstimateCPU') || '0'),
            estimatedIO: parseFloat(relOpElement.getAttribute('EstimateIO') || '0'),
            avgRowSize: parseInt(relOpElement.getAttribute('AvgRowSize') || '0'),
            estimatedExecutions: parseFloat(relOpElement.getAttribute('EstimateRewinds') || '0') + parseFloat(relOpElement.getAttribute('EstimateRebinds') || '0') + 1,
            actualRows: 0,
            actualExecutions: 0,
            children: [],
            details: {}
        };
        
        // Extract specific operation details
        const indexScan = relOpElement.querySelector(':scope > IndexScan, :scope > TableScan, :scope > ClusteredIndexScan');
        if (indexScan) {
            const object = indexScan.querySelector('Object');
            if (object) {
                operation.details.table = object.getAttribute('Table')?.replace(/[\[\]]/g, '') || '';
                operation.details.index = object.getAttribute('Index')?.replace(/[\[\]]/g, '') || '';
                operation.details.schema = object.getAttribute('Schema')?.replace(/[\[\]]/g, '') || 'dbo';
            }
        }
        
        // Extract actual execution stats if present (for actual plans)
        const runTimeInfo = relOpElement.querySelector(':scope > RunTimeInformation');
        if (runTimeInfo) {
            const rowCount = runTimeInfo.querySelector('RunTimeCountersPerThread');
            if (rowCount) {
                operation.actualRows = parseInt(rowCount.getAttribute('ActualRows') || '0');
                operation.actualExecutions = parseInt(rowCount.getAttribute('ActualExecutions') || '0');
            }
        }
        
        planData.operations.push(operation);
        
        // Parse child operations recursively
        const childRelOps = [];
        
        // Check for operation-specific child locations
        const nestedLoops = relOpElement.querySelector(':scope > NestedLoops');
        const merge = relOpElement.querySelector(':scope > Merge');
        const hash = relOpElement.querySelector(':scope > Hash');
        const sort = relOpElement.querySelector(':scope > Sort');
        const top = relOpElement.querySelector(':scope > Top');
        
        if (nestedLoops) {
            childRelOps.push(...nestedLoops.querySelectorAll(':scope > RelOp'));
        } else if (merge) {
            childRelOps.push(...merge.querySelectorAll(':scope > RelOp'));
        } else if (hash) {
            childRelOps.push(...hash.querySelectorAll(':scope > RelOp'));
        } else if (sort) {
            childRelOps.push(...sort.querySelectorAll(':scope > RelOp'));
        } else if (top) {
            childRelOps.push(...top.querySelectorAll(':scope > RelOp'));
        } else {
            // General case: look for direct RelOp children
            childRelOps.push(...relOpElement.querySelectorAll(':scope > RelOp'));
        }
        
        childRelOps.forEach(childRelOp => {
            const childOp = parseOperation(childRelOp, level + 1, operation);
            operation.children.push(childOp);
        });
        
        // Calculate operator cost as subtree cost minus children costs
        const childrenCost = operation.children.reduce((sum, child) => sum + child.estimatedSubtreeCost, 0);
        operation.estimatedCost = Math.max(0, operation.estimatedSubtreeCost - childrenCost);
        
        return operation;
    }
    
    // Parse the entire operation tree starting from root RelOp
    const rootOperation = parseOperation(rootRelOp, 1, selectNode);
    selectNode.children.push(rootOperation);
    
    // Flatten the tree for hierarchical display (depth-first traversal)
    function flattenTree(operation, result = []) {
        result.push(operation);
        operation.children.forEach(child => flattenTree(child, result));
        return result;
    }
    
    planData.hierarchicalOperations = flattenTree(selectNode);
    
    // Sort by cost for top operations (exclude SELECT node)
    planData.topOperations = [...planData.operations]
        .filter(op => op.physicalOp !== 'SELECT')
        .sort((a, b) => b.estimatedCost - a.estimatedCost)
        .slice(0, 20);
    
    return planData;
}

function displayQueryPlanGraphical(planData) {
    const queryPlanContent = document.getElementById('queryPlanContent');
    
    if (!planData || !planData.hierarchicalOperations || planData.hierarchicalOperations.length === 0) {
        queryPlanContent.innerHTML = '<div class="no-results">No query plan available</div>';
        return;
    }
    
    // Clear previous content
    queryPlanContent.innerHTML = '';
    
    // Node dimensions
    const nodeWidth = 180;
    const nodeHeight = 100;
    const horizontalSpacing = 60;
    const verticalSpacing = 40;
    
    // Create D3 hierarchy from our data
    const root = d3.hierarchy(convertToHierarchy(planData.hierarchicalOperations[0]), d => d.children);
    
    // Custom left-to-right layout
    let nodeId = 0;
    root.eachBefore(node => {
        node.id = nodeId++;
    });
    
    function calculateLayout(node, x = 0, y = 0) {
        node.x = x;
        node.y = y;
        
        if (node.children) {
            if (node.children.length === 1) {
                calculateLayout(node.children[0], x + nodeWidth + horizontalSpacing, y);
            } else {
                const totalHeight = (node.children.length - 1) * (nodeHeight + verticalSpacing);
                let currentY = y - totalHeight / 2;
                
                node.children.forEach(child => {
                    calculateLayout(child, x + nodeWidth + horizontalSpacing, currentY);
                    currentY += nodeHeight + verticalSpacing;
                });
            }
        }
    }
    
    calculateLayout(root);
    
    // Calculate bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    root.each(node => {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x + nodeWidth);
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y + nodeHeight);
    });
    
    const padding = 40;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;
    
    const svg = d3.select(queryPlanContent)
        .append('svg')
        .attr('class', 'query-plan-svg')
        .attr('width', '100%')
        .attr('height', Math.max(600, height))
        .attr('viewBox', [0, 0, width, height]);
    
    const g = svg.append('g')
        .attr('transform', `translate(${padding - minX}, ${padding - minY})`);
    
    // Draw links with arrows - data flows from right (children) to left (parent)
    const linkGroup = g.append('g').attr('class', 'links');
    
    root.each(node => {
        if (node.children) {
            const parentX = node.x;
            const parentY = node.y + nodeHeight / 2;
            
            if (node.children.length === 1) {
                // Single child - straight horizontal line with arrow at parent
                const child = node.children[0];
                const childX = child.x;
                const childY = child.y + nodeHeight / 2;
                
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', childX)
                    .attr('y1', childY)
                    .attr('x2', parentX + nodeWidth + 10)
                    .attr('y2', parentY);
                
                // Arrow pointing RIGHT to parent (only if not root)
                if (node.depth > 0) {
                    linkGroup.append('polygon')
                        .attr('class', 'arrow')
                        .attr('points', `${parentX + nodeWidth + 10},${parentY - 6} ${parentX + nodeWidth},${parentY} ${parentX + nodeWidth + 10},${parentY + 6}`)
                        .style('fill', 'var(--connection-color, #808080)');
                }
            } else {
                // Multiple children - branching with vertical connector
                // Branch point is in the middle between children and parent
                const firstChild = node.children[0];
                const branchX = (firstChild.x + parentX + nodeWidth) / 2;
                
                // Draw vertical line connecting all children
                const firstChildY = node.children[0].y + nodeHeight / 2;
                const lastChildY = node.children[node.children.length - 1].y + nodeHeight / 2;
                
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', branchX)
                    .attr('y1', firstChildY)
                    .attr('x2', branchX)
                    .attr('y2', lastChildY);
                
                // Draw horizontal line from branch point to parent
                linkGroup.append('line')
                    .attr('class', 'plan-link')
                    .attr('x1', branchX)
                    .attr('y1', parentY)
                    .attr('x2', parentX + nodeWidth + 10)
                    .attr('y2', parentY);
                
                // Arrow pointing RIGHT to parent (only if not root)
                if (node.depth > 0) {
                    linkGroup.append('polygon')
                        .attr('class', 'arrow')
                        .attr('points', `${parentX + nodeWidth + 10},${parentY - 6} ${parentX + nodeWidth},${parentY} ${parentX + nodeWidth + 10},${parentY + 6}`)
                        .style('fill', 'var(--connection-color, #808080)');
                }
                
                // Draw horizontal lines from each child to branch point
                node.children.forEach(child => {
                    const childX = child.x;
                    const childY = child.y + nodeHeight / 2;
                    
                    linkGroup.append('line')
                        .attr('class', 'plan-link')
                        .attr('x1', childX)
                        .attr('y1', childY)
                        .attr('x2', branchX)
                        .attr('y2', childY);
                });
            }
        }
    });
    
    // Create nodes
    const nodes = g.append('g').attr('class', 'nodes')
        .selectAll('.plan-node')
        .data(root.descendants())
        .join('g')
        .attr('class', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            return `plan-node ${costPercent > 10 ? 'high-cost' : ''}`;
        })
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .on('click', function(event, d) {
            event.stopPropagation();
            
            const isSelected = d3.select(this).classed('selected');
            
            if (isSelected) {
                // Unclick - remove selection and hide tooltip
                g.selectAll('.plan-node').classed('selected', false);
                g.selectAll('.node-selection-outline').style('stroke', 'transparent');
                hideTooltip();
            } else {
                // Click - remove other selections, select this node, show tooltip
                g.selectAll('.plan-node').classed('selected', false);
                g.selectAll('.node-selection-outline').style('stroke', 'transparent');
                d3.select(this).classed('selected', true);
                d3.select(this).select('.node-selection-outline')
                    .style('stroke', 'var(--vscode-button-background)');
                showTooltip(event, d.data);
            }
        });
    
    // Add main rectangles for nodes
    nodes.append('rect')
        .attr('class', 'node-main-rect')
        .attr('width', nodeWidth)
        .attr('height', nodeHeight)
        .attr('rx', 4)
        .style('fill', 'var(--vscode-input-background)')
        .style('stroke', 'var(--vscode-panel-border)')
        .style('stroke-width', 1);
    
    // Add selection outline (dashed border on entire node)
    nodes.append('rect')
        .attr('class', 'node-selection-outline')
        .attr('width', nodeWidth)
        .attr('height', nodeHeight)
        .attr('rx', 4)
        .style('fill', 'none')
        .style('stroke', 'transparent')
        .style('stroke-width', 3)
        .style('stroke-dasharray', '5,5')
        .style('pointer-events', 'none');
    
    // Add operation name
    nodes.append('text')
        .attr('class', 'node-title')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 30)
        .style('fill', 'var(--vscode-editor-foreground)')
        .style('font-size', '12px')
        .style('font-weight', '600')
        .text(d => d.data.physicalOp);
    
    // Add subtitle if exists (table/index name)
    nodes.filter(d => d.data.details && (d.data.details.table || d.data.details.index))
        .append('text')
        .attr('class', 'node-subtitle')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 45)
        .style('fill', '#858585')
        .style('font-size', '10px')
        .text(d => {
            const table = d.data.details.table ? `[${d.data.details.schema || 'dbo'}].[${d.data.details.table}]` : '';
            const index = d.data.details.index ? `[${d.data.details.index}]` : '';
            const text = table + (index ? ' ' + index : '');
            return text.length > 30 ? text.substring(0, 27) + '...' : text;
        });
    
    // Add cost percentage badge
    nodes.append('rect')
        .attr('class', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            return costPercent >= 50 ? 'cost-badge high' : costPercent >= 10 ? 'cost-badge medium' : 'cost-badge low';
        })
        .attr('x', nodeWidth / 2 - 20)
        .attr('y', 60)
        .attr('width', 40)
        .attr('height', 18)
        .attr('rx', 9)
        .style('fill', d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100) : 0;
            if (costPercent >= 50) return '#d73027';
            if (costPercent >= 10) return '#fc8d59';
            return '#4575b4';
        });
    
    nodes.append('text')
        .attr('class', 'cost-text')
        .attr('text-anchor', 'middle')
        .attr('x', nodeWidth / 2)
        .attr('y', 73)
        .style('fill', '#ffffff')
        .style('font-size', '10px')
        .style('font-weight', '600')
        .text(d => {
            const costPercent = planData.totalCost > 0 ? ((d.data.estimatedCost / planData.totalCost) * 100).toFixed(0) : 0;
            return `${costPercent}%`;
        });
    
    // Add row count in bottom right
    nodes.append('text')
        .attr('class', 'row-count')
        .attr('text-anchor', 'end')
        .attr('x', nodeWidth - 10)
        .attr('y', nodeHeight - 10)
        .style('fill', '#858585')
        .style('font-size', '11px')
        .text(d => d.data.estimatedRows.toLocaleString());
    
    // Add zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => {
            g.attr('transform', `translate(${padding - minX}, ${padding - minY}) ${event.transform}`);
        });
    
    svg.call(zoom);
    
    // Click outside to deselect and hide tooltip
    queryPlanContent.addEventListener('click', function(event) {
        if (event.target === queryPlanContent || event.target.tagName === 'svg') {
            g.selectAll('.plan-node').classed('selected', false);
            hideTooltip();
        }
    });
    
    // Create tooltip element
    let tooltip = d3.select('body').select('.plan-tooltip');
    if (tooltip.empty()) {
        tooltip = d3.select('body')
            .append('div')
            .attr('class', 'plan-tooltip')
            .style('display', 'none')
            .style('position', 'fixed');
    }
    
    function showTooltip(event, operation) {
        let html = `<h4>${operation.physicalOp}</h4>`;
        html += '<div class="plan-tooltip-grid">';
        
        html += `<div class="plan-tooltip-label">Logical Op:</div><div class="plan-tooltip-value">${operation.logicalOp}</div>`;
        html += `<div class="plan-tooltip-label">Est. Cost:</div><div class="plan-tooltip-value">${operation.estimatedCost.toFixed(4)}</div>`;
        html += `<div class="plan-tooltip-label">Est. Subtree:</div><div class="plan-tooltip-value">${operation.estimatedSubtreeCost.toFixed(4)}</div>`;
        html += `<div class="plan-tooltip-label">Est. Rows:</div><div class="plan-tooltip-value">${operation.estimatedRows.toLocaleString()}</div>`;
        html += `<div class="plan-tooltip-label">Est. Executions:</div><div class="plan-tooltip-value">${operation.estimatedExecutions}</div>`;
        html += `<div class="plan-tooltip-label">Est. CPU:</div><div class="plan-tooltip-value">${operation.estimatedCPU.toFixed(6)}</div>`;
        html += `<div class="plan-tooltip-label">Est. I/O:</div><div class="plan-tooltip-value">${operation.estimatedIO.toFixed(6)}</div>`;
        html += `<div class="plan-tooltip-label">Avg Row Size:</div><div class="plan-tooltip-value">${operation.avgRowSize} bytes</div>`;
        
        if (operation.actualRows > 0) {
            html += `<div class="plan-tooltip-label">Actual Rows:</div><div class="plan-tooltip-value">${operation.actualRows.toLocaleString()}</div>`;
            html += `<div class="plan-tooltip-label">Actual Executions:</div><div class="plan-tooltip-value">${operation.actualExecutions}</div>`;
        }
        
        if (operation.details.table) {
            html += `<div class="plan-tooltip-label">Object:</div><div class="plan-tooltip-value">${operation.details.schema}.${operation.details.table}</div>`;
        }
        if (operation.details.index) {
            html += `<div class="plan-tooltip-label">Index:</div><div class="plan-tooltip-value">${operation.details.index}</div>`;
        }
        
        html += '</div>';
        
        tooltip
            .html(html)
            .style('display', 'block');
        
        // Position tooltip next to the node
        positionTooltip(event);
    }
    
    function positionTooltip(event) {
        const tooltipNode = tooltip.node();
        const tooltipWidth = 400;
        const tooltipHeight = tooltipNode.offsetHeight;
        
        // Get the clicked element's position
        const nodeRect = event.target.closest('g').getBoundingClientRect();
        
        let left = nodeRect.right + 15;
        let top = nodeRect.top;
        
        // Keep tooltip on screen - if it would go off right edge, put it on left side
        if (left + tooltipWidth > window.innerWidth) {
            left = nodeRect.left - tooltipWidth - 15;
        }
        
        // If still off screen on left, just position with some margin
        if (left < 0) {
            left = nodeRect.right + 15;
        }
        
        // Adjust vertical position if needed
        if (top + tooltipHeight > window.innerHeight) {
            top = window.innerHeight - tooltipHeight - 10;
        }
        if (top < 0) {
            top = 10;
        }
        
        tooltip
            .style('left', left + 'px')
            .style('top', top + 'px');
    }
    
    function hideTooltip() {
        tooltip.style('display', 'none');
    }
}

// Helper function to convert flat hierarchical array to nested tree structure
function convertToHierarchy(rootOp) {
    if (!rootOp) return null;
    
    return {
        ...rootOp,
        children: rootOp.children && rootOp.children.length > 0 
            ? rootOp.children.map(child => convertToHierarchy(child))
            : undefined
    };
}

function displayPlanTree(planData) {
    const planTreeContent = document.getElementById('planTreeContent');
    
    if (!planData || !planData.hierarchicalOperations || planData.hierarchicalOperations.length === 0) {
        planTreeContent.innerHTML = '<div class="no-results">No plan tree available</div>';
        return;
    }
    
    let html = '<table class="plan-tree-table">';
    html += '<thead><tr>';
    html += '<th>Operation</th>';
    html += '<th>Estimated Cost %</th>';
    html += '<th>Estimated Subtree Cost</th>';
    html += '<th>Estimated Rows</th>';
    html += '<th>Average Row Size</th>';
    html += '<th>Estimated CPU Cost</th>';
    html += '<th>Estimated I/O Cost</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    planData.hierarchicalOperations.forEach((op) => {
        const costPercent = planData.totalCost > 0 ? ((op.estimatedCost / planData.totalCost) * 100).toFixed(0) : 0;
        const indentPixels = op.level * 24; // 24 pixels per level
        
        html += '<tr>';
        html += `<td><span class="plan-tree-indent" style="display: inline-block; width: ${indentPixels}px;"></span>${op.physicalOp}</td>`;
        html += `<td>${costPercent}%</td>`;
        html += `<td>${op.estimatedSubtreeCost.toFixed(4)}</td>`;
        html += `<td>${op.estimatedRows.toLocaleString()}</td>`;
        html += `<td>${op.avgRowSize}</td>`;
        html += `<td>${op.estimatedCPU.toFixed(6)}</td>`;
        html += `<td>${op.estimatedIO.toFixed(6)}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    planTreeContent.innerHTML = html;
}

function displayOperationDetails(operation) {
    const detailsPanel = document.getElementById('planDetailsPanel');
    
    let html = `<h3>Operation Details: ${operation.physicalOp}</h3>`;
    html += '<div class="plan-details-grid">';
    
    html += `<div class="plan-details-label">Physical Operation:</div><div class="plan-details-value">${operation.physicalOp}</div>`;
    html += `<div class="plan-details-label">Logical Operation:</div><div class="plan-details-value">${operation.logicalOp}</div>`;
    html += `<div class="plan-details-label">Estimated Cost:</div><div class="plan-details-value">${operation.estimatedCost.toFixed(4)}</div>`;
    html += `<div class="plan-details-label">Estimated Subtree Cost:</div><div class="plan-details-value">${operation.estimatedSubtreeCost.toFixed(4)}</div>`;
    html += `<div class="plan-details-label">Estimated Rows:</div><div class="plan-details-value">${operation.estimatedRows.toLocaleString()}</div>`;
    html += `<div class="plan-details-label">Estimated Executions:</div><div class="plan-details-value">${operation.estimatedExecutions}</div>`;
    html += `<div class="plan-details-label">Estimated CPU Cost:</div><div class="plan-details-value">${operation.estimatedCPU.toFixed(6)}</div>`;
    html += `<div class="plan-details-label">Estimated I/O Cost:</div><div class="plan-details-value">${operation.estimatedIO.toFixed(6)}</div>`;
    html += `<div class="plan-details-label">Average Row Size:</div><div class="plan-details-value">${operation.avgRowSize} bytes</div>`;
    
    if (operation.actualRows > 0) {
        html += `<div class="plan-details-label">Actual Rows:</div><div class="plan-details-value">${operation.actualRows.toLocaleString()}</div>`;
        html += `<div class="plan-details-label">Actual Executions:</div><div class="plan-details-value">${operation.actualExecutions}</div>`;
    }
    
    if (operation.details.table) {
        html += `<div class="plan-details-label">Object:</div><div class="plan-details-value">${operation.details.schema}.${operation.details.table}</div>`;
    }
    if (operation.details.index) {
        html += `<div class="plan-details-label">Index:</div><div class="plan-details-value">${operation.details.index}</div>`;
    }
    
    html += '</div>';
    
    detailsPanel.innerHTML = html;
    detailsPanel.style.display = 'block';
}

function displayTopOperations(planData) {
    const topOperationsContent = document.getElementById('topOperationsContent');
    
    if (!planData || !planData.topOperations || planData.topOperations.length === 0) {
        topOperationsContent.innerHTML = '<div class="no-results">No operations available</div>';
        return;
    }
    
    let html = '<table class="top-operations-table">';
    html += '<thead><tr>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'operation\')">Operation</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'cost\')">Estimated Cost %</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'subtreeCost\')">Estimated Subtree Cost</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'rows\')">Estimated Rows</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'executions\')">Estimated Executions</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'cpu\')">Estimated CPU Cost</th>';
    html += '<th class="sortable-header" onclick="sortTopOperations(\'io\')">Estimated I/O Cost</th>';
    html += '<th>Object</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    planData.topOperations.forEach(op => {
        const costPercent = planData.totalCost > 0 ? ((op.estimatedCost / planData.totalCost) * 100).toFixed(1) : 0;
        const objectName = op.details.table ? `${op.details.schema}.${op.details.table}` : '-';
        
        html += '<tr>';
        html += `<td>${op.physicalOp}</td>`;
        html += `<td>${costPercent}%</td>`;
        html += `<td>${op.estimatedSubtreeCost.toFixed(4)}</td>`;
        html += `<td>${op.estimatedRows.toLocaleString()}</td>`;
        html += `<td>${op.estimatedExecutions}</td>`;
        html += `<td>${op.estimatedCPU.toFixed(6)}</td>`;
        html += `<td>${op.estimatedIO.toFixed(6)}</td>`;
        html += `<td>${objectName}</td>`;
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    topOperationsContent.innerHTML = html;
}

function selectPlanNode(opId) {
    // Remove previous selection
    document.querySelectorAll('.plan-node.selected').forEach(node => {
        node.classList.remove('selected');
    });
    
    // Select new node
    const node = document.querySelector(`.plan-node[data-op-id="${opId}"]`);
    if (node) {
        node.classList.add('selected');
    }
    
    // Show details - find operation in hierarchicalOperations
    let operation = null;
    if (currentQueryPlan && currentQueryPlan.hierarchicalOperations) {
        operation = currentQueryPlan.hierarchicalOperations.find(op => op.id === opId);
    } else if (currentQueryPlan && currentQueryPlan.operations) {
        operation = currentQueryPlan.operations.find(op => op.id === opId);
    }
    
    if (operation) {
        displayOperationDetails(operation);
    }
}

// Make selectPlanNode available globally
window.selectPlanNode = selectPlanNode;

// Sorting function for top operations (simple implementation)
window.sortTopOperations = function(column) {
    // This is a placeholder - in a full implementation, you would re-sort and re-render
    console.log('Sort by:', column);
};

// Make pending changes functions available globally
window.revertAllChanges = revertAllChanges;
window.commitAllChanges = commitAllChanges;
window.previewUpdateStatements = previewUpdateStatements;
window.revertChange = revertChange;

// ===== EDITABLE RESULT SETS FUNCTIONS =====

/**
 * Enter edit mode for a cell
 */
function enterEditMode(tdElement, rowData, columnDef, rowIndex, columnIndex, data, columnDefs, containerEl, resultSetIndex, metadata) {
    // Don't allow editing if already editing another cell
    if (currentEditingCell) {
        exitEditMode(false);
    }

    const columnName = columnDef.field;
    const currentValue = rowData[columnName];
    
    // Find column metadata
    const colMetadata = metadata.columns.find(c => c.name === columnName);
    if (!colMetadata) {
        console.log('[EDIT] No metadata found for column', columnName);
        return;
    }

    // Don't allow editing identity columns or columns without source table
    if (colMetadata.isIdentity) {
        console.warn('Cannot edit identity column:', columnName);
        return;
    }

    // Store editing state
    currentEditingCell = {
        tdElement,
        rowData,
        columnDef,
        rowIndex,
        columnIndex,
        data,
        columnDefs,
        containerEl,
        resultSetIndex,
        metadata,
        originalValue: currentValue
    };

    // Clear cell content and add edit border to cell
    tdElement.textContent = '';
    tdElement.style.border = '1px solid rgba(255, 143, 0, 0.5)';

    // Create input element based on column type
    let inputElement;
    const colType = colMetadata.type.toLowerCase();
    
    // Only use textarea for very long text types, not for regular varchar/char
    if (colType === 'text' || colType === 'ntext' || colType === 'xml') {
        // Multi-line text
        inputElement = document.createElement('textarea');
        inputElement.rows = 3;
        inputElement.style.resize = 'vertical';
    } else {
        // Single-line input for everything else (including varchar, char, etc.)
        inputElement = document.createElement('input');
        inputElement.type = 'text';
        
        if (colType.includes('int') || colType.includes('numeric') || colType.includes('decimal') || colType.includes('float') || colType.includes('money')) {
            inputElement.type = 'text'; // Keep as text for better control
            inputElement.pattern = '-?[0-9]*\\.?[0-9]*';
        } else if (colType.includes('date') || colType.includes('time')) {
            inputElement.type = 'text'; // Keep as text to allow formats like 'NULL'
        } else if (colType === 'bit') {
            inputElement.type = 'checkbox';
            inputElement.checked = currentValue === true || currentValue === 1;
        }
    }

    // Style the input to look like normal cell content
    inputElement.style.width = '100%';
    inputElement.style.height = '100%';
    inputElement.style.border = 'none';
    inputElement.style.outline = 'none';
    inputElement.style.background = 'transparent';
    inputElement.style.color = 'inherit';
    inputElement.style.padding = '0';
    inputElement.style.margin = '0';
    inputElement.style.fontFamily = 'inherit';
    inputElement.style.fontSize = 'inherit';
    inputElement.style.boxSizing = 'border-box';

    // Set current value (handle NULL)
    if (inputElement.type !== 'checkbox') {
        if (currentValue === null || currentValue === undefined) {
            inputElement.value = '';
            inputElement.placeholder = 'NULL';
        } else {
            inputElement.value = String(currentValue);
        }
    }

    // Add to cell
    tdElement.appendChild(inputElement);
    inputElement.focus();
    
    // Select text for easy replacement
    if (inputElement.select) {
        inputElement.select();
    }

    // Handle keyboard events
    inputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            exitEditMode(true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            exitEditMode(false);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            exitEditMode(true);
            // TODO: Move to next editable cell
        }
    });

    // Handle blur (clicking outside)
    inputElement.addEventListener('blur', () => {
        setTimeout(() => {
            if (currentEditingCell && currentEditingCell.tdElement === tdElement) {
                exitEditMode(true);
            }
        }, 100);
    });
}

/**
 * Exit edit mode and optionally save changes
 */
function exitEditMode(saveChanges) {
    if (!currentEditingCell) return;

    const {
        tdElement,
        rowData,
        columnDef,
        rowIndex,
        columnIndex,
        data,
        columnDefs,
        containerEl,
        resultSetIndex,
        metadata,
        originalValue
    } = currentEditingCell;

    const inputElement = tdElement.querySelector('input, textarea');
    if (!inputElement) {
        currentEditingCell = null;
        return;
    }

    let newValue;
    if (inputElement.type === 'checkbox') {
        newValue = inputElement.checked ? 1 : 0;
    } else {
        const rawValue = inputElement.value.trim();
        // Handle NULL
        if (rawValue === '' || rawValue.toUpperCase() === 'NULL') {
            newValue = null;
        } else {
            newValue = rawValue;
        }
    }

    // Remove input and restore cell
    tdElement.removeChild(inputElement);
    tdElement.style.border = '';

    // Normalize values for comparison
    let normalizedOriginal = originalValue;
    let normalizedNew = newValue;
    
    // Convert boolean to number (for bit type)
    if (typeof originalValue === 'boolean') {
        normalizedOriginal = originalValue ? 1 : 0;
    }
    
    // Convert string to number if original was a number (for numeric types)
    if (typeof originalValue === 'number' && typeof newValue === 'string' && newValue !== '') {
        const numValue = Number(newValue);
        if (!isNaN(numValue)) {
            normalizedNew = numValue;
        }
    }

    if (saveChanges && normalizedNew !== normalizedOriginal) {
        // Value changed - record the change
        recordChange(resultSetIndex, rowIndex, columnDef.field, originalValue, newValue, rowData, metadata);
        
        // Update the data
        rowData[columnDef.field] = newValue;
        
        // Mark cell as modified
        tdElement.classList.add('cell-modified');
    }

    // Restore cell display
    const value = rowData[columnDef.field];
    if (value === null || value === undefined) {
        tdElement.textContent = 'NULL';
        tdElement.style.color = 'var(--vscode-descriptionForeground)';
        tdElement.style.fontStyle = 'italic';
    } else if (columnDef.type === 'boolean' || typeof value === 'boolean') {
        tdElement.textContent = value ? '✓' : '✗';
        tdElement.style.color = '';
        tdElement.style.fontStyle = '';
    } else if (columnDef.type === 'number' || typeof value === 'number') {
        tdElement.textContent = typeof value === 'number' ? value.toLocaleString() : value;
        tdElement.style.textAlign = 'right';
        tdElement.style.color = '';
        tdElement.style.fontStyle = '';
    } else {
        tdElement.textContent = String(value);
        tdElement.style.color = '';
        tdElement.style.fontStyle = '';
    }

    currentEditingCell = null;
}

/**
 * Record a cell change in pending changes
 */
function recordChange(resultSetIndex, rowIndex, columnName, oldValue, newValue, rowData, metadata) {
    console.log('[EDIT] Recording change:', { resultSetIndex, rowIndex, columnName, oldValue, newValue });

    // Get or create change list for this result set
    if (!pendingChanges.has(resultSetIndex)) {
        pendingChanges.set(resultSetIndex, []);
    }
    const changes = pendingChanges.get(resultSetIndex);

    // Find column metadata first to know the source table
    const colMetadata = metadata.columns.find(c => c.name === columnName);
    
    if (!colMetadata || !colMetadata.sourceTable) {
        console.error('[EDIT] Cannot record change - no source table for column:', columnName);
        return;
    }

    // Extract primary key values for WHERE clause - only for the source table of this column
    const primaryKeyValues = {};
    metadata.primaryKeyColumns.forEach(pkCol => {
        // Find the column metadata for this primary key
        const pkColMetadata = metadata.columns.find(c => c.name === pkCol);
        
        // Only include primary keys that belong to the same table as the edited column
        if (pkColMetadata && 
            pkColMetadata.sourceTable === colMetadata.sourceTable && 
            pkColMetadata.sourceSchema === colMetadata.sourceSchema) {
            primaryKeyValues[pkCol] = rowData[pkCol];
        }
    });

    // Check if we already have a change for this cell
    const existingChangeIndex = changes.findIndex(
        c => c.rowIndex === rowIndex && c.columnName === columnName
    );

    const changeRecord = {
        rowIndex,
        columnName,
        oldValue: existingChangeIndex >= 0 ? changes[existingChangeIndex].oldValue : oldValue,
        newValue,
        primaryKeyValues,
        sourceTable: colMetadata?.sourceTable,
        sourceSchema: colMetadata?.sourceSchema,
        sourceColumn: colMetadata?.sourceColumn || columnName
    };

    if (existingChangeIndex >= 0) {
        // Update existing change
        if (changeRecord.oldValue === newValue) {
            // Value reverted to original - remove change
            changes.splice(existingChangeIndex, 1);
            console.log('[EDIT] Change reverted to original, removed from pending');
        } else {
            // Update with new value
            changes[existingChangeIndex] = changeRecord;
            console.log('[EDIT] Updated existing change');
        }
    } else {
        // Add new change
        changes.push(changeRecord);
        console.log('[EDIT] Added new change to pending');
    }

    // Update pending changes tab badge
    updatePendingChangesCount();
    
    // Re-render pending changes if currently viewing
    if (currentTab === 'pendingChanges') {
        renderPendingChanges();
    }
}

/**
 * Record a row deletion in pending changes
 */
function recordRowDeletion(resultSetIndex, rowIndex, rowData, metadata) {
    console.log('[EDIT] Recording row deletion:', { resultSetIndex, rowIndex, rowData });

    // Get or create change list for this result set
    if (!pendingChanges.has(resultSetIndex)) {
        pendingChanges.set(resultSetIndex, []);
    }
    const changes = pendingChanges.get(resultSetIndex);

    // Extract primary key values for WHERE clause
    const primaryKeyValues = {};
    metadata.primaryKeyColumns.forEach(pkCol => {
        const pkColMetadata = metadata.columns.find(c => c.name === pkCol);
        if (pkColMetadata) {
            primaryKeyValues[pkCol] = rowData[pkCol];
        }
    });

    // Get table info from first column (all columns should be from same table in single-table query)
    const firstCol = metadata.columns[0];
    
    const deleteRecord = {
        type: 'DELETE',
        rowIndex,
        primaryKeyValues,
        sourceTable: firstCol.sourceTable,
        sourceSchema: firstCol.sourceSchema,
        rowData: { ...rowData } // Store copy of row data for display
    };

    // Check if this row already has a delete pending
    const existingDeleteIndex = changes.findIndex(
        c => c.type === 'DELETE' && c.rowIndex === rowIndex
    );

    if (existingDeleteIndex >= 0) {
        console.log('[EDIT] Row already marked for deletion');
        return;
    }

    // Add delete record
    changes.push(deleteRecord);
    console.log('[EDIT] Added row deletion to pending');

    // Update pending changes tab badge
    updatePendingChangesCount();
    renderPendingChanges();
}

/**
 * Mark a row visually as marked for deletion
 */
function markRowForDeletion(table, rowIndex) {
    const tbody = table.querySelector('.ag-grid-tbody');
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr');
    if (rowIndex < rows.length) {
        const row = rows[rowIndex];
        row.classList.add('row-marked-for-deletion');
        
        // Also mark all cells in the row
        row.querySelectorAll('td').forEach(cell => {
            cell.style.backgroundColor = 'rgba(244, 135, 113, 0.2)';
            cell.style.textDecoration = 'line-through';
            cell.style.color = 'var(--vscode-descriptionForeground)';
        });
    }
}

/**
 * Remove visual deletion marking from a row
 */
function unmarkRowForDeletion(table, rowIndex) {
    const tbody = table.querySelector('.ag-grid-tbody');
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr');
    if (rowIndex < rows.length) {
        const row = rows[rowIndex];
        row.classList.remove('row-marked-for-deletion');
        
        // Reset all cells in the row to normal styling
        row.querySelectorAll('td').forEach(cell => {
            cell.style.backgroundColor = '';
            cell.style.textDecoration = '';
            cell.style.color = '';
        });
    }
}

/**
 * Refresh the display of a specific result set table
 */
function refreshResultSetTable(resultSetIndex) {
    if (!lastResults || !lastResults[resultSetIndex]) {
        console.warn(`[REFRESH] No data for result set ${resultSetIndex}`);
        return;
    }

    const resultSetContainers = document.querySelectorAll('.result-set-container');
    if (resultSetIndex >= resultSetContainers.length) {
        console.warn(`[REFRESH] Result set container ${resultSetIndex} not found`);
        return;
    }

    const container = resultSetContainers[resultSetIndex];
    const tableContainer = container.querySelector('.result-set-table');
    
    if (!tableContainer) {
        console.warn(`[REFRESH] Table container not found for result set ${resultSetIndex}`);
        return;
    }

    console.log(`[REFRESH] Refreshing result set ${resultSetIndex} with ${lastResults[resultSetIndex].length} rows`);
    
    // Determine if single result set mode
    const isSingleResultSet = lastResults.length === 1 && !currentQueryPlan;
    
    // Re-initialize the table with updated data
    const metadata = resultSetMetadata[resultSetIndex];
    initAgGridTable(lastResults[resultSetIndex], tableContainer, isSingleResultSet, resultSetIndex, metadata);
}

/**
/**
 * Update the pending changes count badge
 */
function updatePendingChangesCount() {
    let totalChanges = 0;
    pendingChanges.forEach(changes => {
        totalChanges += changes.length;
    });

    console.log('[EDIT] Total pending changes:', totalChanges);

    // Update tab badge
    const badge = document.getElementById('pendingChangesCount');
    const tab = document.querySelector('[data-tab="pendingChanges"]');
    
    if (badge) {
        badge.textContent = totalChanges;
        badge.style.display = totalChanges > 0 ? 'inline-block' : 'none';
    }
    
    if (tab) {
        if (totalChanges > 0) {
            tab.style.display = '';
        } else {
            tab.style.display = 'none';
            // If currently viewing pending changes tab, switch to results
            if (currentTab === 'pendingChanges') {
                switchTab('results');
            }
        }
    }
    
    // Update quick save button
    updateQuickSaveButton();
}

function renderPendingChanges() {
    const container = document.getElementById('pendingChangesContent');
    if (!container) return;

    const totalChanges = Array.from(pendingChanges.values()).reduce((sum, changes) => sum + changes.length, 0);

    if (totalChanges === 0) {
        container.innerHTML = '<div class="no-pending-changes">No pending changes</div>';
        return;
    }

    let html = `
        <div class="pending-changes-header">
            <div class="pending-changes-title">${totalChanges} Pending Change${totalChanges !== 1 ? 's' : ''}</div>
            <div class="pending-changes-actions">
                <button onclick="previewUpdateStatements()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" /><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6" /></svg>
                    Preview SQL
                </button>
                <button class="secondary" onclick="revertAllChanges()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" /><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" /></svg>
                    Revert All
                </button>
                <button onclick="commitAllChanges()">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 12l5 5l10 -10" /></svg>
                    Commit All
                </button>
            </div>
        </div>
        <div class="pending-changes-list">
    `;

    pendingChanges.forEach((changes, resultSetIndex) => {
        const metadata = resultSetMetadata[resultSetIndex];
        
        changes.forEach((change, changeIndex) => {
            const { type, rowIndex, columnName, oldValue, newValue, sourceTable, sourceSchema } = change;
            
            const tableName = sourceSchema ? `${sourceSchema}.${sourceTable}` : sourceTable;
            
            let sql = '';
            try {
                sql = generateUpdateStatement(change, metadata);
            } catch (error) {
                sql = `-- Error: ${error.message}`;
            }
            
            // Handle DELETE display differently
            if (type === 'DELETE') {
                html += `
                    <div class="change-item change-item-delete">
                        <div class="change-header">
                            <div class="change-location">🗑️ ${tableName} (Row ${rowIndex + 1}) - DELETE</div>
                            <button class="change-revert" onclick="revertChange(${resultSetIndex}, ${changeIndex})">Revert</button>
                        </div>
                        <div class="change-sql">${escapeHtml(sql)}</div>
                    </div>
                `;
            } else {
                // UPDATE display
                // Normalize boolean values to 0/1 for display
                const normalizeValue = (val) => {
                    if (val === null || val === undefined) return 'NULL';
                    if (typeof val === 'boolean') return val ? '1' : '0';
                    return String(val);
                };
                
                const oldDisplay = normalizeValue(oldValue);
                const newDisplay = normalizeValue(newValue);
                
                html += `
                    <div class="change-item">
                        <div class="change-header">
                            <div class="change-location">${tableName}.${columnName} (Row ${rowIndex + 1})</div>
                            <button class="change-revert" onclick="revertChange(${resultSetIndex}, ${changeIndex})">Revert</button>
                        </div>
                        <div class="change-details">
                            <div class="change-label">Old value:</div>
                            <div class="change-value change-value-old">${escapeHtml(oldDisplay)}</div>
                            <div class="change-label">New value:</div>
                            <div class="change-value change-value-new">${escapeHtml(newDisplay)}</div>
                        </div>
                        <div class="change-sql">${escapeHtml(sql)}</div>
                    </div>
                `;
            }
        });
    });

    html += '</div>';
    container.innerHTML = html;
}

/**
 * Revert a single change
 */
function revertChange(resultSetIndex, changeIndex) {
    const changes = pendingChanges.get(resultSetIndex);
    if (!changes || changeIndex >= changes.length) return;

    const change = changes[changeIndex];
    console.log(`[EDIT] Reverting single change: ${change.columnName || 'DELETE'} in row ${change.rowIndex}`);

    // Revert the data change
    if (change.type === 'DELETE') {
        // For DELETE, remove visual marking
        const table = document.querySelectorAll('.result-set-table .ag-grid-table')[resultSetIndex];
        if (table) {
            unmarkRowForDeletion(table, change.rowIndex);
        }
    } else {
        // For UPDATE, revert data value
        const data = lastResults && lastResults[resultSetIndex] ? lastResults[resultSetIndex] : null;
        if (data && data[change.rowIndex]) {
            console.log(`[EDIT] Reverting ${change.columnName} from ${data[change.rowIndex][change.columnName]} to ${change.oldValue}`);
            data[change.rowIndex][change.columnName] = change.oldValue;
            
            // Remove cell-modified class from the specific cell
            const tableContainer = document.querySelectorAll('.result-set-table')[resultSetIndex];
            if (tableContainer) {
                const table = tableContainer.querySelector('.ag-grid-table');
                if (table) {
                    const tbody = table.querySelector('.ag-grid-tbody');
                    const row = tbody?.querySelector(`tr[data-row-index="${change.rowIndex}"]`);
                    if (row) {
                        const cells = row.querySelectorAll('td');
                        // Find column index from columnDefs
                        const colDefs = Object.keys(data[change.rowIndex]);
                        const colIndex = colDefs.indexOf(change.columnName);
                        if (colIndex >= 0 && colIndex + 1 < cells.length) { // +1 because first cell is row number
                            cells[colIndex + 1].classList.remove('cell-modified');
                        }
                    }
                }
            }
            
            // Refresh the table display
            refreshResultSetTable(resultSetIndex);
        }
    }

    // Remove the change from pending list
    changes.splice(changeIndex, 1);
    
    // If no more changes for this result set, remove the key
    if (changes.length === 0) {
        pendingChanges.delete(resultSetIndex);
    }
    
    // Update UI
    updatePendingChangesCount();
    renderPendingChanges();
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

/**
 * Generate UPDATE statement for a change
 */
function generateUpdateStatement(change, metadata) {
    // Handle DELETE statements
    if (change.type === 'DELETE') {
        const { primaryKeyValues, sourceTable, sourceSchema } = change;
        
        if (!sourceTable) {
            throw new Error('Cannot generate DELETE: no source table');
        }

        const fullTableName = sourceSchema ? `[${sourceSchema}].[${sourceTable}]` : `[${sourceTable}]`;
        
        // Build WHERE clause with primary keys
        const whereConditions = Object.entries(primaryKeyValues).map(([pkCol, pkValue]) => {
            return `[${pkCol}] = ${sqlEscape(pkValue)}`;
        }).join(' AND ');

        if (!whereConditions) {
            throw new Error('Cannot generate DELETE: no primary key values');
        }

        return `DELETE FROM ${fullTableName} WHERE ${whereConditions};`;
    }
    
    // Handle UPDATE statements
    const { columnName, newValue, primaryKeyValues, sourceTable, sourceSchema, sourceColumn } = change;

    if (!sourceTable) {
        throw new Error(`Cannot generate UPDATE: column '${columnName}' has no source table`);
    }

    const fullTableName = sourceSchema ? `[${sourceSchema}].[${sourceTable}]` : `[${sourceTable}]`;
    
    // Build SET clause with proper escaping
    const setClause = `[${sourceColumn}] = ${sqlEscape(newValue)}`;
    
    // Build WHERE clause with primary keys
    const whereConditions = Object.entries(primaryKeyValues).map(([pkCol, pkValue]) => {
        return `[${pkCol}] = ${sqlEscape(pkValue)}`;
    }).join(' AND ');

    if (!whereConditions) {
        throw new Error('Cannot generate UPDATE: no primary key values');
    }

    return `UPDATE ${fullTableName} SET ${setClause} WHERE ${whereConditions};`;
}

/**
 * SQL escape value for use in queries
 */
function sqlEscape(value) {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    
    if (typeof value === 'number') {
        return String(value);
    }
    
    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }
    
    // String - escape single quotes and wrap in quotes
    const strValue = String(value);
    return `'${strValue.replace(/'/g, "''")}'`;
}

/**
 * Commit all pending changes to database
 */
function commitAllChanges() {
    if (pendingChanges.size === 0) {
        console.log('No pending changes to commit');
        return;
    }

    // Generate all UPDATE statements
    const updateStatements = [];
    
    try {
        pendingChanges.forEach((changes, resultSetIndex) => {
            const metadata = resultSetMetadata[resultSetIndex];
            
            changes.forEach(change => {
                const sql = generateUpdateStatement(change, metadata);
                updateStatements.push(sql);
            });
        });

        // Send to extension for execution in transaction
        let connectionId = currentConnectionId;
        if (currentConnectionId && currentDatabaseName) {
            connectionId = `${currentConnectionId}::${currentDatabaseName}`;
        }

        vscode.postMessage({
            type: 'commitChanges',
            statements: updateStatements,
            connectionId: connectionId,
            originalQuery: originalQuery
        });

    } catch (error) {
        console.error('Failed to generate UPDATE statements:', error);
    }
}

/**
 * Revert all pending changes
 */
function revertAllChanges() {
    if (pendingChanges.size === 0) {
        return;
    }

    const totalChanges = Array.from(pendingChanges.values()).reduce((sum, changes) => sum + changes.length, 0);
    
    // Use vscode modal instead of confirm (which is blocked in sandboxed webview)
    vscode.postMessage({
        type: 'confirmAction',
        message: `Revert all ${totalChanges} pending changes?`,
        action: 'revertAll'
    });
}

function executeRevertAll() {
    console.log('[EDIT] Executing revert all changes');
    
    // Store changes to revert before clearing
    const changesToRevert = new Map(pendingChanges);
    
    // Clear pending changes first
    pendingChanges.clear();
    
    // Revert data changes and refresh table displays
    changesToRevert.forEach((changes, resultSetIndex) => {
        console.log(`[EDIT] Reverting ${changes.length} changes for result set ${resultSetIndex}`);
        
        changes.forEach(change => {
            if (change.type === 'DELETE') {
                // For DELETE changes, just remove the visual deletion marking
                // The data is still there, we just need to unmark it
                const table = document.querySelectorAll('.result-set-table .ag-grid-table')[resultSetIndex];
                if (table) {
                    unmarkRowForDeletion(table, change.rowIndex);
                }
            } else {
                // For UPDATE changes, revert the data value
                const data = lastResults && lastResults[resultSetIndex] ? lastResults[resultSetIndex] : null;
                if (data && data[change.rowIndex]) {
                    console.log(`[EDIT] Reverting ${change.columnName} from ${data[change.rowIndex][change.columnName]} to ${change.oldValue}`);
                    data[change.rowIndex][change.columnName] = change.oldValue;
                }
            }
        });
        
        // Refresh the table display for this result set
        refreshResultSetTable(resultSetIndex);
    });
    
    // Remove all cell-modified classes
    document.querySelectorAll('.cell-modified').forEach(cell => {
        cell.classList.remove('cell-modified');
    });
    
    // Remove row deletion markings
    document.querySelectorAll('.row-marked-for-deletion').forEach(row => {
        row.classList.remove('row-marked-for-deletion');
        row.querySelectorAll('td').forEach(cell => {
            cell.style.backgroundColor = '';
            cell.style.textDecoration = '';
            cell.style.color = '';
        });
    });
    
    console.log('[EDIT] All changes reverted successfully');
    
    // Update UI
    updatePendingChangesCount();
    
    // Switch to results tab if currently on pending changes
    if (currentTab === 'pendingChanges') {
        document.querySelectorAll('.results-tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.results-tab[data-tab="results"]').classList.add('active');
        currentTab = 'results';
        
        document.getElementById('resultsContent').style.display = 'block';
        document.getElementById('messagesContent').style.display = 'none';
        document.getElementById('pendingChangesContent').style.display = 'none';
        document.getElementById('queryPlanContent').style.display = 'none';
        document.getElementById('planTreeContent').style.display = 'none';
        document.getElementById('topOperationsContent').style.display = 'none';
    }
}

/**
 * Show preview of UPDATE statements
 */
function previewUpdateStatements() {
    if (pendingChanges.size === 0) {
        return;
    }

    try {
        const updateStatements = [];
        
        pendingChanges.forEach((changes, resultSetIndex) => {
            const metadata = resultSetMetadata[resultSetIndex];
            
            changes.forEach(change => {
                const sql = generateUpdateStatement(change, metadata);
                updateStatements.push(sql);
            });
        });

        // Open in new editor
        const sqlContent = `-- Generated UPDATE statements\n-- ${updateStatements.length} statement(s)\n\nBEGIN TRANSACTION;\n\n${updateStatements.join('\n\n')}\n\nCOMMIT TRANSACTION;\n-- ROLLBACK TRANSACTION;`;
        
        openInNewEditor(sqlContent, 'sql');

    } catch (error) {
        console.error('Failed to generate preview:', error);
    }
}

/**
 * Update quick save button visibility and tooltip with UPDATE statements
 */
function updateQuickSaveButton() {
    const quickSaveButton = document.getElementById('quickSaveButton');
    const tooltip = document.getElementById('quickSaveTooltip');
    if (!quickSaveButton || !tooltip) return;
    
    const totalChanges = Array.from(pendingChanges.values()).reduce((sum, changes) => sum + changes.length, 0);
    
    if (totalChanges === 0) {
        quickSaveButton.style.display = 'none';
        return;
    }
    
    quickSaveButton.style.display = 'inline-flex';
    
    // Generate UPDATE statements for tooltip
    try {
        const updateStatements = [];
        
        pendingChanges.forEach((changes, resultSetIndex) => {
            const metadata = resultSetMetadata[resultSetIndex];
            
            changes.forEach(change => {
                // Only include UPDATE statements, skip DELETE
                if (change.type !== 'DELETE') {
                    const sql = generateUpdateStatement(change, metadata);
                    updateStatements.push(sql);
                }
            });
        });
        
        if (updateStatements.length === 0) {
            tooltip.textContent = 'Execute all changes\n\nNo UPDATE statements (only DELETE operations)';
        } else {
            const tooltipContent = `Execute ${updateStatements.length} UPDATE statement${updateStatements.length !== 1 ? 's' : ''}:\n\n${updateStatements.join('\n\n')}`;
            tooltip.textContent = tooltipContent;
        }
    } catch (error) {
        console.error('Failed to generate UPDATE statements for tooltip:', error);
        tooltip.textContent = 'Execute all changes';
    }
}

// Position tooltip on hover for fixed positioning
document.addEventListener('DOMContentLoaded', () => {
    const quickSaveButton = document.getElementById('quickSaveButton');
    const tooltip = document.getElementById('quickSaveTooltip');
    
    if (quickSaveButton && tooltip) {
        quickSaveButton.addEventListener('mouseenter', () => {
            const rect = quickSaveButton.getBoundingClientRect();
            tooltip.style.left = `${rect.left + rect.width / 2}px`;
            tooltip.style.top = `${rect.top - 8}px`;
            tooltip.style.transform = 'translate(-50%, -100%)';
        });
    }
});