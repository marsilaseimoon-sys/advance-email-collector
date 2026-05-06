from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List
import asyncio
import aiohttp
import re
import json
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup

app = FastAPI(title="Advance Email Collector API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

EMAIL_REGEX = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

class ScrapeRequest(BaseModel):
    urls: List[str]
    depth: int = 2
    scrape_subpages: bool = True
    deduplicate: bool = True
    max_pages: int = 50

async def fetch_page(session, url):
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=15), headers=HEADERS, ssl=False) as resp:
            if resp.status == 200:
                ct = resp.headers.get("content-type", "")
                if "html" in ct or "text" in ct:
                    return await resp.text(errors="ignore")
    except Exception:
        pass
    return ""

def extract_emails(html, url):
    emails = EMAIL_REGEX.findall(html)
    # Also check mailto links
    soup = BeautifulSoup(html, "html.parser")
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if href.startswith("mailto:"):
            email = href.replace("mailto:", "").split("?")[0].strip()
            if email:
                emails.append(email)
    return list(set(e.lower() for e in emails if "." in e.split("@")[-1] if len(e) < 100))

def extract_links(html, base_url):
    soup = BeautifulSoup(html, "html.parser")
    base_domain = urlparse(base_url).netloc
    links = set()
    for tag in soup.find_all("a", href=True):
        full = urljoin(base_url, tag["href"])
        parsed = urlparse(full)
        if parsed.netloc == base_domain and parsed.scheme in ("http", "https"):
            links.add(full.split("#")[0])
    return list(links)

@app.post("/scrape-stream")
async def scrape_stream(req: ScrapeRequest):
    async def generate():
        all_emails = {}
        total_pages = 0
        visited = set()

        async with aiohttp.ClientSession() as session:
            for start_url in req.urls:
                queue = [(start_url, 0)]

                while queue and total_pages < req.max_pages:
                    url, level = queue.pop(0)
                    if url in visited:
                        continue
                    visited.add(url)
                    total_pages += 1

                    # Send progress update
                    yield json.dumps({
                        "type": "progress",
                        "page": url,
                        "pages_scanned": total_pages,
                        "emails_found": len(all_emails)
                    }) + "\n"

                    html = await fetch_page(session, url)
                    if not html:
                        continue

                    new_emails = extract_emails(html, url)
                    for email in new_emails:
                        if email not in all_emails:
                            all_emails[email] = url
                            # Send new email found
                            yield json.dumps({
                                "type": "email",
                                "email": email,
                                "source": url
                            }) + "\n"

                    if req.scrape_subpages and level < req.depth:
                        links = extract_links(html, start_url)
                        for link in links[:20]:
                            if link not in visited:
                                queue.append((link, level + 1))

                    await asyncio.sleep(0.1)

        yield json.dumps({
            "type": "done",
            "total_pages": total_pages,
            "total_emails": len(all_emails)
        }) + "\n"

    return StreamingResponse(generate(), media_type="text/plain")

@app.get("/health")
def health():
    return {"status": "ok"}
