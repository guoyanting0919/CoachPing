/**
 * 產生 iCalendar（RFC 5545）文字。
 * 只實作訂閱用得到的最小子集——唯讀行事曆不需要 VTIMEZONE、RRULE 等。
 */

/** 文字值中的這些字元有語法意義，必須轉義。 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * 內容行不得超過 75 個八位元組，超過要折行並以空白起始續行。
 * 中文一字三個位元組，必須以位元組而非字元計算，否則折在字元中間會亂碼。
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);

    // 退到一個完整字元的邊界：UTF-8 續位元組的高兩位是 10。
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // 續行開頭多一個空白
  }

  return parts.join("\r\n ");
}

/** iCalendar 的 UTC 時間戳格式。 */
export function icalTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type IcalEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
};

export function buildCalendar(options: {
  name: string;
  events: IcalEvent[];
  /** 建議的更新頻率。Google 不保證遵守，但填了總比沒填好。 */
  refreshMinutes?: number;
}): string {
  const now = icalTimestamp(new Date());
  const ttl = `PT${options.refreshMinutes ?? 60}M`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CoachPing//Schedule//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(options.name)}`,
    "X-WR-TIMEZONE:Asia/Taipei",
    `REFRESH-INTERVAL;VALUE=DURATION:${ttl}`,
    `X-PUBLISHED-TTL:${ttl}`,
  ];

  for (const e of options.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART:${icalTimestamp(e.start)}`,
      `DTEND:${icalTimestamp(e.end)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");

  // RFC 5545 要求 CRLF 換行。
  return lines.map(fold).join("\r\n") + "\r\n";
}
