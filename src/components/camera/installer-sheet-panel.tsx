'use client';

// ─── MONTAŽNI LIST ZA MONTERJA — UI (korak 7 fotomontaže) ────────────────
// Zakaj: ROKSAL na svoji strani dobesedno pravi, da je razmak stebrov ključni
// podatek za izbiro profila in izkoristek materiala, deske pa se »spajajo na
// dolžino obvezno na stebru«. Fotomontaža je doslej risala eno ravnino brez
// stebrov, zato kosovnica ni mogla povedati ne rezov ne odpadka po celotah.
//
// Ta panel NE izmišljuje: razmak vpiše monter (izmerjen ali predlog), vse
// ostalo izračuna deterministično jedro `photo-install-sheet.ts`. Če meritve
// ni, panel pokaže BLOKADE in ne izriše nobene številke.

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Printer, FileDown, Ruler, TriangleAlert, Info, MessageSquare } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { ReplaceMetadata } from '@/lib/photo-replace-core';
import {
  buildInstallerSheet,
  buildInstallerSheetHtml,
  type InstallerSheet,
} from '@/lib/photo-install-sheet';
import { buildInstallerSheetMessage } from '@/lib/install-sheet-message';
import { formatNum } from '@/lib/format';

interface InstallerSheetPanelProps {
  meta: ReplaceMetadata;
  /** kompozit iz koraka 7 (data URL) — gre na list kot priloga */
  imageDataUrl?: string | null;
  /** podan od zunaj (determinizem); privzeto današnji datum */
  datum?: string;
  obrtnik?: string;
}

const cm = (n: number): string => `${n.toFixed(1).replace('.', ',')} cm`;

/** Odpri natisljiv list v novem oknu in sproži tisk (uporabnik shrani kot PDF). */
export function printInstallerSheet(html: string): boolean {
  const w = window.open('', '_blank', 'width=860,height=1000');
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  // print po izrisu; setTimeout je zanesljivejši od onload pri document.write
  w.setTimeout(() => { w.focus(); w.print(); }, 250);
  return true;
}

