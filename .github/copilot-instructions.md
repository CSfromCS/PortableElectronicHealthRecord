# Copilot Instructions

## Project Overview

**PUHRR** (Portable Electronic Health Record) — A personal Progressive Web App (PWA) for medical clerks doing hospital rounds. This is a **single-user, offline-first** note-taking tool that replaces Google Sheets for tracking ~10 active patients during a 2-month rotation.

**Core goal:** Make it faster to take patient notes on a phone and generate copy-paste-ready text for sharing via messaging apps (Viber/WhatsApp) to a laptop for Google Docs.

**Not:** A shared EHR, team tool, or full EMR. This is a personal clerk's notebook.

## Source of Truth & Drift Control

- Prefer current code behavior over stale prose when they differ.
- Keep these files aligned whenever behavior changes:
  - `src/App.tsx` (workflow and UI behavior)
  - `src/db.ts` (Dexie schema and migrations)
  - `src/types.ts` (domain model)
  - `README.md` (run/deploy/usage notes)
- If a change updates workflow, field labels/order, or copy/share behavior, also update the in-app Settings **How to use** section in the same task.
- Avoid hard-coding static "current version" statements in docs; they become stale quickly.

## Current Code Map (LLM Quick Index)

Use this as the first-stop map when making changes:

- `src/App.tsx`
  - App shell + overall workflow orchestration
  - View switching (`patients` / `patient` / `settings`)
  - Cross-feature state wiring, autosave triggers, dialogs, and reporting actions
  - Keep this as a coordinator file; prefer extracting pure logic/components instead of growing this file further
- `src/features/photos/photoUtils.ts`
  - Photo category options and labels
  - Photo title defaults, upload-group key helpers
  - Image compression + byte-size formatting helpers
- `src/features/photos/photoMentions.tsx`
  - Mention-aware long-form input (`PhotoMentionField`)
  - Mention renderer (`MentionText`) for clickable `@photo-title` links
  - Photo mention-related helper types (`MentionablePhoto`, grouped/review attachment types)
- `src/features/labs/labTemplates.ts`
  - Structured lab template catalog (`LAB_TEMPLATES`)
  - Lab template constants and field-key builders (ULN/normal-range keys, ABG keys)
  - Template IDs used across lab entry/reporting flows
- `src/labFormatters.ts`
  - Lab report text formatters (single, comparison, urinalysis, blood chemistry)
- `src/db.ts`
  - Dexie schema, stores, and migrations (source of truth for persisted shape)
- `src/types.ts`
  - Domain model and shared types

Refactor guidance for future work:

- Prefer feature-local extraction under `src/features/<feature>/`.
- Keep components/hooks/utilities focused and small enough to review in one pass.
- When adding reusable cross-feature helpers, place them in dedicated modules instead of `App.tsx`.

---

## Design Principles

1. **Offline-first, no backend:** All data in IndexedDB (via Dexie.js). No server, no auth, no sync.
2. **PWA = works on phone AND laptop:** Same URL in Chrome on Android and desktop. Can install to home screen.
3. **MVP simplicity:** If a feature doesn't directly speed up note-taking or text generation, defer it.
4. **Better than Google Sheets on a phone, not a full EMR.**

---

## Tech Stack

- **React 19 + TypeScript** + Vite 7 + vite-plugin-pwa
- **Dexie.js v4+** for IndexedDB (stores include `patients`, `dailyUpdates`, `vitals`, `medications`, `labs`, `orders`, `photoAttachments`)
- **React Hook Form + Zod** for structured forms
- **Tailwind CSS v4** for all styling — configured via CSS `@theme` block in `src/index.css`
  - No `tailwind.config.js` — v4 uses CSS-only config
  - Custom color tokens available as utility classes (see Color Tokens section below)
- **shadcn/ui** for UI components — copy-paste system, NOT an npm package
  - Component files live in `src/components/ui/` — edit them freely
  - Install new components: `npx shadcn@latest add <component-name>`
- **Web Share API** + clipboard fallback for text sharing

---

## Color Tokens (Tailwind Classes)

These are the PUHRR brand colors — use them instead of arbitrary color values:

| Token | Class examples | Hex | Use for |
|---|---|---|---|
| `coral-punch` | `bg-coral-punch`, `text-coral-punch` | #E2614A | Primary brand color |
| `peach-cream` | `bg-peach-cream` | #FFF0E8 | Patient card backgrounds |
| `warm-ivory` | `bg-warm-ivory` | #FDF6F0 | Main background, panels |
| `blush-sand` | `bg-blush-sand` | #F5E1D0 | Section card backgrounds |
| `clay` | `text-clay`, `border-clay` | #8A6355 | Secondary text, borders |
| `espresso` | `text-espresso` | #2D1F1A | Primary text |
| `action-primary` | `bg-action-primary` | #E2614A | Primary buttons |
| `action-secondary` | `bg-action-secondary` | #6B5B55 | Secondary buttons |
| `action-edit` | `bg-action-edit` | #3574B8 | Edit buttons |
| `action-danger` | `bg-action-danger` | #C43131 | Delete/danger buttons |

---

## Component Architecture

