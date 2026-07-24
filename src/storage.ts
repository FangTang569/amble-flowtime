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
