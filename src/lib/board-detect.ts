// ─── Zaznavanje ene deske v fotografiji (čisto, brez side-effectov) ───────
// Išče PERIODIČNE temne šprinje med deskami, izmeri korak v slikovnih
// piksli in vrne izrez natanko ene deske. Uporablja se za tile-e iz
// uradnih galerijskih fotografij in iz fotografij od monterjev.

/**
 * Najdi eno celo desko: poišči temne šprinje (odstopanje od sredine) in
 * izmeri korak med njimi. Vrne izrez v slikovnih piksli ali null.
 */
export function findBoard(
  profile: number[],
  opts: { minPitch: number; maxPitch: number },
): { left: number; width: number; pitch: number } | null {
  const n = profile.length;
  if (n < 40) return null;
  const mean = profile.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(profile.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  if (std < 2) return null;
  // lokalni minimumi (šprinje): manjši od sredine za 0,25 odstd
  const mins: number[] = [];
  for (let x = 2; x < n - 2; x++) {
    if (
      profile[x] < mean - 0.25 * std &&
      profile[x] <= profile[x - 1] && profile[x] <= profile[x + 1] &&
      profile[x] < profile[x - 2] && profile[x] < profile[x + 2]
    ) {
      mins.push(x);
    }
  }
  if (mins.length < 3) return null;
  // koraki med zaporednimi šprinjami
  const gaps: number[] = [];
  for (let i = 1; i < mins.length; i++) {
    const d = mins[i] - mins[i - 1];
    if (d >= opts.minPitch && d <= opts.maxPitch) gaps.push(d);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  const pitch = gaps[Math.floor(gaps.length / 2)];
  // par šprinj s korakom najbliž medianu
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let i = 1; i < mins.length; i++) {
    const d = mins[i] - mins[i - 1];
    if (Math.abs(d - pitch) < bestD) { bestD = Math.abs(d - pitch); best = [mins[i - 1], mins[i]]; }
  }
  if (!best) return null;
  const left = best[0];
  const width = best[1] - best[0];
  if (width < opts.minPitch * 0.7) return null;
  return { left, width, pitch };
}
