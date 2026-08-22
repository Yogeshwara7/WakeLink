---
inclusion: always
---

# WakeLink — Agent Workflow Rules

These rules govern how Kiro operates on terminal commands, package management,
git, testing, and development servers for this project.

---

## 1. Terminal execution

**Execute terminal commands directly** whenever the tool is available.
Do NOT stop and ask the user to manually run a command that can be executed here.

Before running any command:
- Confirm the working directory is correct.
- Prefer project-relative paths.
- Do not run destructive commands unless clearly necessary and justified.

---

## 2. Multi-step workflows

Execute the **complete sequence** autonomously:
- Run each step, inspect the output, then decide the next action.
- If a command fails, diagnose the error and attempt the appropriate fix
  before asking the user for help.
- Do not hand the user a list of commands to run one at a time.

---

## 3. Package management

- Run `npm install` / `npm ci` / `npm run <script>` directly.
- Resolve dependency conflicts by inspecting `package.json` and lockfiles first.
- **Never use `--force` or `--legacy-peer-deps` as the first solution.**
  Prefer fixing the actual version mismatch.

---

## 4. Git

Allowed without asking:
- `git status`, `git diff`, `git log`, `git branch`, `git remote -v`
- Stage specific files and create commits when a task explicitly requires it.
- Push when the user explicitly requests a push; verify the remote branch afterward.
- Inspect `git status` and the staged diff before every commit.

Never do without explicit user approval:
- `git push --force`
- `git reset --hard`
- `git clean -fd`
- `git branch -D`
- Discard uncommitted user changes

Never commit:
- `.env` files or any file containing secrets, tokens, API keys, or credentials.
- `node_modules/`, `dist/`, `.expo/`, or other generated/machine-specific output.
- Build artefacts.

---

## 5. Testing and validation

**Run tests yourself** — do not tell the user which commands to run.
After any change to `agent/`, `backend/`, `src/`, or `app/`:
- Run the relevant test suite (`npm test`).
- Run `npx tsc --noEmit` in the affected project.
- Report actual results, not expected results.

---

## 6. Development servers

- Start dev servers when required for verification.
- Use background processes for long-running servers.
- Do not terminate unrelated running processes.

---

## 7. When to stop and ask the user

Only stop for actions that genuinely cannot be automated:
- Entering a password, OTP, or browser authentication flow.
- Accepting an OS security or UAC prompt.
- Connecting physical hardware.
- Changing BIOS/UEFI settings.
- Any action requiring physical presence at the machine.

Clearly describe the **exact manual action** required and why it cannot be automated.

---

## 8. End-of-task summary

After completing any task, provide a concise summary:
1. What was changed (files created / modified).
2. Commands and actions executed.
3. Tests and validation performed with actual results.
4. Any remaining manual steps the user must take.

---

## 9. WakeLink-specific rules

**Preserve existing architecture.**
- Do not rewrite, refactor, or replace Phase 1 or Phase 2 components unless
  explicitly requested.
- Before modifying any existing service, read the current implementation and
  understand the existing interfaces and service registry.
- Prefer **incremental additions** over rewrites.
- The service registry swap point is `src/services/index.ts` — do not wire
  real API services there unless explicitly instructed.
- Mock services remain active in the mobile app until explicitly switched.

### Project layout reminder
```
WakeLink/
├── app/          Mobile screens (Expo Router) — do not modify unless asked
├── src/          Mobile source: models, services, components, store, theme
├── agent/        Windows PC Agent (Node/TypeScript)
├── backend/      Dev backend (Express/TypeScript) — DEVELOPMENT ONLY
└── docs/         Architecture and setup documentation
```

### Running each project
```powershell
# Backend
cd C:\Changes\Hobby\WakeLink\backend
npm run dev          # ts-node src/index.ts — port 3001

# Agent
cd C:\Changes\Hobby\WakeLink\agent
npm run dev          # ts-node src/index.ts

# Mobile app
cd C:\Changes\Hobby\WakeLink
npm start            # expo start

# Agent tests
cd C:\Changes\Hobby\WakeLink\agent
npm test             # jest --runInBand (45 tests baseline)

# Backend typecheck
cd C:\Changes\Hobby\WakeLink\backend
npx tsc --noEmit

# Agent typecheck
cd C:\Changes\Hobby\WakeLink\agent
npx tsc --noEmit

# Mobile typecheck
cd C:\Changes\Hobby\WakeLink
npx tsc --noEmit
```
