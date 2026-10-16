import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MediaKind, Platform } from "@shared/types";
import { Icon, type IconName } from "./Icon";
import { copyText } from "@/lib/clipboard";
import { usePortal } from "@/lib/store";
import { duration } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";

/* ───────────────────────── Button ─────────────────────────────────────── */

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "gold" | "ghost" | "dark" | "outline" | "alert";
  size?: "md" | "sm" | "xs";
  icon?: IconName;
  block?: boolean;
  busy?: boolean;
}

export const Button = ({ variant = "ghost", size = "md", icon, block, busy, className, children, disabled, ...rest }: BtnProps) => (
  <button
    className={["btn", `btn-${variant}`, size !== "md" ? `btn-${size}` : "", block ? "btn-block" : "", className].filter(Boolean).join(" ")}
    disabled={disabled || busy}
    aria-busy={busy || undefined}
    {...rest}
  >
    {busy ? <Icon name="refresh" className="spin" /> : icon ? <Icon name={icon} /> : null}
    {children}
  </button>
);

/* ───────────────────────── Copy button ────────────────────────────────── */

export const CopyButton = ({ text, label = "Copy", size = "xs", variant = "ghost" }: { text: string; label?: string; size?: BtnProps["size"]; variant?: BtnProps["variant"] }) => {
  const [done, setDone] = useState(false);
  const { toast } = usePortal();
  return (
    <Button
      size={size}
      variant={variant}
      icon={done ? "check" : "copy"}
      onClick={async () => {
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } else toast("Couldn't copy — press and hold the text to copy it.", "error");
      }}
    >
      {done ? "Copied" : label}
    </Button>
  );
};

/* ───────────────────────── Modal ──────────────────────────────────────── */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  light?: boolean;
  wide?: boolean;
}

export const Modal = ({ open, onClose, title, children, footer, light, wide }: ModalProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      const f = ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not([data-close])");
      f?.focus();
    }, 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={["modal", light ? "on-light" : ""].filter(Boolean).join(" ")} style={wide ? { maxWidth: 980 } : undefined} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close" data-close>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
};

/* ───────────────────────── Confirm ────────────────────────────────────── */

