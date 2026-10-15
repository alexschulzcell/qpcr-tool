import { useState } from 'react';

export function Dropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={over ? 'dropzone over' : 'dropzone'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
    >
      <input
        type="file"
        accept=".xlsx,.xls,.csv,.txt"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
      <svg viewBox="0 0 48 48" className="drop-icon" aria-hidden="true">
        <path d="M24 31V11m0 0-7 7m7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 29v6a4 4 0 0 0 4 4h22a4 4 0 0 0 4-4v-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <strong>Drop your QuantStudio export here</strong>
      <span className="muted">or click to choose a file · .xlsx, .xls, .csv or .txt · several plates possible</span>
      <span className="muted small">Ct values are read from the “Results” sheet</span>
    </label>
  );
}