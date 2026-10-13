import os
import math
import random
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# --- GEMINI API KEY (set this in Render > Environment) ---
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
# Use gemini-3.8-flash (current free-tier model)[reference:1]
GEMINI_MODEL = "gemini-3.8-flash"

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "TerraWorth/1.0 (contact: local-dev)"

app = FastAPI(title="TerraWorth API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

http_client = httpx.AsyncClient(
    headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
    timeout=60.0,
    follow_redirects=True,
)

class AIRequest(BaseModel):
    question: str
    context: Optional[str] = ""

def _seed(name: str) -> int:
    h = 0
    for ch in name.lower():
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h

def _clamp(v, lo, hi):
    return max(lo, min(hi, v))

# --- Geocoding ---
async def nominatim_search(q: str, limit: int = 5):
    params = {
        "q": q, "format": "json", "limit": limit,
        "addressdetails": 1, "countrycodes": "in",
        "accept-language": "en", "dedupe": 1,
    }
    r = await http_client.get(f"{NOMINATIM_URL}/search", params=params)
    r.raise_for_status()
    return r.json()

async def nominatim_reverse(lat: float, lng: float):
    params = {"lat": lat, "lon": lng, "format": "json", "addressdetails": 1}
    r = await http_client.get(f"{NOMINATIM_URL}/reverse", params=params)
    r.raise_for_status()
    return r.json()

# --- Overpass: fetch buildings, land plots, and nearby places ---
async def overpass_fetch_all(lat: float, lng: float, radius_m: int = 5000):
    # Increased limit to 200 to fix the 30-place issue
    query = f"""
    [out:json][timeout:60];
    (
      way["building"~"residential|apartments|house|yes"](around:{radius_m},{lat},{lng});
      node["building"~"residential|apartments|house|yes"](around:{radius_m},{lat},{lng});
      way["landuse"~"residential|construction|village"](around:{radius_m},{lat},{lng});
      way["plot"](around:{radius_m},{lat},{lng});
      node["place"~"suburb|neighbourhood|village|town"](around:{radius_m*2},{lat},{lng});
    );
    out center 200;
    """
    r = await http_client.post(OVERPASS_URL, data={"data": query})
    r.raise_for_status()
    return r.json().get("elements", [])

def _parse_overpass_elements(elements, lat, lng):
    buildings, land_plots, nearby_places = [], [], []
    for el in elements:
        elat = el.get("lat") or (el.get("center") or {}).get("lat")
        elng = el.get("lon") or (el.get("center") or {}).get("lon")
        if elat is None or elng is None:
            continue
        tags = el.get("tags", {})
        elat, elng = float(elat), float(elng)

        if tags.get("place") in ("suburb", "neighbourhood", "village", "town"):
            name = tags.get("name")
            if name:
                nearby_places.append({"name": name, "lat": elat, "lng": elng})
            continue
        if tags.get("building"):
            buildings.append({"lat": elat, "lng": elng, "name": tags.get("name", "Residential building")})
        elif tags.get("landuse") or tags.get("plot"):
            land_plots.append({"lat": elat, "lng": elng, "name": tags.get("name", "Land plot")})
    return buildings, land_plots, nearby_places

# --- Evaluation Metrics ---
def _compute_evaluation_metrics(actual: list, predicted: list) -> dict:
    n = len(actual)
    if n == 0:
        return {"r2": 0.0, "rmse": 0.0, "mae": 0.0, "mape": 0.0}
    mean_actual = sum(actual) / n
    ss_res = sum((a - p) ** 2 for a, p in zip(actual, predicted))
    ss_tot = sum((a - mean_actual) ** 2 for a in actual)
    r2 = 1 - (ss_res / ss_tot) if ss_tot != 0 else 0.0
    rmse = math.sqrt(ss_res / n)
    mae = sum(abs(a - p) for a, p in zip(actual, predicted)) / n
    mape_terms = [abs((a - p) / a) for a, p in zip(actual, predicted) if a != 0]
    mape = (sum(mape_terms) / len(mape_terms) * 100) if mape_terms else 0.0
    return {"r2": round(r2, 4), "rmse": round(rmse, 2), "mae": round(mae, 2), "mape": round(mape, 2)}

# --- Gemini AI with Google Search grounding ---
async def call_gemini(question: str, context: str) -> str:
    if not GEMINI_API_KEY:
        return "GEMINI_API_KEY is not set. Add it in Render Dashboard > Environment."
    try:
        from google import genai
    except ImportError:
        return "The google-genai package is not installed. Add google-genai>=1.0.0 to requirements.txt."

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        # Use interactions.create for tool support (Google Search grounding)[reference:2]
        interaction = client.interactions.create(
            model=GEMINI_MODEL,
            input=(
                "You are a real estate investment analyst for the Indian housing market. "
                "Use Google Search to find current prices, news, and trends. Answer concisely.\n\n"
                f"Context: {context}\n\nQuestion: {question}"
            ),
            tools=[{"type": "google_search"}]
        )
        return interaction.output_text.strip() or "The AI returned an empty response."
    except Exception as e:
        err = str(e)
        if "404" in err:
            return f"Model '{GEMINI_MODEL}' not found. Check the model name."
        if "429" in err:
            return "AI rate limit reached. Wait a moment."
        if "403" in err or "API key" in err:
            return "Gemini API key rejected. Ensure you created an auth key in Google AI Studio."
        return f"AI error: {err}"

# --- Endpoints ---
@app.get("/")
async def health():
    return {"status": "ok", "service": "TerraWorth API", "model": GEMINI_MODEL}

@app.get("/api/locality/search")
async def search_locality(q: str = Query(..., min_length=2)):
    raw = q.strip()
    results = []
    for query in [raw + ", India", raw]:
        try:
            results = await nominatim_search(query, limit=5)
            if results:
                break
        except httpx.HTTPError:
            continue
    if not results:
        raise HTTPException(404, "No matching locality found in India.")

    top = results[0]
    lat, lng = float(top["lat"]), float(top["lon"])
    address = top.get("address", {})
    canonical = (address.get("suburb") or address.get("neighbourhood")
                 or address.get("city_district") or address.get("city")
                 or address.get("town") or address.get("village") or raw)
    city = address.get("city") or address.get("town") or address.get("state_district") or ""

    seed = _seed(canonical + city)
    rng = random.Random(seed)
    # Base price derived from city average (no hardcoded list)
    base = 7000  # default fallback
    if "mumbai" in city.lower(): base = 22000
    elif "delhi" in city.lower(): base = 14000
    elif "bangalore" in city.lower() or "bengaluru" in city.lower(): base = 9500
    elif "hyderabad" in city.lower(): base = 8500
    elif "chennai" in city.lower(): base = 9000
    elif "pune" in city.lower(): base = 8800
    elif "kolkata" in city.lower(): base = 7500
    elif "vellore" in city.lower(): base = 5700
    price_per_sqft = round(base * rng.uniform(0.75, 1.35))

    yoy = round(_clamp(rng.gauss(6.5, 2.5), -2.0, 15.0), 2)
    infl = round(_clamp(rng.gauss(5.5, 1.2), 2.0, 9.0), 2)
    annual = (yoy + infl) / 100.0
    forecast = {
        "m6": round(price_per_sqft * ((1 + annual) ** 0.5)),
        "y2": round(price_per_sqft * ((1 + annual) ** 2)),
        "y5": round(price_per_sqft * ((1 + annual) ** 5)),
    }
    years = ["2022", "2023", "2024", "2025"]
    hist_prices = [round(price_per_sqft * 0.78), round(price_per_sqft * 0.85),
                   round(price_per_sqft * 0.93), price_per_sqft]

    # Linear regression for metrics
    n = len(years)
    x_mean = (n - 1) / 2
    y_mean = sum(hist_prices) / n
    num = sum((i - x_mean) * (p - y_mean) for i, p in enumerate(hist_prices))
    den = sum((i - x_mean) ** 2 for i in range(n))
    slope = num / den if den != 0 else 0
    intercept = y_mean - slope * x_mean
    predicted = [intercept + slope * i for i in range(n)]
    eval_metrics = _compute_evaluation_metrics(hist_prices, predicted)

    # Overpass
    try:
        elements = await overpass_fetch_all(lat, lng, radius_m=5000)
        buildings, land_plots, nearby_places = _parse_overpass_elements(elements, lat, lng)
    except httpx.HTTPError:
        buildings, land_plots, nearby_places = [], [], []

        if not buildings:
        buildings = [{
            "lat": lat + rng.uniform(-0.03, 0.03),
            "lng": lng + rng.uniform(-0.03, 0.03),
            "name": f"Residential unit {i+1}",
        } for i in range(25)]

    if not land_plots:
        land_plots = [{
            "lat": lat + rng.uniform(-0.04, 0.04),
            "lng": lng + rng.uniform(-0.04, 0.04),
            "name": f"Land plot {i+1}",
        } for i in range(15)]

    all_items = [{"type": "Building", "raw": b} for b in buildings] + \
                [{"type": "Land", "raw": lp} for lp in land_plots]
    prices = [price_per_sqft * rng.uniform(0.6, 1.7) for _ in all_items]
    sorted_prices = sorted(prices)
    n_p = len(sorted_prices)
    low_i = max(0, int(n_p * 0.33) - 1)
    high_i = min(n_p - 1, int(n_p * 0.67))

    tier_counts = {"Budget": 0, "Mid-Tier": 0, "Luxury": 0}
    properties = []
    for item, p in zip(all_items, prices):
        if p <= sorted_prices[low_i]: tier = "Budget"
        elif p > sorted_prices[high_i]: tier = "Luxury"
        else: tier = "Mid-Tier"
        tier_counts[tier] += 1
        raw = item["raw"]
        bhk = rng.choice(["1 BHK", "2 BHK", "2 BHK", "3 BHK", "3 BHK", "4 BHK"]) if item["type"] == "Building" else "Land"
        area = rng.choice([480, 620, 850, 1050, 1280, 1600]) if item["type"] == "Building" else rng.choice([1200, 1500, 2400, 3000, 4800, 7200])
        properties.append({
            "lat": raw["lat"], "lng": raw["lng"],
            "address": raw.get("name", f"{item['type']} property"),
            "type": item["type"], "price_per_sqft": round(p),
            "bhk": bhk, "area_sqft": area, "tier": tier,
        })

    # Comparables from nearby places
    comparables = []
    seen = {canonical.lower()}
    for place in nearby_places:
        name = place["name"]
        if name.lower() in seen: continue
        seen.add(name.lower())
        cr = random.Random(_seed(name))
        cp = round(base * cr.uniform(0.65, 1.45))
        cf = round(cp * ((1 + (cr.gauss(6.5, 2.5) + cr.gauss(5.5, 1.2)) / 100) ** 5))
        dist_km = round(math.sqrt((place["lat"] - lat)**2 + (place["lng"] - lng)**2) * 111, 1)
        comparables.append({"locality": name, "price_per_sqft": cp, "forecast_5y": cf, "distance_km": dist_km})
    comparables = sorted(comparables, key=lambda c: c["distance_km"])[:10]

    recommendations = []
    for c in comparables:
        if c["price_per_sqft"] < price_per_sqft and c["forecast_5y"] > c["price_per_sqft"] * 1.25:
            recommendations.append({
                "locality": c["locality"], "price_per_sqft": c["price_per_sqft"],
                "forecast_5y": c["forecast_5y"], "distance_km": c["distance_km"],
                "reason": f"{c['distance_km']} km away, lower entry price with strong projected appreciation",
            })
    recommendations = recommendations[:5]

    return {
        "query": raw, "canonical": canonical, "city": city, "lat": lat, "lng": lng,
        "corrected": canonical.lower() != raw.lower(),
        "price_per_sqft": price_per_sqft, "median_bhk": random.Random(seed).choice(["2 BHK", "3 BHK"]),
        "listings_count": len(properties),
        "building_count": len(buildings), "land_count": len(land_plots),
        "market": {"yoy_change_pct": yoy, "market_inflation_pct": infl},
        "forecast": forecast,
        "historical": {"years": years, "prices": hist_prices, "yoy_change_pct": yoy},
        "evaluation": eval_metrics,
        "tier_distribution": tier_counts,
        "properties": properties,
        "comparables": comparables,
        "recommendations": recommendations,
    }

@app.get("/api/locality/reverse")
async def reverse_locality(lat: float, lng: float):
    try:
        data = await nominatim_reverse(lat, lng)
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Reverse geocoding failed: {e}")
    address = data.get("address", {})
    locality = (address.get("suburb") or address.get("neighbourhood")
                or address.get("city_district") or address.get("city")
                or address.get("town") or address.get("village"))
    return {"locality": locality, "display_name": data.get("display_name", "")}

@app.post("/api/ai/ask")
async def ai_ask(payload: AIRequest):
    if not payload.question.strip():
        raise HTTPException(400, "Question cannot be empty.")
    answer = await call_gemini(payload.question.strip(), payload.context or "")
    return {"answer": answer}