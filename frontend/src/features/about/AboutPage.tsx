/**
 * Despre aplicație — ported from the prototype's `about.js`.
 *
 * Five tabs of user guide: how the flow works, concepts and stages, what each
 * button does, the recommended order of work, and where the data comes from.
 * The text is the prototype's, because it is the specification of how the
 * product is meant to be understood — paraphrasing it would quietly change what
 * the product claims about itself.
 *
 * Opening the guide from a module preselects the relevant tab, as the prototype
 * does; `?from=campaigns` carries that here.
 *
 * The last tab differs on purpose, in both directions. The prototype loads JSON
 * packages into browser storage, which is how a prototype persists anything —
 * that control does not exist here, so the tab describes the real, server-side
 * procedure instead. In exchange it shows something the prototype cannot: the
 * actual import history from the database.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api } from '../../api/client';
import { countLabel, formatDateTime, formatNumber } from '../../domain/services';
import { useAuth } from '../auth/AuthContext';

const TABS = [
  ['overview', 'Cum funcționează'],
  ['concepts', 'Concepte și stadii'],
  ['buttons', 'Butoane și salvare'],
  ['workflow', 'Flux de lucru'],
  ['data', 'Date & import/export'],
] as const;

type TabId = (typeof TABS)[number][0];

interface ImportRow {
  packageType: string;
  filename: string | null;
  status: string;
  createdCount: number;
  updatedCount: number;
  warningCount: number;
  completedAt: string | null;
}

/**
 * What each package actually put in the database, read back now.
 *
 * The prototype's cards carry the same figures straight from its in-memory
 * repositories. Here they are five ordinary reads any signed-in role may make,
 * which matters: the badge has to say what is in the database, not what the
 * package claimed to contain.
 */
interface DataCounts {
  campaigns: number;
  activations: number;
  annualPlans: number;
  measuredMaterials: number;
  mentions: number;
  reviews: number;
}

const ROUTE_NAMES: Record<string, string> = {
  campaigns: 'Campanii',
  strategic: 'Repere strategice',
  activations: 'Activări',
  annual: 'Plan anual',
  'monitoring-activations': 'Monitorizare activări',
  'monitoring-reputation': 'Monitorizare reputație',
};

/** Which tab answers the question you most likely arrived with. */
function tabForRoute(route: string): TabId {
  if (route === 'campaigns' || route === 'activations' || route === 'annual') return 'concepts';
  if (route === 'monitoring-activations' || route === 'monitoring-reputation') return 'workflow';
  return 'overview';
}

const BUTTON_ROWS: Array<[string, string, string]> = [
  [
    'Adaugă / Creează',
    'Deschide un formular nou pentru o campanie sau o activare.',
    'După salvare, elementul apare în lista modulului și devine disponibil în celelalte vizualizări relevante.',
  ],
  [
    'Deschide',
    'Afișează fișa fără a schimba datele.',
    'Poți consulta taburile, rezultatele și legăturile existente.',
  ],
  [
    'Editează',
    'Deschide formularul cu datele existente.',
    'Salvarea înlocuiește versiunea curentă și actualizează toate vizualizările care folosesc acele date.',
  ],
  [
    'Preia context',
    'Copiază informații selectate dintr-o altă fișă și arată înainte ce urmează să fie preluat.',
    'Datele copiate devin editabile; elementele fixe marcate ca legătură vie rămân sincronizate cu părintele.',
  ],
  [
    'Elimină preluarea',
    'Șterge conținutul preluat în sesiunea curentă.',
    'Poți reveni la valorile anterioare sau poți alege o altă fișă-sursă.',
  ],
  [
    'Salvează',
    'Validează câmpurile și trimite modificările în baza de date.',
    'Datele sunt salvate în baza de date și devin disponibile celorlalți utilizatori autorizați.',
  ],
  [
    'Include în Planul anual',
    'Leagă activarea de Planul anual.',
    'Activarea apare automat în anul sau anii corespunzători perioadei sale, iar campania asociată este considerată selectată.',
  ],
  [
    'Rezultate social',
    'Deschide rezultatele importate pentru postările de pe Facebook, Instagram, TikTok și YouTube.',
    'Rezultatele pe material și canal provin din importul de monitorizare; KPI-urile agregate ale activării rămân manuale.',
  ],
  [
    'Print / Export PDF',
    'Pregătește fișa completă pentru tipărire sau salvare PDF.',
    'Se deschide dialogul browserului; pentru PDF se alege „Salvează ca PDF”.',
  ],
  [
    'Închide / Renunță',
    'Închide fereastra curentă.',
    'Datele nesalvate din formular nu sunt transmise în baza de date.',
  ],
];