export function InstallerSheetPanel({ meta, imageDataUrl, datum, obrtnik }: InstallerSheetPanelProps) {
  const { toast } = useToast();
  const [bay, setBay] = useState('150');
  const [measured, setMeasured] = useState(false);

  const bayCm = Number(bay.replace(',', '.'));
  const sheet: InstallerSheet = useMemo(
    () => buildInstallerSheet({
      meta,
      bayCm: Number.isFinite(bayCm) ? bayCm : 0,
      baySource: measured ? 'measured' : 'assumed',
    }),
    [meta, bayCm, measured],
  );

  const opts = {
    datum: datum ?? new Date().toLocaleDateString('sl-SI'),
    obrtnik: obrtnik ?? '—',
    imageDataUrl: imageDataUrl ?? null,
  };

  const onPrint = () => {
    if (!printInstallerSheet(buildInstallerSheetHtml(sheet, opts))) {
      toast({ title: 'Okno je blokirano', description: 'Dovoli pojavna okna za tiskanje montažnega lista.', variant: 'destructive' });
    }
  };

  const onDownload = () => {
    const blob = new Blob([buildInstallerSheetHtml(sheet, opts)], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `montazni-list-${meta.profileId}-${Math.round(sheet.bayCm)}cm.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Kratko sporočilo za monterja (SMS/WhatsApp) — ista številka kot v listu.
  const onCopyMessage = async () => {
    const text = buildInstallerSheetMessage({ sheet, obrtnik: obrtnik ?? null });
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Sporočilo za monterja kopirano ✓', description: 'Prilepi v SMS ali WhatsApp.' });
    } catch {
      toast({ title: 'Odložišče ni dostopno', variant: 'destructive' });
    }
  };

  const ready = sheet.blockers.length === 0;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3" data-testid="fr-installer-sheet">
      <div className="flex flex-wrap items-center gap-2">
        <Ruler className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold">Montažni list za monterja</span>
        <Badge variant="secondary" className="text-[10px]">stebri + rezalni načrt</Badge>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-muted-foreground">
          Razmak stebrov (cm)
          <Input
            value={bay}
            onChange={(e) => setBay(e.target.value)}
            inputMode="decimal"
            className="mt-1 h-8 w-24 text-sm"
            data-testid="fr-sheet-bay"
          />
        </label>
        <div className="flex gap-1">
          <Button
            size="sm" variant={measured ? 'default' : 'outline'} className="h-8 text-xs"
            onClick={() => setMeasured(true)} data-testid="fr-sheet-measured"
          >
            Izmerjeno
          </Button>
          <Button
            size="sm" variant={!measured ? 'default' : 'outline'} className="h-8 text-xs"
            onClick={() => setMeasured(false)} data-testid="fr-sheet-assumed"
          >
            Predlog
          </Button>
        </div>
        <Button size="sm" className="h-8" onClick={onPrint} disabled={!ready} data-testid="fr-sheet-print">
          <Printer className="mr-1.5 h-4 w-4" /> Natisni / PDF
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={onDownload} data-testid="fr-sheet-download">
          <FileDown className="mr-1.5 h-4 w-4" /> Prenesi HTML
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={!ready}
          onClick={onCopyMessage}
          data-testid="fr-sheet-message"
        >
          <MessageSquare className="mr-1.5 h-4 w-4" /> Sporočilo monterju
        </Button>
      </div>

      {ready ? (
        <div className="flex flex-wrap gap-2 text-[11px]" data-testid="fr-sheet-kpi">
          <span className="rounded border bg-background px-2 py-1">Stebrov <b>{sheet.postCount}</b></span>
          <span className="rounded border bg-background px-2 py-1">Celot <b>{sheet.bays.length}</b></span>
          <span className="rounded border bg-background px-2 py-1">Desk <b>{sheet.boards}</b></span>
          <span className="rounded border bg-background px-2 py-1">Skupaj <b>{formatNum(sheet.totalMeters)} m</b></span>
          {sheet.stocks.length > 0 && (
            <span className="rounded border bg-background px-2 py-1">
              Nabavnih kosov <b>{sheet.stocks.reduce((s, x) => s + x.count, 0)}</b>
            </span>
          )}
          <span className="rounded border bg-background px-2 py-1">
            Odpad <b>{sheet.stocks.reduce((s, x) => s + x.wasteCm, 0).toFixed(0)} cm</b>
          </span>
        </div>
      ) : (
        <ul className="space-y-1" data-testid="fr-sheet-blockers">
          {sheet.blockers.map((b) => (
            <li key={b} className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      )}

      {ready && sheet.warnings.length > 0 && (
        <ul className="space-y-1" data-testid="fr-sheet-warnings">
          {sheet.warnings.slice(0, 4).map((w, i) => (
            <li key={`${i}-${w}`} className="flex items-start gap-1.5 rounded border border-amber-300/60 bg-amber-50 p-2 text-[11px] text-amber-900">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </li>
          ))}
        </ul>
      )}

      {ready && sheet.stocks.length > 0 && (
        <p className="text-[11px] text-muted-foreground" data-testid="fr-sheet-compare">
          Rez {cm(sheet.stocks[0]!.cutLenCm)}; iz enega nabavnega profila {sheet.stocks[0]!.perStock} rezov.
          {' '}Proti eni sami ravnini brez stebrov: {sheet.boards} proti {sheet.singleRun.boards} desk,
          razlika v odpadku <b>{sheet.extraWasteCm > 0 ? '+' : ''}{formatNum(sheet.extraWasteCm)} cm</b>.
        </p>
      )}

      {typeof meta.params?.measureCheck === 'string' && meta.params.measureCheck && (
        <p
          className="rounded border border-stone-300 bg-background p-2 text-[11px]"
          data-testid="fr-sheet-measure-check"
        >
          {meta.params.measureCheck}
        </p>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Stebri in pritrdila niso kosovnica — upodobitev jih ne modelira. Cene niso del lista.
        {sheet.span.status === 'unknown' ? ' ROKSAL meje razmika za ta profil ne objavi, zato je list ne postavi sam.' : ''}
      </p>
    </div>
  );
}

