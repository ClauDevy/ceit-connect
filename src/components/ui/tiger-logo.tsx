export function TigerLogo({ size = 34 }: { size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
        <ellipse cx="50" cy="54" rx="33" ry="25" fill="#EC6608" />
        <ellipse cx="50" cy="63" rx="19" ry="14" fill="#FFF8F0" />
        <path d="M25 32 L17 15 L35 23 Z" fill="#EC6608" />
        <path d="M75 32 L83 15 L65 23 Z" fill="#EC6608" />
        <path d="M25 30 L21 19 L31 24 Z" fill="#1B140F" />
        <path d="M75 30 L79 19 L69 24 Z" fill="#1B140F" />
        <path
          d="M33 36 L28 25 M41 32 L39 21 M59 32 L61 21 M67 36 L72 25"
          stroke="#1B140F"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M36 44 Q42 37 48 44 M52 44 Q58 37 64 44"
          stroke="#1B140F"
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="42" cy="50" r="3" fill="#1B140F" />
        <circle cx="58" cy="50" r="3" fill="#1B140F" />
      </svg>
    );
  }