import { useMemo, useState } from 'react';
import MonacoEditor from '@monaco-editor/react';
import { format } from 'sql-formatter';
import type { ExtensionSettings } from '../types';

interface FormattingPreviewProps {
  settings: Pick<
    ExtensionSettings,
    | 'tabWidth'
    | 'keywordCase'
    | 'dataTypeCase'
    | 'functionCase'
    | 'linesBetweenQueries'
    | 'indentStyle'
    | 'logicalOperatorNewline'
  >;
}

type SampleId = 'analytics' | 'joins' | 'ddl';

const SAMPLE_QUERIES: Record<SampleId, { label: string; sql: string }> = {
  analytics: {
    label: 'Analytics',
    sql: `select top 25 c.customerid,c.companyname,sum(od.unitprice*od.quantity) as totalsales
from sales.customers c
inner join sales.orders o on o.customerid=c.customerid
inner join sales.orderdetails od on od.orderid=o.orderid
where o.orderdate >= '2025-01-01' and o.shipcountry in ('Poland','Germany')
group by c.customerid,c.companyname
having sum(od.unitprice*od.quantity) > 10000
order by totalsales desc;

select count(*) as delayedorders from sales.orders where shippeddate > requireddate;`,
  },
  joins: {
    label: 'Joins',
    sql: `select p.productid,p.productname,s.companyname as supplier,c.categoryname
from production.products p
left join production.categories c on c.categoryid=p.categoryid
left join production.suppliers s on s.supplierid=p.supplierid
where p.discontinued = 0 and (c.categoryname = 'Beverages' or c.categoryname = 'Seafood')
order by c.categoryname,p.productname;`,
  },
  ddl: {
    label: 'DDL + Procedure',
    sql: `create table dbo.auditlog(id int identity(1,1) primary key,entityname nvarchar(128) not null,createdat datetime2 not null default sysutcdatetime());

create or alter procedure dbo.usp_getrecentaudit
@entityname nvarchar(128)
as
begin
  set nocount on;
  select top 50 id,entityname,createdat
  from dbo.auditlog
  where entityname=@entityname and createdat >= dateadd(day,-30,sysutcdatetime())
  order by createdat desc;
end;`,
  },
};

function getMonacoTheme(): 'vs' | 'vs-dark' | 'hc-black' | 'hc-light' {
  if (document.body.classList.contains('vscode-high-contrast-light')) return 'hc-light';
  if (document.body.classList.contains('vscode-high-contrast')) return 'hc-black';
  if (document.body.classList.contains('vscode-light')) return 'vs';
  return 'vs-dark';
}

export function FormattingPreview({ settings }: FormattingPreviewProps) {
  const [sampleId, setSampleId] = useState<SampleId>('analytics');

  const formattedPreview = useMemo(() => {
    const sourceSql = SAMPLE_QUERIES[sampleId].sql;

    try {
      return format(sourceSql, {
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
      return sourceSql;
    }
  }, [
    sampleId,
    settings.tabWidth,
    settings.keywordCase,
    settings.dataTypeCase,
    settings.functionCase,
    settings.linesBetweenQueries,
    settings.indentStyle,
    settings.logicalOperatorNewline,
  ]);

  return (
    <section className="format-preview" aria-label="SQL formatting preview">
      <div className="format-preview-header">
        <div>
          <h3 className="format-preview-title">Live SQL Preview</h3>
          <p className="format-preview-subtitle">
            Preview updates automatically when formatting options change.
          </p>
        </div>
      </div>

      <div className="format-preview-samples" role="tablist" aria-label="Sample SQL queries">
        {(Object.keys(SAMPLE_QUERIES) as SampleId[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={sampleId === id}
            className={`format-preview-sample${sampleId === id ? ' active' : ''}`}
            onClick={() => setSampleId(id)}
          >
            {SAMPLE_QUERIES[id].label}
          </button>
        ))}
      </div>

      <div className="format-preview-editor">
        <MonacoEditor
          height="260px"
          language="sql"
          value={formattedPreview}
          theme={getMonacoTheme()}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            folding: true,
            fontSize: 13,
            wordWrap: 'on',
            renderLineHighlight: 'none',
            contextmenu: false,
          }}
        />
      </div>
    </section>
  );
}
