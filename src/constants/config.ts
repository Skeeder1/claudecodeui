export const IS_PLATFORM = import.meta.env.VITE_IS_PLATFORM === 'true';

// projectId 'default' is a sentinel: empty shell has no real DB row, API calls must tolerate missing match.
export const DEFAULT_PROJECT_FOR_EMPTY_SHELL = {
  projectId: 'default',
  displayName: 'default',
  fullPath: IS_PLATFORM ? '/workspace' : '',
  path: IS_PLATFORM ? '/workspace' : '',
};