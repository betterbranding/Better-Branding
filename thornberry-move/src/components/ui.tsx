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

/** Moving-box logo. `face` fills the box, `line` draws the edges and tape. */
export const MovingBox: React.FC<{ size?: number; face?: string; line?: string }> = ({
  size = 34,
  face = '#fff',
  line = '#cc0000',
}) => (
  <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
    <g strokeLinejoin="round" strokeLinecap="round">
      <path d="M17 3.5 L30.5 10 V24.5 L17 31 L3.5 24.5 V10 Z" fill={face} />
      <path d="M3.5 10 L17 16.5 L30.5 10 M17 16.5 V31" fill="none" stroke={line} strokeWidth="1.6" />
      <path d="M10.25 6.75 L23.75 13.25 V20" fill="none" stroke={line} strokeWidth="2.6" />
    </g>
  </svg>
);
