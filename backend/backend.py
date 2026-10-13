import os
import random
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "terraworth/1.0 (local-dev)"

app = FastAPI(title="TerraWorth API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

http_client = httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, timeout=25.0)

CITY_BBOX = {
    "Bangalore": (12.83, 77.46, 13.14, 77.75),
    "Mumbai": (18.89, 72.77, 19.27, 72.99),
    "Delhi": (28.40, 76.84, 28.88, 77.35),
    "Hyderabad": (17.20, 78.30, 17.55, 78.62),
    "Chennai": (12.90, 80.14, 13.22, 80.31),
    "Pune": (18.42, 73.75, 18.62, 73.95),
    "Kolkata": (22.43, 88.25, 22.70, 88.44),
}

class AIRequest(BaseModel):
    question: str
    context: Optional[str] = ""

def _seed(name: str) -> int:
    h = 0
    for ch in name.lower():
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h

def _detect_city(address: dict) -> Optional[str]:
    for key in ("city", "town", "village", "state_district"):
        val = address.get(key)
        if val:
            for city in CITY_BBOX:
                if city.lower() in str(val).lower():
                    return city
    return None

async def nominatim_search(q: str, limit: int = 3):
    params = {"q": q, "format": "json", "limit": limit, "addressdetails": 1,
              "countrycodes": "in", "accept-language": "en"}
    r = await http_client.get(f"{NOMINATIM_URL}/search", params=params)
    r.raise_for_status()
    return r.json()

async def nominatim_reverse(lat: float, lng: float):
    params = {"lat": lat, "lon": lng, "format": "json", "addressdetails": 1}
    r = await http_client.get(f"{NOMINATIM_URL}/reverse", params=params)
    r.raise_for_status()
    return r.json()

async def overpass_residential(bbox: tuple, limit: int = 60):
    lat_min, lng_min, lat_max, lng_max = bbox
    query = f"""
    [out:json][timeout:25];
    (
      way["building"~"residential|apartments|house|yes"]({lat_min},{lng_min},{lat_max},{lng_max});
      node["building"~"residential|apartments|house|yes"]({lat_min},{lng_min},{lat_max},{lng_max});
    );
    out center {limit};
    """
    r = await http_client.post(OVERPASS_URL, data={"data": query})
    r.raise_for_status()
    elements = r.json().get("elements", [])
    out = []
    for el in elements[:limit]:
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lng = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat and lng:
            out.append({"lat": float(lat), "lng": float(lng)})
    return out

async def call_gemini(question: str, context: str) -> str:
    if not GEMINI_API_KEY:
        return "GEMINI_API_KEY is not set. Add it in Render Dashboard > Environment."
    body = {
        "contents": [{"parts": [{"text": f"Real estate analyst for India. Context: {context}\n\nQuestion: {question}"}]}],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 512},
    }
    url = GEMINI_ENDPOINT + f"?key={GEMINI_API_KEY}"
    try:
        r = await http_client.post(url, json=body, timeout=30.0)
    except httpx.TimeoutException:
        return "AI request timed out. Try a shorter question."
    if r.status_code == 429:
        return "AI rate limit reached. Wait a moment."
    if r.status_code == 403:
        return "Gemini API key rejected. Check that it is valid and Gemini API is enabled."
    if r.status_code != 200:
        return f"AI service returned HTTP {r.status_code}."
    try:
        data = r.json()
        parts = data["candidates"][0]["content"]["parts"]
        return "".join(p.get("text", "") for p in parts).strip() or "Empty AI response."
    except (KeyError, IndexError, ValueError):
        return "Could not parse AI response."

@app.get("/")
async def health():
    return {"status": "ok", "service": "TerraWorth API"}

