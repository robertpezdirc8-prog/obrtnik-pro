// Vstavi testno fotografijo z realistično AI analizo (kot bi jo vrnil VLM)
// — za E2E preverjanje prikaza rezultatov, merjenja in predpolnjevanja.
import { db } from '../src/lib/db';
import { readFileSync } from 'fs';

const b64 = readFileSync('/home/z/my-project/tests/test-photo.jpg').toString('base64');
const dataUrl = `data:image/jpeg;base64,${b64}`;

const products = await db.category.findUnique({
  where: { slug: 'ograje' },
  include: { products: { take: 4, orderBy: { unitPrice: 'asc' } } },
});

const analysis = {
  analysis: {
    craft: 'ograje',
    craftConfidence: 87,
    sceneDescription:
      'Balkon z aluminijasto ograjo z vodoravnimi letvami, balkonskimi vrati in oknom na fasadi.',
    objects: [
      {
        label: 'Aluminijasta ograja',
        count: 1,
        box: [6, 50, 88, 24],
        estWidthCm: 1050,
        estHeightCm: 110,
        note: 'Vodoravne letve, ~5 stebrov',
      },
      {
        label: 'Balkonska vrata',
        count: 1,
        box: [42, 31, 16, 42],
        estWidthCm: 90,
        estHeightCm: 200,
        note: 'Dvojna krila, lesena',
      },
      {
        label: 'Okno',
        count: 1,
        box: [14, 35, 19, 25],
        estWidthCm: 120,
        estHeightCm: 120,
        note: null,
      },
    ],
    reference: {
      label: 'Balkonska vrata',
      assumedCm: 200,
      explanation: 'Standardna višina balkonskih vrat je 200 cm — zanesljivo merilo.',
    },
    estimatedAreaM2: 11.6,
    measurementsNeeded: [
      'Skupna dolžina ograje vzdolž balkona',
      'Višina ograje od balkonske plošče',
      'Način pritrditve (na ploščo ali steno)',
    ],
    condition: { score: 82, notes: 'Ostra fotografija, dobra osvetlitev, cel objekt v okvirju.' },
    recommendations:
      'Priporočam aluminijasto ograjo z vodoravnimi letvami; pri pregledu preveri pritrditev v balkonsko ploščo.',
    prefill: { length: 10.5, height: 1.1, material: 'alu' },
  },
  suggestedProducts: (products?.products ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    unit: p.unit,
    unitPrice: p.unitPrice,
  })),
};

const photo = await db.photo.create({
  data: {
    title: 'Ograje',
    craftId: 'ograje',
    dataUrl,
    analysis: JSON.stringify(analysis),
    measurements: null,
  },
});

console.log('Vstavljena testna fotografija:', photo.id, '| izdelkov:', analysis.suggestedProducts.length);
