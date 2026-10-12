'use client';

// ─── Izbira najboljšega posnetka iz serije (burst picker) ────
// Deterministično (0 AI): vsako fotko iz serije oceni skripta
// (ostrina = Laplaceova varianca, svetlost) in jih rangira.
// Monter na terenu posnemi 2–4 posnetke z roke — aplikacija pokaže,
// kateri je najostrejši, in analizo požene z enim klikom.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Images, Zap, Upload, Loader2, Crown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { checkQuality, processImage, type ProcessedImage } from '@/lib/image-quality';

interface ShotPickerProps {
  onPick: (img: ProcessedImage) => void;
  disabled?: boolean;
}

interface RankedShot {
  id: number;
  img: ProcessedImage;
  blurScore: number;
  brightness: number;
  warnings: string[];
}

function fmtBlur(v: number): string {
  return v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v));
}

export function ShotPicker({ onPick, disabled = false }: ShotPickerProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [shots, setShots] = useState<RankedShot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setLoading(true);
    try {
      const list: RankedShot[] = [];
      for (const f of Array.from(files).slice(0, 6)) {
        if (!f.type.startsWith('image/')) continue;
        try {
          const img = await processImage(f);
          const q = await checkQuality(img.dataUrl);
          list.push({ id: ++seq.current, img, blurScore: q.blurScore, brightness: q.brightness, warnings: q.warnings });
        } catch {
          /* posamezna fotka ne sme ustaviti serije */
        }
      }
      if (list.length === 0) {
        toast({ title: 'Ni veljavnih fotografij', variant: 'destructive' });
        return;
      }
      list.sort((x, y) => y.blurScore - x.blurScore);
      setShots(list);
      toast({
        title: `Serija ocenjena: ${list.length} ${list.length === 1 ? 'posnetek' : 'posnetkov'} ✓`,
        description: `Najostrejša: #1 (ostrina ${fmtBlur(list[0].blurScore)}).`,
      });
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const best = shots && shots.length > 0 ? shots[0] : null;

  return (
    <div className="space-y-3" data-testid="shot-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold">
          <Images className="h-4 w-4 text-primary" />
          Serija posnetkov — skripta izbere najostrejšega
        </h3>
        <Badge variant="secondary" className="text-[10px]">skripta · 0 AI</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Posnemi 2–4 posnetke istega objekta z roke in jih naloži skupaj — skripta oceni ostrino
        (Laplaceova varianca) in svetlost ter rangira posnetke. Analiza najostrejšega = najboljše mere.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
        data-testid="shot-input"
      />
      <Button
        size="sm"
        variant="outline"
        className="min-h-10 w-full sm:w-auto"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || loading}
        data-testid="shot-open"
      >
        {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
        Naloži serijo (2–6 fotografij)
      </Button>

      {shots && shots.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="shot-list">
          {shots.map((s, i) => (
            <div
              key={s.id}
              className={`overflow-hidden rounded-lg border ${i === 0 ? 'border-green-500 ring-1 ring-green-500/40' : 'border-border'}`}
              data-testid={`shot-item-${i}`}
            >
              <img src={s.img.dataUrl} alt={`Posnetek ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
              <div className="space-y-1 p-2">
                <div className="flex items-center justify-between gap-1">
                  {i === 0 ? (
                    <Badge className="text-[9px] px-1 py-0" data-testid="shot-best">
                      <Crown className="mr-0.5 h-3 w-3" />
                      najostrejša
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0">#{i + 1}</Badge>
                  )}
                  <span className="text-[10px] font-semibold text-muted-foreground">ostrina {fmtBlur(s.blurScore)}</span>
                </div>
                {s.warnings.length > 0 && (
                  <p className="text-[9px] leading-tight text-amber-700">{s.warnings[0]}</p>
                )}
                <Button
                  size="sm"
                  variant={i === 0 ? 'default' : 'outline'}
                  className="min-h-8 w-full text-[11px]"
                  onClick={() => onPick(s.img)}
                  disabled={disabled}
                  data-testid={`shot-pick-${i}`}
                >
                  <Zap className="mr-1 h-3 w-3" />
                  Analiziraj
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {best && (
        <Button
          size="sm"
          className="min-h-10 w-full"
          onClick={() => onPick(best.img)}
          disabled={disabled}
          data-testid="shot-analyze-best"
        >
          <Zap className="mr-1.5 h-4 w-4" />
          Analiziraj najostrejšo (#1)
        </Button>
      )}
    </div>
  );
}
