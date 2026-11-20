/**
 * Pure helpers shared by the Copilot language model tools and the MCP server.
 * Kept free of `vscode` imports so they are easy to unit test.
 */

export interface DatabaseTarget {
    connectionId: string;
    connectionName: string;
    server: string;
    connectionType: 'server' | 'database';
    database: string;
    isSystemDatabase: boolean;
}

export interface TargetRequest {
    connectionId?: string;
    database?: string;
}

export interface TargetHint {
    connectionId: string;
    database?: string;
}

export type TargetSelection =
    | { kind: 'resolved'; target: DatabaseTarget }
    | { kind: 'ambiguous'; candidates: DatabaseTarget[] }
    | { kind: 'none'; message: string };

export const SYSTEM_DATABASES: ReadonlySet<string> = new Set(['master', 'tempdb', 'model', 'msdb']);

export const MAX_SCHEMA_CHARS = 60000;

const equalsIgnoreCase = (a: string | undefined, b: string | undefined): boolean =>
    !!a && !!b && a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export function targetKey(target: Pick<DatabaseTarget, 'connectionId' | 'database'>): string {
    return `${target.connectionId}::${target.database}`;
}

export function describeTarget(target: DatabaseTarget): string {
    return `${target.database} — ${target.connectionName} (${target.server})`;
}

export function formatTargetLine(target: DatabaseTarget): string {
    return `connectionId="${target.connectionId}", database="${target.database}" (${target.connectionName} @ ${target.server}, ${target.connectionType} connection)`;
}

/**
 * Decide which database a tool call should run against.
 * Explicit request parameters narrow the candidates; hints (e.g. the database the user
 * picked earlier or the one selected in the active SQL editor) only break ties.
 */
export function selectTarget(all: DatabaseTarget[], request: TargetRequest, hints: (TargetHint | undefined)[] = []): TargetSelection {
    if (all.length === 0) {
        return {
            kind: 'none',
            message: 'There are no active SQL Server connections in MS SQL Manager. Ask the user to connect to a server or database in the MS SQL Manager view first.'
        };
    }

    let candidates = all;

    if (request.connectionId) {
        candidates = candidates.filter(c => c.connectionId === request.connectionId);
        if (candidates.length === 0) {
            candidates = all.filter(c => equalsIgnoreCase(c.connectionName, request.connectionId));
        }
        if (candidates.length === 0) {
            return {
                kind: 'none',
                message: `Connection "${request.connectionId}" is not active. Available targets:\n${all.map(t => `- ${formatTargetLine(t)}`).join('\n')}`
            };
        }
    }

    if (request.database) {
        const byDatabase = candidates.filter(c => equalsIgnoreCase(c.database, request.database));
        if (byDatabase.length === 0) {
            return {
                kind: 'none',
                message: `Database "${request.database}" was not found${request.connectionId ? ` on connection "${request.connectionId}"` : ''}. Available targets:\n${candidates.map(t => `- ${formatTargetLine(t)}`).join('\n')}`
            };
        }
        candidates = byDatabase;
    } else {
        const userDatabases = candidates.filter(c => !c.isSystemDatabase);
        if (userDatabases.length > 0) {
            candidates = userDatabases;
        }
    }

    if (candidates.length === 1) {
        return { kind: 'resolved', target: candidates[0] };
    }

    for (const hint of hints) {
        if (!hint) {
            continue;
        }
        const match = candidates.filter(c =>
            c.connectionId === hint.connectionId && (!hint.database || equalsIgnoreCase(c.database, hint.database))
        );
        if (match.length === 1) {
            return { kind: 'resolved', target: match[0] };
        }
    }

    return { kind: 'ambiguous', candidates };
}

/** Parse ids like `connId::database` used by the SQL editor webviews. */
export function parseCompositeConnectionId(value: string | null | undefined): TargetHint | undefined {
    if (!value) {
        return undefined;
    }
    const separator = value.indexOf('::');
    if (separator === -1) {
        return { connectionId: value };
    }
    const database = value.slice(separator + 2);
    return { connectionId: value.slice(0, separator), database: database || undefined };
}

