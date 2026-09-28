import { createLucideIcon } from 'lucide-react'

/**
 * Munin, the raven of the AI actions rail entry: a stroke icon with the
 * same grid and weight as the Lucide icons of the rail.
 */
export const MuninIcon = createLucideIcon('Munin', [
  ['path', { d: 'M2.5 8.6 6.3 7.5C7 5.4 8.6 4.2 10.5 4.3c2.5.1 4.1 2.1 4.1 4.3L21 13.4l-3.6.2 1.6 2.4-3.8-.6c-1 2-3.1 3.2-5.3 3.1-2.1-.1-3.3-1.9-3-4.1.3-2 1-3.8-.6-5.1z', key: 'body' }],
  ['path', { d: 'M9.6 11.2c1.8 1.9 4.2 2.7 6.8 2.5', key: 'wing' }],
  ['path', { d: 'M10 18.4v2.6', key: 'leg-a' }],
  ['path', { d: 'm12.5 18.2.6 2.8', key: 'leg-b' }],
  ['circle', { cx: '10.4', cy: '6.9', r: '0.6', key: 'eye' }],
])
