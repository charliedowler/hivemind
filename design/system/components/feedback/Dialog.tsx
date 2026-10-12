"use client";

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
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

export function Dialog({
  open = true,
  title,
  eyebrow,
  onClose,
  footer,
  width = 480,
  inline = false,
  children,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || inline) return;
    const panel = panelRef.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel?.showModal();
    return () => {
      panel?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, inline]);

  if (!open) return null;
  return (
    <dialog
      ref={panelRef}
      open={inline || undefined}
      aria-labelledby={titleId}
      data-inline={inline || undefined}
      className={cx("hm-dialog", className)}
      style={width === 480 ? undefined : { maxWidth: width }}
      onKeyDown={trapTab}
      onCancel={
        onClose
          ? (event) => {
              event.preventDefault();
              onClose();
            }
          : undefined
      }
      onPointerDown={
        onClose
          ? (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom
              )
                onClose();
            }
          : undefined
      }
    >
      <div className="hm-dialog-header">
        <div className="hm-dialog-heading">
          {eyebrow ? <div className="hm-dialog-eyebrow">{eyebrow}</div> : null}
          <h2 id={titleId} className="hm-dialog-title">
            {title}
          </h2>
        </div>
        {onClose ? (
          <IconButton icon="icon-x" label="Close dialog" onClick={onClose} />
        ) : null}
      </div>
      <div className="hm-dialog-body">{children}</div>
      {footer ? <div className="hm-dialog-footer">{footer}</div> : null}
    </dialog>
  );
}

function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    ),
  ).filter((element) => element.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  const target = event.shiftKey ? last : first;
  const boundary = event.shiftKey ? first : last;
  if (document.activeElement === boundary && target) {
    event.preventDefault();
    target.focus();
  }
}
