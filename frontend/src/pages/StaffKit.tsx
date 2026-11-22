import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Search, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { avatarFor, avatarSrc } from "@/data/dashboardProfile";
import { initials, type ActionMessage } from "./adminActions";

/** Title row of a staff page, with its main actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="st-page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="st-actions">{actions}</div>}
    </div>
  );
}

/** Learners show their game avatar (or the shared default). Teachers and admins show initials. */
export function Avatar({ name, student = false, avatar, size = 36 }: { name: string; student?: boolean; avatar?: string | null; size?: number }) {
  return student
    ? <img className="st-avatar st-avatar-icon" src={avatarSrc(avatarFor(avatar))} alt="" width={size} height={size} />
    : <span className="st-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>;
}

/** Search box that reports its value after typing pauses. */
export function SearchField({ label, placeholder, onSearch, delay = 300 }: {
  label: string;
  placeholder: string;
  onSearch: (value: string) => void;
  delay?: number;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => onSearch(value.trim()), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay, onSearch]);
  return (
    <label className="st-search">
      <span className="sr-only">{label}</span>
      <Search size={17} aria-hidden="true" />
      <input type="search" value={value} placeholder={placeholder} autoComplete="off" onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

export function Notice({ message }: { message: ActionMessage | null }) {
  if (!message) return null;
  return (
    <p className={message.error ? "st-notice st-notice-error" : "st-notice"} role={message.error ? "alert" : "status"}>
      {message.error ? <AlertCircle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
      {message.text}
    </p>
  );
}

export function Modal({ open, onOpenChange, title, description, wide = false, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="st-overlay" />
        <Dialog.Content className={wide ? "st-modal st-modal-wide" : "st-modal"}>
          <div className="st-modal-head">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description ? <Dialog.Description>{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="st-icon-button" aria-label="Close"><X size={18} aria-hidden="true" /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Confirmation step for actions that are hard to undo, such as suspension or deletion. */
export function ConfirmModal({ open, onOpenChange, title, description, confirmLabel, danger = false, busy, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description}>
      <div className="st-modal-actions">
        <Dialog.Close className="st-button">Cancel</Dialog.Close>
        <button type="button" className={danger ? "st-button st-button-danger" : "st-button st-button-primary"} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

const bar = (width: string, key?: number) => <span key={key} className="st-skeleton" style={{ width }} />;

/** Placeholder rows shaped like the table that is loading. */
export function SkeletonTable({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="st-table-wrap" aria-hidden="true">
      <div className="st-skeleton-row st-skeleton-head">{Array.from({ length: cols }, (_, index) => bar(index ? "60%" : "40%", index))}</div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="st-skeleton-row">
          <span className="st-skeleton-person"><span className="st-skeleton st-skeleton-circle" /><span>{bar("70%")}{bar("45%")}</span></span>
          {Array.from({ length: cols - 1 }, (_, index) => bar(`${50 + ((row + index) % 3) * 15}%`, index))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="st-stats" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div key={index}><span className="st-skeleton st-skeleton-icon" />{bar("55%")}{bar("30%")}</div>
      ))}
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="st-skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}><span className="st-skeleton st-skeleton-circle" /><span>{bar(`${55 + (index % 3) * 12}%`)}{bar("35%")}</span></li>
      ))}
    </ul>
  );
}

/** Loading shows a skeleton of the content (announced to screen readers); errors offer a retry. */
export function LoadState({ status, what, onRetry, skeleton }: { status: "loading" | "error"; what: string; onRetry: () => void; skeleton?: ReactNode }) {
  return status === "loading"
    ? <div role="status"><span className="sr-only">Loading {what}…</span>{skeleton ?? <SkeletonList />}</div>
    : <p className="st-empty" role="alert">{what[0].toUpperCase() + what.slice(1)} could not load. <button type="button" className="st-link" onClick={onRetry}>Try again</button></p>;
}
