import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readSettings, settingsProblemText } from '@/lib/settings-inputs';

interface IncomingItem {
  name: string;
  description?: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
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

export async function GET() {
  try {
    const offers = await db.offer.findMany({
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    return NextResponse.json({ offers });
  } catch (error) {
    console.error('offers GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju ponudb' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const items: IncomingItem[] = Array.isArray(body.items) ? body.items : [];

    if (!body.customerName || typeof body.customerName !== 'string' || !body.customerName.trim()) {
      return NextResponse.json({ error: 'Ime stranke je obvezno' }, { status: 400 });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: 'Ponudba mora imeti vsaj eno postavko' }, { status: 400 });
    }

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

    const neStevilka = items.findIndex((i) => !Number.isFinite(Number(i.quantity)) || !Number.isFinite(Number(i.unitPrice)));
    if (neStevilka >= 0) {
      const i = items[neStevilka];
      return NextResponse.json(
        {
          error:
            `Ponudba ni shranjena — postavka ${neStevilka + 1} (${i.name || 'brez imena'}) ` +
            `nima veljavne količine ali cene na enoto. Vpisani vrednosti nismo popravili.`,
        },
        { status: 400 },
      );
    }

    const subtotal = r2(items.reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0));
    const vatAmount = r2(subtotal * (vatRate / 100));
    const total = r2(subtotal + vatAmount);
    const number = await nextOfferNumber();

    const offer = await db.offer.create({
      data: {
        number,
        customerName: body.customerName.trim(),
        customerEmail: body.customerEmail || null,
        customerPhone: body.customerPhone || null,
        customerAddress: body.customerAddress || null,
        objectAddress: body.objectAddress || null,
        note: body.note || null,
        status: 'draft',
        subtotal,
        vatRate,
        vatAmount,
        total,
        items: {
          create: items.map((i, idx) => ({
            name: i.name,
            description: i.description || null,
            quantity: Number(i.quantity),
            unit: i.unit || 'kos',
            unitPrice: Number(i.unitPrice),
            total: r2(Number(i.quantity) * Number(i.unitPrice)),
            sortOrder: idx,
            productId: i.productId || null,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });

    return NextResponse.json({ offer }, { status: 201 });
  } catch (error) {
    console.error('offers POST error', error);
    return NextResponse.json({ error: 'Napaka pri shranjevanju ponudbe' }, { status: 500 });
  }
}
