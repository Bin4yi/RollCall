import { motion, useReducedMotion } from 'motion/react';

export type Status = 'ready' | 'watch' | 'check-in' | 'waiting' | 'learning';

export const STATUS_LABEL: Record<Status, string> = {
  ready: 'Ready',
  watch: 'Watch',
  'check-in': 'Check in',
  waiting: 'Not checked in',
  learning: 'Learning their usual',
};

const RAYS = [-60, -30, 0, 30, 60];

/**
 * Status is a shape as well as a colour, and always has a text label, so it reads for colour-blind
 * users: sun up, sun rising, sun behind a cloud, moon, and a sun peeking out for learning.
 */
export function StatusSun({ status, size = 44 }: { status: Status; size?: number }) {
  const still = useReducedMotion();
  const label = STATUS_LABEL[status];
  return (
    <motion.svg
      key={status}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role="img"
      aria-label={label}
      initial={still ? false : { scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 20 }}
      className="shrink-0"
    >
      {status === 'ready' && (
        <g stroke="#2B2A6B" strokeWidth="2.4" strokeLinecap="round">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="24" y1="5" x2="24" y2="10" transform={`rotate(${a} 24 24)`} />
          ))}
          <circle cx="24" cy="24" r="10" fill="#FFB37A" />
        </g>
      )}
      {status === 'watch' && (
        <g stroke="#2B2A6B" strokeWidth="2.4" strokeLinecap="round">
          {RAYS.map((a) => (
            <line key={a} x1="24" y1="9" x2="24" y2="14" transform={`rotate(${a} 24 32)`} />
          ))}
          <path d="M12 32a12 12 0 0 1 24 0Z" fill="#FFB37A" strokeLinejoin="round" />
          <line x1="5" y1="32" x2="43" y2="32" />
        </g>
      )}
      {status === 'check-in' && (
        <g stroke="#2B2A6B" strokeWidth="2.4" strokeLinejoin="round">
          <circle cx="30" cy="17" r="9" fill="#FF6B5B" />
          <path d="M11 37a7.5 7.5 0 0 1 .6-15 10 10 0 0 1 19-1.6A8.4 8.4 0 0 1 37 37Z" fill="#FFF6E9" />
        </g>
      )}
      {status === 'waiting' && (
        <path
          d="M31 7a18 18 0 1 0 10 25A15 15 0 0 1 31 7Z"
          fill="#2B2A6B"
          stroke="#2B2A6B"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      )}
      {status === 'learning' && (
        <g stroke="#2B2A6B" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
          <circle cx="17" cy="22" r="9" fill="#FFB37A" />
          <path d="M14 40a6.5 6.5 0 0 1 .4-13 8.5 8.5 0 0 1 16.5-1.4A7.2 7.2 0 0 1 36 40Z" fill="#FFF6E9" />
          <path d="M22 31.5a3.4 3.4 0 1 1 5 3c-1.2.7-2 1.2-2 2.3" fill="none" strokeWidth="2" />
        </g>
      )}
    </motion.svg>
  );
}
