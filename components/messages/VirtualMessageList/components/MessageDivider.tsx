interface MessageDividerProps {
  label: string;
  style?: React.CSSProperties;
}

export function MessageDivider({ label, style }: MessageDividerProps) {
  return (
    <div style={style} className="flex items-center gap-3 px-6 py-3">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs text-muted font-medium select-none shrink-0">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
