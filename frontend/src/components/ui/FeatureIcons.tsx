import React from "react";

type IconProps = { className?: string };

export const BktDiagnosisIcon: React.FC<IconProps> = ({ className = "w-8 h-8" }) => (
  <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden="true">
    <rect width="36" height="36" rx="10" fill="#EEF0FF" />
    <path
      d="M14.5 11.5C12.5 11.5 11 13 11 15C11 15.6 11.15 16.15 11.4 16.65C10.55 17.3 10 18.3 10 19.5C10 21.4 11.5 23 13.5 23H17.5V11.5H14.5Z"
      fill="#5B5CE6"
      fillOpacity="0.25"
      stroke="#5B5CE6"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path
      d="M21.5 11.5C23.5 11.5 25 13 25 15C25 15.6 24.85 16.15 24.6 16.65C25.45 17.3 26 18.3 26 19.5C26 21.4 24.5 23 22.5 23H18.5V11.5H21.5Z"
      fill="#5B5CE6"
      stroke="#4338CA"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle cx="14" cy="17" r="1.4" fill="#4338CA" />
    <circle cx="22" cy="17" r="1.4" fill="#FFFFFF" />
    <path d="M18 23V26.5" stroke="#5B5CE6" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const LlmHintsIcon: React.FC<IconProps> = ({ className = "w-8 h-8" }) => (
  <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden="true">
    <rect width="36" height="36" rx="10" fill="#EEF0FF" />
    <path
      d="M10 14C10 11.79 11.79 10 14 10H22C24.21 10 26 11.79 26 14V19.5C26 21.71 24.21 23.5 22 23.5H16.5L12 26.5V23.2C10.8 22.55 10 21.15 10 19.5V14Z"
      fill="#5B5CE6"
    />
    <path
      d="M18 12.8L19.1 15.6L21.9 16.7L19.1 17.8L18 20.6L16.9 17.8L14.1 16.7L16.9 15.6L18 12.8Z"
      fill="#FFFFFF"
    />
  </svg>
);

export const ArcadeGamesIcon: React.FC<IconProps> = ({ className = "w-8 h-8" }) => (
  <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden="true">
    <rect width="36" height="36" rx="10" fill="#EEF0FF" />
    <rect x="8.5" y="13" width="19" height="11.5" rx="5.75" fill="#5B5CE6" />
    <path d="M13.5 16.5V21M11.25 18.75H15.75" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="21.5" cy="17.5" r="1.25" fill="#FFFFFF" />
    <circle cx="24" cy="19.8" r="1.25" fill="#C7D2FE" />
  </svg>
);

export const MorpolohiyaIcon: React.FC<IconProps> = ({ className = "w-8 h-8" }) => (
  <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden="true">
    <rect width="36" height="36" rx="10" fill="#EEF0FF" />
    <path
      d="M9.5 13C9.5 11.9 10.4 11 11.5 11H17.5V24.5H11.5C10.4 24.5 9.5 23.6 9.5 22.5V13Z"
      fill="#5B5CE6"
      fillOpacity="0.28"
      stroke="#5B5CE6"
      strokeWidth="1.6"
    />
    <path
      d="M26.5 13C26.5 11.9 25.6 11 24.5 11H18.5V24.5H24.5C25.6 24.5 26.5 23.6 26.5 22.5V13Z"
      fill="#5B5CE6"
      stroke="#4338CA"
      strokeWidth="1.6"
    />
    <path d="M12.5 15H15.5M12.5 18H15.5M20.5 15H23.5M20.5 18H23.5" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

export const MasteryTargetIcon: React.FC<IconProps> = ({ className = "w-8 h-8" }) => (
  <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden="true">
    <rect width="36" height="36" rx="10" fill="#EEF0FF" />
    <circle cx="18" cy="18" r="8.5" fill="#5B5CE6" fillOpacity="0.2" stroke="#5B5CE6" strokeWidth="1.8" />
    <circle cx="18" cy="18" r="5" fill="#5B5CE6" fillOpacity="0.45" stroke="#5B5CE6" strokeWidth="1.5" />
    <circle cx="18" cy="18" r="2.2" fill="#4338CA" />
    <path d="M23.5 12.5L18.5 17.5" stroke="#4338CA" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const XpTrophyIcon: React.FC<IconProps> = ({ className = "w-8 h-8" }) => (
  <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden="true">
    <rect width="36" height="36" rx="10" fill="#EEF0FF" />
    <path
      d="M13 11H23V16.5C23 19.26 20.76 21.5 18 21.5C15.24 21.5 13 19.26 13 16.5V11Z"
      fill="#5B5CE6"
    />
    <path
      d="M13 12.5H10.5C10.5 15.5 11.8 17 13 17M23 12.5H25.5C25.5 15.5 24.2 17 23 17"
      stroke="#5B5CE6"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path d="M18 21.5V24.5M14.5 25H21.5" stroke="#4338CA" strokeWidth="1.8" strokeLinecap="round" />
    <path
      d="M18 13.5L18.7 15L20.3 15.2L19.1 16.3L19.4 17.9L18 17.1L16.6 17.9L16.9 16.3L15.7 15.2L17.3 15L18 13.5Z"
      fill="#FFFFFF"
    />
  </svg>
);
