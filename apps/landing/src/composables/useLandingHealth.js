const HEALTH_ENDPOINT = '/api/health';

export function useLandingHealth(options = {}) {
  return useFetch(HEALTH_ENDPOINT, {
    key: 'landing-health',
    ...options
  });
}

export function fetchLandingHealth(options = {}) {
  return $fetch(HEALTH_ENDPOINT, options);
}
