import Link from "next/link";
import { LogoLockup } from "@/components/Logo";
import { Icon } from "@/components/Icon";

/*
 * Shared pieces of the teacher screens (Figma Final, rows 33:706 to 34:1243).
 * Colors only from the tokens in globals.css; motion only through `press`, `focus-ring`
 * and the shared keyframes.
 */

/** A text field: 48 high, surface, 1px hairline, radius md, Body. Focus: 1.5 px ink. */
const fieldLook =
  "h-12 rounded-md border border-hairline bg-surface px-4 type-body text-ink placeholder:text-secondary " +
  "outline-hidden transition-[border-color,box-shadow] duration-(--dur-fast) ease-out " +
  "focus:border-ink focus:shadow-[inset_0_0_0_0.5px_var(--color-ink)] disabled:text-secondary";
export const fieldClass = `${fieldLook} w-full`;

/** The same field at the design's 480 px (Settings name), full width on a phone. */
export const fieldNarrowClass = `${fieldLook} w-120 max-w-full`;

/** A field label: Small strong, ink. */
export const labelClass = "type-small-strong text-ink";

/**
 * An invisible 44 px hit area for a 20 px text link (the top bar's Settings and breadcrumb): an
 * ::after box 12 px above and below the text, so the look and the layout do not move.
 */
export const hitAreaClass = "relative after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']";

/*
 * Actions on the teacher screens are real buttons, never underlined text (Marko, 2:05 PM): the
 * black primary (buttonPrimaryClass, or buttonPrimaryInlineClass in a row next to a field) for the
 * main action, and the white secondary with a hairline border (buttonSecondaryClass) for the rest.
 * Only navigation (the breadcrumb, Settings in the top bar) stays a text link.
 */

/**
 * A whole list row that is one link (a course, a past lecture). A 1000 px row scaled to .97
 * jumps 30 px, so rows press to .99 instead; the ring fades in like everywhere else.
 */
export const rowPressClass =
  "focus-ring transition-[outline-color,scale] duration-(--dur-fast) ease-spring motion-safe:active:scale-[0.99]";
export const rowLinkClass = `group rounded-sm ${rowPressClass}`;

/** Page content that comes in on load: 120 ms from half opacity, never blank (a fade only with reduced motion). */
export const pageInClass = "animate-page-in";

/**
 * Rise-in with a small stagger for list items: 30 ms each, at most 8 staggered, the rest
 * come in with the 8th. No stagger with reduced motion (the keyframes are a fade then).
 */
export function staggerStyle(index: number): React.CSSProperties {
  return { "--i": Math.min(index, 8) } as React.CSSProperties;
}
export const staggerClass =
  "animate-rise-in [animation-delay:calc(var(--i,0)*30ms)] motion-reduce:[animation-delay:0ms]";

/**
 * One step of the breadcrumb. A course step passes its section too (null or a string): the label is then
 * the course code and the section is drawn after it in gray (CourseTitle), "IMS 452 B".
 */
export type Crumb = { label: string; href?: string; section?: string | null };

/** A crumb's text: a course step as its title (code and gray section), anything else as it is. */
function CrumbLabel({ crumb, tone }: { crumb: Crumb; tone: SectionTone }) {
  return crumb.section !== undefined ? <CourseTitle code={crumb.label} section={crumb.section} tone={tone} /> : <>{crumb.label}</>;
}

/**
 * The teacher top bar: 64 high with a hairline, logo (to Home), breadcrumb, then the teacher's name and
 * the Settings link on the right (Figma 33:788, 34:1246). On a phone the name is left out so the
 * back link and Settings keep their room.
 */
