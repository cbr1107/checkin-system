export default function Skeleton({ width = '100%', height = 14, style, className = '' }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height, display: 'block', ...style }}
      aria-hidden="true"
    />
  );
}
