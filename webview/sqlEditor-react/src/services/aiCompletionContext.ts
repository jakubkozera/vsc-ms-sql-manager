import type { DatabaseSchema, ForeignKeyInfo } from '../types/schema';

const defaultMaxChars = 6000;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\w])${escapeRegExp(name)}($|[^\\w])`, 'i').test(text);
}

/**
 * Builds a compact schema description for the AI completion prompt.
 * Objects referenced in the editor text are listed with columns; remaining
 * object names are listed afterwards until the size budget is exhausted.
 */
export function buildSchemaContext(
  schema: DatabaseSchema | undefined,
  editorText: string,
  maxChars: number = defaultMaxChars
): string {
  if (!schema) return '';

  const objects = [
    ...(schema.tables || []).map((t) => ({ ...t, kind: 'TABLE' })),
    ...(schema.views || []).map((v) => ({ ...v, kind: 'VIEW' })),
  ];
  if (objects.length === 0) return '';

  const referenced = objects.filter((o) => mentions(editorText, o.name));
  const referencedKeys = new Set(referenced.map((o) => `${o.schema}.${o.name}`.toLowerCase()));

  const lines: string[] = [];
  let size = 0;
  const push = (line: string): boolean => {
    if (size + line.length + 1 > maxChars) return false;
    lines.push(line);
    size += line.length + 1;
    return true;
  };

  for (const obj of referenced) {
    const cols = (obj.columns || []).map((c) => `${c.name} ${c.type}${c.isPrimaryKey ? ' PK' : ''}`).join(', ');
    if (!push(`${obj.kind} [${obj.schema}].[${obj.name}] (${cols})`)) break;
  }

  const fks = (schema.foreignKeys || []).filter(
    (fk: ForeignKeyInfo) =>
      referencedKeys.has(`${fk.fromSchema}.${fk.fromTable}`.toLowerCase()) ||
      referencedKeys.has(`${fk.toSchema}.${fk.toTable}`.toLowerCase())
  );
  for (const fk of fks) {
    if (!push(`FK [${fk.fromSchema}].[${fk.fromTable}].[${fk.fromColumn}] -> [${fk.toSchema}].[${fk.toTable}].[${fk.toColumn}]`)) break;
  }

  const others = objects.filter((o) => !referencedKeys.has(`${o.schema}.${o.name}`.toLowerCase()));
  if (others.length > 0 && push('Other objects:')) {
    for (const obj of others) {
      if (!push(`[${obj.schema}].[${obj.name}]`)) break;
    }
  }

  return lines.join('\n');
}
