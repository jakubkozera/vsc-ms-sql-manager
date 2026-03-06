import type { ColumnInfo, TableInfo, ForeignKeyInfo, DatabaseSchema } from '../types/schema';
import { extractTablesFromQuery, findTable, findTableForAlias, getColumnsForTable } from './sqlCompletionService';
import { extractCTEsWithColumns, type CteDefinition, type CteColumnInfo } from './sqlValidator';

export interface HoverResult {
  contents: { value: string }[];
  range: {
    startLineNumber: number;
    endLineNumber: number;
    startColumn: number;
    endColumn: number;
  };
}

function formatColumnType(col: ColumnInfo): string {
  let type = col.type;
  if (col.maxLength) {
    type += `(${col.maxLength === -1 ? 'max' : col.maxLength})`;
  } else if (col.precision && col.scale) {
    type += `(${col.precision},${col.scale})`;
  } else if (col.precision) {
    type += `(${col.precision})`;
  }
  return type;
}

/**
 * Render a table's columns as a markdown table.
 */
export function renderTableMarkdown(schemaName: string, tableName: string, cols: ColumnInfo[]): string {
  let md = `**${schemaName}.${tableName}** *(${cols.length} columns)*\n\n`;
  md += '| Column | Type | Nullable |\n';
  md += '|:---|:---|:---:|\n';
  for (const c of cols) {
    const type = formatColumnType(c);
    const nullable = c.nullable ? 'YES' : 'NO';
    md += `| ${c.name} | ${type} | ${nullable} |\n`;
  }
  return md;
}

/**
 * Render a single column's details as a horizontal markdown table.
 */
export function renderColumnMarkdown(schemaName: string, tableName: string, col: ColumnInfo): string {
  const type = formatColumnType(col);
  const nullable = col.nullable ? 'YES' : 'NO';
  let md = '| Table | Column | Type | Nullable |\n';
  md += '|:---|:---|:---|:---:|\n';
  md += `| ${schemaName}.${tableName} | ${col.name} | ${type} | ${nullable} |\n`;
  return md;
}

/**
 * Render multiple tables' matching column as a markdown table.
 */
export function renderMultiTableColumnMarkdown(tables: TableInfo[], columnName: string): string {
  let md = '| Table | Column | Type | Nullable |\n';
  md += '|:---|:---|:---|:---:|\n';
  for (const mt of tables) {
    const mc = mt.columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase());
    if (mc) {
      const type = formatColumnType(mc);
      const nullable = mc.nullable ? 'YES' : 'NO';
      md += `| ${mt.schema}.${mt.name} | ${mc.name} | ${type} | ${nullable} |\n`;
    }
  }
  return md;
}

/**
 * Groups ForeignKeyInfo entries by constraint name.
 * Entries without a constraintName are each treated as their own group.
 */
function groupForeignKeys(fks: ForeignKeyInfo[]): ForeignKeyInfo[][] {
  const named = new Map<string, ForeignKeyInfo[]>();
  const unnamed: ForeignKeyInfo[][] = [];
  for (const fk of fks) {
    if (fk.constraintName) {
      if (!named.has(fk.constraintName)) named.set(fk.constraintName, []);
      named.get(fk.constraintName)!.push(fk);
    } else {
      unnamed.push([fk]);
    }
  }
  return [...Array.from(named.values()), ...unnamed];
}

/**
 * Render FK columns of this table that reference other tables.
 * Returns empty string when there are no outbound FKs.
 */
export function renderOutboundForeignKeys(
  schemaName: string,
  tableName: string,
  foreignKeys: ForeignKeyInfo[]
): string {
  const outbound = foreignKeys.filter(
    (fk) =>
      fk.fromTable.toLowerCase() === tableName.toLowerCase() &&
      fk.fromSchema.toLowerCase() === schemaName.toLowerCase()
  );
  if (outbound.length === 0) return '';

  const groups = groupForeignKeys(outbound);
  let md = '\n**References (FK →)**\n\n';
  md += '| FK | Table |\n';
  md += '|:---|:---|\n';
  for (const group of groups) {
    const cols = group.map((fk) => fk.fromColumn).join(':');
    const toTable = `${group[0].toSchema}.${group[0].toTable}`;
    md += `| ${cols} | ${toTable} |\n`;
  }
  return md;
}

/**
 * Render tables that have FK columns pointing to this table.
 * Returns empty string when there are no inbound FKs.
 */
