import type { SVGProps } from "react";

export type IconName =
  | "chevron-down"
  | "hash"
  | "headphones"
  | "home"
  | "log-out"
  | "message"
  | "mic"
  | "mic-off"
  | "phone-off"
  | "phone"
  | "plus"
  | "radio"
  | "send"
  | "settings"
  | "spark"
  | "volume"
  | "volume-off"
  | "x";

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  readonly name: IconName;
}

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {pathFor(name)}
    </svg>
  );
}

function pathFor(name: IconName) {
  switch (name) {
    case "chevron-down":
      return <path d="m7 10 5 5 5-5" />;
    case "hash":
      return (
        <>
          <path d="M10 3 8 21M16 3l-2 18M4 9h17M3 15h17" />
        </>
      );
    case "headphones":
      return (
        <>
          <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
          <path d="M18 19h-1a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h3v3a3 3 0 0 1-3 3ZM6 19H5a3 3 0 0 1-3-3v-3h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2Z" />
        </>
      );
    case "home":
      return (
        <>
          <path d="m3 11 9-8 9 8" />
          <path d="M5 10v10h14V10M9 20v-6h6v6" />
        </>
      );
    case "log-out":
      return (
        <>
          <path d="M10 17l5-5-5-5M15 12H3" />
          <path d="M14 3h4a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-4" />
        </>
      );
    case "message":
      return (
        <>
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
          <path d="M8 9h8M8 13h5" />
        </>
      );
    case "mic":
      return (
        <>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
        </>
      );
    case "mic-off":
      return (
        <>
          <path d="m3 3 18 18M9 9v1a3 3 0 0 0 4.7 2.5M15 9V5a3 3 0 0 0-5.8-1" />
          <path d="M5 10a7 7 0 0 0 11.9 5M19 10a7 7 0 0 1-.5 2.6M12 17v5M8 22h8" />
        </>
      );
    case "phone-off":
      return (
        <>
          <path d="m3 3 18 18" />
          <path d="M16.7 13.2c.8.3 1.6.8 2.3 1.3.7.5.9 1.5.4 2.2l-1 1.4c-.5.7-1.4 1-2.2.7A20 20 0 0 1 5.2 7.8c-.3-.8 0-1.7.7-2.2l1.4-1c.7-.5 1.7-.3 2.2.4.5.7 1 1.5 1.3 2.3" />
        </>
      );
    case "phone":
      return (
        <path d="M6.6 3.5 9 7.8 6.9 9.9a16 16 0 0 0 7.2 7.2l2.1-2.1 4.3 2.4-.8 3.1c-.2.8-.9 1.3-1.7 1.3A15.8 15.8 0 0 1 2.2 6c0-.8.5-1.5 1.3-1.7l3.1-.8Z" />
      );
    case "plus":
      return <path d="M12 5v14M5 12h14" />;
    case "radio":
      return (
        <>
          <circle cx="12" cy="12" r="2" />
          <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
        </>
      );
    case "send":
      return <path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14" />;
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19 12a7 7 0 0 0-.1-1l2-1.6-2-3.4-2.5 1a8 8 0 0 0-1.8-1L14.2 3h-4.4l-.4 3a8 8 0 0 0-1.8 1L5 6 3 9.4 5.1 11a7 7 0 0 0 0 2L3 14.6 5 18l2.6-1a8 8 0 0 0 1.8 1l.4 3h4.4l.4-3a8 8 0 0 0 1.8-1l2.6 1 2-3.4-2.1-1.6a7 7 0 0 0 .1-1Z" />
        </>
      );
    case "spark":
      return (
        <path d="m12 2 1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Zm7 13 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      );
    case "volume":
      return (
        <>
          <path d="M11 5 6 9H2v6h4l5 4V5Z" />
          <path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" />
        </>
      );
    case "volume-off":
      return (
        <>
          <path d="M11 5 6 9H2v6h4l5 4V5ZM22 9l-6 6M16 9l6 6" />
        </>
      );
    case "x":
      return <path d="m6 6 12 12M18 6 6 18" />;
  }
}
