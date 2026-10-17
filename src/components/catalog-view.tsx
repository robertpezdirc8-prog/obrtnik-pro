'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { PlusCircle, PackageSearch, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCenik } from '@/hooks/use-cenik';
import { useDraft, useView } from '@/lib/store';
import { formatEUR } from '@/lib/format';
import type { CategoryDTO, ProductDTO } from '@/lib/types';

export function CatalogView() {
  const { toast } = useToast();
  const addItem = useDraft((s) => s.addItem);
  const setView = useView((s) => s.setView);
  const cenik = useCenik();
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => toast({ title: 'Napaka', description: 'Kataloga ni bilo mogoče naložiti.', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [toast]);

  // ─── Katalog nima cene ─────────────────────────────────────
  // Prejšnja različica je tu izpisala `p.unitPrice` — številko, ki jo je
  // zapisal program in je bila napisana DRUGIČ kot v kalkulatorju. Katalog
  // zdaj pove samo, KAJ izdelek je; ceno poišče po `sku` v Ceniku, kjer jo je
  // vpisal obrtnik. Če je ni, piše »cena ni vpisana« in ne 0 €.
  const priceOf = (p: ProductDTO): number | null =>
    p.sku ? cenik.priceOf(p.sku) : null;

  const addProduct = (catName: string, p: ProductDTO) => {
    const price = priceOf(p);
    addItem({
      key: `katalog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: p.name,
      description: `Iz kataloga: ${catName}`,
      quantity: 1,
      unit: p.unit,
      unitPrice: price,
      ...(p.sku ? { priceKey: p.sku } : {}),
    });
    toast({
      title: price === null ? 'Dodano brez cene — ceno vpiši' : 'Dodano v ponudbo ✓',
      description: price === null
        ? `${p.name} — 1 ${p.unit}. Vpiši ceno v ponudbi ali v Ceniku; brez cene ponudbe ni mogoče shraniti.`
        : `${p.name} — 1 ${p.unit} · ${formatEUR(price)}. Količino prilagodi v ponudbi.`,
      variant: price === null ? 'destructive' : 'default',
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Katalog materialov</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Kaj se vgradi: naziv, mera in enota. Cen NI v katalogu — tiste so v Ceniku, kjer jih
          vpišeš sam. Klikni + in postavka gre v osnutek ponudbe.
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <PackageSearch className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">Katalog je prazen.</p>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" defaultValue={[categories[0]?.id]} className="space-y-3">
          {categories.map((cat) => (
            <AccordionItem key={cat.id} value={cat.id} className="rounded-xl border bg-card px-4">
              <AccordionTrigger className="hover:no-underline py-4">
                <div className="flex items-center gap-3 text-left">
                  <div>
                    <span className="font-semibold">{cat.name}</span>
                    {cat.description && (
                      <span className="block text-xs text-muted-foreground font-normal">{cat.description}</span>
                    )}
                  </div>
                  <Badge variant="secondary" className="ml-auto mr-2 shrink-0">
                    {cat.products.length} izdelkov
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {cat.products.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/40 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-snug">{p.name}</p>
                        {p.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
                        )}
                        <p className="text-sm font-semibold text-primary mt-1">
                          {(() => {
                            const price = priceOf(p);
                            return price === null
                              ? <span className="text-xs font-normal text-amber-700 dark:text-amber-400">cena ni vpisana</span>
                              : <>{formatEUR(price)} <span className="text-xs font-normal text-muted-foreground">/ {p.unit}</span></>;
                          })()}
                        </p>
                      </div>
                      <button
                        onClick={() => addProduct(cat.name, p)}
                        className="shrink-0 rounded-md p-2 text-primary hover:bg-primary hover:text-primary-foreground transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
                        aria-label={`Dodaj ${p.name} v ponudbo`}
                      >
                        <PlusCircle className="h-5 w-5" />
                      </button>
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            Cene
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription>
            Tu so izdelki in mere. Cene se vpišejo v Ceniku — aplikacija jih ne pozna in jih
            ne ugiblje. Izdelek, ki nima cenovnega ključa, cene nima nikoli: zanje jo vpišeš
            kar v ponudbi.
          </CardDescription>
          <button
            type="button"
            onClick={() => setView('cenik')}
            className="mt-3 rounded-md border px-3 py-2 text-sm font-medium min-h-[40px] hover:bg-accent"
            data-testid="cenik-open-from-catalog"
          >
            Odpri Cenik
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
