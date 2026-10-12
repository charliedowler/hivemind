import type { ReactNode } from "react";
import { Sprite } from "../sprites/Sprite";
import type { SpriteName } from "../sprites/spriteData";
import { cx } from "../cx";

export interface TagProps {
  selected?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
  icon?: SpriteName;
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  removeLabel?: string;
}

export function Tag({ selected = false, onClick, onRemove, icon, children, className, disabled = false, removeLabel }: TagProps) {
  const content = <>{icon ? <Sprite name={icon} scale={1} /> : null}{children}</>;
  const classes = cx("hm-tag", selected && "hm-tag-selected", disabled && "hm-tag-disabled", className);
  if (onClick && !onRemove) {
    return <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected} className={classes}>{content}</button>;
  }
  return (
    <span className={classes}>
      {onClick ? <button type="button" disabled={disabled} onClick={onClick} aria-pressed={selected} className="hm-tag-action">{content}</button> : <span className="hm-tag-label">{content}</span>}
      {onRemove ? <button type="button" disabled={disabled} onClick={onRemove} aria-label={removeLabel ?? (typeof children === "string" ? `Remove ${children}` : "Remove tag")} className="hm-tag-remove"><Sprite name="icon-x" scale={1} /></button> : null}
    </span>
  );
}
