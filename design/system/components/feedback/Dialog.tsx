"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "../core/IconButton";
import { cx } from "../cx";

export interface DialogProps {
  open?: boolean;
  title: string;
  eyebrow?: string;
  onClose?: () => void;
  footer?: ReactNode;
  width?: number;
  inline?: boolean;
  children?: ReactNode;
  className?: string;
}

export function Dialog({ open = true, title, eyebrow, onClose, footer, width = 480, inline = false, children, className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || inline) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableElements = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert], [hidden], [aria-hidden="true"]'));
    const frame = requestAnimationFrame(() => (focusableElements()[0] ?? panelRef.current)?.focus());
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && onCloseRef.current) {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panelRef.current?.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, inline]);

  if (!open) return null;
  const panel = (
    <div ref={panelRef} role="dialog" aria-labelledby={titleId} aria-modal={inline ? undefined : true} tabIndex={-1} className={cx("hm-dialog", className)} style={width === 480 ? undefined : { maxWidth: width }}>
      <div className="hm-dialog-header">
        <div className="hm-dialog-heading">
          {eyebrow ? <div className="hm-dialog-eyebrow">{eyebrow}</div> : null}
          <h2 id={titleId} className="hm-dialog-title">{title}</h2>
        </div>
        {onClose ? <IconButton icon="icon-x" label="Close dialog" onClick={onClose} /> : null}
      </div>
      <div className="hm-dialog-body">{children}</div>
      {footer ? <div className="hm-dialog-footer">{footer}</div> : null}
    </div>
  );
  if (inline) return panel;
  return <div className="hm-dialog-scrim" onClick={onClose ? (event) => { if (event.target === event.currentTarget) onClose(); } : undefined}>{panel}</div>;
}
