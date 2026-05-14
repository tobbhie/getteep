type IconName =
  | "arrowRight"
  | "bolt"
  | "checkCircle"
  | "clock"
  | "link"
  | "puzzle"
  | "send"
  | "shield"
  | "wallet"
  | "coin";

interface IconProps {
  name: IconName;
  className?: string;
}

const paths: Record<IconName, JSX.Element> = {
  arrowRight: <path d="M5 12h14M13 5l7 7-7 7" />,
  bolt: <path d="M13 2 4 14h7l-1 8 10-13h-7l0-7Z" />,
  checkCircle: (
    <>
      <path d="M21 11.1V12a9 9 0 1 1-5.3-8.2" />
      <path d="m9 12 2 2 7-7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" />
    </>
  ),
  puzzle: (
    <path d="M8 3a2 2 0 0 1 4 0v2h3a2 2 0 0 1 2 2v3h2a2 2 0 0 1 0 4h-2v3a2 2 0 0 1-2 2h-3v-2a2 2 0 0 0-4 0v2H5a2 2 0 0 1-2-2v-3h2a2 2 0 0 0 0-4H3V7a2 2 0 0 1 2-2h3V3Z" />
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  wallet: (
    <>
      <path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      <path d="M16 12h5v4h-5a2 2 0 0 1 0-4Z" />
      <path d="M3 7l13-3v3" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M15 9.5c-.7-.7-1.7-1-3-1-1.8 0-3 .8-3 2s1.1 1.8 3 2 3 .8 3 2-1.2 2-3 2c-1.3 0-2.4-.4-3.2-1.2" />
    </>
  ),
};

export default function Icon({ name, className }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
