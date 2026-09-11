/**
 * 建立五組 Rich Menu 並上傳圖片（SPEC.md §7）。
 * 會先刪除帳號上所有既有 Rich Menu，避免重複執行時累積。
 *
 *   npx tsx --env-file=.env scripts/richmenu.ts
 *
 * 選單 ID 不必記下來：綁定時一律以名稱向 LINE 查詢（SPEC.md §7），
 * 因此重建後 ID 變了也不需要同步任何環境變數。
 */
import sharp from "sharp";

const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID;

const API = "https://api.line.me/v2/bot";
const DATA_API = "https://api-data.line.me/v2/bot";

/**
 * page：點擊後開啟 LIFF 的對應頁面。
 * postback：點擊後不開網頁，由 webhook 直接回覆文字訊息。
 */
type Cell =
  | { label: string; icon: IconName; page: string }
  | { label: string; icon: IconName; postback: string }
  /** 切換到另一張選單。由 LINE 客戶端直接完成，同時回送 postback 供伺服器同步綁定。 */
  | { label: string; icon: IconName; switchTo: string; data: string };

/**
 * 自繪線條圖示，皆以 100x100 的 viewBox 定義。
 * 不用 emoji：emoji 的樣貌取決於系統字型，librsvg 在不同機器上挑到的字型不同，
 * 產出的圖會不一致，且多半是糊掉的單色字符。
 */
const ICONS = {
  calendar: `<rect x="14" y="26" width="72" height="60" rx="9"/><path d="M14 46 H86"/><path d="M33 14 V33 M67 14 V33"/>`,
  plus: `<path d="M50 20 V80 M20 50 H80"/>`,
  people: `<circle cx="37" cy="36" r="15"/><path d="M12 84 c0-16 11-26 25-26 s25 10 25 26"/><circle cx="72" cy="41" r="11"/><path d="M66 60 c13-2 22 8 22 21"/>`,
  link: `<path d="M40 60 L60 40"/><path d="M56 30 l7-7 a15 15 0 0 1 21 21 l-7 7"/><path d="M44 70 l-7 7 a15 15 0 0 1-21-21 l7-7"/>`,
  bell: `<path d="M31 68 V51 a19 19 0 0 1 38 0 v17"/><path d="M20 68 H80"/><path d="M41 78 a9 9 0 0 0 18 0"/>`,
  // 齒輪的路徑太複雜、小尺寸下糊成一團，改用滑桿——同樣是通用的「設定」語彙。
  sliders: `<path d="M16 30 H84 M16 50 H84 M16 70 H84"/><circle cx="36" cy="30" r="9" fill="#ffffff"/><circle cx="64" cy="50" r="9" fill="#ffffff"/><circle cx="44" cy="70" r="9" fill="#ffffff"/>`,
  chat: `<path d="M16 32 a12 12 0 0 1 12-12 h44 a12 12 0 0 1 12 12 v26 a12 12 0 0 1-12 12 H46 L28 84 V70 a12 12 0 0 1-12-12 z"/>`,
  person: `<circle cx="50" cy="33" r="16"/><path d="M20 86 c0-17 13-29 30-29 s30 12 30 29"/>`,
  cross: `<rect x="14" y="26" width="72" height="60" rx="9"/><path d="M14 46 H86"/><path d="M39 60 l22 20 M61 60 l-22 20"/>`,
  pencil: `<path d="M27 73 l-7 14 14-7 44-44 -7-7 z"/><path d="M64 25 l7 7"/><path d="M18 92 H86"/>`,
  list: `<path d="M38 28 H86 M38 50 H86 M38 72 H86"/><circle cx="20" cy="28" r="4"/><circle cx="20" cy="50" r="4"/><circle cx="20" cy="72" r="4"/>`,
  // 兩支反向箭頭。切換身分不是「功能」而是「換一套功能」，用交換語彙而非齒輪或人像。
  swap: `<path d="M18 38 H72"/><path d="M58 24 L72 38 L58 52"/><path d="M82 62 H28"/><path d="M42 48 L28 62 L42 76"/>`,
} as const;

type IconName = keyof typeof ICONS;

function iconSvg(name: IconName, cx: number, cy: number, size: number): string {
  return (
    `<svg x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" viewBox="0 0 100 100">` +
    `<g fill="none" stroke="#0f172a" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</g>` +
    `</svg>`
  );
}

