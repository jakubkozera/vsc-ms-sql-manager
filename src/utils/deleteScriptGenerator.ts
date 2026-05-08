/**
 * Generates cascading DELETE SQL scripts with proper handling of
 * single-column and composite foreign key dependencies.
 */

export interface PKColumn {
    COLUMN_NAME: string;
}

export interface FKDependency {
    ref_schema: string;
    ref_table: string;
    target_schema: string;
    target_table: string;
    ref_columns: string;      // comma-separated FK column names in ref_table
    target_columns: string;   // comma-separated referenced column names in target_table
    level: number;
    path: string;
    parent_object_id?: number;
    referenced_object_id?: number;
}

export interface DeleteScriptOptions {
    schema: string;
    table: string;
    pkColumns: PKColumn[];
    dependencies: FKDependency[];
    rowData?: Record<string, any>;
}

/**
 * For a given table, traces its FK columns through the dependency chain
 * to find which columns in that table map back to root PK columns.
 * Returns a Map<columnInTable, rootPKColumn> or null if no mapping found.
 */
export function traceColumnsToRoot(
    tableSchema: string,
    tableName: string,
    rootSchema: string,
    rootTable: string,
    pkColumns: PKColumn[],
    depLookup: Map<string, FKDependency>,
    visited: Set<string>
): Map<string, string> | null {
    const key = `${tableSchema}.${tableName}`;
    if (visited.has(key)) { return null; }
    visited.add(key);

    // If this IS root, each PK column maps to itself
    if (tableSchema === rootSchema && tableName === rootTable) {
        const result = new Map<string, string>();
        for (const pk of pkColumns) {
            result.set(pk.COLUMN_NAME, pk.COLUMN_NAME);
        }
        return result;
    }

    const dep = depLookup.get(key);
    if (!dep) { return null; }

    const refCols = dep.ref_columns.split(', ');
    const targetCols = dep.target_columns.split(', ');

    // Get parent's mapping to root
    const parentMapping = traceColumnsToRoot(
        dep.target_schema, dep.target_table,
        rootSchema, rootTable, pkColumns, depLookup, new Set(visited)
    );
    if (!parentMapping) { return null; }

    // For each FK column in this table, check if its corresponding target column maps to root
    const result = new Map<string, string>();
    for (let i = 0; i < refCols.length; i++) {
        const rootPK = parentMapping.get(targetCols[i]);
        if (rootPK) {
            result.set(refCols[i], rootPK);
        }
    }

    return result.size > 0 ? result : null;
}

/**
 * Builds a WHERE filter condition string for a target table, recursively
 * tracing FK relationships back to the root table.
 */
export function buildTargetFilter(
    targetSchema: string,
    targetTable: string,
    rootSchema: string,
    rootTable: string,
    pkColumns: PKColumn[],
    depLookup: Map<string, FKDependency>,
    visited: Set<string>
): string {
    const key = `${targetSchema}.${targetTable}`;
    if (visited.has(key)) { return '1=1'; }
    visited.add(key);

    // If target IS root, filter by root PKs
    if (targetSchema === rootSchema && targetTable === rootTable) {
        return pkColumns.map(pk => `[${pk.COLUMN_NAME}] = @Target_${pk.COLUMN_NAME}`).join(' AND ');
    }

    // Find how target_table connects back toward root
    const targetDep = depLookup.get(key);
    if (!targetDep) { return '1=1'; }

    const tRefCols = targetDep.ref_columns.split(', ');
    const tTargetCols = targetDep.target_columns.split(', ');

    if (targetDep.level === 0) {
        // target_table directly references root — direct comparison
        return tRefCols.map((col: string, i: number) => `[${col}] = @Target_${tTargetCols[i]}`).join(' AND ');
    }

    // target_table references another intermediate table
    const parentFilter = buildTargetFilter(targetDep.target_schema, targetDep.target_table, rootSchema, rootTable, pkColumns, depLookup, visited);
    if (tRefCols.length === 1) {
        return `[${tRefCols[0]}] IN (SELECT [${tTargetCols[0]}] FROM [${targetDep.target_schema}].[${targetDep.target_table}] WHERE ${parentFilter})`;
    } else {
        // Multi-column: use EXISTS
        const correlations = tRefCols.map((col: string, i: number) =>
            `[${targetSchema}].[${targetTable}].[${col}] = [${targetDep.target_schema}].[${targetDep.target_table}].[${tTargetCols[i]}]`
        ).join(' AND ');
        return `EXISTS (SELECT 1 FROM [${targetDep.target_schema}].[${targetDep.target_table}] WHERE ${correlations} AND ${parentFilter})`;
    }
}

/**
 * Generates the dependent-tables DELETE portion of a cascading delete script.
 * Returns the SQL string for all dependent DELETE statements.
 */
