import {
    IconRefresh,
    IconPencil,
    IconTrash,
} from '@tabler/icons-react';
import { Widget, WidgetQueryState } from './types';
import { ChartWidget } from './widgets/ChartWidget';
import { MetricWidget } from './widgets/MetricWidget';
import { TableWidget } from './widgets/TableWidget';
import { TextWidget } from './widgets/TextWidget';

interface Props {
    widget: Widget;
    queryState?: WidgetQueryState;
    editMode: boolean;
    onEdit: () => void;
    onDelete: () => void;
    onRefresh: () => void;
}

export function WidgetCard({ widget, queryState, editMode, onEdit, onDelete, onRefresh }: Props) {
    return (
        <div className="widget-card">
            <div className="widget-header">
                <span className="widget-title">{widget.title}</span>
                <div className="widget-actions" onMouseDown={e => e.stopPropagation()}>
                    {widget.type !== 'text' && (
                        <button className="btn-icon-sm" title="Refresh" onClick={onRefresh}>
                            <IconRefresh size={14} />
                        </button>
                    )}
                    <button className="btn-icon-sm" title="Edit" onClick={onEdit}>
                        <IconPencil size={14} />
                    </button>
                    {editMode && (
                        <button className="btn-icon-sm btn-danger" title="Delete" onClick={onDelete}>
                            <IconTrash size={14} />
                        </button>
                    )}
                </div>
            </div>

            <div className="widget-content">
                {queryState?.status === 'loading' && (
                    <div className="widget-loading">Loading…</div>
                )}
                {queryState?.status === 'error' && (
                    <div className="widget-error">{queryState.error}</div>
                )}
                {widget.type === 'text' && (
                    <TextWidget widget={widget} />
                )}
                {widget.type === 'chart' && (
                    <ChartWidget widget={widget} queryState={queryState} />
                )}
                {widget.type === 'metric' && (
                    <MetricWidget widget={widget} queryState={queryState} />
                )}
                {widget.type === 'table' && (
                    <TableWidget widget={widget} queryState={queryState} />
                )}
                {!queryState && widget.type !== 'text' && (
                    <div className="widget-no-data">No data — click ↺ to load</div>
                )}
            </div>
        </div>
    );
}