export function renderInboundForeignKeys(
  schemaName: string,
  tableName: string,
  foreignKeys: ForeignKeyInfo[]
): string {
  const inbound = foreignKeys.filter(
    (fk) =>
      fk.toTable.toLowerCase() === tableName.toLowerCase() &&
      fk.toSchema.toLowerCase() === schemaName.toLowerCase()
  );
  if (inbound.length === 0) return '';

  const groups = groupForeignKeys(inbound);
  let md = '\n**Referenced By (← FK)**\n\n';
  md += '| FK | Table |\n';
  md += '|:---|:---|\n';
  for (const group of groups) {
    const cols = group.map((fk) => fk.fromColumn).join(':');
    const fromTable = `${group[0].fromSchema}.${group[0].fromTable}`;
    md += `| ${cols} | ${fromTable} |\n`;
  }
  return md;
}

/**
 * Render a single CTE column's details as a horizontal markdown table.
 */
export function renderCteColumnMarkdown(cteName: string, col: CteColumnInfo): string {
  let md = '| CTE | Column | Type | Nullable |\n';
  md += '|:---|:---|:---|:---:|\n';
  md += `| ${cteName} | ${col.name} | ${col.type || '?'} | ${col.nullable ? 'YES' : 'NO'} |\n`;
  return md;
}

/**
 * Render a CTE's inferred columns as a markdown table.
 */
export function renderCteMarkdown(cte: CteDefinition): string {
  const hasTypes = cte.columns.some(c => c.type);
  let md = `**CTE: ${cte.name}** *(${cte.columns.length} columns)*\n\n`;
  if (hasTypes) {
    md += '| Column | Type | Nullable |\n';
    md += '|:---|:---|:---:|\n';
    for (const col of cte.columns) {
      md += `| ${col.name} | ${col.type || '?'} | ${col.nullable ? 'YES' : 'NO'} |\n`;
    }
  } else {
    md += '| Column |\n';
    md += '|:---|\n';
    for (const col of cte.columns) {
      md += `| ${col.name} |\n`;
    }
  }
  return md;
}

/**
 * Resolve an alias to a CTE definition by searching FROM/JOIN patterns in the query.
 */
function findCteForAlias(query: string, alias: string, ctes: CteDefinition[]): CteDefinition | null {
  if (ctes.length === 0) return null;
  // Direct CTE name match
  const directMatch = ctes.find(c => c.name.toLowerCase() === alias.toLowerCase());
  if (directMatch) return directMatch;
  // Check FROM/JOIN patterns: FROM CteName alias, JOIN CteName AS alias
  const lowerAlias = alias.toLowerCase();
  const patterns = [
    new RegExp(`from\\s+(\\w+)\\s+(?:as\\s+)?${lowerAlias}(?:\\s|,|$)`, 'i'),
    new RegExp(`join\\s+(\\w+)\\s+(?:as\\s+)?${lowerAlias}(?:\\s|,|$)`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      const tableName = match[1];
      const cte = ctes.find(c => c.name.toLowerCase() === tableName.toLowerCase());
      if (cte) return cte;
    }
  }
  return null;
}

/**
 * Check if the word at a given position is a column alias definition (preceded by AS keyword).
 * Handles both regular aliases and bracketed aliases like [Project name].
 */
export function isColumnAliasDefinition(lineText: string, startColumn: number): boolean {
  // startColumn is 1-based
  const idx = startColumn - 1; // 0-based index of word start
  const before = lineText.substring(0, idx).trimEnd();

  // Direct alias: ... AS word
  if (/\bAS\s*$/i.test(before)) return true;

  // Bracketed alias: ... AS [multi word alias]
  const bracketOpenIdx = lineText.lastIndexOf('[', idx - 1);
  if (bracketOpenIdx >= 0) {
    // Make sure there is no closing bracket between the open bracket and our position
    const closeBetween = lineText.indexOf(']', bracketOpenIdx + 1);
    if (closeBetween === -1 || closeBetween >= idx) {
      const beforeBracket = lineText.substring(0, bracketOpenIdx).trimEnd();
      if (/\bAS\s*$/i.test(beforeBracket)) return true;
    }
  }

  return false;
}

/**
 * Built-in SQL function documentation for hover.
 */
interface SqlFunctionDoc {
  description: string;
  syntax: string;
  example: string;
  result?: string;
}

