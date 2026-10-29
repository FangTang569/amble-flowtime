# amble: Timeflow Technique

A minimalist flow-time technique timer built with Tauri v2 and Tailwind CSS.
Cross-platform (Windows, macOS, Linux).

## Philosophy

Rest is not the opposite of work — rest is part of work.

This app focuses on the forward-counting (正计时) timer experience.
Each pause automatically calculates expected rest time based on a user-set ratio
and pre-fills the rest countdown. Rest you end early is banked into an
unused-rest pool, which is spent automatically once the earned rest runs out.

## Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Desktop shell | Tauri v2 | Native windows, ~3-5 MB bundle |
| Frontend tooling | Vite 6 + TypeScript 5.7 | HMR, strict type checking |
| CSS | Tailwind CSS v3 via CLI + PostCSS | Fully offline build, Inter font bundled locally |
| State | Plain class (FlowTimer) | Zero deps, observer pattern |
| Backend (Rust) | Minimal scaffold | Timer logic is pure frontend; Rust reserved for future |

## Project Structure

```
amble-flowtime/
├── CLAUDE.md                  # This file
├── index.html                 # Vite entry + app shell
├── mini.html                  # Mini overlay window
├── package.json               # Node deps
├── tsconfig.json              # Strict TS config
├── vite.config.ts             # Vite + multi-page build
├── tailwind.config.js         # Tailwind theme (accent, Inter font)
├── postcss.config.js          # PostCSS with Tailwind + Autoprefixer
├── src/
│   ├── main.ts                # Bootstrap: create timer, wire UI & storage
│   ├── timer.ts               # FlowTimer class (state machine + rest pool)
│   ├── pool.ts                # Unused-rest pool (localStorage, resets daily)
│   ├── ui.ts                  # DOM manipulation, render(), setupUI()
│   ├── types.ts               # Shared TypeScript types
│   ├── storage.ts             # SQLite session persistence
│   ├── overlay.ts             # Mini overlay window script
│   └── style.css              # Tailwind directives + custom CSS
├── scripts/
│   └── timer-selftest.ts      # Headless timer semantics test (npm run selftest)
├── src-tauri/
│   ├── Cargo.toml             # tauri 2, serde, serde_json, tauri-plugin-sql
│   ├── build.rs               # tauri-build
│   ├── tauri.conf.json        # Window 400×540, borderless, resizable
│   ├── capabilities/
│   │   └── default.json       # App permissions
│   ├── icons/                 # App icons
│   └── src/
│       ├── lib.rs             # Tauri builder with plugins
│       ├── main.rs            # Desktop entry point
│       └── backup.rs          # Database backup command
└── todo.md                    # Project roadmap
```

## Architecture: Timer State Machine

```
idle ──[start]──> running ──[pause]──> paused ──[startRest]──> resting ──[auto/done]──> idle
                     │                    │
                     └──[stop]──> idle    └──[stop]──> idle
                                          └──[resume]──> running
```

**States:**
- **idle**: Timer reset, ready to start a new work session
- **running**: Work timer counting up (forward-counting)
- **paused**: Work timer stopped, earned rest settled and displayed
- **resting**: Rest counting down — first the earned rest, then the banked pool

**Key behaviors:**
- `start()`: Works from idle or paused state
- `pause()`: Settles `restTarget = workElapsed × ratio`, enters paused
- `resume()`: Continues work from paused (accumulated time preserved)
- `startRest()`: Snapshots the pool and begins countdown from earned rest
- `stop()`: Settles the pool, emits `onSessionEnd`, resets to idle
- Auto-stop: When earned rest **and** the snapshotted pool are used up
- `setRatio()`: Rejected (returns false) unless idle — a cycle locks its ratio
- Rest phase: `earned` while the cycle's own rest runs, `unused` once the
  pool is being spent

## Architecture Decisions

### Timer in Frontend (TypeScript)
The timer uses `Date.now()` diff-based timing in the browser.
No Rust backend involvement — avoids IPC overhead every 250ms tick.
OS-level features (notifications, sleep prevention, system tray) are future concerns.

### Drift Prevention
Uses absolute `Date.now()` timestamps rather than incrementing a counter.
Each tick recalculates elapsed from `segmentStartTime`. If the interval is
throttled (minimized window, etc.), it catches up on the next tick.

### Tick Interval: 250ms
Provides smooth second-boundary transitions without measurable CPU cost.

### Ratio
- Stored as a decimal (0.05–1.0)
- Default: 0.25 (work 4:1 = 25% rest)
- Displayed as percentage + ratio string (e.g., "25% (work 4:1)")
- Settable **only while idle** — `setRatio()` returns false once a cycle has
  begun, and both ratio sliders render as locked

### Unused-Rest Pool (未使用休息池)
Ending a rest early banks the leftover earned rest into a pool
(`src/pool.ts`, localStorage key `amble-unused-rest`). The next rest spends it
automatically, but only after that cycle's own earned rest is exhausted — the
pool balance is snapshotted at `startRest()` so a round can never run forever.
The pool is a single-day allowance and resets at local midnight.

### Readout: two-account ledger
The hero display is a side-by-side ledger: **EARNED** (what the current cycle
has bought) and **UNUSED** (the banked pool). The account in play is solid, the
dormant one fades back; the pool flashes amber the moment a rest is banked.
At idle the left column repurposes itself as **TODAY** — today's rest share
(rest ÷ tracked time) instead of a dead 00:00.
The **Live rest share** setting sharpens this to 4 decimals and keeps it on
screen while the unused pool is being spent — toggled by clicking the left
column (in the two share states) or the settings switch; the live figure
quantizes the
in-flight session with the same `secOf` rounding the database applies
(`src/share.ts`), and the session-end handler stores the last displayed rest
seconds, so the handover back to idle never jumps.
The mini overlay mirrors `snapshot.displayMs` — the single most relevant number.

## Development Commands

```bash
# Install dependencies
npm install

# Run in dev mode (with hot reload)
npm run tauri dev

# TypeScript type check
npx tsc --noEmit

# Headless timer semantics test (deterministic clock, no DOM/Tauri)
npm run selftest

# Build for production
npm run tauri build
```

### Prerequisites (Windows)
- Node.js >= 18
- Rust >= 1.77
- Microsoft Visual C++ Build Tools
- WebView2 runtime (pre-installed on Windows 11)

## Known Limitations

| Limitation | Mitigation |
|------------|------------|
| Timer format MM:SS only | Sufficient for < 99 min sessions; extend later |
| No notifications on rest complete | Add tauri-plugin-notification later |
| No system tray / background mode | Tauri plugin in future step |
| No sound alerts | Future enhancement |
| Fonts bundled (165 KB) | Acceptable; only Latin subset loaded |

## Future Roadmap (from todo.md)

1. **Time block view** (时间块视图) — visual timeline of work/rest blocks, inspired by KOReader's "全书漫游"
2. **Quick-add time entry** (高效的时间块添加系统) — inspired by Toggl's time entry system
3. **Stats & forgiveness** (零挫败感):
   - Statistics at week/month granularity (daily stats hidden deeper)
   - Rest overtime goes negative silently (no punishment)
   - Slider to quickly record actual duration for long sessions
4. **Production polish**:
   - ~~Replace Tailwind CDN with CLI/PostCSS build~~ ✅
   - Add app icons
   - System tray integration
   - Notifications on state transitions
   - Prevent system sleep during active sessions
