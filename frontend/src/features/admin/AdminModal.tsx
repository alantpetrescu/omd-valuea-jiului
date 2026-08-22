/**
 * The modal every "add" in Administrare opens into.
 *
 * Markup is the prototype's — `.modal-bg`, `.modal`, `.modal-head`,
 * `.modal-kicker`, `.modal-body`, `.modal-foot` — so the lifted stylesheet
 * applies with nothing added but a width and a scroll container. The prototype
 * uses the same shell for its campaign and activation wizards; this is the
 * single-step version of it.
 *
 * Why creating moved out of the page at all: the four admin lists each replaced
 * their `＋ Adaugă` button with an inline form, so the button vanished at the
 * moment you used it, the list jumped, and on a long nomenclator the form opened
 * above the fold you were reading. A modal keeps the list where it was and puts
 * the form where the eye already is.
 *
 * Editing opens the same modal, badged `MOD EDITARE` — the wording and the
 * `.form-mode-label` class `CampaignWizard` already uses, so the two screens say
 * "you are changing something that exists" the same way.
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function AdminModal({
  mode,
  kicker,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  /**
   * Decides the badge. One badge, not two: the campaign wizard shows a single
   * `.form-mode-label` reading either `MOD EDITARE` or `CAMPANIE NOUĂ`, and two
   * chips stacked above a four-field form would be more chrome than form.
   */
  mode: 'create' | 'edit';
  /** The badge text when creating — e.g. `UTILIZATOR NOU`. */
  kicker: string;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /**
   * Optional. Forms that already carry their own `.wizard-actions` — the two
   * strategy ones — pass nothing and keep them at the end of the body, where a
   * sticky rule holds them in view. Rewriting those two components to hand their
   * buttons up here would be churn for a few pixels.
   */
  footer?: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  /*
   * The page behind stops scrolling while the modal is up.
   *
   * Its own effect with no dependencies, deliberately: it belongs to this modal
   * existing, not to any prop. Sharing it with the key handler meant re-running
   * on every prop change, and each re-run saved the already-locked value as the
   * one to restore — the same defect the drawers had.
   */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-bg"
      /* Only a click that starts and ends on the backdrop closes. Without the
         target check, releasing the mouse outside after selecting text inside
         the form counts as a backdrop click and throws the form away. */
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal admin-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div>
            <div className="form-mode-label">{mode === 'edit' ? 'MOD EDITARE' : kicker}</div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button ref={closeRef} type="button" className="x" onClick={onClose} aria-label="Închide">
            ×
          </button>
        </header>

        <div className="modal-body">
          <div className="admin-modal-scroll">{children}</div>
        </div>

        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}