export const SQL_FUNCTION_DOCS: Record<string, SqlFunctionDoc> = {
  // String functions
  lower: { description: 'Converts a string to lowercase.', syntax: 'LOWER(string)', example: "SELECT LOWER('Hello World')", result: "'hello world'" },
  upper: { description: 'Converts a string to uppercase.', syntax: 'UPPER(string)', example: "SELECT UPPER('Hello World')", result: "'HELLO WORLD'" },
  len: { description: 'Returns the number of characters in a string (excluding trailing spaces).', syntax: 'LEN(string)', example: "SELECT LEN('Hello')", result: '5' },
  datalength: { description: 'Returns the number of bytes used to represent a value.', syntax: 'DATALENGTH(expression)', example: "SELECT DATALENGTH(N'Hello')", result: '10' },
  ltrim: { description: 'Removes leading spaces from a string.', syntax: 'LTRIM(string)', example: "SELECT LTRIM('  Hello')", result: "'Hello'" },
  rtrim: { description: 'Removes trailing spaces from a string.', syntax: 'RTRIM(string)', example: "SELECT RTRIM('Hello  ')", result: "'Hello'" },
  trim: { description: 'Removes leading and trailing spaces (or specified characters) from a string.', syntax: 'TRIM(string)', example: "SELECT TRIM('  Hello  ')", result: "'Hello'" },
  substring: { description: 'Extracts a part of a string starting at a position for a given length.', syntax: 'SUBSTRING(string, start, length)', example: "SELECT SUBSTRING('Hello World', 1, 5)", result: "'Hello'" },
  left: { description: 'Returns the leftmost characters of a string.', syntax: 'LEFT(string, count)', example: "SELECT LEFT('Hello', 3)", result: "'Hel'" },
  right: { description: 'Returns the rightmost characters of a string.', syntax: 'RIGHT(string, count)', example: "SELECT RIGHT('Hello', 3)", result: "'llo'" },
  replace: { description: 'Replaces all occurrences of a substring with another string.', syntax: 'REPLACE(string, old, new)', example: "SELECT REPLACE('Hello', 'l', 'r')", result: "'Herro'" },
  replicate: { description: 'Repeats a string a specified number of times.', syntax: 'REPLICATE(string, count)', example: "SELECT REPLICATE('Ab', 3)", result: "'AbAbAb'" },
  reverse: { description: 'Reverses a string.', syntax: 'REVERSE(string)', example: "SELECT REVERSE('Hello')", result: "'olleH'" },
  charindex: { description: 'Returns the starting position of a substring in a string.', syntax: 'CHARINDEX(substring, string [, start])', example: "SELECT CHARINDEX('lo', 'Hello')", result: '4' },
  patindex: { description: 'Returns the starting position of a pattern in a string.', syntax: "PATINDEX('%pattern%', string)", example: "SELECT PATINDEX('%or%', 'Hello World')", result: '8' },
  stuff: { description: 'Deletes a part of a string and inserts another string at a specified position.', syntax: 'STUFF(string, start, length, replacement)', example: "SELECT STUFF('Hello', 2, 3, 'XY')", result: "'HXYo'" },
  concat: { description: 'Concatenates two or more strings. NULL values are treated as empty strings.', syntax: 'CONCAT(str1, str2, ...)', example: "SELECT CONCAT('Hello', ' ', 'World')", result: "'Hello World'" },
  concat_ws: { description: 'Concatenates strings with a separator. NULL values are skipped.', syntax: 'CONCAT_WS(separator, str1, str2, ...)', example: "SELECT CONCAT_WS(', ', 'A', 'B', 'C')", result: "'A, B, C'" },
  string_agg: { description: 'Concatenates values with a separator (aggregate function).', syntax: 'STRING_AGG(expression, separator)', example: "SELECT STRING_AGG(Name, ', ') FROM Users", result: "'Alice, Bob, Charlie'" },
  format: { description: 'Formats a value with a specified format string.', syntax: 'FORMAT(value, format [, culture])', example: "SELECT FORMAT(1234.56, 'N2')", result: "'1,234.56'" },
  char: { description: 'Returns the character for an ASCII code.', syntax: 'CHAR(integer)', example: 'SELECT CHAR(65)', result: "'A'" },
  ascii: { description: 'Returns the ASCII code of the first character.', syntax: 'ASCII(character)', example: "SELECT ASCII('A')", result: '65' },
  unicode: { description: 'Returns the Unicode code point of the first character.', syntax: 'UNICODE(character)', example: "SELECT UNICODE('A')", result: '65' },
  nchar: { description: 'Returns the Unicode character for a code point.', syntax: 'NCHAR(integer)', example: 'SELECT NCHAR(65)', result: "'A'" },
  quotename: { description: 'Returns a string with delimiters added to make it a valid delimited identifier.', syntax: "QUOTENAME(string [, delimiter])", example: "SELECT QUOTENAME('My Table')", result: "'[My Table]'" },
  translate: { description: 'Replaces characters in a string using a character-by-character mapping.', syntax: 'TRANSLATE(string, from_chars, to_chars)', example: "SELECT TRANSLATE('2*3+5/7', '*/+', '|||')", result: "'2|3|5|7'" },
  // Aggregate functions
  count: { description: 'Returns the number of items in a group.', syntax: 'COUNT(expression | *)', example: 'SELECT COUNT(*) FROM Users', result: '42' },
  sum: { description: 'Returns the sum of all values in a group.', syntax: 'SUM(expression)', example: 'SELECT SUM(Amount) FROM Orders' },
  avg: { description: 'Returns the average of values in a group.', syntax: 'AVG(expression)', example: 'SELECT AVG(Price) FROM Products' },
  min: { description: 'Returns the minimum value in a group.', syntax: 'MIN(expression)', example: 'SELECT MIN(CreatedAt) FROM Orders' },
  max: { description: 'Returns the maximum value in a group.', syntax: 'MAX(expression)', example: 'SELECT MAX(Price) FROM Products' },
  count_big: { description: 'Returns the count as a bigint.', syntax: 'COUNT_BIG(expression | *)', example: 'SELECT COUNT_BIG(*) FROM BigTable' },
  stdev: { description: 'Returns the statistical standard deviation of values.', syntax: 'STDEV(expression)', example: 'SELECT STDEV(Score) FROM Results' },
  var: { description: 'Returns the statistical variance of values.', syntax: 'VAR(expression)', example: 'SELECT VAR(Score) FROM Results' },
  // Date/time functions
  getdate: { description: 'Returns the current date and time.', syntax: 'GETDATE()', example: 'SELECT GETDATE()', result: "'2024-01-15 14:30:00.000'" },
  getutcdate: { description: 'Returns the current UTC date and time.', syntax: 'GETUTCDATE()', example: 'SELECT GETUTCDATE()' },
  sysdatetime: { description: 'Returns the current date and time with higher precision (datetime2).', syntax: 'SYSDATETIME()', example: 'SELECT SYSDATETIME()' },
  sysutcdatetime: { description: 'Returns the current UTC date and time with higher precision.', syntax: 'SYSUTCDATETIME()', example: 'SELECT SYSUTCDATETIME()' },
  dateadd: { description: 'Adds a specified number of units to a date.', syntax: 'DATEADD(datepart, number, date)', example: "SELECT DATEADD(day, 7, '2024-01-01')", result: "'2024-01-08'" },
  datediff: { description: 'Returns the difference between two dates in specified units.', syntax: 'DATEDIFF(datepart, startdate, enddate)', example: "SELECT DATEDIFF(day, '2024-01-01', '2024-01-15')", result: '14' },
  datediff_big: { description: 'Returns the difference between two dates as bigint.', syntax: 'DATEDIFF_BIG(datepart, startdate, enddate)', example: "SELECT DATEDIFF_BIG(millisecond, '2024-01-01', '2024-01-02')", result: '86400000' },
  datepart: { description: 'Returns an integer representing the specified datepart of a date.', syntax: 'DATEPART(datepart, date)', example: "SELECT DATEPART(month, '2024-03-15')", result: '3' },
  datename: { description: 'Returns a string representing the specified datepart of a date.', syntax: 'DATENAME(datepart, date)', example: "SELECT DATENAME(month, '2024-03-15')", result: "'March'" },
  year: { description: 'Returns the year part of a date.', syntax: 'YEAR(date)', example: "SELECT YEAR('2024-03-15')", result: '2024' },
  month: { description: 'Returns the month part of a date.', syntax: 'MONTH(date)', example: "SELECT MONTH('2024-03-15')", result: '3' },
  day: { description: 'Returns the day part of a date.', syntax: 'DAY(date)', example: "SELECT DAY('2024-03-15')", result: '15' },
  eomonth: { description: 'Returns the last day of the month containing the specified date.', syntax: 'EOMONTH(date [, month_offset])', example: "SELECT EOMONTH('2024-02-15')", result: "'2024-02-29'" },
  datefromparts: { description: 'Creates a date from year, month, and day values.', syntax: 'DATEFROMPARTS(year, month, day)', example: 'SELECT DATEFROMPARTS(2024, 3, 15)', result: "'2024-03-15'" },
  isdate: { description: 'Returns 1 if the expression is a valid date, 0 otherwise.', syntax: 'ISDATE(expression)', example: "SELECT ISDATE('2024-01-01')", result: '1' },
  // Conversion functions
  cast: { description: 'Converts an expression to a specified data type.', syntax: 'CAST(expression AS data_type)', example: "SELECT CAST('123' AS int)", result: '123' },
  convert: { description: 'Converts an expression to a specified data type with optional style.', syntax: 'CONVERT(data_type, expression [, style])', example: "SELECT CONVERT(varchar, GETDATE(), 23)", result: "'2024-01-15'" },
  try_cast: { description: 'Attempts to convert; returns NULL on failure instead of error.', syntax: 'TRY_CAST(expression AS data_type)', example: "SELECT TRY_CAST('abc' AS int)", result: 'NULL' },
  try_convert: { description: 'Attempts to convert with style; returns NULL on failure.', syntax: 'TRY_CONVERT(data_type, expression [, style])', example: "SELECT TRY_CONVERT(int, 'abc')", result: 'NULL' },
  parse: { description: 'Converts a string to a specified data type using .NET culture settings.', syntax: 'PARSE(string AS data_type [USING culture])', example: "SELECT PARSE('01/15/2024' AS date USING 'en-US')" },
  try_parse: { description: 'Attempts to parse; returns NULL on failure.', syntax: 'TRY_PARSE(string AS data_type [USING culture])', example: "SELECT TRY_PARSE('abc' AS date)", result: 'NULL' },
  // Math functions
  abs: { description: 'Returns the absolute value.', syntax: 'ABS(number)', example: 'SELECT ABS(-5)', result: '5' },
  ceiling: { description: 'Returns the smallest integer greater than or equal to the number.', syntax: 'CEILING(number)', example: 'SELECT CEILING(4.3)', result: '5' },
  floor: { description: 'Returns the largest integer less than or equal to the number.', syntax: 'FLOOR(number)', example: 'SELECT FLOOR(4.7)', result: '4' },
  round: { description: 'Rounds a number to a specified number of decimal places.', syntax: 'ROUND(number, decimals [, function])', example: 'SELECT ROUND(123.456, 2)', result: '123.460' },
  power: { description: 'Returns the value raised to a specified power.', syntax: 'POWER(base, exponent)', example: 'SELECT POWER(2, 10)', result: '1024' },
  sqrt: { description: 'Returns the square root of a number.', syntax: 'SQRT(number)', example: 'SELECT SQRT(144)', result: '12' },
  sign: { description: 'Returns -1, 0, or 1 indicating the sign of a number.', syntax: 'SIGN(number)', example: 'SELECT SIGN(-42)', result: '-1' },
  rand: { description: 'Returns a random float value between 0 and 1.', syntax: 'RAND([seed])', example: 'SELECT RAND()', result: '0.713...' },
  log: { description: 'Returns the natural logarithm of a number.', syntax: 'LOG(number [, base])', example: 'SELECT LOG(10)', result: '2.302...' },
  log10: { description: 'Returns the base-10 logarithm of a number.', syntax: 'LOG10(number)', example: 'SELECT LOG10(100)', result: '2' },
  // Null handling
  isnull: { description: 'Replaces NULL with a specified value.', syntax: 'ISNULL(expression, replacement)', example: 'SELECT ISNULL(NULL, 0)', result: '0' },
  coalesce: { description: 'Returns the first non-NULL expression from a list.', syntax: 'COALESCE(expr1, expr2, ...)', example: 'SELECT COALESCE(NULL, NULL, 42)', result: '42' },
  nullif: { description: 'Returns NULL if the two expressions are equal, otherwise returns the first expression.', syntax: 'NULLIF(expr1, expr2)', example: 'SELECT NULLIF(10, 10)', result: 'NULL' },
  iif: { description: 'Returns one of two values depending on a boolean condition.', syntax: 'IIF(condition, true_value, false_value)', example: 'SELECT IIF(1 > 0, \'Yes\', \'No\')', result: "'Yes'" },
  // JSON functions
  json_value: { description: 'Extracts a scalar value from a JSON string.', syntax: "JSON_VALUE(json, '$.path')", example: "SELECT JSON_VALUE('{\"name\":\"John\"}', '$.name')", result: "'John'" },
  json_query: { description: 'Extracts an object or array from a JSON string.', syntax: "JSON_QUERY(json, '$.path')", example: "SELECT JSON_QUERY('{\"items\":[1,2]}', '$.items')", result: "'[1,2]'" },
  json_modify: { description: 'Updates a value in a JSON string.', syntax: "JSON_MODIFY(json, '$.path', new_value)", example: "SELECT JSON_MODIFY('{\"name\":\"John\"}', '$.name', 'Jane')", result: "'{\"name\":\"Jane\"}'" },
  openjson: { description: 'Parses JSON text and returns objects and properties as rows and columns.', syntax: "OPENJSON(json [, '$.path']) WITH (...)", example: "SELECT * FROM OPENJSON('[{\"id\":1},{\"id\":2}]') WITH (id int '$.id')" },
  isjson: { description: 'Tests whether a string contains valid JSON.', syntax: 'ISJSON(expression)', example: "SELECT ISJSON('{\"a\":1}')", result: '1' },
  // Window functions
  row_number: { description: 'Returns a sequential integer for each row within a partition.', syntax: 'ROW_NUMBER() OVER (ORDER BY ...)', example: 'SELECT ROW_NUMBER() OVER (ORDER BY Id) FROM Users' },
  rank: { description: 'Returns the rank of each row within a partition, with gaps for ties.', syntax: 'RANK() OVER (ORDER BY ...)', example: 'SELECT RANK() OVER (ORDER BY Score DESC) FROM Results' },
  dense_rank: { description: 'Returns the rank of each row without gaps for ties.', syntax: 'DENSE_RANK() OVER (ORDER BY ...)', example: 'SELECT DENSE_RANK() OVER (ORDER BY Score DESC) FROM Results' },
  ntile: { description: 'Distributes rows into a specified number of groups.', syntax: 'NTILE(n) OVER (ORDER BY ...)', example: 'SELECT NTILE(4) OVER (ORDER BY Id) FROM Users' },
  lag: { description: 'Accesses a value from a previous row in the result set.', syntax: 'LAG(expression, offset, default) OVER (ORDER BY ...)', example: 'SELECT Id, LAG(Id, 1) OVER (ORDER BY Id) AS PrevId FROM Users' },
  lead: { description: 'Accesses a value from a subsequent row in the result set.', syntax: 'LEAD(expression, offset, default) OVER (ORDER BY ...)', example: 'SELECT Id, LEAD(Id, 1) OVER (ORDER BY Id) AS NextId FROM Users' },
  first_value: { description: 'Returns the first value in an ordered set of values.', syntax: 'FIRST_VALUE(expression) OVER (ORDER BY ...)', example: 'SELECT FIRST_VALUE(Name) OVER (ORDER BY Id) FROM Users' },
  last_value: { description: 'Returns the last value in an ordered set of values.', syntax: 'LAST_VALUE(expression) OVER (ORDER BY ... ROWS ...)', example: 'SELECT LAST_VALUE(Name) OVER (ORDER BY Id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) FROM Users' },
  // Other
  newid: { description: 'Creates a new unique identifier (GUID).', syntax: 'NEWID()', example: 'SELECT NEWID()', result: "'6F9619FF-8B86-D011-B42D-00C04FC964FF'" },
  newsequentialid: { description: 'Creates a GUID that is greater than any previously generated by this function (for defaults only).', syntax: 'NEWSEQUENTIALID()', example: 'DEFAULT NEWSEQUENTIALID()' },
  scope_identity: { description: 'Returns the last identity value inserted in the current scope.', syntax: 'SCOPE_IDENTITY()', example: "INSERT INTO Users (Name) VALUES ('Test'); SELECT SCOPE_IDENTITY()" },
  object_id: { description: 'Returns the database object ID for a schema-scoped object.', syntax: "OBJECT_ID('object_name')", example: "SELECT OBJECT_ID('dbo.Users')" },
  db_id: { description: 'Returns the database ID.', syntax: 'DB_ID([database_name])', example: 'SELECT DB_ID()', result: '5' },
  db_name: { description: 'Returns the database name for a given ID.', syntax: 'DB_NAME([database_id])', example: 'SELECT DB_NAME()', result: "'MyDatabase'" },
  object_name: { description: 'Returns the object name for a given object ID.', syntax: 'OBJECT_NAME(object_id)', example: 'SELECT OBJECT_NAME(1234567)' },
  schema_name: { description: 'Returns the schema name for a given schema ID.', syntax: 'SCHEMA_NAME([schema_id])', example: 'SELECT SCHEMA_NAME()', result: "'dbo'" },
  type_name: { description: 'Returns the type name for a given type ID.', syntax: 'TYPE_NAME(type_id)', example: 'SELECT TYPE_NAME(56)', result: "'int'" },
  string_split: { description: 'Splits a string into rows using a specified separator.', syntax: 'STRING_SPLIT(string, separator)', example: "SELECT value FROM STRING_SPLIT('a,b,c', ',')" },
  choose: { description: 'Returns the item at a specified index from a list.', syntax: 'CHOOSE(index, val1, val2, ...)', example: "SELECT CHOOSE(2, 'A', 'B', 'C')", result: "'B'" },
  exists: { description: 'Tests for the existence of rows in a subquery.', syntax: 'EXISTS (subquery)', example: 'SELECT * FROM Users u WHERE EXISTS (SELECT 1 FROM Orders WHERE UserId = u.Id)' },
};

