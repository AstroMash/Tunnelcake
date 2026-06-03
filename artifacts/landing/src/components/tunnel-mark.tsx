export function TunnelMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="32" cy="32" r="27" stroke="#22d3ee" strokeWidth="3" />
      <circle cx="32" cy="32" r="20" stroke="#2ad6c0" strokeWidth="3" />
      <circle cx="32" cy="32" r="13" stroke="#7fdc4e" strokeWidth="3" />
      <circle cx="32" cy="32" r="6.5" fill="#a3e635" />
    </svg>
  );
}
