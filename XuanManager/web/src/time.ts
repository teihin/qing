export const BEIJING_TIME_ZONE = "Asia/Shanghai";

export type NaiveTimeZone = "beijing" | "utc";

interface BeijingDateTimeOptions {
  includeYear?: boolean;
  includeSeconds?: boolean;
  naiveTimeZone?: NaiveTimeZone;
}

const naiveDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const beijingPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function formatBeijingDateTime(value?: string | Date | null, options: BeijingDateTimeOptions = {}): string {
  const date = parseBackendDateTime(value, options.naiveTimeZone ?? "beijing");
  if (!date) return value instanceof Date ? "—" : value || "—";
  const parts = beijingDateParts(date);
  const datePart = options.includeYear === false ? `${parts.month}/${parts.day}` : `${parts.year}-${parts.month}-${parts.day}`;
  const seconds = options.includeSeconds === false ? "" : `:${parts.second}`;
  return `${datePart} ${parts.hour}:${parts.minute}${seconds}`;
}

export function formatBeijingDate(value?: string | Date | null, naiveTimeZone: NaiveTimeZone = "beijing"): string {
  const date = parseBackendDateTime(value, naiveTimeZone);
  if (!date) return value instanceof Date ? "—" : value || "—";
  const parts = beijingDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatBeijingTime(value?: string | Date | null, naiveTimeZone: NaiveTimeZone = "beijing", includeSeconds = true): string {
  const date = parseBackendDateTime(value, naiveTimeZone);
  if (!date) return value instanceof Date ? "—" : value || "—";
  const parts = beijingDateParts(date);
  return `${parts.hour}:${parts.minute}${includeSeconds ? `:${parts.second}` : ""}`;
}

export function toBeijingDateTimeLocal(value?: string | Date | null): string {
  const date = parseBackendDateTime(value, "beijing");
  if (!date) return "";
  const parts = beijingDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function fromBeijingDateTimeLocal(value: string): string {
  const date = parseBackendDateTime(value, "beijing");
  return date ? date.toISOString() : "";
}

export function beijingDateInput(offsetDays = 0): string {
  return formatBeijingDate(new Date(Date.now() + offsetDays * 86_400_000));
}

export function dateInputDayCount(from: string, to: string): number {
  const start = parseDateInput(from);
  const end = parseDateInput(to);
  if (start === null || end === null) return Number.NaN;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function parseBackendDateTime(value?: string | Date | null, naiveTimeZone: NaiveTimeZone = "beijing"): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const clean = value?.trim();
  if (!clean) return null;

  const naive = clean.match(naiveDateTimePattern);
  if (naive) {
    const year = Number(naive[1]);
    const month = Number(naive[2]);
    const day = Number(naive[3]);
    const hour = Number(naive[4] ?? 0);
    const minute = Number(naive[5] ?? 0);
    const second = Number(naive[6] ?? 0);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (
      month < 1 || month > 12 || day < 1 || day > daysInMonth ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59
    ) return null;
    const offsetHours = naiveTimeZone === "beijing" ? 8 : 0;
    const date = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, second));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(clean);
  return Number.isNaN(date.getTime()) ? null : date;
}

function beijingDateParts(date: Date): Record<"year" | "month" | "day" | "hour" | "minute" | "second", string> {
  const result = { year: "", month: "", day: "", hour: "", minute: "", second: "" };
  for (const part of beijingPartsFormatter.formatToParts(date)) {
    if (part.type in result) result[part.type as keyof typeof result] = part.value;
  }
  return result;
}

function parseDateInput(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
