import Database from "@tauri-apps/plugin-sql";

export interface TimeBlock {
  id: number;
  block_type: "work" | "rest";
  start_time: number; // timestamp ms
  end_time: number; // timestamp ms
  duration: number; // seconds
  earned_rest_duration: number; // seconds
  is_manual: number; // 0 | 1
  tag: string | null;
  note: string | null;
  created_at: number; // timestamp ms
}

interface TimeBlockRow {
  id: number;
  block_type: string;
  start_time: number;
  end_time: number;
  duration: number;
  earned_rest_duration: number;
  is_manual: number;
  tag: string | null;
  note: string | null;
  created_at: number;
}

const DB_NAME = import.meta.env.DEV ? "amble-dev.db" : "amble.db";

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load(`sqlite:${DB_NAME}`);
    // Create table — use execute with error handling
    try {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS time_blocks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          block_type TEXT NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          duration INTEGER NOT NULL,
          earned_rest_duration INTEGER DEFAULT 0,
          is_manual INTEGER DEFAULT 0,
          tag TEXT,
          note TEXT,
          created_at INTEGER NOT NULL
        )
      `);
    } catch (e) {
      console.error("Failed to create time_blocks table:", e);
    }
  }
  return db;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function msToSec(ms: number): number {
  return Math.round(ms / 1000);
}

// --- Save a work+rest pair ---

export async function saveSession(data: {
  workStartTime: number;
  workEndTime: number;
  workDurationMs: number;
  restTargetMs: number;
  restStartTime: number;
  restEndTime: number;
  restDurationMs: number;
  ratio: number;
}): Promise<void> {
  const d = await getDb();
  const now = Date.now();

  // Insert work block
  await d.execute(
    `INSERT INTO time_blocks (block_type, start_time, end_time, duration, earned_rest_duration, is_manual, created_at)
     VALUES ('work', $1, $2, $3, $4, 0, $5)`,
    [
      data.workStartTime,
      data.workEndTime,
      msToSec(data.workDurationMs),
      msToSec(data.restTargetMs),
      now,
    ]
  );

  // Insert rest block (only if rest was started)
  if (data.restStartTime > 0 && data.restEndTime > 0) {
    await d.execute(
      `INSERT INTO time_blocks (block_type, start_time, end_time, duration, earned_rest_duration, is_manual, created_at)
       VALUES ('rest', $1, $2, $3, $4, 0, $5)`,
      [
        data.restStartTime,
        data.restEndTime,
        msToSec(data.restDurationMs),
        msToSec(data.restTargetMs),
        now,
      ]
    );
  }
}

// --- Manual entry ---

export async function addManualBlock(params: {
  block_type: "work" | "rest";
  durationMin: number;
  ratio: number;
  tag?: string;
  note?: string;
}): Promise<void> {
  const d = await getDb();
  const now = Date.now();
  const durationSec = params.durationMin * 60;
  const earned = params.block_type === "work"
    ? Math.round(durationSec * params.ratio)
    : durationSec; // rest: earned = its own duration (allocated rest)

  await d.execute(
    `INSERT INTO time_blocks (block_type, start_time, end_time, duration, earned_rest_duration, is_manual, tag, note, created_at)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8)`,
    [
      params.block_type,
      now - durationSec * 1000, // start = now - duration
      now,                       // end = now
      durationSec,
      earned,
      params.tag || null,
      params.note || null,
      now,
    ]
  );
}

// --- Query ---

export async function getTodayBlocks(): Promise<TimeBlock[]> {
  const d = await getDb();
  const dayStart = new Date(today()).getTime();
  const dayEnd = dayStart + 86400000;
  const rows = await d.select<TimeBlockRow[]>(
    "SELECT * FROM time_blocks WHERE start_time >= $1 AND start_time < $2 ORDER BY start_time ASC",
    [dayStart, dayEnd]
  );
  return rows.map(mapRow);
}

export async function getAllBlocks(): Promise<TimeBlock[]> {
  const d = await getDb();
  const rows = await d.select<TimeBlockRow[]>(
    "SELECT * FROM time_blocks ORDER BY start_time DESC"
  );
  return rows.map(mapRow);
}

function mapRow(r: TimeBlockRow): TimeBlock {
  return {
    id: r.id,
    block_type: r.block_type as "work" | "rest",
    start_time: r.start_time,
    end_time: r.end_time,
    duration: r.duration,
    earned_rest_duration: r.earned_rest_duration,
    is_manual: r.is_manual,
    tag: r.tag,
    note: r.note,
    created_at: r.created_at,
  };
}

// --- Stats queries ---

export interface StatsResult {
  focusSec: number;
  breakSec: number;
  sessionCount: number;
}

export interface BarDatum {
  label: string;
  focusSec: number;
  breakSec: number;
}

export async function getStats(daysBack: number): Promise<StatsResult> {
  const d = await getDb();
  const since = new Date().getTime() - daysBack * 86400000;

  const focusRow = await d.select<[{ total: number }]>(
    "SELECT COALESCE(SUM(duration), 0) as total FROM time_blocks WHERE block_type = 'work' AND start_time >= $1",
    [since]
  );
  const breakRow = await d.select<[{ total: number }]>(
    "SELECT COALESCE(SUM(duration), 0) as total FROM time_blocks WHERE block_type = 'rest' AND start_time >= $1",
    [since]
  );
  const countRow = await d.select<[{ cnt: number }]>(
    "SELECT COUNT(*) as cnt FROM time_blocks WHERE block_type = 'work' AND start_time >= $1",
    [since]
  );

  return {
    focusSec: focusRow[0]?.total ?? 0,
    breakSec: breakRow[0]?.total ?? 0,
    sessionCount: countRow[0]?.cnt ?? 0,
  };
}

// Bar chart data: daily for the past N days
export async function getDailyBars(days: number): Promise<BarDatum[]> {
  const d = await getDb();
  const since = new Date().getTime() - days * 86400000;
  const rows = await d.select<Array<{ d: string; f: number; b: number }>>(
    `SELECT date(start_time/1000, 'unixepoch') as d,
            COALESCE(SUM(CASE WHEN block_type='work' THEN duration ELSE 0 END), 0) as f,
            COALESCE(SUM(CASE WHEN block_type='rest' THEN duration ELSE 0 END), 0) as b
     FROM time_blocks WHERE start_time >= $1
     GROUP BY d ORDER BY d ASC`,
    [since]
  );
  return rows.map((r) => {
    const t = new Date(r.d);
    const label = t.toLocaleDateString("en-US", { weekday: "short" });
    return { label, focusSec: r.f, breakSec: r.b };
  });
}

// Weekly bars: past N weeks
export async function getWeeklyBars(weeks: number): Promise<BarDatum[]> {
  const d = await getDb();
  const since = new Date().getTime() - weeks * 7 * 86400000;
  const rows = await d.select<Array<{ w: string; f: number; b: number }>>(
    `SELECT strftime('%Y-W%W', start_time/1000, 'unixepoch') as w,
            COALESCE(SUM(CASE WHEN block_type='work' THEN duration ELSE 0 END), 0) as f,
            COALESCE(SUM(CASE WHEN block_type='rest' THEN duration ELSE 0 END), 0) as b
     FROM time_blocks WHERE start_time >= $1
     GROUP BY w ORDER BY w ASC`,
    [since]
  );
  return rows.map((r) => {
    const parts = r.w.split("-W");
    const label = `W${parseInt(parts[1])}`;
    return { label, focusSec: r.f, breakSec: r.b };
  });
}

// Monthly bars: past N months
export async function getMonthlyBars(months: number): Promise<BarDatum[]> {
  const d = await getDb();
  const since = new Date().getTime() - months * 30 * 86400000;
  const rows = await d.select<Array<{ m: string; f: number; b: number }>>(
    `SELECT strftime('%Y-%m', start_time/1000, 'unixepoch') as m,
            COALESCE(SUM(CASE WHEN block_type='work' THEN duration ELSE 0 END), 0) as f,
            COALESCE(SUM(CASE WHEN block_type='rest' THEN duration ELSE 0 END), 0) as b
     FROM time_blocks WHERE start_time >= $1
     GROUP BY m ORDER BY m ASC`,
    [since]
  );
  return rows.map((r) => {
    const parts = r.m.split("-");
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const label = monthNames[parseInt(parts[1]) - 1];
    return { label, focusSec: r.f, breakSec: r.b };
  });
}

// --- Stats with explicit date range ---

export async function getStatsBetween(since: number, until: number): Promise<StatsResult> {
  const d = await getDb();

  const focusRow = await d.select<[{ total: number }]>(
    "SELECT COALESCE(SUM(duration), 0) as total FROM time_blocks WHERE block_type = 'work' AND start_time >= $1 AND start_time < $2",
    [since, until]
  );
  const breakRow = await d.select<[{ total: number }]>(
    "SELECT COALESCE(SUM(duration), 0) as total FROM time_blocks WHERE block_type = 'rest' AND start_time >= $1 AND start_time < $2",
    [since, until]
  );
  const countRow = await d.select<[{ cnt: number }]>(
    "SELECT COUNT(*) as cnt FROM time_blocks WHERE block_type = 'work' AND start_time >= $1 AND start_time < $2",
    [since, until]
  );

  return {
    focusSec: focusRow[0]?.total ?? 0,
    breakSec: breakRow[0]?.total ?? 0,
    sessionCount: countRow[0]?.cnt ?? 0,
  };
}

export async function getBarsBetween(
  since: number,
  until: number,
  granularity: "day" | "week" | "month",
): Promise<BarDatum[]> {
  const d = await getDb();

  let groupExpr: string;
  let labelFn: (r: { period: string }) => string;

  if (granularity === "day") {
    groupExpr = "date(start_time/1000, 'unixepoch')";
    labelFn = (r) => {
      const t = new Date(r.period);
      return t.toLocaleDateString("en-US", { weekday: "short" });
    };
  } else if (granularity === "week") {
    groupExpr = "strftime('%Y-W%W', start_time/1000, 'unixepoch')";
    labelFn = (r) => {
      const parts = r.period.split("-W");
      return `W${parseInt(parts[1])}`;
    };
  } else {
    groupExpr = "strftime('%Y-%m', start_time/1000, 'unixepoch')";
    labelFn = (r) => {
      const parts = r.period.split("-");
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return monthNames[parseInt(parts[1]) - 1];
    };
  }

  const rows = await d.select<Array<{ period: string; f: number; b: number }>>(
    `SELECT ${groupExpr} as period,
            COALESCE(SUM(CASE WHEN block_type='work' THEN duration ELSE 0 END), 0) as f,
            COALESCE(SUM(CASE WHEN block_type='rest' THEN duration ELSE 0 END), 0) as b
     FROM time_blocks WHERE start_time >= $1 AND start_time < $2
     GROUP BY period ORDER BY period ASC`,
    [since, until]
  );

  return rows.map((r) => ({
    label: labelFn(r),
    focusSec: r.f,
    breakSec: r.b,
  }));
}

// --- Helpers ---

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
