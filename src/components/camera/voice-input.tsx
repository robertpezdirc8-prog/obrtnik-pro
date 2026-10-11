'use client';

// ─── Glasovni vnos meritev (Web Speech API, sl-SI) ──────────
// Uporabnik pove meritev (»dva metra petdeset«), slovenski parser
// (parseSloMeasure) jo pretvori v cm, predogled pa jo po potrditvi
// doda v isti seznam meritev kot fotomeritve (onAddMeasurement).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Info, Mic, MicOff, X } from 'lucide-react';
import { formatCm, parseSloMeasure } from '@/lib/measure-geometry';

export interface VoiceInputProps {
  /** Pokliče se ob potrditvi prepoznane meritve. */
  onAddMeasurement: (label: string, cm: number) => void;
  /** Onemogoči mikrofon in potrditev (npr. med drugimi operacijami). */
  disabled?: boolean;
}

// ── Minimalni tipi za Web Speech API (namesto 'any') ────────
interface SpeechRecognitionEventLike {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Detekcija zmožnosti: standardni API, sicer webkit predpona (Chrome). */
function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const NOT_UNDERSTOOD =
  'Nisem razumel meritve. Poskusi: »dvesto petdeset«, »dva metra petdeset« ali »350 centimetrov«.';

export function VoiceInput({ onAddMeasurement, disabled = false }: VoiceInputProps) {
  const [mounted, setMounted] = useState(false); // SSR-varna detekcija
  const [listening, setListening] = useState(false);
  const [preview, setPreview] = useState<{ transcript: string; cm: number } | null>(null);
  const [note, setNote] = useState<string | null>(null); // prijazna opomba (amber)
  const [counter, setCounter] = useState(0); // lokalni števec izmerkov

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const addRef = useRef(onAddMeasurement); // vedno najnovejši prop
  const aliveRef = useRef(false); // zaščita pred setState po unmount

  useEffect(() => {
    addRef.current = onAddMeasurement;
  }, [onAddMeasurement]);

  // Mount + čistitev ob unmount (vsi event handlerji varni proti odjavi)
  useEffect(() => {
    aliveRef.current = true;
    // asinhrono nastavljanje — izognemo se sinhronemu setState v efektu
    const timer = setTimeout(() => setMounted(true), 0);
    return () => {
      clearTimeout(timer);
      aliveRef.current = false;
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          // prepoznavanje že ni aktivno
        }
      }
    };
  }, []);

  const stopListening = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // prepoznavanje že ni aktivno
      }
    }
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (recRef.current) return; // že poslušamo
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setNote('Glasovni vnos ni podprt v tem brskalniku (poskusi Chrome).');
      return;
    }
    setNote(null);
    setPreview(null);
    try {
      const rec = new Ctor();
      recRef.current = rec;
      rec.lang = 'sl-SI';
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        if (!aliveRef.current) return;
        const last = event.results[event.results.length - 1];
        const transcript = (last?.[0]?.transcript ?? '').trim();
        if (!transcript) return;
        const parsed = parseSloMeasure(transcript);
        if (parsed) {
          setPreview({ transcript, cm: parsed.cm });
          setNote(null);
        } else {
          setPreview(null);
          setNote(NOT_UNDERSTOOD);
        }
      };

      rec.onerror = (event) => {
        if (!aliveRef.current) return;
        const kind = event.error ?? '';
        if (kind === 'aborted') return; // uporabnik je sam ustavil
        if (kind === 'no-speech') {
          setNote('Nisem slišal govora. Klikni mikrofon in povej meritev.');
        } else if (kind === 'not-allowed' || kind === 'service-not-allowed') {
          setNote(
            'Dostop do mikrofona je zavrnjen — dovoli mikrofon v nastavitvah brskalnika.',
          );
        } else if (kind === 'network') {
          setNote('Prepoznavanje ni dosegljivo (ni povezave). Poskusi znova.');
        } else {
          setNote('Prepoznavanje govora ni uspelo. Poskusi znova.');
        }
      };

      rec.onend = () => {
        if (!aliveRef.current) return;
        recRef.current = null;
        setListening(false);
      };

      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setListening(false);
      setNote('Mikrofona ni bilo mogoče zagnati. Poskusi znova ali vpiši meritev ročno.');
    }
  }, []);

  const confirmPreview = useCallback(() => {
    if (!preview) return;
    addRef.current(`Glas ${counter + 1}`, preview.cm);
    setCounter((c) => c + 1);
    setPreview(null);
    setNote(null);
  }, [preview, counter]);

  const toggleListening = (): void => {
    if (listening) stopListening();
    else startListening();
  };

  const supported = mounted && getSpeechRecognition() !== null;
  const unsupported = mounted && !supported;

  return (
    <div className="space-y-3 rounded-xl border p-4">
      {/* Glava */}
      <div className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Glasovni vnos</h3>
      </div>

      {/* Mirna opomba, če Web Speech ni podprt */}
      {unsupported && (
        <p
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-600"
          role="status"
        >
          <MicOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Glasovni vnos ni podprt v tem brskalniku (poskusi Chrome).</span>
        </p>
      )}

      {/* Mikrofonski gumb */}
      {!unsupported && (
        <Button
          type="button"
          onClick={toggleListening}
          disabled={!supported || disabled}
          className="min-h-11 w-full whitespace-normal sm:w-auto"
          aria-pressed={listening}
          aria-label={
            listening ? 'Ustavi poslušanje' : 'Začni glasovni vnos meritve'
          }
        >
          {listening ? (
            <>
              <span
                className="h-3 w-3 animate-pulse rounded-full bg-red-500"
                aria-hidden="true"
              />
              Poslušam… povej meritev (npr. »dva metra petdeset«)
            </>
          ) : (
            <>
              <Mic className="h-4 w-4" aria-hidden="true" />
              Povej meritev
            </>
          )}
        </Button>
      )}

      {/* Prijazne inline opombe (napake, nerazumljen govor) */}
      {note && (
        <p
          className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-600"
          role="status"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{note}</span>
        </p>
      )}

      {/* Predogled prepoznane meritve */}
      {preview && (
        <div
          className="space-y-2 rounded-xl border bg-secondary/50 p-3"
          aria-live="polite"
        >
          <p className="text-sm">
            Razumel: <span className="font-medium">»{preview.transcript}«</span>{' '}
            → <strong className="text-green-700">{formatCm(preview.cm)}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={confirmPreview}
              disabled={disabled}
              className="min-h-11 bg-green-600 text-white hover:bg-green-700"
              aria-label={`Potrdi meritev ${formatCm(preview.cm)}`}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Potrdi
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPreview(null)}
              className="min-h-11"
              aria-label="Prekliči prepoznano meritev"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Prekliči
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Povej dolžino v centimetrih ali metrih — npr. »tristo petdeset« ali
        »dva metra petdeset«. Meritev se doda v isti seznam kot fotomeritve.
      </p>
    </div>
  );
}