/**
 * Conservative check whether a T-SQL batch only reads data.
 * Strings, comments and quoted identifiers are removed in a single left-to-right pass,
 * so a keyword hidden inside a literal can't mask a real statement after it.
 */
export function isReadOnlySql(sql: string): boolean {
    const stripped = sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\/|\[[^\]]*\]|"[^"]*"/g, ' ');
    if (!/\S/.test(stripped)) {
        return false;
    }

    const writeKeywords = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|BACKUP|RESTORE|DBCC|KILL|SHUTDOWN|RECONFIGURE|BULK|OPENROWSET|OPENQUERY|OPENDATASOURCE|WRITETEXT|UPDATETEXT|USE|INTO|SP_\w+|XP_\w+)\b/i;
    return !writeKeywords.test(stripped);
}

interface SchemaObjectName {
    schema: string;
    name: string;
}

function parseObjectSpec(spec: string): { schema?: string; name: string } {
    const parts = spec.replace(/[\[\]"]/g, '').trim().split('.');
    const name = parts.pop() ?? '';
    const schema = parts.pop();
    return { schema, name };
}

function wildcardToRegExp(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

function objectMatches(object: SchemaObjectName, specs: string[]): boolean {
    return specs.some(spec => {
        const parsed = parseObjectSpec(spec);
        if (!parsed.name) {
            return false;
        }
        if (parsed.schema && !wildcardToRegExp(parsed.schema).test(object.schema)) {
            return false;
        }
        return wildcardToRegExp(parsed.name).test(object.name);
    });
}

const CREATE_OBJECT_REGEX = /CREATE (TABLE|VIEW) \[([^\]]+)\]\.\[([^\]]+)\]/;
const ROUTINE_LINE_REGEX = /^-- (?:EXEC|SELECT) \[([^\]]+)\]\.\[([^\]]+)\]/;
const SECTION_HEADER_REGEX = /^-- (TABLES|VIEWS|STORED PROCEDURES|FUNCTIONS) \(\d+\)$/;

/**
 * Keep only the schema blocks (tables, views, routines) matching the given object names.
 * Names can be `table`, `schema.table` and may contain `*` / `%` wildcards.
 */
export function filterSchemaText(schemaText: string, objects: string[]): string {
    const specs = objects.map(o => o.trim()).filter(Boolean);
    if (specs.length === 0) {
        return schemaText;
    }

    const kept: string[] = [];
    let matchedCount = 0;
    const blocks = schemaText.split(/\n{2,}/);

    for (const [index, rawBlock] of blocks.entries()) {
        const lines = rawBlock.split('\n').filter(line => !SECTION_HEADER_REGEX.test(line.trim()));
        const block = lines.join('\n').trim();
        if (!block) {
            continue;
        }

        const createMatch = block.match(CREATE_OBJECT_REGEX);
        if (createMatch) {
            if (objectMatches({ schema: createMatch[2], name: createMatch[3] }, specs)) {
                kept.push(block);
                matchedCount++;
            }
            continue;
        }

        const routineLines = lines.filter(line => ROUTINE_LINE_REGEX.test(line));
        if (routineLines.length > 0) {
            const matching = routineLines.filter(line => {
                const m = line.match(ROUTINE_LINE_REGEX)!;
                return objectMatches({ schema: m[1], name: m[2] }, specs);
            });
            if (matching.length > 0) {
                kept.push(matching.join('\n'));
                matchedCount += matching.length;
            }
            continue;
        }

        if (index === 0) {
            kept.push(block);
        }
    }

    if (matchedCount === 0) {
        const available = extractObjectNames(schemaText);
        return `${kept.join('\n\n')}\n\n-- No objects matched: ${specs.join(', ')}\n-- Available objects:\n${available.map(o => `--   ${o}`).join('\n')}`;
    }

    return kept.join('\n\n');
}