/**
 * Render a SQL function hover markdown.
 */
export function renderFunctionHover(name: string, doc: SqlFunctionDoc): string {
  let md = `**${name.toUpperCase()}** — ${doc.description}\n\n`;
  md += '```sql\n';
  md += doc.syntax + '\n';
  md += '```\n\n';
  md += '**Example:**\n```sql\n';
  md += doc.example + '\n';
  md += '```\n';
  if (doc.result) {
    md += `\n→ ${doc.result}`;
  }
  return md;
}

/**
 * Provide hover information for SQL text at a given position.
 * Pure function — no Monaco dependency.
 */
export function provideHoverContent(
  fullText: string,
  lineText: string,
  position: { lineNumber: number; column: number },
  wordAtPosition: { word: string; startColumn: number; endColumn: number } | null,
  dbSchema: DatabaseSchema
): HoverResult | null {
  const tablesInQuery = extractTablesFromQuery(fullText, dbSchema) || [];
  const beforeCursor = lineText.substring(0, position.column - 1);

  // 1. Detect alias.column or table.column pattern before/at cursor
  // Also handle bracketed identifiers: [alias].[column], [table].[column]
  const afterCursor = lineText.substring(position.column - 1);
  const dotPatternBefore = beforeCursor.match(/(?:\[([^\]]+)\]|([A-Za-z0-9_]+))\.(?:\[([^\]]*)\]|([A-Za-z0-9_]*))$/);
  if (dotPatternBefore) {
    const alias = dotPatternBefore[1] || dotPatternBefore[2];
    // The column name from beforeCursor may be partial — complete it with afterCursor
    const partialCol = dotPatternBefore[3] ?? dotPatternBefore[4] ?? '';
    let colName = partialCol;

    // If there's a wordAtPosition and it extends beyond our partial capture, use the full word
    if (wordAtPosition?.word && partialCol) {
      const fullWord = wordAtPosition.word;
      if (fullWord.toLowerCase().startsWith(partialCol.toLowerCase()) || partialCol.toLowerCase().startsWith(fullWord.toLowerCase())) {
        colName = fullWord;
      }
    } else if (wordAtPosition?.word && !partialCol) {
      // Cursor is right after the dot — wordAtPosition has the column
      colName = wordAtPosition.word;
    }

    // Complete bracketed column from afterCursor if needed
    if (dotPatternBefore[3] !== undefined && !dotPatternBefore[3].includes(']')) {
      const closingBracket = afterCursor.match(/^[^\]]*\]/);
      if (closingBracket) {
        colName = dotPatternBefore[3] + closingBracket[0].slice(0, -1);
      }
    }

    // First check if alias resolves to a CTE
    const ctes = extractCTEsWithColumns(fullText, dbSchema);
    const aliasedCte = findCteForAlias(fullText, alias, ctes);
    if (aliasedCte) {
      const cteCol = colName ? aliasedCte.columns.find(c => c.name.toLowerCase() === colName.toLowerCase()) : undefined;
      if (cteCol) {
        const mdCteCol = renderCteColumnMarkdown(aliasedCte.name, cteCol);
        const matchText = dotPatternBefore[0];
        const startCol = beforeCursor.length - matchText.length + 1;
        const colEndInLine = wordAtPosition ? wordAtPosition.endColumn : position.column;
        return {
          contents: [{ value: mdCteCol }],
          range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: startCol, endColumn: colEndInLine },
        };
      }
      // Column not matched — show full CTE schema
      const cteMd = renderCteMarkdown(aliasedCte);
      const matchText = dotPatternBefore[0];
      const startCol = beforeCursor.length - matchText.length + 1;
      const colEndInLine = wordAtPosition ? wordAtPosition.endColumn : position.column;
      return {
        contents: [{ value: cteMd }],
        range: { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: startCol, endColumn: colEndInLine },
      };
    }

    const tableInfo = findTableForAlias(fullText, alias, dbSchema) || findTable(alias, dbSchema);
    if (tableInfo) {
      const cols = getColumnsForTable(tableInfo.schema, tableInfo.table, dbSchema) || [];

      // If colName matches a column, show single-column detail
      const col = colName ? cols.find((c) => c.name.toLowerCase() === colName.toLowerCase()) : undefined;
      if (col) {
        const mdSingle = renderColumnMarkdown(tableInfo.schema, tableInfo.table, col);
        // Highlight the full alias.column range
        const matchText = dotPatternBefore[0];
        const startCol = beforeCursor.length - matchText.length + 1;
        // Calculate end: add remaining part of column word after cursor
        const colEndInLine = wordAtPosition ? wordAtPosition.endColumn : position.column;
        return {
          contents: [{ value: mdSingle }],
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: startCol,
            endColumn: colEndInLine,
          },
        };
      }

      // Column not found or empty — show table schema preview
      const previewCols = cols.slice(0, 15);
      const tableMd =
        renderTableMarkdown(tableInfo.schema, tableInfo.table, previewCols) +
        renderOutboundForeignKeys(tableInfo.schema, tableInfo.table, dbSchema.foreignKeys || []) +
        renderInboundForeignKeys(tableInfo.schema, tableInfo.table, dbSchema.foreignKeys || []);
      const matchText = dotPatternBefore[0];
      const startCol2 = beforeCursor.length - matchText.length + 1;
      const colEndInLine = wordAtPosition ? wordAtPosition.endColumn : position.column;
      return {
        contents: [{ value: tableMd }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: startCol2,
          endColumn: colEndInLine,
        },
      };
    }
  }

  // 2. No alias dot — check standalone word under cursor
  if (wordAtPosition?.word) {
    const w = wordAtPosition.word;

    // 2a. Check if the word is a CTE name — show its inferred columns
    const ctes = extractCTEsWithColumns(fullText, dbSchema);
    const matchedCte = ctes.find((c) => c.name.toLowerCase() === w.toLowerCase());
    if (matchedCte && matchedCte.columns.length > 0) {
      const cteMd = renderCteMarkdown(matchedCte);
      return {
        contents: [{ value: cteMd }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordAtPosition.startColumn,
          endColumn: wordAtPosition.endColumn,
        },
      };
    }

    // If it's a table name, show full table definition
    const table = findTable(w, dbSchema);
    if (table) {
      const cols2 = getColumnsForTable(table.schema, table.table, dbSchema) || [];
      const md2 =
        renderTableMarkdown(table.schema, table.table, cols2) +
        renderOutboundForeignKeys(table.schema, table.table, dbSchema.foreignKeys || []) +
        renderInboundForeignKeys(table.schema, table.table, dbSchema.foreignKeys || []);
      return {
        contents: [{ value: md2 }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordAtPosition.startColumn,
          endColumn: wordAtPosition.endColumn,
        },
      };
    }

    // 2c. Check if the word is a CTE alias — show the CTE definition
    const cteAliased = findCteForAlias(fullText, w, ctes);
    if (cteAliased) {
      const cteMd = renderCteMarkdown(cteAliased);
      return {
        contents: [{ value: cteMd }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordAtPosition.startColumn,
          endColumn: wordAtPosition.endColumn,
        },
      };
    }

    // 2d. Check if the word is a table alias — show the aliased table definition
    const aliasedTable = findTableForAlias(fullText, w, dbSchema);
    if (aliasedTable && !findTable(w, dbSchema)) {
      const cols3 = getColumnsForTable(aliasedTable.schema, aliasedTable.table, dbSchema) || [];
      const md3 =
        renderTableMarkdown(aliasedTable.schema, aliasedTable.table, cols3) +
        renderOutboundForeignKeys(aliasedTable.schema, aliasedTable.table, dbSchema.foreignKeys || []) +
        renderInboundForeignKeys(aliasedTable.schema, aliasedTable.table, dbSchema.foreignKeys || []);
      return {
        contents: [{ value: md3 }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordAtPosition.startColumn,
          endColumn: wordAtPosition.endColumn,
        },
      };
    }

    // Skip column hover for alias definitions (e.g., td.Name AS Tool)
    if (isColumnAliasDefinition(lineText, wordAtPosition.startColumn)) {
      return null;
    }

    // If it's a column name present in multiple tables, prefer tables in the current query
    const matching = (dbSchema.tables || []).filter((t: TableInfo) =>
      t.columns.some((c) => c.name.toLowerCase() === w.toLowerCase())
    );

    if (matching.length > 1) {
      const inQuery = matching.filter((t: TableInfo) =>
        tablesInQuery.some(
          (q) => q.table.toLowerCase() === t.name.toLowerCase() && (q.schema ? q.schema === t.schema : true)
        )
      );
      const effective = inQuery.length > 0 ? inQuery : matching;
      const mdMulti = renderMultiTableColumnMarkdown(effective, w);
      return {
        contents: [{ value: mdMulti }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordAtPosition.startColumn,
          endColumn: wordAtPosition.endColumn,
        },
      };
    }

    // If it's a column name in exactly one table, show that column
    if (matching.length === 1) {
      const t = matching[0];
      const col = t.columns.find((c) => c.name.toLowerCase() === w.toLowerCase());
      if (col) {
        const md3 = renderColumnMarkdown(t.schema, t.name, col);
        return {
          contents: [{ value: md3 }],
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: wordAtPosition.startColumn,
            endColumn: wordAtPosition.endColumn,
          },
        };
      }
    }
    // Check if the word is a built-in SQL function
    const funcDoc = SQL_FUNCTION_DOCS[w.toLowerCase()];
    if (funcDoc) {
      return {
        contents: [{ value: renderFunctionHover(w, funcDoc) }],
        range: {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: wordAtPosition.startColumn,
          endColumn: wordAtPosition.endColumn,
        },
      };
    }
  }

  return null;
}
