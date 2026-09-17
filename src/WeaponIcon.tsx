const P = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

const SHAPES: Record<string, React.ReactNode> = {
  rifle: (
    <>
      <path d="M4 11h30v4h-6l-3 5h-6l2-5H4z" />
      <path d="M34 12.2h11v1.8H34z" />
      <path d="M12 15v4.5" />
      <path d="M8 9.5h6v1.5H8z" />
    </>
  ),
  carbine: (
    <>
      <path d="M6 11h26v4h-5l-3 5h-6l2-5H6z" />
      <path d="M32 12.2h9v1.8h-9z" />
      <path d="M14 15v4" />
      <path d="M13 7.5h9v3.2h-9z" />
      <path d="M17.5 7.5V5" />
    </>
  ),
  smg: (
    <>
      <path d="M8 11h20v4h-4l-2 5h-5l1-5H8z" />
      <path d="M28 12.2h8v1.8h-8z" />
      <path d="M14 15v6.5" />
      <path d="M11 8.5h8v2.5h-8z" />
    </>
  ),
  lmg: (
    <>
      <path d="M4 10h28v6h-5l-3 5h-6l2-5H4z" />
      <path d="M32 12h13v2H32z" />
      <circle cx="13" cy="18" r="4" />
      <path d="M36 14v5m0 0-3 3m3-3 3 3" />
      <path d="M10 6.5h10V10H10z" />
    </>
  ),
  shotgun: (
    <>
      <path d="M4 12h26v3.5h-5l-3 4.5h-6l2-4.5H4z" />
      <path d="M30 11.4h15v2.2H30z" />
      <path d="M30 14.2h15v2H30z" />
      <path d="M20 15.5v3.5h7" />
    </>
  ),
  sniper: (
    <>
      <path d="M3 11.5h24v4h-4l-3 5h-6l2-5H3z" />
      <path d="M27 12.6h18v1.6H27z" />
      <path d="M12 6.5h16v3.8H12z" />
      <path d="M16 6.5V4m8 2.5V4" />
      <path d="M26 15.5v5m0 0-2.5 2m2.5-2 2.5 2" />
    </>
  ),
  revolver: (
    <>
      <path d="M12 11h10v4h-3l-4 7h-6l4-7z" />
      <circle cx="21" cy="13" r="3.6" />
      <path d="M25 11.6h15v2.6H25z" />
      <path d="M18 9.5h5V11h-5z" />
    </>
  ),
  pistol: (
    <>
      <path d="M12 10h20v4.5H20l-4 7.5h-6l4-7.5h-2z" />
      <path d="M32 11.2h5v2.2h-5z" />
      <path d="M14 14.5h8" />
    </>
  ),
  knife: (
    <>
      <path d="M5 12.5h18.5v5.5H7a2 2 0 0 1-2-2z" />
      <circle cx="21.5" cy="15.2" r="1.3" />
      <path d="M23.5 12.8 44 9.5l-3 4.4-17.5 1.2z" />
      <path d="M26.5 12.4v-2" />
    </>
  ),
  katana: (
    <>
      <path d="M17 12.4 45 9l-1.6 3.4L17 15.2z" />
      <path d="M14.5 10.6h2.6v6h-2.6z" />
      <path d="M4 12.2h10.5v2.6H4z" />
      <path d="M6 12.2v2.6M8.5 12.2v2.6M11 12.2v2.6" />
    </>
  ),
};

export function WeaponIcon({ kind, className }: { kind: string; className?: string }) {
  const shape = SHAPES[kind] ?? SHAPES.rifle;
  return (
    <svg className={className ?? "wicon"} viewBox="0 0 48 24" aria-hidden="true" {...P}>
      {shape}
    </svg>
  );
}
