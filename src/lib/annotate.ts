// ─── Dimenzijske oznake na slikah (skriptna anotacija) ───────
// Klasična tehniška anotacija (raziskava task14: Hover "measurement
// PDF", CAD Dimension tool): pomožni črti (extension lines), razsež-
//nostna črta s puščicami na obeh koncih in oznaka z belim halo-jem,
// da je berljiva na vsaki fotki. Vse čisto canvas-skriptno, 0 AI.

export interface PxPt {
  x: number;
  y: number;
}

export interface DimStyle {
  /** Barva črt (privzeto bela). */
  line?: string;
  /** Barva besedila (privzeto temna). */
  text?: string;
  /** Velikost pisave v px (privzeto 13). */
  fontPx?: number;
  /** Odmik razsežnostne črte od daljice (px; pozitiven = levo od a→b). */
  offset: number;
  /** Halo za berljivost (privzeto true). */
  halo?: boolean;
}

function fmtM(cm: number): string {
  return `${(cm / 100).toLocaleString('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
}

/**
 * Nariše razsežnostno črto za daljico a→b z odmikom (px) in oznako.
 * Puščici sta narisani znotraj črte (klasična arhitekturna konvencija).
 */
export function drawDimensionLine(
  ctx: CanvasRenderingContext2D,
  a: PxPt,
  b: PxPt,
  label: string,
  style: DimStyle,
): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 8) return;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy; // normala (levo od smeri a→b)
  const ny = ux;
  const off = style.offset;

  const a2 = { x: a.x + nx * off, y: a.y + ny * off };
  const b2 = { x: b.x + nx * off, y: b.y + ny * off };
  const line = style.line ?? 'rgba(255,255,255,0.95)';
  const fontPx = style.fontPx ?? 13;

  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = line;
  ctx.setLineDash([]);

  // Pomožni črti (extension lines): od oglišč do razsežnostne črte
  ctx.beginPath();
  ctx.moveTo(a.x + nx * (off > 0 ? 3 : -3), a.y + ny * (off > 0 ? 3 : -3));
  ctx.lineTo(a2.x + nx * 4, a2.y + ny * 4);
  ctx.moveTo(b.x + nx * (off > 0 ? 3 : -3), b.y + ny * (off > 0 ? 3 : -3));
  ctx.lineTo(b2.x + nx * 4, b2.y + ny * 4);
  ctx.stroke();

  // Razsežnostna črta
  ctx.beginPath();
  ctx.moveTo(a2.x, a2.y);
  ctx.lineTo(b2.x, b2.y);
  ctx.stroke();

  // Puščici (zapolnjeni trikotniki, ~7 px)
  const ah = Math.min(8, Math.max(5, len * 0.06));
  const arrow = (p: PxPt, dirX: number, dirY: number) => {
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + dirX * ah + nx * ah * 0.38, p.y + dirY * ah + ny * ah * 0.38);
    ctx.lineTo(p.x + dirX * ah - nx * ah * 0.38, p.y + dirY * ah - ny * ah * 0.38);
    ctx.closePath();
    ctx.fillStyle = line;
    ctx.fill();
  };
  arrow(a2, ux, uy);
  arrow(b2, -ux, -uy);

  // Oznaka z halo-jem na sredini (berljivost na vsaki podlagi)
  const mx = (a2.x + b2.x) / 2 + nx * 14;
  const my = (a2.y + b2.y) / 2 + ny * 14;
  ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const padX = 5;
  const boxW = tw + padX * 2;
  const boxH = fontPx + 7;
  if (style.halo !== false) {
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    const r = 4;
    const bx = mx - boxW / 2;
    const by = my - boxH / 2;
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r);
    ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r);
    ctx.arcTo(bx, by + boxH, bx, by, r);
    ctx.arcTo(bx, by, bx + boxW, by, r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = style.text ?? 'rgba(15,15,18,0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, mx, my + 0.5);
  ctx.restore();
}

/**
 * Nariše širino (nad zgornjim robom) in višino (desno od desnega
 * roba) štirikotnika — mere direktno na vizualizaciji.
 * `dims` v cm; oznake v metrih (sl-SI decimalna vejica).
 */
export function drawQuadDimensions(
  ctx: CanvasRenderingContext2D,
  quadPx: PxPt[],
  dims: { topW: number; botW: number; leftH: number; rightH: number },
): void {
  if (quadPx.length !== 4) return;
  // širina: povprečje zgornjega/spodnjega roba, črta nad zgornjim robom
  const wCm = (dims.topW + dims.botW) / 2;
  drawDimensionLine(ctx, quadPx[0], quadPx[1], fmtM(wCm), { offset: -16 });
  // višina: črta desno od desnega roba
  const hCm = (dims.leftH + dims.rightH) / 2;
  drawDimensionLine(ctx, quadPx[1], quadPx[2], fmtM(hCm), { offset: 16 });
}
