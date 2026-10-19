import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readSettings, settingsProblemText } from '@/lib/settings-inputs';
import { createWithUniqueNumber } from '@/lib/numbering';
import { parseMontageJson, serializeMontage } from '@/lib/offer-sheet';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner } from '@/lib/tenancy';

interface IncomingItem {
  name: string;
  description?: string | null;
  quantity: number;
  unit: string;
  /** Lahko pride `null` — zanj je značilno, da ga `Number()` spremeni v 0.
   *  Prav zato ima vrstica svojo preverbo, preden karkoli gre v bazo. */
  unitPrice: number | null;
  productId?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

async function nextOfferNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await db.offer.count({
    where: { number: { startsWith: `${year}-` } },
  });
  return `${year}-${String(count + 1).padStart(3, '0')}`;
}

export async function GET(req: Request) {
  const zavrnjen = await requireAccess(req, 'offers', 'GET');
  if (zavrnjen) return zavrnjen;
  try {
    const uid = await resolveOwner(req);
    const offers = await db.offer.findMany({
      where: ownScope(uid),
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    // DTO brez celotnega JSON-a metapodatkov: odjemalcu rabi le DEJANSKO
    // vprašanje »ali je montažni list mogoč« (hasMontage), ne vsebine.
    return NextResponse.json({
      offers: offers.map((o) => ({ ...o, montageJson: undefined, hasMontage: !!o.montageJson })),
    });
  } catch (error) {
    console.error('offers GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju ponudb' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const zavrnjen = await requireAccess(req, 'offers', 'POST');
  if (zavrnjen) return zavrnjen;
  try {
    const body = await req.json();
    const items: IncomingItem[] = Array.isArray(body.items) ? body.items : [];

    if (!body.customerName || typeof body.customerName !== 'string' || !body.customerName.trim()) {
      return NextResponse.json({ error: 'Ime stranke je obvezno' }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: 'Ponudba mora imeti vsaj eno postavko' }, { status: 400 });
    }

    // Fotomontaza (ce je bila): shrani se ob ponudbi, da je pozneje mogoce
    // natisniti MONTAZNI LIST za monterja. Neveljavni metapodatki se tiho
    // preskocijo (ponudba ostane veljavna) — lista ni, ampak ni lazi.
    const montage = parseMontageJson(body.montage);

    const uid = await resolveOwner(req);

    // DDV se bere skozi ISTI register kot urejevalnik, PDF, račun in SMS.
    // Strežnik ne sme izmisliti 22 % tam, kjer klijent ni poslal veljavne
    // stopnje — sicer gre v bazo znesek, ki ga noben zaslon ni izračunal.
    const ddv = readSettings({ vatRate: body.vatRate }).vatRate;
    if (ddv.problem) {
      return NextResponse.json(
        { error: `Ponudba ni shranjena — ${settingsProblemText(ddv.problem)}` },
        { status: 400 },
      );
    }
    const vatRate = ddv.value;

    // Number(null) je 0, zato vrstica brez cene ne sme v bazo.
    // Količina in cena morata biti vpisani — aplikacija ničesar ne doda sama.
    const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const slaba = items.findIndex((i) => !isNum(i.quantity) || !isNum(i.unitPrice));
    if (slaba >= 0) {
      const i = items[slaba];
      const razlog = !isNum(i.quantity)
        ? 'količina ni veljavno število'
        : i.unitPrice === null
          ? 'cena na enoto ni vpisana'
          : 'cena na enoto ni veljavno število';
      return NextResponse.json(
        {
          error:
            `Ponudba ni shranjena — postavka ${slaba + 1} (${i.name || 'brez imena'}): ${razlog}. ` +
            'Vpisanih vrednosti nismo popravili.',
        },
        { status: 400 },
      );
    }

    // `postavke` je samo tisti seznam, ki je šel skozi preverbo zgoraj.
    const postavke = items.map((i) => ({ ...i, unitPrice: i.unitPrice as number }));
    const subtotal = r2(postavke.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
    const vatAmount = r2(subtotal * (vatRate / 100));
    const total = r2(subtotal + vatAmount);

    // Atomsko številčenje: ob P2002 (dva sočasna vnosa sta dobila isto
    // številko) se številka izračuna ZNOVA in vnos ponovi — zahteva ne
    // pade s 500 (glej src/lib/numbering.ts in tests/verify/numbering-retry.ts).
    const { value: offer } = await createWithUniqueNumber(
      () => nextOfferNumber(),
      (number) =>
        db.offer.create({
          data: {
            number,
            // Obseg: zapis pripada prijavljenemu obratu; brez seje (lokalni
            // način/E2E) ostane brez lastnika, kot pred Taskom 94.
            ownerId: uid,
            customerName: body.customerName.trim(),
            customerEmail: body.customerEmail || null,
            customerPhone: body.customerPhone || null,
            customerAddress: body.customerAddress || null,
            objectAddress: body.objectAddress || null,
            note: body.note || null,
            montageJson: serializeMontage(montage),
            status: 'draft',
            subtotal,
            vatRate,
            vatAmount,
            total,
            items: {
              create: postavke.map((i, idx) => ({
                name: i.name,
                description: i.description || null,
                quantity: i.quantity,
                unit: i.unit || 'kos',
                unitPrice: i.unitPrice,
                total: r2(i.quantity * i.unitPrice),
                sortOrder: idx,
                productId: i.productId || null,
              })),
            },
          },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        }),
    );

    return NextResponse.json({ offer }, { status: 201 });
  } catch (error) {
    console.error('offers POST error', error);
    return NextResponse.json({ error: 'Napaka pri shranjevanju ponudbe' }, { status: 500 });
  }
}
