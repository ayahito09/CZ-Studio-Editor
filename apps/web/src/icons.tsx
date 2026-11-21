const PATHS = {
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  redo: "m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13",
  lock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  unlock: "M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  eyeOff: "M3 3l18 18M10.6 5.6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.3M6.4 6.9A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.2-1",
  sound: "M4 9.5h3.5L12 6v12l-4.5-3.5H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11",
  mute: "M4 9.5h3.5L12 6v12l-4.5-3.5H4zM16 9.5l5 5M21 9.5l-5 5",
  folder: "M3 6.5h6l2 2.5h10v9.5H3z",
  home: "M4 11 12 4l8 7M6 9.5V20h12V9.5",
  film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4",
  play: "M8 5.5v13l10.5-6.5z",
  pause: "M8 5.5v13M16 5.5v13",
  toStart: "M6 5.5v13M18 5.5v13l-9-6.5z",
  toEnd: "M18 5.5v13M6 5.5v13l9-6.5z",
  stepBack: "M15 6l-6 6 6 6",
  stepFwd: "m9 6 6 6-6 6",
  loop: "M17 4l3 3-3 3M4 11V9.5A2.5 2.5 0 0 1 6.5 7H20M7 20l-3-3 3-3M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H4",
  safe: "M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 8h8v8H8z",
  select: "M5 3.5l13 7-5.5 1.5L10 18z",
  trackFwd: "M4 12h10M11 8l4 4-4 4M18 5v14",
  ripple: "M7 5v14M7 12h10M14 9l3 3-3 3",
  roll: "M12 5v14M9 9l-3 3 3 3M15 9l3 3-3 3M6 12h12",
  razor: "M6 6.5a2.5 2.5 0 1 0 0 .01M6 17.5a2.5 2.5 0 1 0 0 .01M8 8l12 10M8 16 20 6",
  slip: "M4 7h16v10H4zM9 12H4M20 12h-5M7 10l-2 2 2 2M17 10l2 2-2 2",
  slide: "M8 7h8v10H8zM2 12h4M18 12h4M4 10l-2 2 2 2M20 10l2 2-2 2",
  magnet: "M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4",
  zoomIn: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4M8 11h6M11 8v6",
  zoomOut: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4M8 11h6",
  fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4",
  copy: "M9 9h10v11H9zM5 15V4h10",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  close: "M6 6l12 12M18 6 6 18",
  minus: "M6 12h12",
  marker: "M6 4h12v10l-6 6-6-6z",
  insert: "M12 4v10M8 10l4 4 4-4M4 20h16",
  alert: "M12 8v5M12 16.5h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z",
  text: "M5 6V4.5h14V6M12 4.5v15M9 19.5h6",
  wand: "M4 20 15 9M14 4v2M19 9h2M18.5 5.5 17 7M10 4.5l.7 1.6M19.5 13.5l-1.6-.7",
  check: "m5 12.5 4.5 4.5L19 7",
  stop: "M7 7h10v10H7z",
  send: "M4 12 20 4l-4 16-4-7zM12 13l8-9",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01",
  scissors: "M6 6.5a2.5 2.5 0 1 0 0 .01M6 17.5a2.5 2.5 0 1 0 0 .01M8 8l12 10M8 16 20 6",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-2 3.4-1.9-.8a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.1a7 7 0 0 1-2-1.2l-1.9.8-2-3.4 1.6-1.2a7 7 0 0 1 0-2.4L4.6 10.3l2-3.4 1.9.8a7 7 0 0 1 2-1.2L10.8 3h4l.3 2.1a7 7 0 0 1 2 1.2l1.9-.8 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4Z",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5",
  render: "M4 6h16v12H4zM10 9.5v5l4-2.5z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  const filled = name === "play" || name === "toStart" || name === "toEnd" || name === "select" || name === "marker";
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