function Overview() {
  return (
    <>
      <section className="about-intro">
        <h2>Un singur flux, de la strategie la rezultate</h2>
        <p>
          Sistemul organizează informația de marketing într-o succesiune clară. Reperele strategice
          definesc direcția, campaniile stabilesc cadrul, activările transformă cadrul în execuții
          concrete, Planul anual le așază în timp, iar Monitorizarea centralizează rezultatele.
        </p>
      </section>

      <div className="about-flow">
        <article>
          <small>1</small>
          <h3>Repere strategice</h3>
          <p>Programe, obiective și priorități folosite pentru încadrarea campaniilor.</p>
        </article>
        <article>
          <small>2</small>
          <h3>Campanii</h3>
          <p>
            Cadre strategice și creative reutilizabile, cu public, mesaje, produse, reguli și KPI-uri.
          </p>
        </article>
        <article>
          <small>3</small>
          <h3>Activări</h3>
          <p>Execuții concrete, cu perioadă, buget, materiale, canale și rezultate.</p>
        </article>
        <article>
          <small>4</small>
          <h3>Plan anual</h3>
          <p>
            Vedere managerială a campaniilor selectate pentru an și a activărilor concrete, cu buget,
            finanțare, implementare și rezultate, fără duplicarea datelor.
          </p>
        </article>
        <article>
          <small>5</small>
          <h3>Monitorizare</h3>
          <p>Performanța activărilor și reputația destinației, urmărite în două zone distincte.</p>
        </article>
      </div>

      <div className="about-accordion">
        <details open>
          <summary>Cum circulă informația între module</summary>
          <div className="about-accordion-body">
            <p>
              O campanie se leagă de repere strategice și poate genera activări. O activare preia
              elementele relevante din campanie și adaugă perioada, bugetul, materialele și
              rezultatele proprii. Dacă este bifată pentru Planul anual, apare automat în anul sau
              anii acoperiți de perioada ei, iar campania asociată este considerată selectată pentru
              acei ani. Rezultatele actualizate în activare sunt agregate automat în Monitorizare.
              Performanța este agregată din materialele activărilor, fără dublarea rezultatelor.
              Campaniile sunt evaluate pe baza activărilor asociate direct, iar activările fără
              campanie sunt raportate separat.
            </p>
          </div>
        </details>
        <details>
          <summary>Ce nu trebuie introdus de două ori</summary>
          <div className="about-accordion-body">
            <p>
              Planul anual și dashboardul de performanță sunt vizualizări ale acelorași date. Nu se
              creează copii separate ale activărilor și nu se reintroduc manual rezultatele în
              Monitorizare. KPI-urile agregate ale activării pot fi însă completate manual în fișa
              activării, inclusiv folosind valori consultate în rezultatele social.
            </p>
          </div>
        </details>
      </div>
    </>
  );
}

