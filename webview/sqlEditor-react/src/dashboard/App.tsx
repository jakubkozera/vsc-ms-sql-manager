import { useEffect, useState, useCallback } from 'react';
import {
    IconPlus,
    IconLayoutDashboard,
    IconCheck,
} from '@tabler/icons-react';
import { useVSCode } from './hooks/useVSCode';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardCanvas } from './DashboardCanvas';
import { WidgetEditor } from './WidgetEditor';
import { Dashboard, Widget } from './types';
import './styles.css';

export default function App() {
    const { state, postMessage, setWidgetQueryLoading, setPreviewLoading } = useVSCode();
    const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
    const [isNewWidget, setIsNewWidget] = useState(false);

    // Load dashboards on mount
    useEffect(() => {
        postMessage({ type: 'getDashboards' });
        postMessage({ type: 'getConnectionDatabases' });
    }, [postMessage]);

    // Auto-select first dashboard when loaded
    useEffect(() => {
        if (state.dashboards.length > 0 && !activeDashboardId) {
            setActiveDashboardId(state.dashboards[0].id);
        }
        // If active dashboard was deleted, clear selection or pick first
        if (activeDashboardId && !state.dashboards.find(d => d.id === activeDashboardId)) {
            setActiveDashboardId(state.dashboards[0]?.id ?? null);
        }
    }, [state.dashboards, activeDashboardId]);

    const activeDashboard = state.dashboards.find(d => d.id === activeDashboardId) ?? null;

    const handleSaveDashboard = useCallback((dashboard: Dashboard) => {
        postMessage({ type: 'saveDashboard', dashboard });
    }, [postMessage]);

    const handleAddWidget = useCallback(() => {
        if (!activeDashboard) return;
        // Create a fresh empty widget to edit
        const newWidget: Widget = {
            id: crypto.randomUUID(),
            type: 'chart',
            title: 'New Widget',
            sql: '',
            database: state.defaultDatabase,
            chartConfig: { chartType: 'bar', xAxis: '', yAxis: '', color: '#4e8ef7' },
            textContent: '',
            layout: { i: crypto.randomUUID(), x: 0, y: Infinity, w: 6, h: 4 },
        };
        newWidget.layout.i = newWidget.id;
        setEditingWidget(newWidget);
        setIsNewWidget(true);
    }, [activeDashboard, state.defaultDatabase]);

    const handleEditWidget = useCallback((widget: Widget) => {
        setEditingWidget({ ...widget });
        setIsNewWidget(false);
    }, []);

    const handleDeleteWidget = useCallback((widgetId: string) => {
        if (!activeDashboard) return;
        const updated: Dashboard = {
            ...activeDashboard,
            widgets: activeDashboard.widgets.filter(w => w.id !== widgetId),
        };
        handleSaveDashboard(updated);
    }, [activeDashboard, handleSaveDashboard]);

    const handleRefreshWidget = useCallback((widget: Widget) => {
        if (!widget.sql) return;
        setWidgetQueryLoading(widget.id);
        postMessage({
            type: 'executeWidgetQuery',
            widgetId: widget.id,
            sql: widget.sql,
            database: widget.database,
        });
    }, [postMessage, setWidgetQueryLoading]);

    const handleWidgetEditorSave = useCallback((widget: Widget) => {
        if (!activeDashboard) return;
        const exists = activeDashboard.widgets.find(w => w.id === widget.id);
        const updated: Dashboard = {
            ...activeDashboard,
            widgets: exists
                ? activeDashboard.widgets.map(w => w.id === widget.id ? widget : w)
                : [...activeDashboard.widgets, widget],
        };
        handleSaveDashboard(updated);
        setEditingWidget(null);
        // Auto-run the widget query
        if (widget.sql) {
            setWidgetQueryLoading(widget.id);
            postMessage({
                type: 'executeWidgetQuery',
                widgetId: widget.id,
                sql: widget.sql,
                database: widget.database,
            });
        }
    }, [activeDashboard, handleSaveDashboard, postMessage, setWidgetQueryLoading]);

    const handleLayoutChange = useCallback((widgets: Widget[]) => {
        if (!activeDashboard) return;
        const updated: Dashboard = { ...activeDashboard, widgets };
        handleSaveDashboard(updated);
    }, [activeDashboard, handleSaveDashboard]);

    return (
        <div className="dashboard-app">
            <DashboardSidebar
                dashboards={state.dashboards}
                activeDashboardId={activeDashboardId}
                onSelect={setActiveDashboardId}
                onCreateDashboard={(name) => postMessage({ type: 'createDashboard', name })}
                onDeleteDashboard={(id) => postMessage({ type: 'deleteDashboard', dashboardId: id })}
                onRenameDashboard={(id, name) => postMessage({ type: 'renameDashboard', dashboardId: id, name })}
            />

            <div className="dashboard-main">
                {activeDashboard ? (
                    <>
                        <div className="dashboard-toolbar">
                            <span className="dashboard-title">{activeDashboard.name}</span>
                            <div className="dashboard-toolbar-actions">
                                {editMode && (
                                    <button className="btn btn-primary" onClick={handleAddWidget}>
                                        <IconPlus size={15} /> Add Widget
                                    </button>
                                )}
                                <button
                                    className={`btn ${editMode ? 'btn-active' : 'btn-secondary'}`}
                                    onClick={() => setEditMode(m => !m)}
                                >
                                    {editMode ? <><IconCheck size={15} /> Done Editing</> : <><IconLayoutDashboard size={15} /> Edit Layout</>}
                                </button>
                            </div>
                        </div>

                        <DashboardCanvas
                            dashboard={activeDashboard}
                            editMode={editMode}
                            widgetQueryStates={state.widgetQueryStates}
                            onLayoutChange={handleLayoutChange}
                            onEditWidget={handleEditWidget}
                            onDeleteWidget={handleDeleteWidget}
                            onRefreshWidget={handleRefreshWidget}
                        />
                    </>
                ) : (
                    <div className="dashboard-empty">
                        <p>No dashboards yet. Create one from the sidebar.</p>
                    </div>
                )}
            </div>

            {editingWidget && (
                <WidgetEditor
                    widget={editingWidget}
                    isNew={isNewWidget}
                    databases={state.databases}
                    defaultDatabase={state.defaultDatabase}
                    previewStates={state.previewStates}
                    onSave={handleWidgetEditorSave}
                    onCancel={() => setEditingWidget(null)}
                    onPreview={(sql, database, requestId) => {
                        setPreviewLoading(requestId);
                        postMessage({ type: 'previewQuery', requestId, sql, database });
                    }}
                />
            )}
        </div>
    );
}