export function TeacherTopBar({
  crumbs,
  teacherName,
  onSettings = false,
  back,
}: {
  crumbs: Crumb[];
  teacherName?: string | null;
  /** True on the Settings page itself, where the link is marked as the current page. */
  onSettings?: boolean;
  /** The phone back link's target when the breadcrumb has no parent to offer (Settings). */
  back?: Crumb;
}) {
  // On a phone the breadcrumb is hidden, so the page one level up gets a short back link instead.
  const parent = back ?? (crumbs.length > 1 ? crumbs[crumbs.length - 2] : undefined);
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-hairline px-4 sm:gap-6 sm:px-8">
      <Link href="/" aria-label="backtrack, home" className="press focus-ring shrink-0 rounded-sm">
        <LogoLockup size="S" />
      </Link>
      {parent?.href && (
        <Link
          href={parent.href}
          data-testid="back-link"
          className={`press focus-ring flex min-w-0 items-center gap-1 rounded-sm type-small text-secondary hover:text-ink sm:hidden ${hitAreaClass}`}
        >
          <Icon name="back" size={18} />
          <span className="truncate">
            <CrumbLabel crumb={parent} tone="regular" />
          </span>
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
                    <CrumbLabel crumb={crumb} tone="strong" />
                  </span>
                ) : crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="press focus-ring relative rounded-sm text-secondary after:absolute after:-inset-x-1 after:-inset-y-3 after:content-[''] hover:text-ink"
                  >
                    <CrumbLabel crumb={crumb} tone="regular" />
                  </Link>
                ) : (
                  <span className="text-secondary">
                    <CrumbLabel crumb={crumb} tone="regular" />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="min-w-0 flex-1" />
      {teacherName && <p className="hidden min-w-0 truncate type-small text-secondary sm:block">{teacherName}</p>}
      <Link
        href="/teach/settings"
        aria-current={onSettings ? "page" : undefined}
        className={`press focus-ring shrink-0 rounded-sm type-small-strong whitespace-nowrap text-ink hover:text-ink-hover ${hitAreaClass}`}
      >
        Settings
      </Link>
    </header>
  );
}

/** The whole teacher page: top bar, then the content. */
export function TeacherPage({
  crumbs,
  teacherName,
  onSettings,
  back,
  children,
}: {
  crumbs: Crumb[];
  teacherName?: string | null;
  onSettings?: boolean;
  back?: Crumb;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <TeacherTopBar crumbs={crumbs} teacherName={teacherName} onSettings={onSettings} back={back} />
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

/**
 * The course's section as the end of its title (Marko, hand test 3: "That section thing should
 * just be an extension of the title"): "IMS 452 B". A section typed as "Section B" or "Sec. B"
 * shows as "B"; "001" stays "001". Null when there is none.
 */
export function sectionTag(section: string | null | undefined): string | null {
  const s = section?.trim();
  if (!s) return null;
  const bare = s.replace(/^(section|sect|sec)\b\.?\s*/i, "").trim();
  return bare || s;
}

/** The title as text, where a string is needed (the breadcrumb, a dialog title): "IMS 452 B". */
export function courseTitleText(code: string, section?: string | null): string {
  const tag = sectionTag(section);
  return tag ? `${code} ${tag}` : code;
}

/** The title as a screen reader says it, for an aria-label: "IMS 452 section B". */
export function courseTitleSpoken(code: string, section?: string | null): string {
  const tag = sectionTag(section);
  return tag ? `${code} section ${tag}` : code;
}

/**
 * How heavy the text around a course title is. "strong" (the default): a heading, a card or a crumb set
 * in a medium or semibold weight, so the section is regular. "regular": text in the regular weight (the
 * Live now row, the archive note, a breadcrumb link), so the section is light.
 */
export type SectionTone = "strong" | "regular";

/** The section's look: the secondary gray, one weight lighter than the code (Marko, hand test 4). */
export function sectionClass(tone: SectionTone = "strong"): string {
  return `text-secondary ${tone === "regular" ? "font-light" : "font-normal"}`;
}

/**
 * The title inside a heading or a link: the code, then the section in gray and a lighter weight
 * ("IMS 452 B"), so the section reads as its own part and never as text typed into the name (Marko,
 * hand test 4). A screen reader hears "IMS 452 section B".
 */
export function CourseTitle({ code, section, tone = "strong" }: { code: string; section?: string | null; tone?: SectionTone }) {
  const tag = sectionTag(section);
  if (!tag) return <>{code}</>;
  return (
    <>
      {code} <span className="sr-only">section</span>{" "}
      <span data-course-section="" className={sectionClass(tone)}>
        {tag}
      </span>
    </>
  );
}
