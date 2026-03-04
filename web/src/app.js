export function minutesToSeconds(minutes) {
  if (minutes < 0) {
    throw new Error('minutes must be non-negative');
  }

  return Math.round(minutes * 60);
}

if (typeof window !== 'undefined') {
  console.log('Isochrone web app initialized');
}
