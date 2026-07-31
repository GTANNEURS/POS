import { Loader2, Plus } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/format";

export function Button({
  children,
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const map = {
    primary: "btn-primary",
    secondary: "btn-secondary",
    ghost: "btn-ghost"
  };

  return (
    <button type={type} className={cn(map[variant], className)} {...props}>
      {children}
    </button>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  titleClassName
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  titleClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-2">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-300/80">{eyebrow}</p> : null}
        <div>
          <h1 className={cn("text-3xl font-semibold tracking-tight text-white md:text-[2.35rem]", titleClassName)}>{title}</h1>
          {description ? <p className="mt-2 max-w-3xl text-sm text-[#cdbfb1] md:text-[15px]">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const hasHeading = Boolean(title || description);
  const hasHeader = Boolean(title || description || actions);

  return (
    <section className={cn("card-shell p-5 md:p-6", className)}>
      {hasHeader ? (
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {hasHeading ? (
            <div>
              {title ? <h2 className="text-lg font-semibold text-white">{title}</h2> : null}
              {description ? <p className="mt-1 text-sm text-[#c3b4a5]">{description}</p> : null}
            </div>
          ) : <div />}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent = "orange"
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "orange" | "blue" | "red" | "green";
}) {
  const accentMap = {
    orange: "from-orange-300/20 via-orange-400/10 to-transparent border-orange-300/20",
    blue: "from-sky-300/20 via-sky-400/10 to-transparent border-sky-300/20",
    red: "from-rose-300/20 via-rose-400/10 to-transparent border-rose-300/20",
    green: "from-emerald-300/20 via-emerald-400/10 to-transparent border-emerald-300/20"
  };

  return (
    <div className={cn("rounded-[24px] border bg-gradient-to-br p-5", accentMap[accent])}>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d3c6b9]">{label}</p>
      <div className="mt-3 metric-value">{value}</div>
      {hint ? <p className="mt-2 text-sm text-[#baa999]">{hint}</p> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("input-base w-full", props.className)} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn("textarea-base w-full", props.className)} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("select-base w-full", props.className)} {...props} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-[#efe3d7]">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-[#b5a595]">{hint}</span> : null}
    </label>
  );
}

export function LoadingBlock({ label = "Chargement en cours..." }: { label?: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-black/10 text-[#c6b8aa]">
      <div className="flex items-center gap-3 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {label}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  compact = false
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={cn("rounded-[24px] border border-dashed border-white/10 bg-black/10 text-center", compact ? "p-6" : "p-10")}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-orange-200">
        <Plus className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-xl text-sm text-[#bbaea0]">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" }) {
  const tones = {
    neutral: "border-white/10 bg-white/5 text-[#eadfd5]",
    success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
    warning: "border-orange-300/20 bg-orange-300/10 text-orange-100",
    danger: "border-rose-300/20 bg-rose-400/10 text-rose-100"
  };

  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", tones[tone])}>{children}</span>;
}

