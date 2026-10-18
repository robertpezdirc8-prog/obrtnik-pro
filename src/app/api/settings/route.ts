import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureSeeded } from '@/lib/seed';
import {
  readSettings,
  SETTINGS_INPUT_BOUNDS,
  settingsProblemText,
  type SettingsField,
} from '@/lib/settings-inputs';
import { requireSession } from '@/lib/auth-guard';
import { resolveOwner, settingsWhere } from '@/lib/tenancy';

export async function GET(req: Request) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    await ensureSeeded();
    // Obseg (Task 94): prijavljen obrt bere SVOJO vrstico (ownerId);
    // brez seje legacy vrstico "default" (lokalni način).
    const uid = await resolveOwner(req);
    let settings = await db.settings.findFirst({ where: settingsWhere(uid) });
    if (!settings) {
      settings = await db.settings.create({
        data: {
          ...(uid ? { ownerId: uid } : {}),
          // id po default (cuid) — "default" je samo legacy (brez seje).
          ...(uid ? {} : { id: 'default' }),
        },
      });
    }
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('settings GET error', error);
    return NextResponse.json({ error: 'Napaka pri nalaganju nastavitev' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const zavrnjen = await requireSession(req);
  if (zavrnjen) return zavrnjen;
  try {
    const body = await req.json();
    const allowed = [
      'companyName', 'ownerName', 'address', 'phone', 'email',
      'taxNumber', 'iban', 'vatRate', 'laborRate', 'quoteValidDays', 'depositPercent', 'paymentDays', 'logoUrl',
    ] as const;

    // Številčna polja gredo skozi ISTO okno vnosa kot dokumenti. Prejšnja
    // različica je `Number(body[key])` shranila karkoli (torej tudi 150 %
    // akontacije ali 'abc' → NaN) in je šele upodobljena številka na PDF
    // tiho usekala. Strežnik je rob sistema: tu se napačen vnos ZAVRNE.
    const NUMERIC = new Set<string>(SETTINGS_INPUT_BOUNDS.map((b) => b.field));
    const incoming: Partial<Record<SettingsField, number>> = {};
    for (const key of allowed) {
      if (NUMERIC.has(key) && body[key] !== undefined) incoming[key as SettingsField] = Number(body[key]);
    }
    const readings = readSettings(incoming);
    const refused = (Object.keys(incoming) as SettingsField[]).filter((f) => readings[f].problem);
    if (refused.length > 0) {
      return NextResponse.json(
        {
          error: refused.map((f) => settingsProblemText(readings[f].problem!)).join(' '),
          refusedFields: refused,
        },
        { status: 400 },
      );
    }

    const data: Record<string, string | number | null> = {};
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      data[key] = NUMERIC.has(key) ? readings[key as SettingsField].value : body[key];
    }

    // Upsert po obsegu (Task 94): prijavljen piše SVOJO vrstico; brez
    // seje legacy "default". Create ne dela kolizij — id je cuid.
    const uid = await resolveOwner(req);
    const settings = await db.settings.upsert({
      where: settingsWhere(uid),
      update: data,
      create: { ...(uid ? { ownerId: uid } : { id: 'default' }), ...data },
    });
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('settings PUT error', error);
    return NextResponse.json({ error: 'Napaka pri shranjevanju nastavitev' }, { status: 500 });
  }
}
