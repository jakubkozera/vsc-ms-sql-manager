interface NumberSettingProps {
  label: string;
  description: string;
  value: number;
  onChange: (val: number) => void;
  id: string;
  min?: number;
  max?: number;
  isModified?: boolean;
}

export function NumberSetting({
  label,
  description,
  value,
  onChange,
  id,
  min,
  max,
  isModified = false,
}: NumberSettingProps) {
  return (
    <div className={`setting-item${isModified ? ' modified' : ''}`}>
      <div className="setting-header">
        <label className="setting-label" htmlFor={id}>{label}</label>
      </div>
      <p className="setting-description">{description}</p>
      <input
        type="number"
        id={id}
        className="setting-input-number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      />
    </div>
  );
}
