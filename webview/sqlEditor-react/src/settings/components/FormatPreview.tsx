import { useMemo, useEffect, useRef } from 'react';
import MonacoEditor, { OnMount } from '@monaco-editor/react';
import { format } from 'sql-formatter';
import type { ExtensionSettings } from '../types';

/**
 * Compact raw SQL that exercises keywords, data types, aggregate functions,
 * JOINs, AND/OR logic and multiple statements — showcasing all formatting options.
 */
const SAMPLE_SQL =
  `select e.employee_id, e.first_name, e.last_name, d.department_name, ` +
  `count(p.project_id) as project_count, sum(p.budget) as total_budget, ` +
  `cast(e.salary as decimal(10, 2)) as salary ` +
  `from employees as e ` +
  `inner join departments as d on e.department_id = d.department_id ` +
  `left join employee_projects as ep on e.employee_id = ep.employee_id ` +
  `left join projects as p on ep.project_id = p.project_id ` +
  `where e.hire_date >= '2020-01-01' ` +
  `and (d.department_name = 'Engineering' or d.department_name = 'Marketing') ` +
  `and e.salary > 50000 ` +
  `group by e.employee_id, e.first_name, e.last_name, d.department_name ` +
  `having count(p.project_id) > 2 ` +
  `order by total_budget desc; ` +
  `select top 10 p.project_name, p.budget, isnull(p.end_date, getdate()) as effective_end ` +
  `from projects as p where p.status = 'active' order by p.budget desc`;

type FormatSettingKeys =
  | 'tabWidth'
  | 'keywordCase'
  | 'dataTypeCase'
  | 'functionCase'
  | 'linesBetweenQueries'
  | 'indentStyle'
  | 'logicalOperatorNewline';

export type FormatPreviewSettings = Pick<ExtensionSettings, FormatSettingKeys>;

export interface FormatPreviewProps {
  settings: FormatPreviewSettings;
}

function getTheme(): 'vs' | 'vs-dark' | 'hc-black' | 'hc-light' {
  const { classList } = document.body;
  if (classList.contains('vscode-high-contrast-light')) return 'hc-light';
  if (classList.contains('vscode-high-contrast')) return 'hc-black';
  if (classList.contains('vscode-light')) return 'vs';
  return 'vs-dark';
}

export function FormatPreview({ settings }: FormatPreviewProps) {
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null);

  const formatted = useMemo(() => {
    try {
      return format(SAMPLE_SQL, {
        language: 'transactsql',
        tabWidth: settings.tabWidth,
        keywordCase: settings.keywordCase,
        dataTypeCase: settings.dataTypeCase,
        functionCase: settings.functionCase,
        linesBetweenQueries: settings.linesBetweenQueries,
        indentStyle: settings.indentStyle,
        logicalOperatorNewline: settings.logicalOperatorNewline,
      });
    } catch {
      return SAMPLE_SQL;
    }
  }, [
    settings.tabWidth,
    settings.keywordCase,
    settings.dataTypeCase,
    settings.functionCase,
    settings.linesBetweenQueries,
    settings.indentStyle,
    settings.logicalOperatorNewline,
  ]);

  useEffect(() => {
    editorRef.current?.setValue(formatted);
  }, [formatted]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  return (
    <div className="format-preview">
      <div className="format-preview-header">
        <span className="format-preview-title">Live Preview</span>
      </div>
      <div className="format-preview-editor">
        <MonacoEditor
          defaultLanguage="sql"
          defaultValue={formatted}
          theme={getTheme()}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: 'on',
            folding: false,
            wordWrap: 'off',
            scrollbar: { vertical: 'auto', horizontal: 'auto' },
            contextmenu: false,
            renderLineHighlight: 'none',
          }}
          onMount={handleMount}
        />
      </div>
    </div>
  );
}
