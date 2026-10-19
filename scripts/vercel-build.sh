#!/usr/bin/env bash
# ─── Produkcijska gradnja na Vercelu (SQLite → Postgres) ─────────────────
# Zakaj obstaja: lokalni razvoj in vseh 63 verifikacijskih skriptov teče na
# SQLite. Vercel je serverless, kjer datotečni sistem ni pisanje-sposoben, zato
# je prvi deploy vračal `P2021: The table main.Offer does not exist`.
#
# Ta skript med gradnjo:
#   1. zamenja shemo s Postgres različico (razlika: ena vrstica `provider`),
#   2. ustvari/preveri tabele z `prisma db push` prek NEPOSREDNE povezave
#      (pooled povezava ni primerna za DDL),
#   3. generira odjemalca za Postgres in zgradi Next.
#
# Brez `DATABASE_URL_DIRECT` se skript obnaša kot navadna gradnja (SQLite) —
# zato ostane `bun run build` lokalno nespremenjen.
set -euo pipefail

if [ -n "${DATABASE_URL_DIRECT:-}" ]; then
  echo "▸ Produkcijska shema: Postgres"
  cp prisma/schema.postgres.prisma prisma/schema.prisma
  # Lokalni binarni, NE `npx`: npx bi med gradnjo prenašal pakete (minuti in
  # odvisnost od omrežja) — `bun install` je na Vercelu že namestil prisma.
  DATABASE_URL="$DATABASE_URL_DIRECT" ./node_modules/.bin/prisma db push --accept-data-loss --skip-generate
else
  echo "▸ DATABASE_URL_DIRECT ni nastavljen — gradnja po izvirni (SQLite) shemi"
fi

./node_modules/.bin/prisma generate
./node_modules/.bin/next build
# Enako kot `bun run build` v package.json (standalone izhod).
cp -r .next/static .next/standalone/.next/ 2>/dev/null || true
cp -r public .next/standalone/ 2>/dev/null || true
