'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { PlusCircle, PackageSearch } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useDraft, useView } from '@/lib/store';
import { formatEUR } from '@/lib/format';
import type { CategoryDTO } from '@/lib/types';

export function CatalogView() {
  const { toast } = useToast();
  const addItem = useDraft((s) => s.addItem);
  const setView = useView((s) => s.setView);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/catalog')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => toast({ title: 'Napaka', description: 'Kataloga ni bilo mogoče naložiti.', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [toast]);

  const addProduct = (catName: string, p: { name: string; unit: string; unitPrice: number }) => {
    addItem({
      key: `katalog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: p.name,
      description: `Iz kataloga: ${catName}`,
      quantity: 1,
      unit: p.unit,
      unitPrice: p.unitPrice,
    });
    toast({
      title: 'Dodano v ponudbo ✓',
      description: `${p.name} — 1 ${p.unit}. Količino prilagodi v ponudbi.`,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Katalog materialov</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Orientacijske cene po dejavnostih. Klikni + in postavka gre v osnutek ponudbe.
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
                          {formatEUR(p.unitPrice)}{' '}
                          <span className="text-xs font-normal text-muted-foreground">/ {p.unit}</span>
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
          <CardTitle className="text-sm">Nasvet</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription>
            Cene v katalogu so orientacijske in jih na ponudbi lahko vedno prilagodiš.
            Kalkulatorji odmerka uporabljajo te iste cene kot izhodišče.
          </CardDescription>
        </CardContent>
      </Card>
    </div>
  );
}
