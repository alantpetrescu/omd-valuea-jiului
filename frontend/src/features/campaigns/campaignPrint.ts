/**
 * Print a campaign — the prototype's `printCampaign()`.
 *
 * A separate window with its own A4 stylesheet, rather than printing the app
 * behind an `@media print` block. Two reasons the prototype chose it and we
 * keep it: the output is a standalone document (nothing to un-hide, no sidebar
 * or drawer chrome to fight), and the page box can be set properly with
 * `@page{size:A4;margin:14mm}`.
 *
 * Print only. The prototype's second action here was an "Export PDF" that
 * opened the same dialog with an extra hint line, because a page cannot choose
 * the print destination itself; that button now exports JSON instead, so the
 * hint and its `pdfMode` flag are gone. Saving as PDF is still available from
 * the print dialog, which is the only place a browser offers it.
 */

/** Lifted verbatim from the prototype's printCampaign() style block. */
const PRINT_CSS = `
@page{size:A4;margin:14mm}
*{box-sizing:border-box}
body{margin:0;color:#1c2420;font:11pt/1.5 Arial,sans-serif}
h1,h2,h3,h4{font-family:Georgia,serif;margin:0}
h1{font-size:24pt;margin-bottom:5mm}
.print-meta{color:#5d655e;margin-bottom:8mm}
.campaign-full-view{display:grid;gap:7mm}
.campaign-full-section{border:1px solid #d8d2c5;border-radius:5px;overflow:hidden;break-inside:avoid}
.campaign-full-section>header{padding:4mm 5mm;background:#eeeae0;display:flex;gap:3mm;align-items:center}
.campaign-full-section>header b{width:7mm;height:7mm;border-radius:50%;display:grid;place-items:center;background:#c08a2e}
.campaign-full-section>header h3{font-size:15pt}
.campaign-full-section-body{padding:5mm}
.section{padding:0 0 4mm;margin:0 0 4mm;border-bottom:1px solid #e8e3d7}
.section:last-child{border:0;margin:0;padding:0}
.section h3{font-size:13pt;margin-bottom:2mm}
.table,.edit-table,.activation-list-table,.channel-results-table{width:100%;border-collapse:collapse;font-size:9pt}
.table th,.table td,.edit-table th,.edit-table td,.activation-list-table th,.activation-list-table td,.channel-results-table th,.channel-results-table td{border:1px solid #ddd6c9;padding:2mm;text-align:left;vertical-align:top}
.table th{background:#f6f2e9}
.drawer-table-scroll,.metric-scroll,.activation-table-scroll,.channel-results-wrap{overflow:visible;border:0}
.badges{display:flex;gap:2mm;flex-wrap:wrap}
.badge{padding:1.5mm 2.5mm;border-radius:3px;background:#eeeae0}
.view-note{padding:3mm;border:1px solid #dfd2ab;background:#fbf5e6;margin-bottom:4mm}
.mockup-card,.activation-material-view{border:1px solid #ddd6c9;margin-bottom:4mm;break-inside:avoid}
.mockup-card header,.activation-material-view header{padding:3mm;background:#f6f2e9}
.visual-gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:2mm;padding:3mm}
.visual-gallery img{width:100%;height:35mm;object-fit:cover}
.mockup-card p{padding:3mm}
.mockup-actions,.btn,button,.x,.tabs,.campaign-view-switch,.section-title-row .btn{display:none!important}
ul{margin-top:1mm}
.linked-fixed-box{padding:3mm;border:1px solid #bdd2c6;background:#edf4f0}
.linked-fixed-box header{display:block;background:none;padding:0}
.linked-fixed-box .badge{display:none}
a{color:#1c2420;text-decoration:none}
.post-examples{display:grid;gap:3mm}
.post-examples article{border:1px solid #ddd6c9;padding:3mm}
.image-lightbox{display:none}
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Waits for the images in a document to settle, so the print dialog does not
 * open over half-loaded template visuals.
 *
 * The prototype could use a flat 350 ms because its visuals were inline data
 * URIs; ours are fetched from /uploads, so the wait has to be real. Capped,
 * because a broken image must delay the dialog rather than prevent it.
 */
function whenImagesSettled(doc: Document, timeoutMs = 3000): Promise<void> {
  const images = Array.from(doc.images).filter((image) => !image.complete);
  if (images.length === 0) return Promise.resolve();

  return Promise.race([
    Promise.all(
      images.map(
        (image) =>
          new Promise<void>((resolve) => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    ).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export interface CampaignPrintInput {
  title: string;
  /** Rendered under the title: type · pillar · status, as the prototype does. */
  meta: string;
  /** outerHTML of the live `.campaign-full-view` node. */
  bodyHtml: string;
}

/**
 * Opens the print window. Returns false when the browser blocked the popup,
 * which is the one failure the caller has to tell the user about.
 */
export function printCampaign({ title, meta, bodyHtml }: CampaignPrintInput): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.opener = null;

  win.document.write(
    `<!doctype html><html lang="ro"><head><meta charset="utf-8">` +
      // Template visuals are served from /uploads with root-relative URLs. The
      // new window has no document URL of its own, so without a base they would
      // resolve against about:blank and every image would be missing.
      `<base href="${window.location.origin}/">` +
      `<title>${escapeHtml(title)} – campanie</title>` +
      `<style>${PRINT_CSS}</style></head><body>` +
      `<h1>${escapeHtml(title)}</h1>` +
      `<div class="print-meta">${escapeHtml(meta)}</div>` +
      bodyHtml +
      `</body></html>`,
  );
  win.document.close();

  void whenImagesSettled(win.document).then(() => {
    win.focus();
    win.print();
  });

  return true;
}
