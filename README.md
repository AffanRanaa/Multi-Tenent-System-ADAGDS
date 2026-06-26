# ADAGDS — Adaptive Distributed Application Generation & Deployment System

> COMSATS University Islamabad, Lahore Campus — Parallel & Distributed Computing
> (CSC 334) Final Lab Exam, Spring 2026. CLO-5: *Develop an application using
> concepts of distributed and parallel computing.*

ADAGDS analyses real-time machine resources, **adaptively decides how many
applications (1–20) to generate**, distributes the build jobs across a
master/worker cluster, generates each application as a **fully independent
project**, deploys and launches them, and monitors the whole run on a live web
dashboard — with fault tolerance throughout.

---

## How it works

```
                 MASTER NODE (http://localhost:8080)
   Browser ──►  Dashboard + WebSocket + Reverse Proxy
                 Resource Analyzer ─► Decision Engine ─► Scheduler
                 Job Queue ─► Coordinator ─► Fault Manager ─► Deployer
                        │ HTTP job dispatch │ heartbeat / report
        ┌───────────────┼───────────────────┼───────────────┐
   Worker 5001      Worker 5002         Worker 500N   (separate Node processes)
        └──── shared App Engine / Scaffolder ───────────────┘
                        │
        /output/app1   /output/app2   …   (independent Express projects)
                        │
        http://localhost:8080/app1   /app2   (reverse-proxied, auto-launched)
```

The pipeline: **analyze → decide → schedule → dispatch in parallel → minimum
guarantee → deploy & launch**.

---

## Requirement → component map

| #  | Exam requirement                  | Implemented in |
|----|-----------------------------------|----------------|
| 1  | Single base codebase              | `src/engine/app-engine.js`, `scaffolder.js`, `engine/templates/` |
| 2  | Config-driven multi-app           | `config/tenants/*.json`, `src/common/config-loader.js` |
| 3  | Distributed job execution         | `src/master/*`, `src/worker/worker.js` (separate processes) |
| 4  | Parallel generation engine        | `src/master/coordinator.js`, `src/jobs/job-queue.js`, `src/resource/scheduler.js` |
| 5  | **Independent codebase generation** | `src/engine/scaffolder.js` → `/output/appN` |
| 6  | Multi-tenant isolation            | each app: own `.env`, `config/`, port, no shared runtime |
| 7  | Resource-aware scheduling         | `src/resource/resource-analyzer.js`, `scheduler.js` |
| 8  | Adaptive workload decision        | `src/resource/decision-engine.js` |
| 9  | Minimum execution guarantee       | `coordinator.js` (`_enforceMinimumGuarantee`, local fallback) |
| 10 | Deployment & launch               | `src/master/deployer.js` + reverse proxy in `dashboard-server.js` |
| 11 | Fault tolerance                   | `src/master/fault-manager.js`, persisted `job-queue.js` |
| 12 | Logging & monitoring              | `src/common/logger.js`, `dashboard/` |

---

## Setup

Requires **Node.js 18+**.

```
npm install
```

## Run

```
npm start
```

Then open the dashboard at **http://localhost:8080**.

1. The dashboard shows a live **Resource Analysis** snapshot.
2. Click **Start Generation**. Watch the **Adaptive Decision**, build jobs being
   distributed across workers in parallel, deployments, and the live log.
3. Generated applications appear under `/output/appN`.
4. Every generated app is auto-launched and reverse-proxied — each gets its own
   clickable link in the dashboard (`http://localhost:8080/app1`, `/app2`, …).

## Choosing how many apps to generate

**From the dashboard (easiest):** type a number in the **Apps** box in the top
bar before clicking **Start Generation**. Leave it blank for automatic mode.

**Or in config:** set `appCount` in `config/system.json` to a number or `"auto"`.

The number is still capped at 20 and reduced if the machine genuinely lacks
resources. If you request more apps than there are tenant configs, the configs
are reused cyclically.

## Uploading your own tenant config

Click **Upload Config** in the dashboard top bar and choose a `.json` file shaped
like the files in `config/tenants/`. It is validated, saved into
`config/tenants/`, and is immediately available for the next generation run —
no need to copy files into the folder manually.

## Run a generated app independently (Requirement 5)

Every generated app is a fully standalone project with **no shared runtime
dependency** on any other app:

```
cd output/app1
npm install
npm start
```

## Fault-tolerance demo (Requirement 11)

While a run is in progress, click **Kill** on any worker in the dashboard.
The worker is declared dead, its in-flight job is re-queued, and another worker
(or the local fallback executor) completes it — no job is lost.

## Low-resource / adaptive demo (Requirement 8 & 9)

Set `"forceLowResources": true` in `config/system.json` and restart.
The decision engine reports a reduced app count, and the minimum-execution
guarantee still builds at least 1–2 applications.

## Tests

```
npm test
```

Unit tests (Node's built-in `node:test`) live in `/tests`, mirroring `/src`:
decision engine, resource analyzer, job queue, config loader, and scaffolder.

---

## Project structure

```
config/system.json        system tunables
config/tenants/*.json      15 tenant specifications (the multi-app configs)
src/constants.js           all named constants
src/common/                logger, config loader, HTTP messaging
src/resource/              resource analyzer, decision engine, scheduler
src/engine/                shared app engine, scaffolder, project templates
src/jobs/                  job model + persisted job queue
src/worker/worker.js       worker node (independent process)
src/master/                master, coordinator, fault manager, deployer, dashboard
dashboard/                 live monitoring web UI
tests/                     unit tests mirroring src/
output/                    generated independent applications (created at runtime)
logs/                      run logs + persisted queue state (created at runtime)
```

Author: rafay9696@gmail.com
