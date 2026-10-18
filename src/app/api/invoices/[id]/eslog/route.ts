import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { eslogFilename, buildEslogXml, eslogMathIssues } from '@/lib/eslog';
import { requireAccess } from '@/lib/auth-guard';
import { ownScope, resolveOwner, settingsWhere } from '@/lib/tenancy';

// ─── GET /api/invoices/[id]/eslog — e-račun XML ─────────────
// Task 49: izvoz e-računa (EN 16931 / UBL 2.1 — e-SLOG 2.x; ZIERDED,
// sprejet 23. 11. 2025: B2B obvezno od 1. 1. 2028, javni sektor že
// zdaj prek UJP). Aplikacija le izda datoteko — oddaja poteka zunaj.
// Iskrna vrata: račun brez postavk ali z neskladnimi zneski se NE izvozi
// (409 z razlogom) — pokvarjenega e-računa ne izdajamo.

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const zavrnjen = await requireAccess(req, 'invoices', 'GET');
  if (zavrnjen) return zavrnjen;
  try {
    const { id } = await ctx.params;
    const uid = await resolveOwner(req);

    const invoice = await db.invoice.findFirst({
      where: { id, ...ownScope(uid) },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        offer: { select: { number: true, customerAddress: true } },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: 'Račun ne obstaja' }, { status: 404 });
    }

    // Prodajalčevi podatki so NASTAVITVE istega obrta (Task 94) —
    // tudi e-račun tujega obrta ne sme nositi naših podpisnikov.
    const settings = await db.settings.findFirst({ where: settingsWhere(uid) });
    if (!settings) {
      return NextResponse.json({ error: 'Nastavitve ne obstajajo' }, { status: 500 });
    }

    if (invoice.items.length === 0) {
      return NextResponse.json(
        { error: 'Ta račun nima postavk (starejši vnos brez snapshotov) — e-račun ni mogoč. Izdajte nov račun.' },
        { status: 409 },
      );
    }

    const input = {
      number: invoice.number,
      issueDate: invoice.createdAt,
      dueDate: invoice.dueAt,
      offerNumber: invoice.offer.number,
      subtotal: invoice.subtotal,
      vatRate: invoice.vatRate,
      vatAmount: invoice.vatAmount,
      total: invoice.total,
      seller: {
        name: settings.companyName,
        address: settings.address,
        taxNumber: settings.taxNumber,
        iban: settings.iban,
      },
      buyer: { name: invoice.customerName, address: invoice.offer.customerAddress ?? undefined },
      items: invoice.items.map((it) => ({
        name: it.name,
        description: it.description,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        total: it.total,
      })),
    };

    const issues = eslogMathIssues(input);
    if (issues.length > 0) {
      return NextResponse.json(
        { error: `E-računa ni mogoče izdati — neskladje v podatkih: ${issues.join(' ')}` },
        { status: 409 },
      );
    }

    const { xml } = buildEslogXml(input);

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${eslogFilename(invoice.number)}"`,
      },
    });
  } catch (error) {
    console.error('invoices eslog GET error', error);
    return NextResponse.json({ error: 'Napaka pri izdelavi e-računa' }, { status: 500 });
  }
}
