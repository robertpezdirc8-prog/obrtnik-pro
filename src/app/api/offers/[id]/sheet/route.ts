import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';
import { buildOfferSheet, parseMontageJson } from '@/lib/offer-sheet';

/**
 * MONTAŽNI LIST ponudbe — tisk/PDF iz shranjene fotomontaže.
 *
 * Vhodi: `bay` (razmak stebrov v cm) in `measured=1` (razmak je IZMERJEN,
 * sicer je predlog). Oba sta VNOSA MONTERJA — strežnik ne ugiba.
 * Ponudba brez fotomontaže nima lista: odgovor je 409 z razlago, ne lažni list.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const zavrnjen = await requireAccess(req, 'offers', 'GET');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await params;
    const uid = await resolveOwner(req);
    const offer = await db.offer.findFirst({ where: { id, ...ownScope(uid) } });
    if (!offer) return NextResponse.json({ error: 'Ponudba ne obstaja' }, { status: 404 });

    const stored = parseMontageJson(offer.montageJson);
    if (!stored) {
      return NextResponse.json(
        { hasMontage: false, error: 'Ta ponudba ni nastala iz fotomontaže — montažnega lista ni.' },
        { status: 409 },
      );
    }
    const p = req.nextUrl.searchParams;
    const bayRaw = Number(p.get('bay') ?? '150');
    const bayCm = Number.isFinite(bayRaw) ? bayRaw : 0;
    const baySource = p.get('measured') === '1' ? 'measured' : 'assumed';
    const built = buildOfferSheet(
      { number: offer.number, customerName: offer.customerName, objectAddress: offer.objectAddress },
      stored,
      {
        bayCm,
        baySource,
        datum: offer.createdAt ? new Date(offer.createdAt).toLocaleDateString('sl-SI') : '',
      },
    );
    if (!built) {
      return NextResponse.json({ hasMontage: false, error: 'Montažnega lista ni.' }, { status: 409 });
    }
    return NextResponse.json({
      hasMontage: true,
      sheet: built.sheet,
      html: built.html,
      offer: { id: offer.id, number: offer.number, customerName: offer.customerName },
    });
  } catch (error) {
    console.error('offer sheet error', error);
    return NextResponse.json({ error: 'Napaka pri pripravi montažnega lista' }, { status: 500 });
  }
}
