interface BooleanSettingProps {
  label: string;
  description: string;
  value: boolean;
  onChange: (val: boolean) => void;
  id: string;
  isModified?: boolean;
}

export function BooleanSetting({
  label,
  description,
  value,
  onChange,
  id,
  isModified = false,
}: BooleanSettingProps) {
  return (
    <div className={`setting-item${isModified ? ' modified' : ''}`}>
      <div className="setting-boolean-layout">
        <div className="setting-boolean-control">
          <button
            type="button"
            id={id}
            role="switch"
            aria-checked={value}
            aria-label={label}
            className={`setting-switch${value ? ' checked' : ''}`}
            onClick={() => onChange(!value)}
          >
            <span className="setting-switch-thumb" />
          </button>
        </div>
        <div className="setting-boolean-content">
          <div className="setting-header">
            <span className="setting-label">{label}</span>
          </div>
          <p className="setting-description">{description}</p>
        </div>
      </div>
    </div>
  );
}
