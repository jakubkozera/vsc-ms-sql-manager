import { Widget, WidgetQueryState } from '../types';

interface Props {
    widget: Widget;
    queryState?: WidgetQueryState;
}

export function MetricWidget({ widget: _widget, queryState }: Props) {
    if (!queryState || queryState.status !== 'success' || queryState.rows.length === 0) {
        return null;
    }

    const value = String(queryState.rows[0]?.[0] ?? '—');
    const label = queryState.rows[0]?.[1] != null ? String(queryState.rows[0][1]) : null;

    return (
        <div className="metric-widget">
            <div className="metric-value">{value}</div>
            {label && <div className="metric-label">{label}</div>}
        </div>
    );
}
