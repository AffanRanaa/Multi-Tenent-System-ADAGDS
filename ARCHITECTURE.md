# ADAGDS Architecture Overview

## What this project is

ADAGDS is an Adaptive Distributed Application Generation & Deployment System.
It is built to automatically analyze available resources, decide how many
applications to generate, distribute generation work across a master/worker
cluster, generate each app as a fully independent Express project, deploy and
launch the apps, and monitor the entire process through a live dashboard.

The system is designed for a distributed systems / parallel computing lab
exercise, with a focus on resource-aware scheduling, fault tolerance, and
isolated multi-app generation.

## Core concepts

- **Master node**: the central coordinator. Runs the dashboard, resource analysis,
  decision engine, scheduler, job queue, fault manager, deployer, and reverse
  proxy.
- **Worker nodes**: separate Node.js processes that receive build jobs from the
  master and execute application scaffolding tasks in parallel.
- **Generated apps**: fully independent projects created under `/output/appN`.
  Each generated app has its own isolated config and runtime.
- **Dashboard**: browser-based UI served by the master, with real-time updates
  over WebSocket.
- **Fault tolerance**: worker failures are detected and jobs are re-queued so no
  generation work is lost.

## High-level architecture

```
                   MASTER NODE (http://localhost:8080)
   Browser ──►  Dashboard + WebSocket + Reverse Proxy
                   Resource Analyzer ─► Decision Engine ─► Scheduler
                   Job Queue ─► Coordinator ─► Fault Manager ─► Deployer
                          │ HTTP job dispatch │ heartbeat / report
       ┌───────────────┬─┬───────────────┬─┬───────────────┐
  Worker 5001      Worker 5002     Worker 500N   (separate Node processes)
       └──── shared App Engine / Scaffolder ───────────────┘
                       │
       /output/app1   /output/app2   …   (independent Express projects)
                       │
       http://localhost:8080/app1   /app2   (reverse-proxied)
```

## Execution flow

1. `npm start` runs `src/index.js`, which boots the master node.
2. The dashboard is served and WebSocket state is published to the browser.
3. When generation starts, the master analyzes host resources and calculates an
   adaptive app count.
4. A job queue is created, and build jobs are dispatched to workers.
5. Workers scaffold independent apps concurrently and report results back.
6. The master enforces a minimum application completion guarantee if needed.
7. Completed apps are deployed, launched, and exposed through the dashboard
   via proxy paths like `/app1`, `/app2`, etc.

## Key components

- `src/index.js`: project entrypoint. Boots the master.
- `src/master/`: the master orchestration layer.
- `src/worker/worker.js`: worker node process.
- `src/resource/`: resource analysis, adaptive decision making, and scheduling.
- `src/jobs/`: job model and persisted job queue.
- `src/engine/`: shared app scaffolding engine and templates.
- `src/common/`: logger, config loader, messaging utilities.
- `dashboard/`: live monitoring UI.
- `config/`: system config and tenant/app definitions.
- `output/`: generated independent application projects.
- `logs/`: runtime logs and persisted queue state.

## Master / worker interaction

- Workers register with the master and send periodic heartbeats.
- The master sends build jobs to workers via HTTP POST requests.
- Workers report success or failure back to the master.
- If a worker dies, the master re-queues its job and may reroute it to another
  worker or execute it locally.

## Generated app isolation

Each generated application is created as a standalone project in
`/output/appN`.

- Own `package.json` and runtime dependencies
- Own `config/` folder
- Own `data/` folder when applicable
- No shared runtime or memory with other generated apps
- Can be run independently after generation with `npm install` and `npm start`

## Non-database persistence

The project uses file-based persistence instead of a database:

- `config/tenants/*.json`: tenant/app input specifications
- `config/system.json`: runtime tunables and adaptive settings
- `logs/queue-state.json`: persisted job queue state for fault tolerance
- `output/appN/`: generated project files and app-specific data

## Summary

ADAGDS is a single codebase for orchestrating the parallel generation and
deployment of multiple isolated applications. It is built around a master-worker
model, uses real-time resource awareness to adapt workload size, and provides
live monitoring and fault recovery through a browser dashboard.
