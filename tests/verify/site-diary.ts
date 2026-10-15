// Numerična verifikacija site-diary (bun, brez brskalnika) — Task 48
// Terenski dnevnik (Baustellendokumentacija): grupiranje po dnevih,
// iskren povzetek, ure iz časovnice po ponudbi, CSV, tiskalno poročilo.
// Vse pričakovanje so ROČNO izračunane resnice.
import {
  buildDiaryReportHtml,
  diaryHours,
  diarySummary,
  diaryToCsv,
  formatDiaryDay,
  groupDiaryByDay,
  isDiaryPhase,
  MAX_CAPTION_LEN,
  MAX_NOTE_LEN,
  MAX_OBJECT_LABEL_LEN,
  MAX_PHOTOS_PER_ENTRY,
  parseDiaryPhotos,
  weekdayShort,
  type DiaryEntryInput,
} from '../../src/lib/site-diary';
import type { TimeEntryInput } from '../../src/lib/time-tracking';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got: unknown) {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name} — dobil: ${JSON.stringify(got)}`);
  }
}

const photo = (i: number): { dataUrl: string; thumb: string | null; caption: string | null } => ({
  dataUrl: `data:image/jpeg;base64,PHOTO${i}`,
  thumb: `data:image/jpeg;base64,THUMB${i}`,
  caption: i % 2 === 0 ? `Opomba ${i}` : null,
});

function entry(partial: Partial<DiaryEntryInput> & { id: string; day: string }): DiaryEntryInput {
  return {
    phase: 'ostalo',
    note: '',
    offerId: null,
    offerNumber: null,
    objectLabel: null,
    photos: [],
    createdAt: `${partial.day}T10:00:00.000Z`,
    ...partial,
  };
}

// 1) Konstante
check('konstante: max fotk 6', MAX_PHOTOS_PER_ENTRY === 6, MAX_PHOTOS_PER_ENTRY);
check('konstante: opis ≤ 500', MAX_NOTE_LEN === 500, MAX_NOTE_LEN);
check('konstante: objekt ≤ 80', MAX_OBJECT_LABEL_LEN === 80, MAX_OBJECT_LABEL_LEN);
check('konstante: opomba ≤ 120', MAX_CAPTION_LEN === 120, MAX_CAPTION_LEN);

// 2) isDiaryPhase
check('faza: montaža veljavna', isDiaryPhase('montaza') === true, isDiaryPhase('montaza'));
check('faza: priprava veljavna', isDiaryPhase('priprava') === true, isDiaryPhase('priprava'));
check('faza: neznana zavrnjena', isDiaryPhase('neznana') === false, isDiaryPhase('neznana'));
check('faza: število zavrnjeno', isDiaryPhase(3) === false, isDiaryPhase(3));
check('faza: null zavrnjena', isDiaryPhase(null) === false, isDiaryPhase(null));

// 3) parseDiaryPhotos — validacija
{
  const ok = parseDiaryPhotos([photo(1), { dataUrl: 'data:image/png;base64,XYZ', thumb: null, caption: '  ' }]);
  check('fotke: 2 veljavni', ok.error === null && ok.photos.length === 2, ok);
  check('fotke: prazen caption → null', ok.photos[1]?.caption === null, ok.photos[1]?.caption);
  check('fotke: caption se obreže na 120', parseDiaryPhotos([{ dataUrl: 'data:image/jpeg;base64,AA', thumb: null, caption: 'x'.repeat(150) }]).photos[0]?.caption?.length === 120, 'trim');
  const tooMany = parseDiaryPhotos(Array.from({ length: 7 }, (_, i) => photo(i)));
  check('fotke: 7 → zavrnjeno', tooMany.error !== null, tooMany.error);
  const badUrl = parseDiaryPhotos([{ dataUrl: 'http://x', thumb: null, caption: null }]);
  check('fotke: http → zavrnjeno', badUrl.error !== null, badUrl.error);
  const short = parseDiaryPhotos([{ dataUrl: 'data:image/', thumb: null, caption: null }]);
  check('fotke: prekratka → zavrnjena', short.error !== null, short.error);
  const notArr = parseDiaryPhotos('x');
  check('fotke: niz → zavrnjeno', notArr.error !== null, notArr.error);
  const noThumb = parseDiaryPhotos([{ dataUrl: 'data:image/jpeg;base64,AA', thumb: 123 as unknown as string, caption: null }]);
  check('fotke: zloben thumb → ignoriran (null)', noTail(noThumb.photos[0]), noThumb.photos[0]);
  function noTail(p: { thumb: string | null } | undefined): boolean {
    return p?.thumb === null;
  }
}

// 4) weekdayShort + formatDiaryDay (UTC — deterministično)
check('dan v tedna: 2026-10-14 je sre.', weekdayShort('2026-10-14') === 'sre.', weekdayShort('2026-10-14'));
check('dan v tedna: 2026-10-18 je ned.', weekdayShort('2026-10-18') === 'ned.', weekdayShort('2026-10-18'));
check('format: "sre., 14. 10. 2026"', formatDiaryDay('2026-10-14') === 'sre., 14. 10. 2026', formatDiaryDay('2026-10-14'));

// 5) groupDiaryByDay — padajoče dnevi, znotraj dneva padajoče createdAt
{
  const e1 = entry({ id: 'a', day: '2026-02-10', createdAt: '2026-02-10T08:00:00.000Z', note: 'zjutraj' });
  const e2 = entry({ id: 'b', day: '2026-02-10', createdAt: '2026-02-10T16:00:00.000Z', note: 'popoldne' });
  const e3 = entry({ id: 'c', day: '2026-02-13', createdAt: '2026-02-13T09:00:00.000Z', photos: [photo(1), photo(2)] });
  const e4 = entry({ id: 'd', day: '2026-02-12', createdAt: '2026-02-12T12:00:00.000Z' });
  const days = groupDiaryByDay([e1, e2, e3, e4]);
  check('grupe: 3 dnevi', days.length === 3, days.map((d) => d.day));
  check('grupe: padajoče 13 > 12 > 10', days[0]?.day === '2026-02-13' && days[1]?.day === '2026-02-12' && days[2]?.day === '2026-02-10', days.map((d) => d.day));
  check('grupe: znotraj dneva zadnji zgoraj', days[2]?.entries[0]?.id === 'b', days[2]?.entries.map((e) => e.id));
  check('grupe: št. fotk dneva = 2', days[0]?.photoCount === 2, days[0]?.photoCount);
  check('grupe: prazen vhod → prazno', groupDiaryByDay([]).length === 0, groupDiaryByDay([]));
}

// 6) diarySummary — iskreni številki
{
  const s0 = diarySummary([]);
  check('povzetek: prazno → nič, span null', s0.entries === 0 && s0.spanDays === null, s0);
  const entries = [
    entry({ id: 'a', day: '2026-02-10', photos: [photo(1)] }),
    entry({ id: 'b', day: '2026-02-13', photos: [photo(2), photo(3)] }),
    entry({ id: 'c', day: '2026-02-13' }),
  ];
  const s = diarySummary(entries);
  check('povzetek: 3 vnosi', s.entries === 3, s.entries);
  check('povzetek: 2 dneva', s.days === 2, s.days);
  check('povzetek: 3 fotke', s.photos === 3, s.photos);
  check('povzetek: first 10.2.', s.firstDay === '2026-02-10', s.firstDay);
  check('povzetek: last 13.2.', s.lastDay === '2026-02-13', s.lastDay);
  check('povzetek: span = 4 dni (10.–13., vključno)', s.spanDays === 4, s.spanDays);
}

// 7) diaryHours — ure iz časovnice (Σ obračunljivih ur po vnosu)
{
  const te: TimeEntryInput[] = [
    { id: 't1', day: '2026-02-10', description: 'montaža', minutes: 95, hourlyRate: 35, customerName: null, offerId: 'OFF1', craftId: null, billedAt: null, billedRef: null, createdAt: '' },
    { id: 't2', day: '2026-02-11', description: 'vrtanje', minutes: 100, hourlyRate: 35, customerName: null, offerId: 'OFF1', craftId: null, billedAt: null, billedRef: null, createdAt: '' },
    { id: 't3', day: '2026-02-11', description: 'druga ponudba', minutes: 60, hourlyRate: 30, customerName: null, offerId: 'OFF2', craftId: null, billedAt: null, billedRef: null, createdAt: '' },
  ];
  const h1 = diaryHours(te, 'OFF1');
  // ročno: 95 min → 1,5 h + 100 min → 1,75 h = 3,25 h · 195 min
  check('ure: OFF1 = 195 min', h1.minutes === 195, h1.minutes);
  check('ure: OFF1 = 3,25 h (Σ po vnosu na 0,25)', h1.hours === 3.25, h1.hours);
  check('ure: OFF1 = 2 vnosa', h1.timeEntries === 2, h1.timeEntries);
  const h2 = diaryHours(te, 'OFF2');
  check('ure: OFF2 = 1 h', h2.hours === 1, h2.hours);
  const hNone = diaryHours(te, null);
  check('ure: brez ponudbe → 0 (ne ugibamo)', hNone.minutes === 0 && hNone.hours === 0 && hNone.timeEntries === 0, hNone);
  const hMissing = diaryHours(te, 'NEOBSTOJA');
  check('ure: neobstoječ nalog → 0', hMissing.timeEntries === 0, hMissing);
  // obračunan vnos še vedno šteje v zgodovino dnevnika
  const teBilled: TimeEntryInput[] = [{ ...te[0]!, billedAt: '2026-03-01T00:00:00.000Z', billedRef: 'ponudba' }];
  check('ure: obračunan vnos ostane v zgodovini', diaryHours(teBilled, 'OFF1').hours === 1.5, diaryHours(teBilled, 'OFF1'));
}

// 8) diaryToCsv — escape + struktura
{
  const entries = [
    entry({
      id: 'a', day: '2026-02-13', phase: 'montaza', note: 'Delo z "nagovornimi" narekovaji, in vejico',
      offerId: 'OFF1', offerNumber: '2026-001', photos: [photo(1)], createdAt: '2026-02-13T09:00:00.000Z',
    }),
  ];
  const csv = diaryToCsv(entries);
  const lines = csv.split('\r\n');
  check('csv: 2 vrstici (glava + 1)', lines.length === 2, lines.length);
  check('csv: glava', lines[0] === 'dan;faza;ponudba;objekt;opis;st_fotografij;ustvarjeno', lines[0]);
  check('csv: narekovaji podvojeni', lines[1]?.includes('""nagovornimi""'), lines[1]);
  check('csv: faza slovensko', lines[1]?.includes('"Montaža"'), lines[1]);
  check('csv: 1 fotka', lines[1]?.endsWith('";"1";"2026-02-13T09:00:00.000Z"'), lines[1]?.slice(-45));
}

// 9) buildDiaryReportHtml — struktura + iskrenost
{
  const days = groupDiaryByDay([
    entry({ id: 'a', day: '2026-02-13', phase: 'montaza', note: 'Montaža ograje', offerNumber: '2026-001', photos: [photo(1)] }),
  ]);
  const meta = {
    companyName: 'Moj Obrt s.p.', ownerName: 'Jože', address: 'Cesta 1', phone: '040', email: 'j@x.si',
    customerName: 'Ana Kovač', objectAddress: 'Cesta v Mestni log 12', offerNumber: '2026-001',
  };
  const withHours = buildDiaryReportHtml(days, meta, { minutes: 195, hours: 3.25, timeEntries: 2 });
  check('poročilo: naslov podjetja', withHours.includes('Moj Obrt s.p.'), 'company');
  check('poročilo: dokumentacija naslov', withHours.includes('Dokumentacija izvedenih del'), 'title');
  check('poročilo: stranka', withHours.includes('Ana Kovač'), 'customer');
  check('poročilo: dan', withHours.includes('pet., 13. 02. 2026'), formatDiaryDay('2026-02-13'));
  check('poročilo: faza Montaža', withHours.includes('Montaža'), 'phase');
  check('poročilo: opis', withHours.includes('Montaža ograje'), 'note');
  check('poročilo: fotka v img', withHours.includes('data:image/jpeg;base64,PHOTO1'), 'img');
  check('poročilo: ure izpisane (3,25 h)', withHours.includes('3,25 h'), 'hours');
  check('poročilo: 0,25 h opomba', withHours.includes('0,25 h'), 'rounding note');
  const noHours = buildDiaryReportHtml(days, meta, { minutes: 0, hours: 0, timeEntries: 0 });
  check('poročilo: brez ur NE trdi nič o urah', !noHours.includes('Evidence ure'), 'no hours');
  const empty = buildDiaryReportHtml([], meta, { minutes: 0, hours: 0, timeEntries: 0 });
  check('poročilo: prazno → jasen stavek', empty.includes('Ni zapisov'), 'empty');
  // XSS: opis z <script> mora biti pobegnil
  const xss = buildDiaryReportHtml(
    groupDiaryByDay([entry({ id: 'x', day: '2026-02-13', note: '<script>alert(1)</script>' })]),
    meta, { minutes: 0, hours: 0, timeEntries: 0 },
  );
  check('poročilo: XSS pobegnil', xss.includes('&lt;script&gt;') && !xss.includes('<script>alert'), 'esc');
}

// 10) Zgodovinski dan (determinizem ob meji — niz, brez TZ)
{
  const days = groupDiaryByDay([entry({ id: 'a', day: '2026-01-01' })]);
  check('novo leto: 2026-01-01 je čet.', days[0]?.weekday === 'čet.', days[0]?.weekday);
}

console.log(`\n${pass} uspešnih, ${fail} neuspešnih`);
if (fail > 0) process.exit(1);
