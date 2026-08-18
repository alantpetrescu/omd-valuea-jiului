/**
 * Despre aplicație.
 *
 * The prototype's About page explained where the demo data came from. The live
 * version answers the equivalent question: where the data lives now, and what
 * the rules are that the screens obey.
 */
import { useEffect, useState } from 'react';

import { api } from '../../api/client';
import { formatDateTime } from '../../domain/services';
import { useAuth } from '../auth/AuthContext';

interface ImportRow {
  packageType: string;
  status: string;
  createdCount: number;
  completedAt: string | null;
}

export function AboutPage() {
  const { user } = useAuth();
  const [imports, setImports] = useState<ImportRow[]>([]);

  useEffect(() => {
    // Only ADMIN may read import history; for everyone else the section is
    // simply absent rather than shown as an error.
    if (user?.role !== 'ADMIN') return;
    api
      .get<ImportRow[]>('/admin/imports?pageSize=10')
      .then((response) => setImports(response.data))
      .catch(() => setImports([]));
  }, [user?.role]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Despre aplicație</h1>
          <p>OMD Valea Jiului — Sistem digital de marketing</p>
        </div>
      </header>

      <div className="campaign-full-view">
        <section className="campaign-full-section">
          <header>
            <b>1</b>
            <h3>Unde sunt datele</h3>
          </header>
          <div className="campaign-full-section-body">
            <section className="section">
              <p>
                Toate datele sunt păstrate pe server, în MySQL, iar vizualurile sunt fișiere pe disc.
                Nimic nu se salvează în browser: dacă te autentifici de pe alt calculator, vezi
                aceleași informații.
              </p>
            </section>
            <section className="section">
              <h3>Cum ajung datele în sistem</h3>
              <p>
                Strategia, nomenclatoarele și campaniile pot fi populate dintr-un pachet JSON, fără
                introducere manuală. Activările se creează apoi direct în aplicație, iar rezultatele
                de monitorizare sosesc periodic prin importuri.
              </p>
            </section>
          </div>
        </section>

        <section className="campaign-full-section">
          <header>
            <b>2</b>
            <h3>Reguli care se văd în ecrane</h3>
          </header>
          <div className="campaign-full-section-body">
            <section className="section">
              <h3>Ce nu se șterge</h3>
              <p>
                O campanie sau o activare cu istoric nu se șterge — se marchează „Încheiată". Un
                nomenclator folosit undeva nu poate fi șters, dar poate fi dezactivat: valorile
                existente rămân, doar că nu mai pot fi alese în înregistrări noi.
              </p>
            </section>
            <section className="section">
              <h3>Zero nu este același lucru cu lipsă</h3>
              <p>
                În monitorizare, „0" înseamnă că valoarea a fost măsurată și este zero, iar „—"
                înseamnă că nu a fost raportată. Cele două nu se amestecă niciodată.
              </p>
            </section>
            <section className="section">
              <h3>Planul anual are două surse</h3>
              <p>
                O campanie apare în plan fie pentru că a fost aleasă manual, fie pentru că una dintre
                activările ei se desfășoară în acel an. Doar prima categorie se editează din Planul
                anual.
              </p>
            </section>
            <section className="section">
              <h3>Strategia este versionată</h3>
              <p>
                Reperele aparțin unui ciclu strategic. Un cod precum <code>OS2</code> poate însemna
                altceva într-o strategie viitoare, fără ca o campanie din trecut să își piardă
                contextul.
              </p>
            </section>
          </div>
        </section>

        <section className="campaign-full-section">
          <header>
            <b>3</b>
            <h3>Roluri</h3>
          </header>
          <div className="campaign-full-section-body">
            <table className="table">
              <tbody>
                <tr>
                  <th>Administrator</th>
                  <td>Tot ce face un Editor, plus utilizatori, nomenclatoare, strategie și audit.</td>
                </tr>
                <tr>
                  <th>Editor</th>
                  <td>Creează și modifică campanii, activări și Planul anual.</td>
                </tr>
                <tr>
                  <th>Vizualizare</th>
                  <td>Poate consulta totul, fără să modifice nimic.</td>
                </tr>
              </tbody>
            </table>
            <p className="muted-copy">
              Ești autentificat ca <strong>{user?.name}</strong> ({user?.email}).
            </p>
          </div>
        </section>

        {user?.role === 'ADMIN' && imports.length ? (
          <section className="campaign-full-section">
            <header>
              <b>4</b>
              <h3>Ultimele importuri</h3>
            </header>
            <div className="campaign-full-section-body">
              <div className="drawer-table-scroll">
                <table className="table wide">
                  <tbody>
                    <tr>
                      <th>Pachet</th>
                      <th>Status</th>
                      <th>Înregistrări create</th>
                      <th>Finalizat</th>
                    </tr>
                    {imports.map((row, index) => (
                      <tr key={index}>
                        <td>{row.packageType}</td>
                        <td>{row.status}</td>
                        <td>{row.createdCount}</td>
                        <td>{row.completedAt ? formatDateTime(row.completedAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