/** List all objects (tables, views, procedures, functions) found in a schema context text. */
export function extractObjectNames(schemaText: string): string[] {
    const names: string[] = [];
    for (const line of schemaText.split('\n')) {
        const create = line.match(CREATE_OBJECT_REGEX);
        if (create) {
            names.push(`${create[2]}.${create[3]} (${create[1].toLowerCase()})`);
            continue;
        }
        const routine = line.match(/^-- (EXEC|SELECT) \[([^\]]+)\]\.\[([^\]]+)\]/);
        if (routine) {
            names.push(`${routine[2]}.${routine[3]} (${routine[1] === 'EXEC' ? 'procedure' : 'function'})`);
        }
    }
    return names;
}

/** Return the full schema when it fits; otherwise an object list so the agent can request specific objects. */
export function limitSchemaText(schemaText: string, maxChars: number = MAX_SCHEMA_CHARS): string {
    if (schemaText.length <= maxChars) {
        return schemaText;
    }
    const header = schemaText.split(/\n{2,}/)[0];
    const names = extractObjectNames(schemaText);
    return [
        header,
        '',
        `-- The full schema is too large (${schemaText.length} characters) to return at once.`,
        '-- Call the schema tool again with the "objects" parameter listing the tables/views you need.',
        `-- Objects in this database (${names.length}):`,
        ...names.map(n => `--   ${n}`)
    ].join('\n');
}

function jsonReplacer(_key: string, value: unknown): unknown {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (value && typeof value === 'object' && (value as { type?: string }).type === 'Buffer' && Array.isArray((value as { data?: unknown }).data)) {
        const bytes = (value as { data: number[] }).data;
        const hex = bytes.slice(0, 64).map(b => b.toString(16).padStart(2, '0')).join('');
        return `0x${hex}${bytes.length > 64 ? '…' : ''}`;
    }
    return value;
}

export interface QueryResultLike {
    recordsets?: unknown[][] | unknown;
    recordset?: unknown[];
    rowsAffected?: number[];
}

/** Format a mssql/msnodesqlv8 query result for an LLM. */
export function formatQueryResult(result: QueryResultLike, elapsedMs: number, maxRows: number): string {
    const recordsets: unknown[][] = Array.isArray(result.recordsets)
        ? (result.recordsets as unknown[][])
        : (result.recordset ? [result.recordset] : []);

    const sections: string[] = [];

    recordsets.forEach((rows, index) => {
        const rowArray = Array.isArray(rows) ? rows : [];
        const title = recordsets.length > 1 ? `Result set ${index + 1}` : 'Result';
        if (rowArray.length === 0) {
            sections.push(`${title}: 0 rows`);
            return;
        }
        const shown = rowArray.slice(0, maxRows);
        const columns = Object.keys(shown[0] as Record<string, unknown>);
        let text = `${title}: ${rowArray.length} row(s)\nColumns: ${columns.join(', ')}\n${JSON.stringify(shown, jsonReplacer, 2)}`;
        if (rowArray.length > maxRows) {
            text += `\n(Showing first ${maxRows} of ${rowArray.length} rows. Use TOP/WHERE to narrow the result.)`;
        }
        sections.push(text);
    });

    const affected = (result.rowsAffected ?? []).reduce((sum, n) => sum + (n || 0), 0);
    if (recordsets.length === 0) {
        sections.push(`Query executed successfully. Rows affected: ${affected}`);
    }

    return `Execution time: ${elapsedMs}ms\n${sections.join('\n\n')}`;
}

export const SQL_AGENT_GUIDELINES = [
    'Rules for writing SQL against this database:',
    '- Use ONLY tables, views, columns and routines that appear in the schema above. Never guess names; if something is missing, call the schema tool with the "objects" parameter or ask the user.',
    '- Follow the database-specific instructions (if present) — they take precedence over general conventions.',
    '- Write T-SQL compatible with the reported server version / compatibility level.',
    '- Use schema-qualified names (e.g. [dbo].[Orders]) and explicit column lists instead of SELECT *.',
    '- Use TOP / WHERE for exploratory queries to keep result sets small.',
    '- Data-modifying statements (INSERT/UPDATE/DELETE/DDL) require explicit user consent; explain the impact first.'
].join('\n');
