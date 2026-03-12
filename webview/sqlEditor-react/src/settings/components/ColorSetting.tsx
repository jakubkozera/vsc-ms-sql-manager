interface ColorSettingProps {
  label: string;
  description: string;
  value: string;
  onChange: (val: string) => void;
  id: string;
  isModified?: boolean;
}

export function ColorSetting({
  label,
  description,
  value,
  onChange,
  id,
  isModified = false,
}: ColorSettingProps) {
  const isEmpty = value.trim() === '';

  return (
    <div className={`setting-item${isModified ? ' modified' : ''}`}>
      <div className="setting-color-layout">
        <div className="setting-color-content">
          <div className="setting-header">
            <span className="setting-label">{label}</span>
          </div>
          <p className="setting-description">{description}</p>
        </div>
        <div className="setting-color-control">
          <div className="setting-color-row">
            <label className="setting-color-enable">
              <input
                type="checkbox"
                checked={!isEmpty}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange('#6adc7a');
                  } else {
                    onChange('');
                  }
                }}
              />
              <span>Enable</span>
            </label>
            {!isEmpty && (
              <div className="setting-color-picker-row">
                <input
                  id={id}
                  type="color"
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  className="setting-color-picker"
                  title={value}
                />
                <input
                  type="text"
                  value={value}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    onChange(raw);
                  }}
                  className="setting-color-hex"
                  placeholder="#6adc7a"
                  maxLength={9}
                  spellCheck={false}
                />
                <span
                  className="setting-color-preview"
                  style={{ backgroundColor: value }}
                  title="Preview"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
