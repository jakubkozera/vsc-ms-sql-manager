import * as vscode from 'vscode';
import { DBPool } from '../dbClient';

export interface DmlProtectionResult {
    /** Whether execution should proceed */
    proceed: boolean;
    /** If the user was warned and confirmed, this is true */
    confirmed?: boolean;
}

/**
 * Extracts individual DML statements (UPDATE / DELETE) from a SQL batch,
 * ignoring content inside string literals and block comments.
 */
export function extractDmlStatements(sql: string): { type: 'UPDATE' | 'DELETE'; text: string }[] {
    // Remove block comments and string literals to avoid false positives
    const cleaned = sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')         // block comments
        .replace(/--[^\r\n]*/g, ' ')                // line comments
        .replace(/'(?:[^']|'')*'/g, "''");           // string literals

    const results: { type: 'UPDATE' | 'DELETE'; text: string }[] = [];

    // Match standalone UPDATE / DELETE statements (simplified — looks for the keyword at a statement boundary)
    const stmtRegex = /\b(UPDATE|DELETE)\b/gi;
    let match: RegExpExecArray | null;
    while ((match = stmtRegex.exec(cleaned)) !== null) {
        const keyword = match[1].toUpperCase() as 'UPDATE' | 'DELETE';
        results.push({ type: keyword, text: sql }); // keep original text for execution
    }

    return results;
}

/**
 * Checks whether a SQL batch contains UPDATE or DELETE without a WHERE clause.
 * Returns true if at least one such statement is found.
 */
export function hasDmlWithoutWhere(sql: string): boolean {
    const cleaned = sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\r\n]*/g, ' ')
        .replace(/'(?:[^']|'')*'/g, "''");

    // Split by semicolons to isolate individual statements (rough but practical)
    const statements = cleaned.split(';');

    for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (!trimmed) { continue; }

        const upper = trimmed.toUpperCase();

        // Check for DELETE ... without WHERE
        if (/\bDELETE\b/i.test(upper) && !/\bWHERE\b/i.test(upper)) {
            // Exclude "DELETE" inside sub-selects or CTEs — simple heuristic: the statement starts with DELETE
            if (/^\s*DELETE\b/i.test(trimmed)) {
                return true;
            }
        }

        // Check for UPDATE ... without WHERE
        if (/\bUPDATE\b/i.test(upper) && !/\bWHERE\b/i.test(upper)) {
            if (/^\s*UPDATE\b/i.test(trimmed)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Returns true when the SQL batch contains at least one UPDATE or DELETE statement.
 */
export function containsDml(sql: string): boolean {
    const cleaned = sql
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/--[^\r\n]*/g, ' ')
        .replace(/'(?:[^']|'')*'/g, "''");

    return /\b(UPDATE|DELETE)\b/i.test(cleaned);
}

/**
 * Run the query inside a transaction that is always rolled back and return the
 * number of affected rows (sum of all batches). This lets us check the impact
 * without modifying data.
 */
export async function dryRunAffectedRows(sql: string, pool: DBPool): Promise<number> {
    if (!pool.runInTransaction) {
        // Driver doesn't support transactions — skip the check
        return 0;
    }

    return pool.runInTransaction(async (makeRequest) => {
        const req = makeRequest();
        const result = await req.query(sql);
        const affected: number[] = result.rowsAffected || [];
        return affected.reduce((sum: number, n: number) => sum + n, 0);
    });
    // runInTransaction always rolls back (by design in the existing codebase)
}

/**
 * Main entry point: run all configured DML protection checks before a query
 * is executed.  Returns { proceed: true } when the query may run.
 */
export async function checkDmlProtection(
    sql: string,
    pool: DBPool,
    outputChannel: vscode.OutputChannel
): Promise<DmlProtectionResult> {
    const config = vscode.workspace.getConfiguration('mssqlManager.dmlProtection');
    const warnOnMissingWhere: boolean = config.get<boolean>('warnOnMissingWhere', true);
    const limitAffectedRows: boolean = config.get<boolean>('limitAffectedRows', true);
    const maxAffectedRows: number = config.get<number>('maxAffectedRows', 100);

    // 1. Warn on missing WHERE
    if (warnOnMissingWhere && hasDmlWithoutWhere(sql)) {
        const choice = await vscode.window.showWarningMessage(
            'This query contains UPDATE or DELETE without a WHERE clause. All rows in the target table may be affected. Do you want to continue?',
            { modal: true },
            'Execute'
        );
        if (choice !== 'Execute') {
            return { proceed: false };
        }
        // User confirmed — if limitAffectedRows is also on we still check it below
    }

    // 2. Affected-row limit check
    if (limitAffectedRows && containsDml(sql)) {
        try {
            outputChannel.appendLine('[DmlProtection] Running dry-run to count affected rows...');
            const affected = await dryRunAffectedRows(sql, pool);
            outputChannel.appendLine(`[DmlProtection] Dry-run affected rows: ${affected}`);

            if (affected > maxAffectedRows) {
                const choice = await vscode.window.showWarningMessage(
                    `This query will affect ${affected} row(s), which exceeds the safe threshold of ${maxAffectedRows}. Do you want to continue?`,
                    { modal: true },
                    'Execute'
                );
                if (choice !== 'Execute') {
                    return { proceed: false };
                }
                return { proceed: true, confirmed: true };
            }
        } catch (error) {
            outputChannel.appendLine(`[DmlProtection] Dry-run failed: ${error}`);
            // If the dry-run itself fails (e.g. syntax error), let the real execution
            // surface the error naturally — don't block.
        }
    }

    return { proceed: true };
}
