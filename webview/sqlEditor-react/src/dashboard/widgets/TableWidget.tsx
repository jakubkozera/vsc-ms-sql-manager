import { Widget, WidgetQueryState } from '../types';

interface Props {
    widget: Widget;
    queryState?: WidgetQueryState;
}

export function TableWidget({ widget: _widget, queryState }: Props) {
    if (!queryState || queryState.status !== 'success' || queryState.rows.length === 0) {
        return null;
    }

    return (
        <div className="table-widget">
            <table>
                <thead>
                    <tr>
                        {queryState.columns.map((col, i) => (
                            <th key={i}>{col}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {queryState.rows.map((row, ri) => (
                        <tr key={ri}>
                            {(row as unknown[]).map((cell, ci) => (
                                <td key={ci}>{cell == null ? '' : String(cell)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