export function generateDependentDeletes(
    schema: string,
    table: string,
    pkColumns: PKColumn[],
    dependencies: FKDependency[]
): string {
    if (dependencies.length === 0) { return ''; }

    let script = `    -- Delete dependent records (from most dependent to least dependent)\n\n`;

    // Group by level and table to avoid duplicates
    const processedTables = new Set<string>();
    const groupedByLevel = new Map<number, FKDependency[]>();

    dependencies.forEach((dep) => {
        const tableKey = `${dep.level}_${dep.ref_schema}.${dep.ref_table}`;
        if (!processedTables.has(tableKey)) {
            processedTables.add(tableKey);
            if (!groupedByLevel.has(dep.level)) {
                groupedByLevel.set(dep.level, []);
            }
            groupedByLevel.get(dep.level)!.push(dep);
        }
    });

    // Build a lookup map: "schema.table" -> dep (prefer lowest-level for each table)
    const depLookup = new Map<string, FKDependency>();
    dependencies.forEach((dep) => {
        const key = `${dep.ref_schema}.${dep.ref_table}`;
        const existing = depLookup.get(key);
        if (!existing || dep.level < existing.level) {
            depLookup.set(key, dep);
        }
    });

    // Sort levels in descending order (delete most dependent first)
    const sortedLevels = Array.from(groupedByLevel.keys()).sort((a, b) => b - a);

    sortedLevels.forEach(level => {
        const depsAtLevel = groupedByLevel.get(level)!;

        depsAtLevel.forEach((dep) => {
            const refColsList = dep.ref_columns.split(', ');
            const targetColsList = dep.target_columns.split(', ');

            script += `    -- Level ${dep.level}: Delete from [${dep.ref_schema}].[${dep.ref_table}]\n`;
            script += `    -- Path: ${dep.path}\n`;
            script += `    DELETE [${dep.ref_schema}].[${dep.ref_table}]\n`;

            if (dep.level === 0) {
                // Direct dependency on the target table — use simple comparison
                const conditions = refColsList.map((col: string, i: number) =>
                    `[${col}] = @Target_${targetColsList[i]}`
                );
                script += `    WHERE ${conditions.join(' AND ')};\n`;
            } else {
                // For level > 0: try to find direct column mappings to root PK
                const columnMapping = traceColumnsToRoot(
                    dep.ref_schema, dep.ref_table,
                    schema, table, pkColumns, depLookup, new Set<string>()
                );

                // Check if all root PK columns are covered by columns in this table
                const rootPKsCovered = columnMapping && pkColumns.every(pk => {
                    for (const [, rootPK] of columnMapping) {
                        if (rootPK === pk.COLUMN_NAME) { return true; }
                    }
                    return false;
                });

                if (rootPKsCovered && columnMapping) {
                    // Direct comparison — columns in this table map to root PK
                    const conditions: string[] = [];
                    for (const pk of pkColumns) {
                        for (const [col, rootPK] of columnMapping) {
                            if (rootPK === pk.COLUMN_NAME) {
                                conditions.push(`[${col}] = @Target_${pk.COLUMN_NAME}`);
                                break;
                            }
                        }
                    }
                    script += `    WHERE ${conditions.join(' AND ')};\n`;
                } else if (refColsList.length === 1) {
                    // Single-column FK, no direct mapping — use IN subquery
                    const targetFilter = buildTargetFilter(dep.target_schema, dep.target_table, schema, table, pkColumns, depLookup, new Set<string>());
                    script += `    WHERE [${refColsList[0]}] IN (\n`;
                    script += `        SELECT [${targetColsList[0]}]\n`;
                    script += `        FROM [${dep.target_schema}].[${dep.target_table}]\n`;
                    script += `        WHERE ${targetFilter}\n`;
                    script += `    );\n`;
                } else {
                    // Multi-column FK, no direct mapping — use EXISTS
                    const targetFilter = buildTargetFilter(dep.target_schema, dep.target_table, schema, table, pkColumns, depLookup, new Set<string>());
                    const correlations = refColsList.map((col: string, i: number) =>
                        `[${dep.ref_schema}].[${dep.ref_table}].[${col}] = [${dep.target_schema}].[${dep.target_table}].[${targetColsList[i]}]`
                    );
                    script += `    WHERE EXISTS (\n`;
                    script += `        SELECT 1\n`;
                    script += `        FROM [${dep.target_schema}].[${dep.target_table}]\n`;
                    script += `        WHERE ${correlations.join('\n            AND ')}\n`;
                    script += `            AND ${targetFilter}\n`;
                    script += `    );\n`;
                }
            }

            script += `    PRINT 'Deleted ' + CAST(@@ROWCOUNT AS VARCHAR) + ' row(s) from [${dep.ref_schema}].[${dep.ref_table}]';\n\n`;
        });
    });

    return script;
}
