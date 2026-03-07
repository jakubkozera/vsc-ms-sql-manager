interface SelectOption {
  value: string;
  label: string;
}

interface SelectSettingProps {
  label: string;
  description: string;
  value: string;
  onChange: (val: string) => void;
  options: SelectOption[];
  id: string;
  isModified?: boolean;
}

export function SelectSetting({
  label,
  description,
  value,
  onChange,
  options,
  id,
  isModified = false,
}: SelectSettingProps) {
  return (
    <div className={`setting-item${isModified ? ' modified' : ''}`}>
      <div className="setting-header">
        <label className="setting-label" htmlFor={id}>{label}</label>
      </div>
      <p className="setting-description">{description}</p>
      <select
        id={id}
        className="setting-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
