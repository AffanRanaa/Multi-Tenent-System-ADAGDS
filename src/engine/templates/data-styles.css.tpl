:root {
  --primary: {{PRIMARY_COLOR}};
  --accent: {{ACCENT_COLOR}};
  --font: {{FONT_FAMILY}};
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font);
  background: #f8fafc;
  color: #0f172a;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: var(--primary);
  color: #ffffff;
  position: sticky;
  top: 0;
  z-index: 5;
}

.logo { font-weight: 800; font-size: 1.25rem; letter-spacing: 0.5px; }

.badge {
  background: rgba(255, 255, 255, 0.2);
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  margin-left: 0.5rem;
}

.app-main {
  flex: 1;
  padding: 2rem;
  max-width: 920px;
  margin: 0 auto;
  width: 100%;
}

.hero { margin-bottom: 1.25rem; }
.hero h1 { font-size: 1.8rem; color: var(--primary); }
.subtitle { color: #64748b; margin-top: 0.25rem; font-size: 0.9rem; }

.search {
  width: 100%;
  padding: 0.7rem 0.9rem;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  font-size: 0.95rem;
  margin-bottom: 1.25rem;
  font-family: var(--font);
}
.search:focus { outline: 2px solid var(--accent); }

.records { display: flex; flex-direction: column; gap: 0.75rem; }

.record {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-left: 4px solid var(--accent);
  border-radius: 10px;
  padding: 1rem 1.15rem;
}

.record-text {
  font-size: 1.35rem;
  line-height: 1.9;
  color: #0f172a;
}

.record-sub {
  font-size: 1rem;
  line-height: 1.8;
  color: #475569;
  margin-top: 0.35rem;
}

.record-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.6rem;
}

.record-tag {
  background: #f1f5f9;
  color: var(--primary);
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  font-weight: 600;
}

.empty { color: #94a3b8; padding: 1rem 0; }

.app-footer {
  display: flex;
  justify-content: space-between;
  padding: 1rem 2rem;
  background: #0f172a;
  color: #94a3b8;
  font-size: 0.8rem;
}