function Concepts() {
  return (
    <>
      <div className="about-definition-grid">
        <article className="about-definition">
          <small>Campanie</small>
          <h3>Cadrul strategic și creativ</h3>
          <p>
            Campania definește de ce, pentru cine și cum comunică OMD într-o direcție coerentă. Ea
            poate fi:
          </p>
          <ul>
            <li>
              <strong>campanie-umbrelă</strong> – cadrul comun al destinației;
            </li>
            <li>
              <strong>campanie tematică</strong> – dezvoltă un pilon;
            </li>
            <li>
              <strong>campanie tactică</strong> – răspunde unui sezon sau context și poate prelua
              elemente din campania tematică părinte.
            </li>
          </ul>
        </article>

        <article className="about-definition">
          <small>Activare</small>
          <h3>Execuția concretă a unei campanii</h3>
          <p>
            Activarea are o perioadă, un buget, un public, produse, materiale și canale specifice.
            Aici sunt introduse publicările efective și rezultatele obținute.
          </p>
          <ul>
            <li>pornește dintr-o campanie;</li>
            <li>folosește template-urile și regulile acesteia;</li>
            <li>poate fi inclusă în Planul anual;</li>
            <li>alimentează dashboardul de performanță.</li>
          </ul>
        </article>

        <article className="about-definition">
          <small>Campanie selectată în Plan</small>
          <h3>Direcție asumată pentru anul ales</h3>
          <p>
            Selecția anuală spune ce campanii intenționează OMD să folosească în anul respectiv. Nu
            creează o copie a campaniei și nu înseamnă că aceasta rulează continuu.
          </p>
        </article>

        <article className="about-definition">
          <small>Plan anual</small>
          <h3>Plan operațional + Calendar</h3>
          <p>
            <strong>Sezonalitatea campaniei</strong> definește lunile în care aceasta este relevantă
            strategic și nu reprezintă execuția efectivă. <strong>Activarea</strong> are propriile
            date de început și sfârșit și reprezintă implementarea concretă.{' '}
            <strong>Calendarul Planului anual</strong> suprapune aceste două niveluri pentru a arăta
            atât oportunitatea strategică, cât și acțiunile efectiv planificate.
          </p>
        </article>

        <article className="about-definition">
          <small>Stadiu</small>
          <h3>Poziția fișei în fluxul de lucru</h3>
          <p>
            Campaniile și activările folosesc aceeași schemă simplă:{' '}
            <strong>Draft → Activă → Încheiată</strong>. Pentru materiale nu mai există un stadiu
            separat; se urmăresc canalul, perioada de rulare, bugetul și datele de monitorizare.
          </p>
        </article>
      </div>

      <section className="about-intro">
        <h2>Stadii și situația în calendar</h2>
        <p>
          Stadiul este ales de utilizator și descrie maturitatea fișei. Situația în calendar este
          calculată automat și descrie doar poziția temporală a unei activări active.
        </p>
      </section>

      <div className="drawer-table-scroll">
        <table className="stage-table">
          <thead>
            <tr>
              <th>Obiect</th>
              <th>Stadiu</th>
              <th>Semnificație</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td rowSpan={3}>
                <strong>Campanie</strong>
              </td>
              <td>
                <strong>Draft</strong>
              </td>
              <td>Fișa este în lucru, poate fi incompletă și nu este încă versiune de referință.</td>
            </tr>
            <tr>
              <td>
                <strong>Activă</strong>
              </td>
              <td>
                Fișa este completată, salvată și disponibilă pentru activări, preluare de context,
                moștenire și Plan anual.{' '}
                <strong>Activă nu înseamnă că o campanie este în difuzare în acest moment.</strong>
              </td>
            </tr>
            <tr>
              <td>
                <strong>Încheiată</strong>
              </td>
              <td>
                Campania nu mai este utilizată pentru activări noi, dar rămâne pentru istoric,
                raportare și consultare.
              </td>
            </tr>
            <tr>
              <td rowSpan={3}>
                <strong>Activare</strong>
              </td>
              <td>
                <strong>Draft</strong>
              </td>
              <td>Fișa activării este încă în lucru.</td>
            </tr>
            <tr>
              <td>
                <strong>Activă</strong>
              </td>
              <td>
                Activarea este validă pentru execuție. Sistemul calculează automat situația în
                calendar din datele de început și sfârșit.
              </td>
            </tr>
            <tr>
              <td>
                <strong>Încheiată</strong>
              </td>
              <td>
                Activarea nu mai este executată și rămâne disponibilă pentru rezultate, raportare și
                istoric.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="about-definition-grid">
        <article className="about-definition">
          <small>Situație în calendar</small>
          <h3>Calculată automat doar pentru activările active</h3>
          <ul>
            <li>
              <strong>Urmează</strong> – data curentă este înainte de început;
            </li>
            <li>
              <strong>În desfășurare</strong> – data curentă este în interval;
            </li>
            <li>
              <strong>Perioadă trecută</strong> – data de sfârșit a trecut.
            </li>
          </ul>
          <p>
            Sistemul nu schimbă automat stadiul. O activare poate rămâne „Activă · Perioadă trecută”
            până când utilizatorul o marchează Încheiată.
          </p>
        </article>

        <article className="about-definition">
          <small>Material</small>
          <h3>Fără stadiu separat</h3>
          <p>
            Pentru fiecare material se completează canalul, formatul, bugetul alocat, perioada de
            rulare, vizualul/copy-ul și datele necesare monitorizării. Rezultatele social sunt
            actualizate separat la nivel de postare și canal.
          </p>
        </article>
      </div>

      <div className="about-accordion">
        <details open>
          <summary>Diferența dintre campanie și activare</summary>
          <div className="about-accordion-body">
            <p>
              Campania este cadrul reutilizabil. Activarea este aplicarea acelui cadru într-o perioadă
              și într-un context precis. De exemplu, „Muntele nu are un singur sezon” este o campanie,
              iar „Weekend în mișcare – început de toamnă” este o activare derivată din ea.
            </p>
          </div>
        </details>
        <details>
          <summary>Ce înseamnă legătura cu o campanie părinte</summary>
          <div className="about-accordion-body">
            <p>
              Elementele fixe rămân legate de campania părinte și se actualizează odată cu aceasta.
              Publicurile, produsele, canalele, mesajele secundare și KPI-urile pot fi copiate și apoi
              adaptate în fișa derivată.
            </p>
          </div>
        </details>
      </div>
    </>
  );
}