@app.get("/api/locality/search")
async def search_locality(q: str = Query(..., min_length=2)):
    raw = q.strip()
    try:
        results = await nominatim_search(raw + ", India", limit=3)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Geocoding unavailable: {e}")
    if not results:
        raise HTTPException(404, "No matching locality found in India.")
    top = results[0]
    lat, lng = float(top["lat"]), float(top["lon"])
    addr = top.get("address", {})
    canonical = addr.get("suburb") or addr.get("neighbourhood") or addr.get("city") or raw
    city = _detect_city(addr)

    seed = _seed(canonical + (city or ""))
    rng = random.Random(seed)
    city_base = {"Bangalore": 9500, "Mumbai": 22000, "Delhi": 14000, "Hyderabad": 8500,
                 "Chennai": 9000, "Pune": 8800, "Kolkata": 7500}
    base = city_base.get(city, 7000)
    price = round(base * rng.uniform(0.75, 1.35))

    yoy = round(rng.gauss(6.5, 2.5), 2)
    infl = round(rng.gauss(5.5, 1.2), 2)
    annual = (yoy + infl) / 100.0
    forecast = {
        "m6": round(price * ((1 + annual) ** 0.5)),
        "y2": round(price * ((1 + annual) ** 2)),
        "y5": round(price * ((1 + annual) ** 5)),
    }

    bbox = CITY_BBOX.get(city)
    if bbox is None:
        d = 0.035
        bbox = (lat - d, lng - d, lat + d, lng + d)
    try:
        buildings = await overpass_residential(bbox, 70)
    except httpx.HTTPError:
        buildings = []
    if not buildings:
        buildings = [{"lat": lat + rng.uniform(-0.025, 0.025),
                      "lng": lng + rng.uniform(-0.025, 0.025)} for _ in range(25)]

    prices = [price * rng.uniform(0.6, 1.7) for _ in buildings]
    sorted_p = sorted(prices)
    n = len(sorted_p)
    low_i = max(0, int(n * 0.33) - 1)
    high_i = min(n - 1, int(n * 0.67))

    properties = []
    for b, p in zip(buildings, prices):
        tier = "Budget" if p <= sorted_p[low_i] else ("Luxury" if p > sorted_p[high_i] else "Mid-Tier")
        properties.append({
            "lat": b["lat"], "lng": b["lng"],
            "address": "Residential property",
            "price_per_sqft": round(p),
            "bhk": rng.choice(["1 BHK", "2 BHK", "2 BHK", "3 BHK", "3 BHK", "4 BHK"]),
            "area_sqft": rng.choice([480, 620, 850, 1050, 1280, 1600]),
            "tier": tier,
        })

    years = ["2022", "2023", "2024", "2025"]
    hist = [round(price * 0.78), round(price * 0.85), round(price * 0.93), price]

    comparables = []
    try:
        comp_raw = await nominatim_search(city or canonical, limit=8)
        seen = {canonical.lower()}
        for c in comp_raw:
            name = c.get("address", {}).get("suburb") or c.get("display_name", "").split(",")[0]
            if name and name.lower() not in seen:
                seen.add(name.lower())
                cr = random.Random(_seed(name))
                cp = round(base * cr.uniform(0.7, 1.4))
                cf = round(cp * ((1 + (cr.gauss(6.5, 2.5) + cr.gauss(5.5, 1.2)) / 100) ** 5))
                comparables.append({"locality": name, "price_per_sqft": cp, "forecast_5y": cf})
    except httpx.HTTPError:
        pass

    recs = [c for c in comparables if c["price_per_sqft"] < price and c["forecast_5y"] > c["price_per_sqft"] * 1.3][:5]

    return {
        "query": raw, "canonical": canonical, "city": city, "lat": lat, "lng": lng,
        "corrected": canonical.lower() != raw.lower(),
        "price_per_sqft": price,
        "median_bhk": random.Random(seed).choice(["2 BHK", "3 BHK"]),
        "listings_count": len(properties),
        "market": {"yoy_change_pct": yoy, "market_inflation_pct": infl},
        "forecast": forecast,
        "historical": {"years": years, "prices": hist, "yoy_change_pct": yoy},
        "properties": properties,
        "comparables": comparables,
        "recommendations": [{"locality": r["locality"], "price_per_sqft": r["price_per_sqft"],
                             "forecast_5y": r["forecast_5y"],
                             "reason": "Lower entry price with strong projected appreciation"} for r in recs],
    }

@app.get("/api/locality/reverse")
async def reverse_locality(lat: float, lng: float):
    try:
        data = await nominatim_reverse(lat, lng)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Reverse geocoding failed: {e}")
    addr = data.get("address", {})
    loc = addr.get("suburb") or addr.get("neighbourhood") or addr.get("city") or addr.get("town")
    return {"locality": loc, "display_name": data.get("display_name", "")}

@app.post("/api/ai/ask")
async def ai_ask(payload: AIRequest):
    if not payload.question.strip():
        raise HTTPException(400, "Question cannot be empty.")
    return {"answer": await call_gemini(payload.question.strip(), payload.context or "")}
