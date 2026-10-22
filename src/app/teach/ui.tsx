import Link from "next/link";
import { LogoLockup } from "@/components/Logo";
import { Icon } from "@/components/Icon";

/*
 * Shared pieces of the teacher screens (Figma Final, rows 33:706 to 34:1243).
 * Colors only from the tokens in globals.css; motion only through `press`, `focus-ring`
 * and the shared keyframes.
 */

/** A text field: 48 high, surface, 1px hairline, radius md, Body. Focus: 1.5 px ink. */
export const fieldClass =
  "h-12 w-full rounded-md border border-hairline bg-surface px-4 type-body text-ink placeholder:text-secondary " +
  "outline-hidden transition-[border-color,box-shadow] duration-(--dur-fast) ease-out " +
  "focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)] disabled:text-secondary";

/** A field label: Small strong, ink. */
export const labelClass = "type-small-strong text-ink";

/**
 * Invisible 44 px hit areas for 20 px text actions (as on My spots): an ::after box around the text,
 * so the look and the layout do not move. `hitAreaClass` reaches 12 px above and below;
 * `hitAreaBelowClass` is for actions right under a field or a row link, so it reaches 4 px up and
 * 20 px down instead of covering the control above.
 */
export const hitAreaClass = "relative after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']";
export const hitAreaBelowClass =
  "relative after:absolute after:-inset-x-2 after:-top-1 after:-bottom-5 after:content-['']";

const textLinkBase =
  "press focus-ring inline-flex w-fit items-center gap-1.5 rounded-sm type-small-strong text-ink underline " +
  "decoration-from-font underline-offset-[3px] hover:text-ink-hover disabled:cursor-default disabled:text-secondary";

/** An underlined text action (Export semester CSV, Cancel, Change file ...): Small strong, ink, 44 px hit area. */
export const textLinkClass = `${textLinkBase} ${hitAreaClass}`;

/** The same, for an action directly under a field or a list (Add a course, Add another course). */
export const textLinkBelowClass = `${textLinkBase} ${hitAreaBelowClass}`;

/** A small outlined button (the live lecture row): 40 high, 1px ink, radius md, Small strong. */
export const secondaryButtonClass =
  "press focus-ring inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-ink px-4 " +
  "type-small-strong whitespace-nowrap text-ink hover:bg-ink/5";

/**
 * A whole list row that is one link (a course, a past lecture). A 1000 px row scaled to .97
 * jumps 30 px, so rows press to .99 instead; the ring fades in like everywhere else.
 */
export const rowPressClass =
  "focus-ring transition-[outline-color,scale] duration-(--dur-fast) ease-spring motion-safe:active:scale-[0.99]";
export const rowLinkClass = `group rounded-sm ${rowPressClass}`;

/** Page content that rises in on load (200 ms; a fade only with reduced motion). */
export const pageInClass = "animate-rise-in";

/**
 * Rise-in with a small stagger for list items: 30 ms each, at most 8 staggered, the rest
 * come in with the 8th. No stagger with reduced motion (the keyframes are a fade then).
 */
export function staggerStyle(index: number): React.CSSProperties {
  return { "--i": Math.min(index, 8) } as React.CSSProperties;
}
export const staggerClass =
  "animate-rise-in [animation-delay:calc(var(--i,0)*30ms)] motion-reduce:[animation-delay:0ms]";

export type Crumb = { label: string; href?: string };

/**
 * The teacher top bar: 64 high with a hairline, logo, breadcrumb, then the teacher's name
 * on the right. The design's Settings link belongs to Task 11 and is not shown yet.
 */
export function TeacherTopBar({ crumbs, teacherName }: { crumbs: Crumb[]; teacherName?: string | null }) {
  // On a phone the breadcrumb is hidden, so the page one level up gets a short back link instead.
  const parent = crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined;
  return (
    <header className="flex h-16 shrink-0 items-center gap-6 border-b border-hairline px-4 sm:px-8">
      <Link href="/teach" aria-label="backtrack, courses" className="press focus-ring shrink-0 rounded-sm">
        <LogoLockup size="S" />
      </Link>
      {parent?.href && (
        <Link
          href={parent.href}
          data-testid="back-link"
          className={`press focus-ring flex min-w-0 items-center gap-1 rounded-sm type-small text-secondary hover:text-ink sm:hidden ${hitAreaClass}`}
        >
          <Icon name="back" size={18} />
          <span className="truncate">{parent.label}</span>
        </Link>
      )}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
        <ol className="flex min-w-0 items-center gap-2 type-small whitespace-nowrap">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={i} className={`flex items-center gap-2 ${last ? "min-w-0" : "shrink-0"}`}>
                {i > 0 && (
                  <span aria-hidden className="text-secondary">
                    /
                  </span>
                )}
                {last ? (
                  <span aria-current="page" className="truncate type-small-strong text-ink">
                    {crumb.label}
                  </span>
                ) : crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="press focus-ring relative rounded-sm text-secondary after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:text-ink"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-secondary">{crumb.label}</span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="min-w-0 flex-1" />
      {teacherName && <p className="min-w-0 truncate type-small text-secondary">{teacherName}</p>}
    </header>
  );
}

/** The whole teacher page: top bar, then the content. */
export function TeacherPage({
  crumbs,
  teacherName,
  children,
}: {
  crumbs: Crumb[];
  teacherName?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <TeacherTopBar crumbs={crumbs} teacherName={teacherName} />
      {children}
    </div>
  );
}

/**
 * "ACC 221 Intro to Financial Accounting" -> { code: "ACC 221", title: "Intro to Financial Accounting" }.
 * A name without a course code in front stays whole as the code, with no title.
 */
export function splitCourseName(name: string): { code: string; title: string | null } {
  const m = /^\s*([A-Za-z]{2,5}\s?\d{3}[A-Za-z]?)\s+(\S.*?)\s*$/.exec(name);
  return m ? { code: m[1], title: m[2] } : { code: name.trim(), title: null };
}