function Buttons() {
  return (
    <>
      <section className="about-intro">
        <h2>Ce face fiecare acțiune</h2>
        <p>
          Butoanele sunt acțiuni asupra aceleiași baze de date. După salvare, informația devine
          disponibilă în toate modulele în care este relevantă.
        </p>
      </section>

      <div className="drawer-table-scroll">
        <table className="about-button-table">
          <thead>
            <tr>
              <th>Buton / acțiune</th>
              <th>Ce face</th>
              <th>Rezultatul</th>
            </tr>
          </thead>
          <tbody>
            {BUTTON_ROWS.map(([action, what, result]) => (
              <tr key={action}>
                <td>{action}</td>
                <td>{what}</td>
                <td>{result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="about-save-result">
        <h3>Ce se întâmplă după salvare</h3>
        <p>
          Datele sunt salvate în baza de date și devin disponibile celorlalți utilizatori autorizați.
          O campanie salvată poate fi folosită ca sursă de context; o activare salvată apare în lista
          Activări, în Planul anual dacă este inclusă și în Monitorizare atunci când are rezultate.
        </p>
      </section>
    </>
  );
}

function Workflow() {
  return (
    <>
      <section className="about-intro">
        <h2>Flux recomandat de lucru</h2>
        <p>
          Ordinea de mai jos păstrează legăturile dintre strategie, execuție și rezultate și reduce
          introducerea repetată a acelorași informații.
        </p>
      </section>

      <div className="about-accordion">
        <details open>
          <summary>1. Definește sau selectează campania</summary>
          <div className="about-accordion-body">
            <p>
              Verifică tipul, pilonul, campania părinte, obiectivele, publicul, mesajele, produsele,
              canalele, regulile și KPI-urile. Pentru o campanie tactică, păstrează legătura vie cu
              elementele fixe ale campaniei tematice părinte.
            </p>
          </div>
        </details>
        <details>
          <summary>2. Creează activarea</summary>
          <div className="about-accordion-body">
            <p>
              Alege campania-sursă, perioada, stadiul, bugetul, publicurile, produsele și mesajul.
              Pentru fiecare material completează canalul, bugetul și perioada de rulare și, dacă este
              relevant, selectează un template al campaniei.
            </p>
          </div>
        </details>
        <details>
          <summary>3. Construiește Planul anual</summary>
          <div className="about-accordion-body">
            <p>
              Selectează campaniile pe care OMD intenționează să le utilizeze în anul ales. Apoi
              creează sau include activările concrete și completează perioada, responsabilul, bugetul
              planificat, modul de implementare, partenerii/furnizorii și sursele de finanțare. Planul
              citește aceste date direct din activări și le agregă automat.
            </p>
          </div>
        </details>
        <details>
          <summary>4. Publică materialele și actualizează rezultatele</summary>
          <div className="about-accordion-body">
            <p>
              Completează URL-ul public și ID-ul extern. Datele pe material și canal sunt agregate
              automat în zona „Performanța activărilor”. KPI-urile agregate ale activării rămân valori
              introduse manual de utilizator.
            </p>
          </div>
        </details>
        <details>
          <summary>5. Actualizează reputația destinației</summary>
          <div className="about-accordion-body">
            <p>
              Se importă separat pachetul de monitorizare reputațională, cu mențiuni, review-uri,
              sentiment și teme. Aceste date nu se amestecă cu rezultatele directe ale activărilor.
            </p>
          </div>
        </details>
      </div>

      <div className="drawer-table-scroll">
        <table className="stage-table">
          <thead>
            <tr>
              <th>Obiect</th>
              <th>Când îl creezi</th>
              <th>Ce alimentează după salvare</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Campanie</td>
              <td>Când este nevoie de un cadru strategic, tematic sau tactic reutilizabil.</td>
              <td>Activări, moștenire contextuală, Plan anual și interpretarea rezultatelor.</td>
            </tr>
            <tr>
              <td>Activare</td>
              <td>Când campania este transformată într-o execuție concretă.</td>
              <td>Plan anual, rezultate pe materiale și dashboardul de performanță.</td>
            </tr>
            <tr>
              <td>Import reputațional</td>
              <td>La fiecare actualizare periodică a pachetului-sursă.</td>
              <td>Dashboardul separat „Reputația destinației”.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/*
 * Date & import/export — the prototype's `dataPortability()`.
 *
 * Its shape, element for element: an intro, one status band, a two-column grid
 * of package cards each ending in a `data-portability-status` badge, and a
 * footnote. The earlier version of this tab rendered plain articles with no
 * badge and no band, so the stylesheet's two-row card grid had only one row to
 * lay out and the tab read as a column of paragraphs.
 *
 * The words differ where the prototype describes itself. It loads four JSON
 * files into browser storage at start-up and reports on that; here the import
 * runs on the server, one transaction per package, and is recorded in
 * `import_batches`. Copying its sentences across would have the product claim a
 * mechanism it does not have.
 */
function DataTab({
  imports,
  counts,
  countsFailed,
  isAdmin,
}: {
  imports: ImportRow[];
  counts: DataCounts | null;
  countsFailed: boolean;
  isAdmin: boolean;
}) {
  /* Most recent run per package, for the real file name on each card. Only
     ADMIN may read the history, so every other role sees the contract name. */
  const lastRun = new Map<string, ImportRow>();
  for (const row of imports) {
    if (!lastRun.has(row.packageType)) lastRun.set(row.packageType, row);
  }

  const cards = [
    {
      code: 'CAMPANII',
      packageType: 'OMD_CAMPAIGNS_PACKAGE',
      description: 'Strategie, nomenclatoare, campanii, machete și vizualuri.',
      value: counts ? countLabel(counts.campaigns, 'campanie', 'campanii') : '—',
      loaded: (counts?.campaigns ?? 0) > 0,
    },
    {
      code: 'ACTIVĂRI',
      packageType: 'OMD_ACTIVATIONS_PACKAGE',
      description: 'Activări, materiale, bugete, KPI și selecțiile din Planul anual.',
      value: counts
        ? `${countLabel(counts.activations, 'activare', 'activări')} · ${countLabel(
            counts.annualPlans,
            'an în plan',
            'ani în plan',
          )}`
        : '—',
      loaded: (counts?.activations ?? 0) > 0,
    },
    {
      code: 'MONITORIZARE ACTIVĂRI',
      packageType: 'OMD_ACTIVATION_MONITORING_PACKAGE',
      description: 'Instantanee de performanță legate de activare și de material.',
      value: counts
        ? countLabel(counts.measuredMaterials, 'material măsurat', 'materiale măsurate')
        : '—',
      loaded: (counts?.measuredMaterials ?? 0) > 0,
    },
    {
      code: 'MONITORIZARE REPUTAȚIE',
      packageType: 'OMD_REPUTATION_MONITORING_PACKAGE',
      description: 'Instantaneu reputațional, independent de campanii și activări.',
      value: counts
        ? `${countLabel(counts.mentions, 'mențiune', 'mențiuni')} · ${countLabel(
            counts.reviews,
            'review',
            'review-uri',
          )}`
        : '—',
      loaded: (counts?.mentions ?? 0) > 0 || (counts?.reviews ?? 0) > 0,
    },
  ];

  /*
   * The band the prototype puts above the grid, said in terms this application
   * can verify: what is in the database right now. The prototype reports the
   * outcome of its own browser-side import, which has no counterpart here.
   *
   * The last run is appended only for ADMIN — the one role allowed to read
   * `import_batches`, and the one role that can act on what it says.
   */
  const missing = cards.filter((card) => !card.loaded);
  const latest = imports[0];

  let bandClass = 'ok';
  let bandText = 'Toate cele patru pachete sunt încărcate.';

  if (countsFailed || !counts) {
    bandClass = 'error';
    bandText = 'Starea datelor nu a putut fi citită.';
  } else if (missing.length > 0) {
    bandClass = 'warn';
    bandText = `Fără date din: ${missing.map((card) => card.code.toLowerCase()).join(', ')}.`;
  }

  const bandSuffix =
    isAdmin && latest
      ? ` · ultimul import ${latest.packageType}${
          latest.completedAt ? `, ${formatDateTime(latest.completedAt)}` : ''
        }`
      : '';

  return (
    <>
      <section className="about-intro">
        <h2>Date externe &amp; import</h2>
        <p>
          Datele de business intră prin patru pachete JSON, validate față de contractele din{' '}
          <code>contracts/</code>. Importul rulează pe server, nu din interfață: fiecare pachet într-o
          tranzacție, iar la orice eroare nu rămâne nimic pe jumătate scris. Cifrele de mai jos sunt
          citite acum din baza de date, nu preluate din pachet.
        </p>
      </section>

      <div className={`data-portability-status ${bandClass}`} role="status">
        {bandText}
        {bandSuffix}
      </div>

      <div className="data-portability-grid">
        {cards.map((card) => (
          <section className="data-portability-card" key={card.packageType}>
            <div>
              <small className="entity-code">{card.code}</small>
              <h3>{lastRun.get(card.packageType)?.filename || card.packageType}</h3>
              <p>{card.description}</p>
            </div>
            <div className={`data-portability-status ${card.loaded ? 'ok' : 'warn'}`}>
              {card.value}
            </div>
          </section>
        ))}
      </div>

      <div className="about-accordion">
        <details open>
          <summary>Ce se întâmplă la un import repetat</summary>
          <div className="about-accordion-body">
            <p>
              Importul este idempotent: identitatea fiecărei fișe este <code>externalKey</code>, deci
              rularea aceluiași pachet a doua oară actualizează, nu duplică. Un nomenclator redenumit
              din aplicație <strong>nu</strong> este suprascris de pachet — diferența apare ca
              avertisment, iar valoarea din aplicație rămâne.
            </p>
          </div>
        </details>
        <details>
          <summary>Ordinea pachetelor</summary>
          <div className="about-accordion-body">
            <p>
              Campanii → activări → monitorizare activări → reputație. Activările se leagă de campanii
              prin <code>externalKey</code>, iar instantaneele se agață de materialele activărilor, așa
              că un pachet importat prea devreme eșuează pe o referință inexistentă.
            </p>
          </div>
        </details>
        <details>
          <summary>Zero nu este același lucru cu lipsă</summary>
          <div className="about-accordion-body">
            <p>
              O valoare de <strong>0</strong> înseamnă că s-a măsurat și rezultatul a fost zero. O
              valoare lipsă rămâne goală și se afișează ca liniuță. Distincția se păstrează din
              contractul JSON, prin baza de date, până în ecran — nicăieri nu se transformă un „nu
              știm” într-un zero.
            </p>
          </div>
        </details>
      </div>

      {isAdmin ? (
        <section className="about-intro">
          <h2>Ultimele importuri</h2>
          {imports.length === 0 ? (
            <p>Nu există importuri înregistrate.</p>
          ) : (
            <div className="data-portability-preview">
              <table>
                <thead>
                  <tr>
                    <th>Pachet</th>
                    <th>Stare</th>
                    <th>Create</th>
                    <th>Actualizate</th>
                    <th>Avertismente</th>
                    <th>Finalizat</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((row, index) => (
                    <tr key={index}>
                      <td>
                        <span className="entity-code">{row.packageType}</span>
                      </td>
                      <td>{row.status}</td>
                      <td>{formatNumber(row.createdCount)}</td>
                      <td>{formatNumber(row.updatedCount)}</td>
                      <td>{formatNumber(row.warningCount)}</td>
                      <td>{row.completedAt ? formatDateTime(row.completedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <p className="data-portability-footnote">
        În producție, importurile pot fi făcute independent. Campaniile reale se importă din
        OMD_CAMPAIGNS_PACKAGE; activările pot fi create direct în aplicație; monitorizarea activărilor
        se importă ulterior după <code>externalKey</code>.
      </p>
    </>
  );
}

export function AboutPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const from = searchParams.get('from') ?? '';
  const context = ROUTE_NAMES[from] ?? '';

  const [tab, setTab] = useState<TabId>(() => tabForRoute(from));
  const [contextShown, setContextShown] = useState(Boolean(from));
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  /*
   * Re-read `?from=` whenever it changes, not only on mount.
   *
   * A lazy `useState` initializer runs once. Arriving here from a module the
   * first time worked, but following a second contextual link while already on
   * this page changed the URL and nothing else — the guide stayed on whatever
   * tab was last clicked, silently ignoring the question just asked.
   */
  useEffect(() => {
    if (!from) return;
    setTab(tabForRoute(from));
    setContextShown(true);
  }, [from]);

  useEffect(() => {
    // Only ADMIN may read import history; for everyone else the section is
    // simply absent rather than shown as an error.
    if (!isAdmin) return;
    api
      .get<ImportRow[]>('/admin/imports?pageSize=10')
      .then((response) => setImports(response.data))
      .catch(() => setImports([]));
  }, [isAdmin]);

  /*
   * What each package left behind, counted now.
   *
   * Five reads rather than one summary endpoint, because each figure already
   * has an owner: the campaign list knows how many campaigns there are, the
   * monitoring summary knows how many materials carry measurements. Adding a
   * sixth endpoint to repeat them would give the same numbers a second place to
   * be wrong.
   *
   * One failure fails the set. A card reading "0 campanii" because a request
   * did not arrive is worse than saying the state could not be read: the first
   * claims an empty database.
   */
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      api.get<unknown[]>('/campaigns?pageSize=1'),
      api.get<{ total: number }>('/activations/stats'),
      api.get<unknown[]>('/annual-plans'),
      api.get<{ materials: number }>('/monitoring/activations/summary'),
      api.get<{ mentionsCount: number | null; reviewsCount: number | null } | null>(
        '/monitoring/reputation/latest',
      ),
    ])
      .then(([campaigns, activations, annual, monitoring, reputation]) => {
        if (cancelled) return;
        setCounts({
          campaigns: campaigns.meta?.totalUnfiltered ?? campaigns.data.length,
          activations: activations.data.total ?? 0,
          annualPlans: annual.data.length,
          measuredMaterials: monitoring.data.materials ?? 0,
          mentions: reputation.data?.mentionsCount ?? 0,
          reviews: reputation.data?.reviewsCount ?? 0,
        });
        setCountsFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setCounts(null);
        setCountsFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Despre aplicație</h1>
          <p>
            Ghid de utilizare pentru concepte, butoane, stadii, salvare și legăturile dintre module.
          </p>
        </div>
      </header>

      <nav className="about-tabs">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            onClick={() => {
              setTab(id);
              setContextShown(false);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {context && contextShown ? (
        <div className="about-context">
          <b>Ajutor contextual</b>
          <span>
            Ai deschis ghidul din modulul <strong>{context}</strong>. Este selectată secțiunea cea mai
            relevantă pentru acel flux.
          </span>
        </div>
      ) : null}

      <main className="about-content">
        {tab === 'concepts' ? <Concepts /> : null}
        {tab === 'buttons' ? <Buttons /> : null}
        {tab === 'workflow' ? <Workflow /> : null}
        {tab === 'data' ? (
          <DataTab
            imports={imports}
            counts={counts}
            countsFailed={countsFailed}
            isAdmin={isAdmin}
          />
        ) : null}
        {tab === 'overview' ? <Overview /> : null}
      </main>
    </>
  );
}
