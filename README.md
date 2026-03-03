# PUHRR — Portable Unofficial Health Record, Really

> An offline-first Progressive Web App for medical clerks doing hospital rounds.  
> Replaces Google Sheets for tracking ~10 active patients during a rotation — built to be fast on a phone.

[![License](https://img.shields.io/github/license/CSfromCS/PortableEletronicHealthRecord)](LICENSE)
[![PWA](https://img.shields.io/badge/PWA-offline--first-blue)](#)
[![React](https://img.shields.io/badge/React-19-61dafb)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)](#)

---

## Table of Contents

- [About](#about)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Project Structure](#project-structure)
- [Data & Privacy](#data--privacy)
- [Validating Changes](#validating-changes)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## About

PUHRR is a **single-user, personal** PWA designed for a medical clerk who needs to:

1. Quickly capture patient notes during morning rounds on a phone.
2. Generate copy-paste-ready text to share via Viber/WhatsApp to a laptop.
3. Paste into Google Docs for the official record.

It is **not** a shared EHR, team tool, or full EMR — just a fast personal notebook that works offline.

---

## Features

### Navigation

- **Bottom nav on mobile** — Patients / Patient / Checklist / Settings sticky bar.
- **Top nav on desktop** — same sections, with focused patient shown as *Room – Last name*.
- Tap **Open** on any patient card to jump directly into the focused patient view.
- On mobile, the tab row stays fixed just above the bottom nav when a patient is open.

### Patient Tabs

Each open patient has eight focused tabs:

| Tab | Purpose |
|---|---|
| **Profile** | Demographics plus case-review notes (clinical summary, chief complaint, HPI, PMH, PE), diagnosis, and clinical details |
| **FRICHMOND** | Daily progress notes (Fluid, Respiratory, Infectious, Cardiovascular, Hema, Metabolic, Output, Neuro, Drugs), assessment/plan, and a per-date checklist where items can be edited/reordered and only pending items carry forward on copy |
| **Vitals** | Temp, BP, HR, RR, O₂ saturation with history |
| **Labs** | CBC, urinalysis, Blood Chemistry, ABG (with auto-calculated pO2/FiO2 and conditional Desired FiO2 when FiO2 > 21% or pO2 < 60; target PaO2 = 60), and Others (custom label + freeform result); trend comparison applies to structured templates, while Others stays plain |
| **Medications** | Active medication list with status tracking |
| **Orders** | Doctor's orders — add, edit status, remove in one place |
| **Photos** | Camera capture or gallery pick, organized by section category |
| **Reporting** | Profile/FRICHMOND/vitals/labs/orders/census exports with lab instance selection and comparison support |

### Master Checklist (All Patients)

- Date picker shows checklist state for the chosen date across all patients.
- Incomplete items carry forward to future dates; completed items stay on their original completion date.
- Each row shows patient identifier plus created/completed dates (if present), displayed in short format (e.g., `Feb 10`).
- Checklist entries can be marked done/pending, edited, removed, and reordered from either FRICHMOND or Master Checklist view.

### Reporting & Export

- **Profile summary** follows room/name header, main/referral service split, `Dx`, and optional `Notes` blocks.
- **FRICHMOND summary** uses `ROOM - LASTNAME, First — MM-DD-YYYY`, removes orders, includes daily vitals min–max ranges, and appends checklist items as `- [ ]` (pending) / `- [x]` (completed).
- **Vitals summary** supports multi-patient selection and date/time window filtering.
- **Labs summary** supports arbitrary instance selection per patient; comparison mode runs only when exactly 2 instances of the same non-Others lab template are selected.
- **Orders summary** supports date/time filtering using order date/time fields and preserves order text exactly as entered.
- **All patient exports** — choose exactly which active patients to include and reorder them before generating Selected Census or Selected Vitals.
- Text output opens in a popup with full-select and **Copy full text** button.

### Photos

- Attach one or multiple photos per upload, categorized by section (Profile, FRICHMOND, Vitals, Medications, Labs, Orders).
- Each upload batch uses one shared title + category and appears as one gallery block with a photo-count badge.
- Photo title is auto-prefilled as `Category + date/time`; editable before saving.
- Tapping a gallery block opens an in-app carousel for that upload set.
- Use `@photo-title` mentions in long-form notes to link directly to an attached photo.
- Compressed copies stored in IndexedDB for offline viewing.
- Deleting a photo removes only the in-app copy — the original phone gallery file is untouched.

### Settings

- **Backup / restore** — export all text data as JSON; import replaces text data while keeping current on-device photos.
- **Encrypted sync (optional)** — link devices with a shared room code and distinct device names, then sync encrypted patients + FRICHMOND updates through the configured proxy endpoint.
- **Sync status panel** — view latest room upload time/device and whether this device has local unsynced changes.
- **Review all photos** — open a global photo manager that marks each photo as linked/orphan and supports reassign, delete, and export.
- **Clear discharged patients** — bulk-remove patients marked as discharged.
- **Show onboarding** — reopen the Welcome modal and retry the install prompt at any time.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript 5.9 |
| Build tool | Vite 7 |
| PWA | vite-plugin-pwa (Workbox, autoUpdate) |
| Styling | Tailwind CSS v4 (CSS-only config in `src/index.css`) |
| UI components | shadcn/ui (files in `src/components/ui/`) |
| Local database | Dexie.js v4 (IndexedDB) |
| Forms | React Hook Form + Zod |
| Icons | lucide-react |

> **Tailwind v4 note:** There is no `tailwind.config.js`. All theme tokens (colors, spacing) are declared in the `@theme` block inside `src/index.css`.

---

## Getting Started

### Setup orientation (what this is, how it works, what to remember)

Before running the app, use this quick mental model:

- **What this is:** a personal, offline-first rounding notebook for one medical clerk. It is not a shared EHR.
- **How it works:** React + TypeScript renders the UI, Dexie stores data in IndexedDB, and report builders generate copy/paste-ready text from saved records.
- **Data flow to remember:** UI actions in `App.tsx` write/read Dexie tables via `db.ts`, shared shapes come from `types.ts`, and formatted outputs are produced by feature formatters/builders.
- **Safety baseline:** preserve existing patient data by default; avoid destructive schema changes unless explicitly requested.
- **Docs drift rule:** if workflow/labels/output behavior changes, update both this README and the in-app Settings “How to use” content.

If you only remember one thing: **keep the app fast on mobile and offline-first**.

### Prerequisites

- **Node.js 20 LTS or later** — [nodejs.org](https://nodejs.org)
- **npm** (bundled with Node.js)

### Install & run

```bash
# 1. Clone the repo
git clone https://github.com/CSfromCS/PortableEletronicHealthRecord.git
cd PortableEletronicHealthRecord

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Vite starts on **http://localhost:5173** by default.

### Testing on a real phone (Codespaces / remote)

1. Run `npm run dev` in the terminal.
2. Open the **Ports** panel in VS Code — port 5173 appears automatically.
3. Set visibility to **Public**.
4. Copy the forwarded URL and open it in Chrome on your phone.
5. Use **Add to Home Screen** in Chrome to install the PWA.

### Recommended VS Code extension

- **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`) — autocomplete for custom tokens like `bg-coral-punch`.

---

## Deployment

### Option A — Local production preview

```bash
npm run build
npm run preview
```

Preview serves the production bundle at **http://localhost:4173**.

### Option B — Static hosting

After `npm run build`, deploy the `dist/` folder to any static host:

- [Netlify](https://netlify.com)
- [Cloudflare Pages](https://pages.cloudflare.com)
- [Vercel](https://vercel.com) (static output mode)
- GitHub Pages (see Option C)

The build uses relative asset paths (`./`) so it works in a subdirectory without extra configuration.

### Option C — GitHub Pages (automated)

A GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) deploys automatically on every push to `main`.

**One-time setup:**

1. Go to **Settings → Pages** in your fork.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or trigger the workflow manually from the **Actions** tab).

The live URL appears in the workflow run after the `deploy` job completes.

> **PWA manifest:** Metadata is the source of truth in `vite.config.ts` (`VitePWA.manifest`). `public/manifest.json` is kept in sync as a static mirror for hosts that fetch manifests directly.

---

## Project Structure

```
src/
├── App.tsx              # Main app — all views, tabs, and UI logic
├── db.ts                # Dexie schema, migrations, and DB helper functions
├── types.ts             # TypeScript domain types
├── index.css            # Tailwind v4 @theme tokens + global styles
├── labFormatters.ts     # Lab result formatting utilities
├── main.tsx             # React entry point + PWA registration
├── components/
│   └── ui/              # shadcn/ui base components (edit freely)
├── hooks/               # Custom React hooks
└── lib/
    └── utils.ts         # cn() helper and shared utilities

public/
└── manifest.json        # Static PWA manifest mirror (keep in sync with vite.config.ts)
```

### Database stores (IndexedDB via Dexie)

| Store | Contents |
|---|---|
| `patients` | Demographics, diagnosis, clinical details, status |
| `dailyUpdates` | FRICHMOND notes per patient per day |
| `vitals` | Vital signs history |
| `medications` | Medication list entries |
| `labs` | Lab results |
| `orders` | Doctor's orders |
| `photoAttachments` | Compressed photo blobs + metadata |

> **Schema baseline:** The database is named `roundingAppDatabase_v1`. Legacy pre-1.0 stores and migration chains are intentionally dropped for clean installs.

---

## Data & Privacy

- **By default, data stays on your device.**
- **If Sync is enabled, only encrypted sync blobs are sent** to the configured sync endpoint.
- No analytics, no telemetry, no external API calls.
- Backups are plain JSON files exported manually from Settings.
- Photo attachments are stored in IndexedDB only — they are **excluded** from the JSON backup.
- Importing a JSON backup replaces text tables and keeps existing photo attachments already stored on the device.

---

## Validating Changes

No automated test suite yet. Use these checks before shipping:

```bash
npm run lint
npm run build
```

Then do a quick manual smoke test:

1. Open the app — confirm it loads with title **PUHRR**.
2. Add a patient, enter a FRICHMOND note, check a generated summary.
3. Confirm no errors in the browser console.
4. *(Optional)* Disable network in DevTools → confirm the app still loads and data is accessible.
5. *(Optional)* Install via browser menu → confirm it opens in standalone mode.

---

## Known Limitations

- JSON backup/restore covers **text data only** — photo attachments are not included.
- Import keeps currently stored photos; it does not recreate photos from the backup file.
- Sync covers `patients`, `dailyUpdates`, `vitals`, `medications`, `labs`, and `orders`.
- If a room still contains a legacy snapshot from an older build, pull may include only `patients` + `dailyUpdates` until an updated device pushes a fresh snapshot.
- First sync against an existing room now requires explicit user choice (upload local data or download room data first) to avoid silent overwrite.
- Conflict protection triggers whenever remote data is newer and local data also changed since last sync (including same-tag/device-name edge cases).
- Offline support depends on the PWA service worker being registered on first load while online.

---

## License

[MIT](LICENSE)