/** 一列 3 欄的 x 起點與寬度，總和必須剛好 2500。 */
const COLS_3 = [
  { x: 0, w: 833 },
  { x: 833, w: 833 },
  { x: 1666, w: 834 },
];
const COLS_2 = [
  { x: 0, w: 1250 },
  { x: 1250, w: 1250 },
];
/** 雙重身分版的教練選單要塞第七格。只有那張選單用四欄，一般教練的版面不受影響。 */
const COLS_4 = [
  { x: 0, w: 625 },
  { x: 625, w: 625 },
  { x: 1250, w: 625 },
  { x: 1875, w: 625 },
];
const ROW_H = 843;

/** 一列有幾格就用哪組欄位。總寬必須剛好 2500。 */
const COLS: Record<number, { x: number; w: number }[]> = {
  1: [{ x: 0, w: 2500 }],
  2: COLS_2,
  3: COLS_3,
  4: COLS_4,
};

/**
 * Rich Menu alias：richmenuswitch 動作指向的是 alias 而非選單 ID，
 * 這樣重建選單（ID 會變）時不必改動任何選單定義，只要把 alias 重新指過去。
 */
const COACH_ALIAS = "coach-mode";
const MEMBER_ALIAS = "member-mode";

/** alias 指向哪一張選單。 */
const ALIASES: Record<string, string> = {
  [COACH_ALIAS]: "coach_dual",
  [MEMBER_ALIAS]: "member_dual",
};

const MENUS: Record<string, { chatBarText: string; rows: Cell[][] }> = {
  unregistered: {
    chatBarText: "開始使用",
    rows: [[{ label: "完成註冊", icon: "pencil", page: "register" }]],
  },
  coach: {
    chatBarText: "教練選單",
    rows: [
      [
        // 今日課表走 postback：直接回一則文字訊息，不必等網頁載入。
        // 教練在健身房現場最常做的就是瞄一眼今天有誰。
        { label: "今日課表", icon: "list", postback: "today" },
        { label: "我的課表", icon: "calendar", page: "today" },
        { label: "排課", icon: "plus", page: "schedule" },
      ],
      [
        // 邀請學員併入「我的學員」頁面——邀請本來就是管理學員的子動作。
        { label: "我的學員", icon: "people", page: "members" },
        { label: "請假通知", icon: "bell", page: "leaves" },
        { label: "設定", icon: "sliders", page: "settings" },
      ],
    ],
  },
  member: {
    chatBarText: "學員選單",
    rows: [
      [
        // 與教練端同理：查課表走 postback 直接回文字，不必等網頁載入，
        // 而且 reply message 免費。
        { label: "我的課表", icon: "list", postback: "my_sessions" },
        // 預約刻意佔一格，第一列因此擴成三格。不做成「我的課表」頁面裡的
        // 一顆按鈕——那會讓主功能藏在另一個頁面後面，而選單還有空位（SPEC.md §7）。
        { label: "預約課程", icon: "plus", page: "book" },
        { label: "請假", icon: "cross", page: "leave" },
      ],
      // 「聯絡教練」不能寫死網址：學員可能同時屬於多位教練，
      // 且每位教練的官方帳號不同。導到 LIFF 頁面動態列出。
      [
        { label: "聯絡教練", icon: "chat", page: "contact" },
        { label: "個人設定", icon: "person", page: "profile" },
      ],
    ],
  },

  // 以下兩張只綁給雙重身分者（見 CONTEXT.md、ADR-0001）。
  // 一般教練與一般學員繼續拿上面兩張，不為一個罕見功能付版面代價。
  coach_dual: {
    chatBarText: "教練選單",
    rows: [
      // 上列三個最高頻的按鈕與一般教練版位置完全相同，切換時肌肉記憶不會錯位。
      [
        { label: "今日課表", icon: "list", postback: "today" },
        { label: "我的課表", icon: "calendar", page: "today" },
        { label: "排課", icon: "plus", page: "schedule" },
      ],
      // 第七格塞在下列，該列改為四格。
      [
        { label: "我的學員", icon: "people", page: "members" },
        { label: "請假通知", icon: "bell", page: "leaves" },
        { label: "設定", icon: "sliders", page: "settings" },
        { label: "切換身分", icon: "swap", switchTo: MEMBER_ALIAS, data: "action=switch&to=member" },
      ],
    ],
  },
  member_dual: {
    chatBarText: "學員選單",
    rows: [
      [
        { label: "我的課表", icon: "list", postback: "my_sessions" },
        // 上列與一般學員版位置完全相同，切換時肌肉記憶不會錯位（同 coach_dual）。
        { label: "預約課程", icon: "plus", page: "book" },
        { label: "請假", icon: "cross", page: "leave" },
      ],
      [
        { label: "聯絡教練", icon: "chat", page: "contact" },
        { label: "個人設定", icon: "person", page: "profile" },
        { label: "切換身分", icon: "swap", switchTo: COACH_ALIAS, data: "action=switch&to=coach" },
      ],
    ],
  },
};