export const useConfirm = () => {
  const [req, setReq] = useState<{ title: string; body?: string; action: string; danger?: boolean; resolve: (ok: boolean) => void } | null>(null);
  const confirm = (title: string, opts: { body?: string; action?: string; danger?: boolean } = {}) =>
    new Promise<boolean>((resolve) => setReq({ title, body: opts.body, action: opts.action || "Confirm", danger: opts.danger, resolve }));
  const element = req ? (
    <Modal
      open
      onClose={() => {
        req.resolve(false);
        setReq(null);
      }}
      title={req.title}
      footer={
        <>
          <Button
            onClick={() => {
              req.resolve(false);
              setReq(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant={req.danger ? "alert" : "gold"}
            onClick={() => {
              req.resolve(true);
              setReq(null);
            }}
          >
            {req.action}
          </Button>
        </>
      }
    >
      {req.body ? <p className="muted">{req.body}</p> : null}
    </Modal>
  ) : null;
  return { confirm, element };
};

/* ───────────────────────── Toasts ─────────────────────────────────────── */

export const Toasts = () => {
  const { toasts } = usePortal();
  if (!toasts.length) return null;
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`}>
          <Icon name={t.kind === "error" ? "alert" : "check"} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
};

/* ───────────────────────── Media tile ─────────────────────────────────── */

const kindIcon: Record<MediaKind, IconName> = { video: "film", image: "image", audio: "audio", other: "file" };

interface TileProps {
  src?: string;
  kind: MediaKind;
  label?: string;
  dur?: number;
  shape?: "portrait" | "square" | "wide";
  selected?: boolean;
  selectable?: boolean;
  onClick?: () => void;
  badge?: ReactNode;
  alt?: string;
}

export const MediaTile = ({ src, kind, label, dur, shape = "portrait", selected, selectable, onClick, badge, alt = "" }: TileProps) => {
  const cls = ["tile", shape === "square" ? "square" : shape === "wide" ? "wide" : "", selected ? "selected" : ""].filter(Boolean).join(" ");
  const inner = (
    <>
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <div className="tile-placeholder">
          <Icon name={kindIcon[kind]} />
          {label ? <span className="xs">{label}</span> : null}
        </div>
      )}
      <span className="tile-kind">
        <Icon name={kindIcon[kind]} /> {kind === "image" ? "Photo" : kind === "video" ? "Video" : kind === "audio" ? "Audio" : "File"}
      </span>
      {dur ? <span className="tile-dur">{duration(dur)}</span> : null}
      {selectable ? (
        <span className="tile-check">
          <Icon name="check" />
        </span>
      ) : null}
      {badge}
    </>
  );
  if (onClick)
    return (
      <button type="button" className={cls} onClick={onClick} aria-pressed={selectable ? Boolean(selected) : undefined} style={{ width: "100%", textAlign: "left" }}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
};

/* ───────────────────────── Lightbox ───────────────────────────────────── */

export const Lightbox = ({ url, kind, name, onClose, actions }: { url: string; kind: MediaKind; name: string; onClose: () => void; actions?: ReactNode }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={name}>
      <div className="lb-head">
        <span className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </span>
        <div className="row">
          {actions}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div className="lb-body" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {kind === "video" ? (
          <video src={url} controls autoPlay playsInline />
        ) : kind === "audio" ? (
          <audio src={url} controls autoPlay />
        ) : kind === "image" ? (
          <img src={url} alt={name} />
        ) : (
          <div className="empty">
            <Icon name="file" />
            <p>This file type can't be previewed here. Download it to open it.</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

/* ───────────────────────── Platform badge ─────────────────────────────── */

const PB: Record<Platform, string> = { instagram: "IG", tiktok: "TT", facebook: "FB" };

export const PlatformBadge = ({ platform, posted, title }: { platform: Platform; posted?: boolean; title?: string }) => (
  <span className={`platform-badge ${posted ? "posted" : ""}`} title={title || platform} aria-label={platform}>
    {PB[platform]}
  </span>
);

/* ───────────────────────── Gold motes ─────────────────────────────────── */

const SEEDS = [3, 11, 17, 24, 31, 38, 45, 52, 58, 63, 69, 74, 80, 86, 91, 96, 8, 27, 49, 71, 55, 15];

export const GoldMotes = ({ count = 22 }: { count?: number }) => {
  const reduced = useMemo(prefersReducedMotion, []);
  if (reduced) return null;
  return (
    <div className="motes" aria-hidden="true">
      {SEEDS.slice(0, count).map((x, i) => (
        <i
          key={i}
          style={
            {
              "--x": `${x}%`,
              "--d": `${12 + ((x * 7) % 11)}s`,
              "--delay": `${-((x * 13) % 14)}s`,
              "--dx": `${((x % 5) - 2) * 14}px`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
};

/* ───────────────────────── Empty state ────────────────────────────────── */

export const Empty = ({ icon = "leaf", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) => (
  <div className="empty">
    <Icon name={icon} />
    <h3>{title}</h3>
    {children ? <p className="small">{children}</p> : null}
    {action}
  </div>
);

/* ───────────────────────── Segmented control ──────────────────────────── */

export const Segmented = <T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) => (
  <div className="seg" role="group">
    {options.map((o) => (
      <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
        {o.label}
      </button>
    ))}
  </div>
);

/* ───────────────────────── Tag input ──────────────────────────────────── */

export const TagInput = ({ value, onChange, placeholder = "Add a hashtag and press space" }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) => {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parts = raw
      .split(/[\s,]+/)
      .map((p) => p.trim().replace(/^#+/, ""))
      .filter(Boolean)
      .map((p) => `#${p}`);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.some((x) => x.toLowerCase() === p.toLowerCase())) next.push(p);
    onChange(next);
    setDraft("");
  };
  return (
    <div className="tag-input" onClick={(e) => (e.currentTarget.querySelector("input") as HTMLInputElement)?.focus()}>
      {value.map((t) => (
        <span className="tag" key={t}>
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
            <Icon name="x" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (/[\s,]$/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft && commit(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[\s,#]/.test(text)) {
            e.preventDefault();
            commit(text);
          }
        }}
      />
    </div>
  );
};
