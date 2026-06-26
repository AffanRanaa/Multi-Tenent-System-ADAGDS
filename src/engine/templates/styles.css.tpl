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
  max-width: 960px;
  margin: 0 auto;
  width: 100%;
}

.hero { margin-bottom: 2rem; }
.hero h1 { font-size: 2rem; color: var(--primary); }
.subtitle { color: #64748b; margin-top: 0.25rem; }

.panels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1rem;
}

.panel {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-top: 4px solid var(--accent);
  border-radius: 12px;
  padding: 1.25rem;
}

.panel h2 { font-size: 1rem; margin-bottom: 0.75rem; color: var(--primary); }
.panel ul { list-style: none; }

.panel li {
  display: flex;
  justify-content: space-between;
  padding: 0.35rem 0;
  border-bottom: 1px dashed #e2e8f0;
  font-size: 0.875rem;
}
.panel li:last-child { border-bottom: none; }

.flag-on { color: #16a34a; font-weight: 600; }
.flag-off { color: #94a3b8; }

.app-footer {
  display: flex;
  justify-content: space-between;
  padding: 1rem 2rem;
  background: #0f172a;
  color: #94a3b8;
  font-size: 0.8rem;
}
