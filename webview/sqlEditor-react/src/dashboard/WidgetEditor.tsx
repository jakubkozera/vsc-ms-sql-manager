import { useState, useCallback, useRef, type JSX } from 'react';
import Editor from '@monaco-editor/react';
import {
    IconX,
    IconPlayerPlay,
    IconChartBar,
    IconChartLine,
    IconChartArea,
    IconChartPie,
    IconChartDonut,
    IconTable,
    IconNumber123,
    IconAlignLeft,
} from '@tabler/icons-react';
import { Widget, WidgetType, ChartType } from './types';

interface PreviewState {
    status: 'idle' | 'loading' | 'success' | 'error';
    columns: string[];
    rows: unknown[][];
    error?: string;
}

interface Props {
    widget: Widget;
    isNew: boolean;
    databases: string[];
    defaultDatabase: string;
    previewStates: Record<string, PreviewState>;
    onSave: (widget: Widget) => void;
    onCancel: () => void;
    onPreview: (sql: string, database: string, requestId: string) => void;
}

const WIDGET_TYPES: { value: WidgetType; label: string; icon: JSX.Element }[] = [
    { value: 'chart', label: 'Chart', icon: <IconChartBar size={15} /> },
    { value: 'metric', label: 'Metric', icon: <IconNumber123 size={15} /> },
    { value: 'table', label: 'Table', icon: <IconTable size={15} /> },
    { value: 'text', label: 'Text', icon: <IconAlignLeft size={15} /> },
];

const CHART_TYPES: { value: ChartType; label: string; icon: JSX.Element }[] = [
    { value: 'bar', label: 'Bar', icon: <IconChartBar size={15} /> },
    { value: 'line', label: 'Line', icon: <IconChartLine size={15} /> },
    { value: 'area', label: 'Area', icon: <IconChartArea size={15} /> },
    { value: 'pie', label: 'Pie', icon: <IconChartPie size={15} /> },
    { value: 'doughnut', label: 'Donut', icon: <IconChartDonut size={15} /> },
];