### shadcn/ui base components (`src/components/ui/`)
- `Button` — variants: `default` (coral-punch), `secondary`, `destructive`, `edit` (custom blue), `outline`, `ghost`, `link`
- `Card`, `CardHeader`, `CardTitle`, `CardContent` — use for all panels and sections
- `Badge` — for status labels (active/discharged/medication status)
- `Input`, `Textarea`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`
- `Label` — always pair with form inputs
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` — for tab navigation
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` — for modals
- `Alert`, `AlertDescription` — for status notices
- `ScrollArea` — for scrollable content in dialogs
- `Table`, `Tooltip` — for data tables and contextual hints

### Utility
- `cn()` from `@/lib/utils` — merge Tailwind classes conditionally

---

## Styling Rules for AI Code Generation

When generating new UI for this app, follow these rules:

1. **Use Tailwind utility classes** — do NOT write new CSS files or inline styles
2. **Use shadcn/ui components** from `@/components/ui/` for all interactive elements
3. **Use `cn()` from `@/lib/utils`** to merge classes conditionally
4. **Button variants:**
   - Primary actions → `<Button>` (default, coral-punch)
   - Neutral/cancel → `<Button variant="secondary">`
   - Edit/update → `<Button variant="edit">`
   - Delete/danger → `<Button variant="destructive">`
5. **Card usage conventions:**
   - Patient cards → `<Card className="bg-peach-cream border-clay">`
   - Detail panels → `<Card className="bg-warm-ivory border-clay">`
   - Section panels (vitals/meds/labs/orders) → `<Card className="bg-blush-sand border-clay">`
6. **Form fields:** Always use `<Label>` above `<Input>`, `<Textarea>`, or `<Select>`. Wrap in `<div className="space-y-1">`
7. **Lists:** Use `flex flex-col gap-2` for card lists, `space-y-1` for item lists within sections
8. **Modals:** Always use `<Dialog>` from shadcn/ui — never custom modal divs
9. **Tab navigation:** Always use `<Tabs>` from shadcn/ui
10. **Status text:** Always use `<Badge>` for patient/medication/order status strings
11. **Long-form text fields:** For any new long-form clinical notes field in `src/App.tsx`, use the shared mention-enabled input (`PhotoMentionField`) instead of raw `<Textarea>` so `@photo-title` suggestions and link opening are available by default.

---

## Medical Context & Terms

### Patient Workflow
1. **Admit patient:** Enter demographics (room, name, age, sex) → add service → add diagnosis and clinical details in Profile tab
2. **Daily rounds:** Enter ordered problem notes, vitals, meds, labs
3. **Generate text:** Tap button to get formatted census entry or daily summary
4. **Copy/share:** Paste into chat → send to laptop → paste into Google Docs

### Problems List
Daily progress notes are stored as user-defined, ordered problem blocks. Each block has a short title and free-text notes, and users control priority through drag-and-drop ordering.

### Key Data
- **Demographics:** Room number, name, age, sex, service (e.g., Internal Medicine, Surgery)
- **Admitting diagnosis:** Chief complaint / reason for admission
- **Working diagnosis:** Current diagnosis after workup
- **Clinical details:** Freeform text fields (plans, medications, labs, pendings, clerk notes)
- **Daily updates:** Ordered problem notes, vitals, assessment, plan
- **Vitals:** Temperature, blood pressure, heart rate, respiratory rate, O2 saturation
- **Labs:** CBC, electrolytes, liver/kidney function, etc. with trend comparison

---

## Implementation Rules

### Version Bumping (Required)
For every user-visible or behavior-changing update:
1. Bump `package.json` version in the same task.
2. Verify footer displays new version after run/preview.
3. Mention the new version in final response.

### Safety Gates (Required)
- Default to backward-compatible data changes.
- Treat destructive schema/data changes as high-risk; only do them when explicitly requested.
- For backup/import changes, validate payload shape before writes and fail with user-readable errors.
- Avoid broad refactors unless specifically requested; prefer minimal, localized edits.

### Code Quality
- Prefer focused, minimal edits. Keep style consistent.
- Implement only requested features; avoid adding extra screens/components.
- Use TypeScript strictly (no `any` unless absolutely necessary).
- Keep Dexie schema simple unless explicitly asked to add structure.

### Data Constraints
- **Privacy-first:** All data stays on device. No telemetry, no analytics, no external calls (except optional Web Share API).
- Preserve existing user data by default. If a migration may alter/drop data, clearly call it out before implementing.

---

## Codespace Preview Workflow

1. Run `npm run dev` in terminal — Vite starts on port 5173
2. Open the **Ports** panel (bottom VS Code bar) — port 5173 appears automatically
3. Set visibility to **Public** to test from phone during rounds
4. `Ctrl+Shift+P` → "Simple Browser: Show" → paste the forwarded URL for in-IDE preview
5. Install the **Tailwind CSS IntelliSense** extension (`bradlc.vscode-tailwindcss`) for autocomplete on `bg-coral-punch`, `text-espresso`, etc.

---

## Current State (Living)

- ✅ MVP foundation: Patient add/edit, list with search/filter/sort, Profile tab, Vital Signs tab, Orders tab
- ✅ Ordered Problems List note-taking with autosave
- ✅ Structured data entry: Vitals, medications, labs (with trends), doctor's orders
- ✅ Text generation: Census entry, daily summary, profile copy/share
- ✅ Settings: Backup export/import (JSON), clear discharged patients, built-in usage guide
- ✅ Demo data: Sample patient "Juan Dela Cruz" auto-initialized on first launch
- ✅ Photo attachments by category with mention linking (`@photo-title`) in long-form notes
- ✅ **Tailwind CSS v4 + shadcn/ui** — full UI migration complete
- ✅ All styling uses Tailwind utilities — `src/App.css` deleted

---

## When Making Changes

- Start simple, iterate based on real usage feedback
- Test on mobile viewport (360px width minimum)
- Verify offline behavior (disable network in DevTools)
- Check that generated text is readable and copy-paste-ready
- Always update the in-app Settings "How to use" section when workflow, field order, labels, or user-visible behavior changes.
- Keep README accurate for setup/deployment instructions
- Do not run `npm run build` unless explicitly asked by the user