function buildSvg(rows: Cell[][]): string {
  const height = rows.length * ROW_H;
  const parts: string[] = [
    `<rect width="2500" height="${height}" fill="#ffffff"/>`,
  ];

  rows.forEach((row, r) => {
    const cols = COLS[row.length];
    const y = r * ROW_H;

    row.forEach((cell, c) => {
      const { x, w } = cols[c];
      const cx = x + w / 2;
      parts.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${ROW_H}" fill="#ffffff" stroke="#e2e8f0" stroke-width="4"/>`,
        iconSvg(cell.icon, cx, y + ROW_H / 2 - 70, 210),
        `<text x="${cx}" y="${y + ROW_H / 2 + 130}" font-size="88" font-weight="600" fill="#0f172a" text-anchor="middle" dominant-baseline="middle" font-family="PingFang TC, Heiti TC, Noto Sans CJK TC, sans-serif">${cell.label}</text>`,
      );
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="2500" height="${height}">${parts.join("")}</svg>`;
}

async function lineFetch(url: string, init: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${await res.text()}`);
  }
  return res;
}

/** --dry：只在本機產生圖片預覽，不呼叫 LINE API。用來確認排版與字體。 */
async function dryRun(outDir: string) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(outDir, { recursive: true });

  for (const [key, menu] of Object.entries(MENUS)) {
    const png = await sharp(Buffer.from(buildSvg(menu.rows))).png().toBuffer();
    const file = `${outDir}/${key}.png`;
    await writeFile(file, png);
    console.log(`✓ ${file} (2500x${menu.rows.length * ROW_H})`);
  }
}

/**
 * 重新綁定所有使用者的選單。
 *
 * 刪除舊選單會讓已綁定的使用者失去選單，因此重建後必須綁回去。
 * 同時是教練與學員的人（雙重身分）綁 coach_dual：教練是主身分，與 primaryRole
 * 的順序一致，他自己按切換鍵就能換到學員模式。
 */
