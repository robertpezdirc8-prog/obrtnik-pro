import { Fence, Footprints, Grid3X3, LayoutPanelTop, DoorOpen, Umbrella, Building2, type LucideIcon } from 'lucide-react';
import type { CraftId } from './types';

export interface CraftMeta {
  slug: CraftId;
  name: string;
  short: string;
  icon: LucideIcon;
  image: string;
  emoji: string;
}

export const CRAFTS: CraftMeta[] = [
  { slug: 'ograje', name: 'Balkonske ograje', short: 'Alu, steklo, inox — stebri in montaža na meter', icon: Fence, image: '/crafts/ograje.jpg', emoji: '🛡️' },
  { slug: 'stopnice', name: 'Stopnice', short: 'WPC, les, konstrukcija in ograja', icon: Footprints, image: '/crafts/stopnice.jpg', emoji: '🪜' },
  { slug: 'keramika', name: 'Keramika', short: 'Ploščice, lepilo, fuge — odmerek po m²', icon: Grid3X3, image: '/crafts/keramika.jpg', emoji: '◻️' },
  { slug: 'wpc-terasa', name: 'WPC terasa', short: 'Deske, nosilci, kljukice — razpored na mero', icon: LayoutPanelTop, image: '/crafts/wpc-terasa.jpg', emoji: '🟫' },
  { slug: 'okna-vrata', name: 'Okna in vrata', short: 'PVC in alu — števec kosov z montažo', icon: DoorOpen, image: '/crafts/okna-vrata.jpg', emoji: '🚪' },
  { slug: 'nadstreški', name: 'Nadstreški', short: 'Konstrukcija, kritina, stebri, odvod vode', icon: Umbrella, image: '/crafts/nadstreški.jpg', emoji: '⛱️' },
  { slug: 'fasada', name: 'Fasade', short: 'Obloge WPC, les, pločevina — neto m²', icon: Building2, image: '/crafts/fasada.jpg', emoji: '🏢' },
];

export function craftBySlug(slug: string): CraftMeta | undefined {
  return CRAFTS.find((c) => c.slug === slug);
}
