/**
 * Built-in SQL Snippets
 * Port from snippets.js
 */

export interface SqlSnippet {
  name: string;
  prefix: string;
  body: string;
  description: string;
}

export const builtInSnippets: SqlSnippet[] = [
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
    body: "SELECT ${1:*} FROM [${2:dbo}].[${3:Table}] [${4:t}]${0}",
    description: "Basic SELECT statement"
  },
  {
    name: "SELECT with NOLOCK",
    prefix: "self",
    body: "SELECT * FROM [${1:dbo}].[${2:Table}] [t] WITH (NOLOCK)${0}",
    description: "SELECT with NOLOCK hint"
  },
  {
    name: "SELECT with NOLOCK",
    prefix: "nolock",
    body: "SELECT * FROM [${1:dbo}].[${2:Table}] [t] WITH (NOLOCK)${0}",
    description: "SELECT with NOLOCK hint"
  },
  {
    name: "SELECT TOP 1000",
    prefix: "top",
    body: "SELECT TOP (1000) ${1:*} FROM [${2:dbo}].[${3:Table}] [${4:t}]",
    description: "Quick preview"
  },
  {
    name: "COUNT(*)",
    prefix: "selc",
    body: "SELECT COUNT(*) FROM [${1:dbo}].[${2:Table}]${0}",
    description: "Count all records"
  },
  {
    name: "INSERT INTO",
    prefix: "ins",
    body: "INSERT INTO [${1:dbo}].[${2:Table}] ([${3:Column}]) VALUES (${4:value})${0}",
    description: "Basic INSERT statement"
  },
  {
    name: "INSERT SELECT",
    prefix: "insel",
    body: "INSERT INTO [${1:dbo}].[${2:Target}] ([${3:Columns}])\nSELECT [${4:Columns}] FROM [${5:dbo}].[${6:Source}]${0}",
    description: "INSERT with SELECT"
  },
  {
    name: "UPDATE",
    prefix: "upd",
    body: "UPDATE [${1:t}]\nSET [${1:t}].[${2:Column}] = ${3:value}\nFROM [${4:dbo}].[${5:Table}] [${1:t}]${6: WHERE <condition>}${0}",
    description: "UPDATE with FROM clause"
  },
  {
    name: "DELETE",
    prefix: "del",
    body: "DELETE FROM [${1:dbo}].[${2:Table}] WHERE ${3:Id = @Id}${0}",
    description: "Basic DELETE statement"
  },
  {
    name: "TRUNCATE TABLE",
    prefix: "trunc",
    body: "TRUNCATE TABLE [${1:dbo}].[${2:Table}]",
    description: "Truncate table (fast delete)"
  },
  {
    name: "MERGE",
    prefix: "merge",
    body: "MERGE [${1:dbo}].[${2:Target}] AS [t]\nUSING [${3:Source}] AS [s] ON [t].[${4:Key}] = [s].[${4:Key}]\nWHEN MATCHED THEN UPDATE SET [${5:t.Col}] = [${6:s.Col}]\nWHEN NOT MATCHED BY TARGET THEN INSERT ([${7:Cols}]) VALUES ([${8:s.Cols}])\nWHEN NOT MATCHED BY SOURCE THEN DELETE;\nGO",
    description: "MERGE statement (UPSERT)"
  },
  {
    name: "Common Table Expression",
    prefix: "cte",
    body: "WITH [${1:cteName}] AS (\n\t${2:-- query}\n)\nSELECT * FROM [${1:cteName}]${0}",
    description: "CTE (Common Table Expression)"
  },
  {
    name: "IF EXISTS",
    prefix: "exists",
    body: "IF EXISTS (SELECT 1 FROM [${1:dbo}].[${2:Table}] WHERE ${3:Id = @Id})\nBEGIN\n\t${0:-- code}\nEND",
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
    body: "-- Example external table (Azure SQL cross-database)\nCREATE EXTERNAL DATA SOURCE RemoteDb WITH (\n\tTYPE = RDBMS,\n\tLOCATION = 'server.database.windows.net',\n\tDATABASE_NAME = 'RemoteDb',\n\tCREDENTIAL = ElasticCredential\n);\nCREATE EXTERNAL TABLE dbo.${1:RemoteTable} (\n\t${2:Id} int\n) WITH (DATA_SOURCE = RemoteDb);",
    description: "Azure Elastic Query - External Table"
  },
  {
    name: "CETAS (Synapse/Fabric)",
    prefix: "cetas",
    body: "CREATE EXTERNAL TABLE ${1:ExternalTable}\nWITH (\n\tLOCATION = '${2:folder/file.parquet}',\n\tDATA_SOURCE = ${3:storage},\n\tFILE_FORMAT = ${4:ParquetFormat}\n) AS\nSELECT ${0:*} FROM ${5:SourceTable};",
    description: "CREATE EXTERNAL TABLE AS SELECT (Synapse/Fabric)"
  },
  {
    name: "Print Long String (>4000 chars)",
    prefix: "printlong",
    body: "DECLARE @i int = 1, @len int = LEN(@LongString);\nWHILE @i <= @len BEGIN\n\tPRINT SUBSTRING(@LongString, @i, 4000);\n\tSET @i += 4000;\nEND",
    description: "Print strings longer than 4000 characters"
  },
  {
    name: "WHILE Loop",
    prefix: "while",
    body: "DECLARE @i int = 0;\nWHILE @i < ${1:10}\nBEGIN\n\t${0:-- code}\n\tSET @i += 1;\nEND",
    description: "WHILE loop with counter"
  },
  {
    name: "CURSOR",
    prefix: "cursor",
    body: "DECLARE @${1:Id} int;\nDECLARE ${2:cur_name} CURSOR LOCAL FAST_FORWARD FOR\n\tSELECT ${1:Id} FROM ${3:dbo.Table};\n\nOPEN ${2:cur_name};\nFETCH NEXT FROM ${2:cur_name} INTO @${1:Id};\n\nWHILE @@FETCH_STATUS = 0\nBEGIN\n\t${0:-- process}\n\tFETCH NEXT FROM ${2:cur_name} INTO @${1:Id};\nEND\n\nCLOSE ${2:cur_name};\nDEALLOCATE ${2:cur_name};",
    description: "CURSOR pattern with FAST_FORWARD"
  },
  {
    name: "ROW_NUMBER",
    prefix: "rownum",
    body: "ROW_NUMBER() OVER (${1:PARTITION BY ${2:Column} }ORDER BY ${3:Id}) AS RowNum",
    description: "ROW_NUMBER window function"
  },
  {
    name: "RANK",
    prefix: "rank",
    body: "RANK() OVER (${1:PARTITION BY ${2:Column} }ORDER BY ${3:Value} DESC) AS Rank",
    description: "RANK window function"
  },
  {
    name: "LAG/LEAD",
    prefix: "lag",
    body: "LAG(${1:Column}, ${2:1}, ${3:NULL}) OVER (${4:PARTITION BY ${5:GroupCol} }ORDER BY ${6:OrderCol}) AS PrevValue",
    description: "LAG window function"
  },
  {
    name: "Running Total",
    prefix: "running",
    body: "SUM(${1:Amount}) OVER (${2:PARTITION BY ${3:GroupCol} }ORDER BY ${4:OrderCol} ROWS UNBOUNDED PRECEDING) AS RunningTotal",
    description: "Running total with window function"
  },
  {
    name: "PIVOT",
    prefix: "pivot",
    body: "SELECT ${1:*}\nFROM (\n\tSELECT ${2:RowCol}, ${3:PivotCol}, ${4:ValueCol}\n\tFROM ${5:SourceTable}\n) AS src\nPIVOT (\n\t${6:SUM}(${4:ValueCol}) FOR ${3:PivotCol} IN ([${7:Val1}], [${8:Val2}])\n) AS pvt;",
    description: "PIVOT query"
  },
  {
    name: "UNPIVOT",
    prefix: "unpivot",
    body: "SELECT ${1:Id}, ${2:Attribute}, ${3:Value}\nFROM ${4:SourceTable}\nUNPIVOT (\n\t${3:Value} FOR ${2:Attribute} IN ([${5:Col1}], [${6:Col2}])\n) AS unpvt;",
    description: "UNPIVOT query"
  },
  {
    name: "STRING_AGG",
    prefix: "stringagg",
    body: "STRING_AGG(${1:Column}, '${2:, }')${3: WITHIN GROUP (ORDER BY ${4:Column})}",
    description: "Concatenate values with separator"
  },
  {
    name: "CROSS APPLY",
    prefix: "crossapply",
    body: "CROSS APPLY (\n\tSELECT TOP 1 *\n\tFROM ${1:RelatedTable} r\n\tWHERE r.${2:ForeignKey} = ${3:t}.${4:PrimaryKey}\n\tORDER BY ${5:Column}\n) AS ${6:ca}",
    description: "CROSS APPLY for correlated subquery"
  },
  {
    name: "OUTER APPLY",
    prefix: "outerapply",
    body: "OUTER APPLY (\n\tSELECT TOP 1 *\n\tFROM ${1:RelatedTable} r\n\tWHERE r.${2:ForeignKey} = ${3:t}.${4:PrimaryKey}\n\tORDER BY ${5:Column}\n) AS ${6:oa}",
    description: "OUTER APPLY for optional correlated subquery"
  },
];

/**
 * Get all snippets (built-in + custom from extension)
 */
export function getAllSnippets(customSnippets: SqlSnippet[] = []): SqlSnippet[] {
  return [...builtInSnippets, ...customSnippets];
}
