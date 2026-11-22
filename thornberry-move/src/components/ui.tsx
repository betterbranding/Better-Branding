import { Check, X } from 'lucide-react';
import React from 'react';

export const CheckCircle: React.FC<{ checked: boolean; onToggle: () => void; label: string }> = ({
  checked,
  onToggle,
  label,
}) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={checked}
    className={`tm-check ${checked ? 'is-checked' : ''}`}
    onClick={(e) => {
      e.stopPropagation();
      onToggle();
    }}
  >
    {checked && <Check size={14} strokeWidth={3} />}
  </button>
);

export const Chips: React.FC<{
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
}> = ({ options, value, onChange }) => (
  <div className="tm-chips">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        className={`tm-chip ${value === o.value ? 'is-active' : ''}`}
        onClick={() => onChange(o.value)}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="tm-field">
    <span>{label}</span>
    {children}
  </label>
);

export const Sheet: React.FC<{
  title: string;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  canSave: boolean;
  children: React.ReactNode;
}> = ({ title, onClose, onSave, onDelete, canSave, children }) => (
  <div className="tm-overlay" onClick={onClose}>
    <form
      className="tm-sheet"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave();
      }}
    >
      <div className="tm-sheet-head">
        <h2>{title}</h2>
        <button type="button" className="tm-icon-btn" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="tm-sheet-body">{children}</div>
      <div className="tm-sheet-foot">
        {onDelete && (
          <button type="button" className="tm-btn tm-btn-ghost" onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="submit" className="tm-btn tm-btn-red" disabled={!canSave}>
          Save
        </button>
      </div>
    </form>
  </div>
);

export const Fab: React.FC<{ label: string; onClick: () => void; icon: React.ReactNode }> = ({ label, onClick, icon }) => (
  <button type="button" className="tm-fab" onClick={onClick}>
    {icon}
    {label}
  </button>
);
