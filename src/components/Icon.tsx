import type { SVGProps } from "react";

/** Hand-drawn 24×24 stroke set. No emoji anywhere in the portal. */

export type IconName =
  | "upload"
  | "download"
  | "copy"
  | "check"
  | "x"
  | "play"
  | "image"
  | "film"
  | "file"
  | "audio"
  | "calendar"
  | "idea"
  | "bell"
  | "heart"
  | "heart-fill"
  | "chat"
  | "pin"
  | "trash"
  | "edit"
  | "plus"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "link"
  | "sparkle"
  | "inbox"
  | "send"
  | "clock"
  | "alert"
  | "folder"
  | "archive"
  | "user"
  | "logout"
  | "eye"
  | "refresh"
  | "leaf"
  | "grid"
  | "list"
  | "star"
  | "arrow-right"
  | "camera"
  | "crown";

const paths: Record<IconName, JSX.Element> = {
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H9" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5z" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m20 16-5-5-6.5 6.5" />
    </>
  ),
  film: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4" />
    </>
  ),
  file: (
    <>
      <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
      <path d="M14 3.5v4h4" />
    </>
  ),
  audio: (
    <>
      <path d="M9 18V7l10-2v11" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="1.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  idea: (
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.8.7 1.1 1.4 1.1 2.2h5c0-.8.3-1.5 1.1-2.2A6 6 0 0 0 12 3z" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  "heart-fill": <path fill="currentColor" d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  chat: <path d="M4.5 5.5h15v10h-8l-4 3.5v-3.5h-3z" />,
  pin: (
    <>
      <path d="M9 4h6l-1 6 3 3v1H7v-1l3-3z" />
      <path d="M12 14v6" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9 7V4.5h6V7M7 7l.8 12.5h8.4L17 7" />
    </>
  ),
  edit: (
    <>
      <path d="m4 20 4-.8L19.5 7.7a1.5 1.5 0 0 0 0-2.1l-1.1-1.1a1.5 1.5 0 0 0-2.1 0L4.8 16z" />
      <path d="m14.5 6.5 3 3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  "chevron-left": <path d="m14.5 6-6 6 6 6" />,
  "chevron-right": <path d="m9.5 6 6 6-6 6" />,
  "chevron-down": <path d="m6 9.5 6 6 6-6" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
      <path d="m7 7 2.5 2.5M14.5 14.5 17 17M17 7l-2.5 2.5M9.5 14.5 7 17" />
    </>
  ),
  inbox: (
    <>
      <path d="M4 13V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5V13" />
      <path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20v5.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" />
    </>
  ),
  send: <path d="M20 4 4 10.5l7 2.5 2.5 7z M11 13l9-9" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 3.5 19h17z" />
      <path d="M12 10v4M12 16.5v.5" />
    </>
  ),
  folder: <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />,
  archive: (
    <>
      <rect x="3.5" y="4.5" width="17" height="4" rx="1" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H6a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 6 20h4" />
      <path d="M14 8l4 4-4 4M9 12h9" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  leaf: (
    <>
      <path d="M5 19C5 9 11 5 20 4.5c-.5 9-4.5 15-14.5 15z" />
      <path d="M5 19c3-5 6-8 10-10.5" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.5M4 12h.5M4 18h.5" />,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z" />,
  "arrow-right": <path d="M4 12h16M13 5l7 7-7 7" />,
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  crown: (
    <>
      <path d="M4 17 3 7l5 4 4-6 4 6 5-4-1 10z" />
      <path d="M4 17h16" />
    </>
  ),
};

interface Props extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export const Icon = ({ name, size, className, ...rest }: Props) => (
  <svg
    className={["icon", className].filter(Boolean).join(" ")}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {paths[name]}
  </svg>
);

/** The brand's root mark — a loc that becomes a root system. Draws on first view. */
export const RootMark = ({ className = "", drawn = false }: { className?: string; drawn?: boolean }) => (
  <svg
    className={["root-draw", drawn ? "in" : "", className].filter(Boolean).join(" ")}
    viewBox="0 0 120 120"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    pathLength="1"
    aria-hidden="true"
  >
    <circle cx="60" cy="60" r="56" pathLength="1" opacity="0.55" />
    <circle cx="60" cy="60" r="50" pathLength="1" opacity="0.35" />
    <path d="M60 14c-6 10-6 20 0 30 6 10 6 20 0 30" pathLength="1" />
    <path d="M60 44c-10 2-18 8-24 18M60 44c10 2 18 8 24 18" pathLength="1" />
    <path d="M60 74c-8 4-14 10-18 20M60 74c8 4 14 10 18 20M60 74v26" pathLength="1" />
    <path d="M42 62c-6 2-10 6-12 12M78 62c6 2 10 6 12 12" pathLength="1" opacity="0.7" />
    <path d="M52 20c-6 2-10 6-12 12M68 20c6 2 10 6 12 12" pathLength="1" opacity="0.7" />
    <circle cx="60" cy="14" r="2" pathLength="1" />
  </svg>
);