export function WidgetEditor({
    widget: initialWidget,
    isNew,
    databases,
    defaultDatabase,
    previewStates,
    onSave,
    onCancel,
    onPreview,
}: Props) {
    const [widget, setWidget] = useState<Widget>({
        ...initialWidget,
        database: initialWidget.database || defaultDatabase,
    });
    const previewRequestId = useRef(`preview-${widget.id}`);
    const previewState = previewStates[previewRequestId.current];

    const set = useCallback(<K extends keyof Widget>(key: K, value: Widget[K]) => {
        setWidget(prev => ({ ...prev, [key]: value }));
    }, []);

    const setChartConfig = useCallback(<K extends keyof Widget['chartConfig']>(
        key: K,
        value: Widget['chartConfig'][K]
    ) => {
        setWidget(prev => ({
            ...prev,
            chartConfig: { ...prev.chartConfig, [key]: value },
        }));
    }, []);

    function handlePreview() {
        if (!widget.sql.trim()) return;
        previewRequestId.current = `preview-${widget.id}-${Date.now()}`;
        onPreview(widget.sql, widget.database, previewRequestId.current);
    }

    const previewColumns = previewState?.status === 'success' ? previewState.columns : [];
    const previewRows = previewState?.status === 'success' ? previewState.rows : [];

    return (
        <div className="widget-editor-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
            <div className="widget-editor-panel">
                <div className="widget-editor-header">
                    <h3>{isNew ? 'Add Widget' : 'Edit Widget'}</h3>
                    <button className="btn-icon" onClick={onCancel}><IconX size={18} /></button>
                </div>

                <div className="widget-editor-body">
                    {/* Title */}
                    <div className="field">
                        <label>Title</label>
                        <input
                            className="input"
                            value={widget.title}
                            onChange={e => set('title', e.target.value)}
                            placeholder="Widget title"
                        />
                    </div>

                    {/* Type selector */}
                    <div className="field">
                        <label>Type</label>
                        <div className="btn-group">
                            {WIDGET_TYPES.map(t => (
                                <button
                                    key={t.value}
                                    className={`btn btn-sm ${widget.type === t.value ? 'btn-active' : 'btn-secondary'}`}
                                    onClick={() => set('type', t.value)}
                                >
                                    {t.icon} {t.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Text content (text type only) */}
                    {widget.type === 'text' && (
                        <div className="field">
                            <label>Content</label>
                            <textarea
                                className="input textarea"
                                rows={5}
                                value={widget.textContent}
                                onChange={e => set('textContent', e.target.value)}
                                placeholder="Enter text content…"
                            />
                        </div>
                    )}

                    {/* SQL section (non-text types) */}
                    {widget.type !== 'text' && (
                        <>
                            {/* Database */}
                            <div className="field">
                                <label>Database</label>
                                <select
                                    className="input select"
                                    value={widget.database}
                                    onChange={e => set('database', e.target.value)}
                                >
                                    {databases.length === 0 && (
                                        <option value={widget.database}>{widget.database || '(default)'}</option>
                                    )}
                                    {databases.map(db => (
                                        <option key={db} value={db}>{db}</option>
                                    ))}
                                </select>
                            </div>

                            {/* SQL Editor */}
                            <div className="field">
                                <div className="field-row">
                                    <label>SQL Query</label>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={handlePreview}
                                        disabled={!widget.sql.trim()}
                                    >
                                        <IconPlayerPlay size={13} /> Preview
                                    </button>
                                </div>
                                <div className="sql-editor-wrapper">
                                    <Editor
                                        height="180px"
                                        language="sql"
                                        value={widget.sql}
                                        onChange={v => set('sql', v ?? '')}
                                        theme="vs-dark"
                                        options={{
                                            minimap: { enabled: false },
                                            scrollBeyondLastLine: false,
                                            fontSize: 13,
                                            lineNumbers: 'off',
                                            folding: false,
                                            wordWrap: 'on',
                                        }}
                                    />
                                </div>
                            </div>

                            {/* Preview result */}
                            {previewState?.status === 'loading' && (
                                <div className="preview-loading">Running preview…</div>
                            )}
                            {previewState?.status === 'error' && (
                                <div className="preview-error">{previewState.error}</div>
                            )}
                            {previewState?.status === 'success' && previewRows.length > 0 && (
                                <div className="preview-table-wrapper">
                                    <table className="preview-table">
                                        <thead>
                                            <tr>{previewColumns.map((c, i) => <th key={i}>{c}</th>)}</tr>
                                        </thead>
                                        <tbody>
                                            {previewRows.slice(0, 10).map((row, ri) => (
                                                <tr key={ri}>
                                                    {(row as unknown[]).map((cell, ci) => (
                                                        <td key={ci}>{cell == null ? '' : String(cell)}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {previewRows.length > 10 && (
                                        <div className="preview-truncation">Showing 10 of {previewRows.length} rows</div>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* Chart config (chart type only) */}
                    {widget.type === 'chart' && (
                        <div className="field chart-config">
                            <label>Chart Type</label>
                            <div className="btn-group">
                                {CHART_TYPES.map(t => (
                                    <button
                                        key={t.value}
                                        className={`btn btn-sm ${widget.chartConfig.chartType === t.value ? 'btn-active' : 'btn-secondary'}`}
                                        onClick={() => setChartConfig('chartType', t.value)}
                                    >
                                        {t.icon} {t.label}
                                    </button>
                                ))}
                            </div>

                            <div className="field-row axis-row">
                                <div className="field half">
                                    <label>X Axis (labels)</label>
                                    <select
                                        className="input select"
                                        value={widget.chartConfig.xAxis}
                                        onChange={e => setChartConfig('xAxis', e.target.value)}
                                    >
                                        <option value="">— auto (col 1) —</option>
                                        {previewColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div className="field half">
                                    <label>Y Axis (values)</label>
                                    <select
                                        className="input select"
                                        value={widget.chartConfig.yAxis}
                                        onChange={e => setChartConfig('yAxis', e.target.value)}
                                    >
                                        <option value="">— auto (col 2) —</option>
                                        {previewColumns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div className="field">
                                <label>Color</label>
                                <input
                                    type="color"
                                    value={widget.chartConfig.color}
                                    onChange={e => setChartConfig('color', e.target.value)}
                                    className="color-input"
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="widget-editor-footer">
                    <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onSave(widget)}
                        disabled={!widget.title.trim() || (widget.type !== 'text' && !widget.sql.trim())}
                    >
                        {isNew ? 'Add' : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}
