import { Widget } from '../types';

interface Props {
    widget: Widget;
}

export function TextWidget({ widget }: Props) {
    return (
        <div className="text-widget">
            {widget.textContent || <span className="muted">No content.</span>}
        </div>
    );
}
