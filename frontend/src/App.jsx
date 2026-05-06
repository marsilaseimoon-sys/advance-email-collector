import { useState, useRef } from "react";
import "./App.css";

const API = "http://localhost:8000";

export default function App() {
  const [urlInput, setUrlInput] = useState("");
  const [urls, setUrls] = useState([]);
  const [depth, setDepth] = useState(2);
  const [maxPages, setMaxPages] = useState(50);
  const [subpages, setSubpages] = useState(true);
  const [dedup, setDedup] = useState(true);
  const [running, setRunning] = useState(false);
  const [emails, setEmails] = useState([]);
  const [currentPage, setCurrentPage] = useState("");
  const [pagesScanned, setPagesScanned] = useState(0);
  const [filter, setFilter] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef(null);

  const addUrl = () => {
    const v = urlInput.trim();
    if (!v) return;
    const u = v.startsWith("http") ? v : "https://" + v;
    if (urls.includes(u)) return;
    setUrls([...urls, u]);
    setUrlInput("");
  };

  const removeUrl = (i) => setUrls(urls.filter((_, idx) => idx !== i));

  const startScraping = async () => {
    if (!urls.length) { setError("Kam az kam ek URL add karein"); return; }
    setRunning(true);
    setEmails([]);
    setPagesScanned(0);
    setCurrentPage("");
    setDone(false);
    setError("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`${API}/scrape-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls, depth, max_pages: maxPages, scrape_subpages: subpages, deduplicate: dedup }),
        signal: controller.signal,
      });

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === "progress") {
              setCurrentPage(data.page);
              setPagesScanned(data.pages_scanned);
            } else if (data.type === "email") {
              setEmails(prev => {
                if (dedup && prev.find(e => e.email === data.email)) return prev;
                return [...prev, { email: data.email, source: data.source }];
              });
            } else if (data.type === "done") {
              setDone(true);
            }
          } catch {}
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        setError("Backend se connect nahi hua. Backend terminal check karein.");
      }
    } finally {
      setRunning(false);
    }
  };

  const stopScraping = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const exportCSV = () => {
    const rows = ["email,source", ...emails.map(e => `${e.email},${e.source}`)].join("\n");
    dl("emails.csv", rows, "text/csv");
  };

  const exportTXT = () => dl("emails.txt", emails.map(e => e.email).join("\n"), "text/plain");

  const dl = (name, data, type) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name; a.click();
  };

  const filtered = emails.filter(e =>
    e.email.includes(filter) || e.source.includes(filter)
  );

  return (
    <div className="app">
      <div className="topbar">
        <div className="logo">⚡ Swift Email Collector</div>
        <div className="topbar-stats">
          <span>{emails.length} emails</span>
          <span>{pagesScanned} pages</span>
        </div>
      </div>

      <div className="main">
        <div className="left-panel">
          <div className="card">
            <div className="card-title">Target URLs</div>
            <div className="url-row">
              <input
                className="input"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addUrl()}
                placeholder="website.com ya https://..."
              />
              <button className="btn-add" onClick={addUrl}>+ Add</button>
            </div>
            {error && <div className="error">{error}</div>}
            <div className="tags">
              {urls.map((u, i) => (
                <div key={i} className="tag">
                  <span className="tag-text">{u.replace("https://","").replace("http://","")}</span>
                  <span className="tag-x" onClick={() => removeUrl(i)}>×</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Settings</div>
            <div className="setting-row">
              <span>Depth</span>
              <div className="slider-wrap">
                <input type="range" min="1" max="5" value={depth} onChange={e => setDepth(+e.target.value)} />
                <span className="val">{depth}</span>
              </div>
            </div>
            <div className="setting-row">
              <span>Max Pages</span>
              <div className="slider-wrap">
                <input type="range" min="10" max="200" step="10" value={maxPages} onChange={e => setMaxPages(+e.target.value)} />
                <span className="val">{maxPages}</span>
              </div>
            </div>
            <div className="checks">
              <label className="check"><input type="checkbox" checked={subpages} onChange={e => setSubpages(e.target.checked)} /> Subpages scan</label>
              <label className="check"><input type="checkbox" checked={dedup} onChange={e => setDedup(e.target.checked)} /> Duplicates hatao</label>
            </div>
          </div>

          <button
            className={`run-btn ${running ? "stop" : ""}`}
            onClick={running ? stopScraping : startScraping}
          >
            {running ? "⏹ Stop" : "▶ Run Scraper"}
          </button>

          {running && (
            <div className="progress-card">
              <div className="scanning-label">Scanning...</div>
              <div className="current-page">{currentPage}</div>
              <div className="pulse-bar"><div className="pulse-inner" /></div>
            </div>
          )}

          {done && <div className="done-msg">✅ Complete! {emails.length} emails mili</div>}
        </div>

        <div className="right-panel">
          <div className="results-header">
            <div className="results-title">
              Emails <span className="badge">{filtered.length}</span>
            </div>
            <div className="export-btns">
              <button className="exp-btn" onClick={exportCSV} disabled={!emails.length}>CSV</button>
              <button className="exp-btn" onClick={exportTXT} disabled={!emails.length}>TXT</button>
            </div>
          </div>
          <input
            className="input search"
            placeholder="Filter karein..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          <div className="email-list">
            {filtered.length === 0 && (
              <div className="empty">
                {running ? "Emails dhundh raha hai..." : "Koi email nahi mili abhi tak"}
              </div>
            )}
            {filtered.map((e, i) => (
              <div key={i} className={`email-row ${i % 2 === 0 ? "even" : ""}`}>
                <div className="email-addr">{e.email}</div>
                <div className="email-src">{e.source.replace(/https?:\/\//,"").slice(0,40)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