async function rebindUsers(ids: Record<string, string>) {
  const { prisma } = await import("../src/lib/prisma");
  try {
    const coaches = await prisma.coach.findMany({ select: { lineUserId: true } });
    const coachIds = new Set(
      coaches.map((c) => c.lineUserId).filter((id) => !id.startsWith("detached:")),
    );

    const members = await prisma.member.findMany({
      where: { lineUserId: { not: null }, lineBlocked: false },
      select: { lineUserId: true },
    });
    const memberIds = new Set(
      members.map((m) => m.lineUserId).filter((id): id is string => id !== null),
    );

    let dualCount = 0;
    for (const lineUserId of coachIds) {
      const dual = memberIds.has(lineUserId);
      if (dual) dualCount++;
      const menuId = dual ? ids.coach_dual : ids.coach;
      await lineFetch(`${API}/user/${lineUserId}/richmenu/${menuId}`, {
        method: "POST",
      }).catch((e) => console.warn(`  教練 ${lineUserId} 綁定失敗:`, e.message));
    }

    let memberCount = 0;
    for (const lineUserId of memberIds) {
      // 雙重身分者已在上面綁過 coach_dual，不要再蓋成學員選單。
      if (coachIds.has(lineUserId)) continue;
      await lineFetch(`${API}/user/${lineUserId}/richmenu/${ids.member}`, {
        method: "POST",
      }).catch((e) => console.warn(`  學員 ${lineUserId} 綁定失敗:`, e.message));
      memberCount++;
    }

    console.log(
      `✓ 已重新綁定 ${coachIds.size} 位教練（其中 ${dualCount} 位雙重身分）、${memberCount} 位學員`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const dryIndex = process.argv.indexOf("--dry");
  if (dryIndex !== -1) {
    await dryRun(process.argv[dryIndex + 1] ?? "./richmenu-preview");
    return;
  }

  if (!TOKEN || !LIFF_ID) {
    console.error("缺少 LINE_CHANNEL_ACCESS_TOKEN 或 NEXT_PUBLIC_LIFF_ID");
    process.exit(1);
  }

  // 只重新綁定，沿用現有選單。修正綁定錯誤時不必重建，避免 ID 又變動。
  if (process.argv.includes("--rebind")) {
    const list = (await (await lineFetch(`${API}/richmenu/list`, {})).json()) as {
      richmenus: { richMenuId: string; name: string }[];
    };
    const byName = Object.fromEntries(list.richmenus.map((m) => [m.name, m.richMenuId]));
    await rebindUsers(byName);
    return;
  }

  // 重複執行時先清空，否則帳號上會累積一堆孤兒選單（上限 1000 組）。
  const existing = (await (await lineFetch(`${API}/richmenu/list`, {})).json()) as {
    richmenus: { richMenuId: string }[];
  };
  for (const m of existing.richmenus) {
    await lineFetch(`${API}/richmenu/${m.richMenuId}`, { method: "DELETE" });
  }
  if (existing.richmenus.length) {
    console.log(`已清除 ${existing.richmenus.length} 組舊選單`);
  }

  const ids: Record<string, string> = {};

  for (const [key, menu] of Object.entries(MENUS)) {
    const height = menu.rows.length * ROW_H;

    const areas = menu.rows.flatMap((row, r) => {
      const cols = COLS[row.length];
      return row.map((cell, c) => ({
        bounds: { x: cols[c].x, y: r * ROW_H, width: cols[c].w, height: ROW_H },
        action:
          "postback" in cell
            ? {
                type: "postback" as const,
                label: cell.label,
                data: `action=${cell.postback}`,
                // 讓聊天室留下「教練問了什麼」的紀錄，回覆才不會沒頭沒尾。
                displayText: cell.label,
              }
            : "switchTo" in cell
              ? {
                  // 刻意不設 displayText：切換是介面操作，不該在聊天室留下一句發言。
                  type: "richmenuswitch" as const,
                  richMenuAliasId: cell.switchTo,
                  data: cell.data,
                }
              : {
                  type: "uri" as const,
                  label: cell.label,
                  uri: `https://liff.line.me/${LIFF_ID}?p=${cell.page}`,
                },
      }));
    });

    const created = (await (
      await lineFetch(`${API}/richmenu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          size: { width: 2500, height },
          selected: false,
          name: key,
          chatBarText: menu.chatBarText,
          areas,
        }),
      })
    ).json()) as { richMenuId: string };

    const png = await sharp(Buffer.from(buildSvg(menu.rows))).png().toBuffer();
    await lineFetch(`${DATA_API}/richmenu/${created.richMenuId}/content`, {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(png),
    });

    ids[key] = created.richMenuId;
    console.log(`✓ ${key}: ${created.richMenuId}`);
  }

  // alias 必須等選單建立後才能指過去。反過來不必擔心：選單裡的 richmenuswitch
  // 動作引用 alias ID 時，LINE 不要求該 alias 當下已存在。
  for (const [aliasId, menuKey] of Object.entries(ALIASES)) {
    // 舊 alias 可能還指著剛被刪掉的選單。先刪再建，否則會撞到重複的 alias ID。
    await lineFetch(`${API}/richmenu/alias/${aliasId}`, { method: "DELETE" }).catch(() => {});
    await lineFetch(`${API}/richmenu/alias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId: ids[menuKey] }),
    });
    console.log(`✓ alias ${aliasId} → ${menuKey}`);
  }

  // 未註冊者尚未觸發任何綁定邏輯，設為預設選單讓他們一加好友就看得到。
  await lineFetch(`${API}/user/all/richmenu/${ids.unregistered}`, { method: "POST" });
  console.log("✓ 已將 unregistered 設為預設選單");

  // 舊選單被刪除時，已綁定的使用者會連帶失去選單。重新綁回去，
  // 這支腳本才能安全地重複執行。
  await rebindUsers(ids);

  console.log("\n完成。應用程式以選單名稱向 LINE 查詢 ID，不需要更新環境變數。\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
