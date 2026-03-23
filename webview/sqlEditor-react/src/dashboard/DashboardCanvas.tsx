import { useCallback } from 'react';
import GridLayout, { Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { Dashboard, Widget, WidgetQueryState } from './types';
import { WidgetCard } from './WidgetCard';

interface Props {
    dashboard: Dashboard;
    editMode: boolean;
    widgetQueryStates: Record<string, WidgetQueryState>;
    onLayoutChange: (widgets: Widget[]) => void;
    onEditWidget: (widget: Widget) => void;
    onDeleteWidget: (widgetId: string) => void;
    onRefreshWidget: (widget: Widget) => void;
}

const COL_WIDTH = 1200;
const COLS = 12;
const ROW_HEIGHT = 80;

export function DashboardCanvas({
    dashboard,
    editMode,
    widgetQueryStates,
    onLayoutChange,
    onEditWidget,
    onDeleteWidget,
    onRefreshWidget,
}: Props) {
    const layout: Layout[] = dashboard.widgets.map(w => ({ ...w.layout }));

    const handleLayoutChange = useCallback((newLayout: Layout[]) => {
        const updatedWidgets = dashboard.widgets.map(w => {
            const l = newLayout.find(l => l.i === w.id);
            if (!l) return w;
            return { ...w, layout: { i: l.i, x: l.x, y: l.y, w: l.w, h: l.h } };
        });
        onLayoutChange(updatedWidgets);
    }, [dashboard.widgets, onLayoutChange]);

    if (dashboard.widgets.length === 0) {
        return (
            <div className="canvas-empty">
                {editMode ? (
                    <p>Click <strong>+ Add Widget</strong> to get started.</p>
                ) : (
                    <p>No widgets. Click <strong>Edit Layout</strong> to add some.</p>
                )}
            </div>
        );
    }

    return (
        <div className="dashboard-canvas">
            <GridLayout
                className="layout"
                layout={layout}
                cols={COLS}
                rowHeight={ROW_HEIGHT}
                width={COL_WIDTH}
                isDraggable={editMode}
                isResizable={editMode}
                onLayoutChange={handleLayoutChange}
                margin={[12, 12]}
                containerPadding={[12, 12]}
                draggableCancel=".widget-actions"
            >
                {dashboard.widgets.map(widget => (
                    <div key={widget.id}>
                        <WidgetCard
                            widget={widget}
                            queryState={widgetQueryStates[widget.id]}
                            editMode={editMode}
                            onEdit={() => onEditWidget(widget)}
                            onDelete={() => onDeleteWidget(widget.id)}
                            onRefresh={() => onRefreshWidget(widget)}
                        />
                    </div>
                ))}
            </GridLayout>
        </div>
    );
}
