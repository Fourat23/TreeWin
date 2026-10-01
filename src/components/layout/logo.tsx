/** CELLTREE mark: a root cell splitting into three children (one per profile). */
export function Logo({ withWordmark = true }: { withWordmark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 6.5v4.5M12 11 6 17M12 11v6M12 11l6 6"
          stroke="var(--border-strong)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <circle cx="12" cy="5" r="3" fill="var(--fg)" />
        <circle cx="5.5" cy="18.5" r="2.5" fill="var(--harvest)" />
        <circle cx="12" cy="19" r="2.5" fill="var(--balanced)" />
        <circle cx="18.5" cy="18.5" r="2.5" fill="var(--growth)" />
      </svg>
      {withWordmark ? (
        <span className="text-[13px] font-semibold tracking-[0.2em] text-fg">CELLTREE</span>
      ) : null}
    </span>
  );
}
