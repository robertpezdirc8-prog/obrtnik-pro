'use client';

import { useState } from 'react';

/** Slika dejavnosti s kritjem napak (fallback: gradient + emoji). */
export function CraftImage({ src, alt, emoji }: { src: string; alt: string; emoji: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary via-accent to-secondary text-4xl">
        <span role="img" aria-label={alt}>{emoji}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
      onError={() => setFailed(true)}
      loading="lazy"
    />
  );
}
