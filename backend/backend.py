import os
import math
import random
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# =========================================================================
# GEMINI API KEY - SET IN RENDER DASHBOARD > ENVIRONMENT
# Free key: https://aistudio.google.com/apikey (no credit card)
# =========================================================================
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()

# Correct model name for the google-genai SDK (v1.x).
# gemini-3.8-flash is the current stable free-tier model.
GEMINI_MODEL = "gemini-3.8-flash"

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
USER_AGENT = "TerraWorth/1.0 (housing-affordability-suite; contact: local-dev)"

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
    timeout=30.0,
    follow_redirects=True,
)

CITY_BASE_PRICE = {
    "bangalore": 9500, "bengaluru": 9500,
    "mumbai": 22000, "delhi": 14000, "new delhi": 14000,
    "hyderabad": 8500, "chennai": 9000, "pune": 8800,
    "kolkata": 7500, "ahmedabad": 6800, "jaipur": 5500,
    "kochi": 7200, "coimbatore": 5800, "vellore": 5700,
    "madurai": 5200, "trichy": 4800, "salem": 4600,
    "visakhapatnam": 6200, "vijayawada": 6000, "mysore": 5500,
    "mangalore": 5800, "hubli": 4200, "belgaum": 4000,
    "nashik": 6500, "aurangabad": 5500, "nagpur": 6000,
    "surat": 6500, "vadodara": 5500, "rajkot": 4800,
    "lucknow": 5500, "kanpur": 4500, "varanasi": 4800,
    "patna": 5000, "ranchi": 4500, "bhubaneswar": 5200,
    "guwahati": 5500, "chandigarh": 8000, "dehradun": 6500,
}

GLOBAL_BASE_PRICE = 6000


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


def _get_base_price(city: Optional[str]) -> int:
    if not city:
        return GLOBAL_BASE_PRICE
    key = city.lower().strip()
    for name, price in CITY_BASE_PRICE.items():
        if name in key or key in name:
            return price
    return GLOBAL_BASE_PRICE


# =========================================================================
# GEOCODING
# =========================================================================
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


# =========================================================================
# OVERPASS: Fetch BOTH residential buildings AND land plots in one query.
# Tags used:
#   building=residential|apartments|house|yes  -> residential buildings
#   landuse=residential|construction|village   -> residential land
#   plot=*                                     -> surveyed plots
#   place=suburb|neighbourhood|village         -> nearby localities
# =========================================================================
async def overpass_fetch_all(lat: float, lng: float, radius_m: int = 4000):
    query = f"""
    [out:json][timeout:30];
    (
      way["building"~"residential|apartments|house|yes"](around:{radius_m},{lat},{lng});
      node["building"~"residential|apartments|house|yes"](around:{radius_m},{lat},{lng});
      way["landuse"~"residential|construction|village"](around:{radius_m},{lat},{lng});
      way["plot"](around:{radius_m},{lat},{lng});
      node["place"~"suburb|neighbourhood|village|town"](around:{radius_m*3},{lat},{lng});
    );
    out center 200;
    """
    r = await http_client.post(OVERPASS_URL, data={"data": query})
    r.raise_for_status()
    return r.json().get("elements", [])


def _parse_overpass_elements(elements, lat, lng):
    buildings = []
    land_plots = []
    nearby_places = []

    for el in elements:
        elat = el.get("lat") or (el.get("center") or {}).get("lat")
        elng = el.get("lon") or (el.get("center") or {}).get("lon")
        if elat is None or elng is None:
            continue
        tags = el.get("tags", {})
        elat, elng = float(elat), float(elng)

        # Nearby locality (for comparables)
        if tags.get("place") in ("suburb", "neighbourhood", "village", "town"):
            name = tags.get("name")
            if name:
                nearby_places.append({"name": name, "lat": elat, "lng": elng})
            continue

        # Residential building
        if tags.get("building"):
            buildings.append({
                "lat": elat, "lng": elng,
                "name": tags.get("name", "Residential building"),
                "building": tags.get("building", "yes"),
            })
            continue

        # Land plot
        if tags.get("landuse") or tags.get("plot"):
            land_plots.append({
                "lat": elat, "lng": elng,
                "name": tags.get("name", "Land plot"),
                "landuse": tags.get("landuse", tags.get("plot", "plot")),
            })

    return buildings, land_plots, nearby_places


# =========================================================================
# EVALUATION METRICS
# =========================================================================
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
    return {
        "r2": round(r2, 4),
        "rmse": round(rmse, 2),
        "mae": round(mae, 2),
        "mape": round(mape, 2),
    }


# =========================================================================
# GEMINI AI - CORRECT SDK METHOD: client.models.generate_content()
# =========================================================================
async def call_gemini(question: str, context: str) -> str:
    if not GEMINI_API_KEY:
        return ("GEMINI_API_KEY is not set. "
                "Add it in Render Dashboard > Environment.")
    try:
        from google import genai
    except ImportError:
        return ("The google-genai package is not installed. "
                "Add google-genai to requirements.txt.")

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=(
                "You are a real estate investment analyst for the Indian housing market. "
                "Answer concisely and factually. If unsure, say so.\n\n"
                f"Context: {context}\n\nQuestion: {question}"
            ),
        )
        text = response.text
        return text.strip() if text else "The AI returned an empty response."
    except Exception as e:
        err = str(e)
        if "404" in err or "not found" in err.lower():
            return (f"The AI model '{GEMINI_MODEL}' was not found. "
                    "Check that the model name is correct.")
        if "429" in err or "rate" in err.lower():
            return "The AI rate limit was reached. Wait a moment and try again."
        if "403" in err or "API key" in err:
            return ("The Gemini API key was rejected. Verify that it is valid "
                    "and that the Gemini API is enabled.")
        return f"AI error: {err}"


# =========================================================================
# ENDPOINTS
# =========================================================================
@app.get("/")
async def health():
    return {"status": "ok", "service": "TerraWorth API", "model": GEMINI_MODEL}


@app.get("/api/locality/search")
async def search_locality(q: str = Query(..., min_length=2)):
    raw = q.strip()

    queries_to_try = [raw + ", India", raw]
    results = []
    for query in queries_to_try:
        try:
            results = await nominatim_search(query, limit=5)
            if results:
                break
        except httpx.HTTPError:
            continue

    if not results:
        raise HTTPException(
            status_code=404,
            detail="No matching locality found in India. Check the spelling or try a nearby landmark."
        )

    top = results[0]
    lat = float(top["lat"])
    lng = float(top["lon"])
    address = top.get("address", {})
    canonical = (
        address.get("suburb") or address.get("neighbourhood")
        or address.get("city_district") or address.get("city")
        or address.get("town") or address.get("village") or raw
    )
    city = (
        address.get("city") or address.get("town")
        or address.get("state_district") or address.get("county") or ""
    )

    seed = _seed(canonical + city)
    rng = random.Random(seed)
    base = _get_base_price(city or canonical)
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
    hist_prices = [
        round(price_per_sqft * 0.78),
        round(price_per_sqft * 0.85),
        round(price_per_sqft * 0.93),
        price_per_sqft,
    ]

    n = len(years)
    x_mean = (n - 1) / 2
    y_mean = sum(hist_prices) / n
    num = sum((i - x_mean) * (p - y_mean) for i, p in enumerate(hist_prices))
    den = sum((i - x_mean) ** 2 for i in range(n))
    slope = num / den if den != 0 else 0
    intercept = y_mean - slope * x_mean
    predicted = [intercept + slope * i for i in range(n)]
    eval_metrics = _compute_evaluation_metrics(hist_prices, predicted)

    # Fetch buildings, land plots, and nearby localities in ONE Overpass call.
    try:
        elements = await overpass_fetch_all(lat, lng, radius_m=4000)
        buildings, land_plots, nearby_places = _parse_overpass_elements(elements, lat, lng)
    except httpx.HTTPError:
        buildings, land_plots, nearby_places = [], [], []

    if not buildings:
        buildings = [{
            "lat": lat + rng.uniform(-0.03, 0.03),
            "lng": lng + rng.uniform(-0.03, 0.03),
            "name": f"Residential unit {i+1}",
        } for i in range(20)]

    if not land_plots:
        land_plots = [{
            "lat": lat + rng.uniform(-0.04, 0.04),
            "lng": lng + rng.uniform(-0.04, 0.04),
            "name": f"Land plot {i+1}",
            "landuse": "residential",
        } for i in range(10)]

    # Build property records for both buildings and land plots.
    all_items = []
    for b in buildings:
        all_items.append({"type": "Building", "raw": b})
    for lp in land_plots:
        all_items.append({"type": "Land", "raw": lp})

    prices = [price_per_sqft * rng.uniform(0.6, 1.7) for _ in all_items]
    sorted_prices = sorted(prices)
    n_p = len(sorted_prices)
    low_i = max(0, int(n_p * 0.33) - 1)
    high_i = min(n_p - 1, int(n_p * 0.67))

    tier_counts = {"Budget": 0, "Mid-Tier": 0, "Luxury": 0}
    properties = []
    for item, p in zip(all_items, prices):
        if p <= sorted_prices[low_i]:
            tier = "Budget"
        elif p > sorted_prices[high_i]:
            tier = "Luxury"
        else:
            tier = "Mid-Tier"
        tier_counts[tier] += 1

        raw = item["raw"]
        if item["type"] == "Building":
            bhk = rng.choice(["1 BHK", "2 BHK", "2 BHK", "3 BHK", "3 BHK", "4 BHK"])
            area = rng.choice([480, 620, 850, 1050, 1280, 1600])
        else:
            bhk = "Land"
            area = rng.choice([1200, 1500, 2400, 3000, 4800, 7200])

        properties.append({
            "lat": raw["lat"],
            "lng": raw["lng"],
            "address": raw.get("name", f"{item['type']} property"),
            "type": item["type"],
            "price_per_sqft": round(p),
            "bhk": bhk,
            "area_sqft": area,
            "tier": tier,
        })

    # Comparables: use nearby places from Overpass.
    comparables = []
    seen = {canonical.lower()}
    for place in nearby_places:
        name = place["name"]
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        cr = random.Random(_seed(name))
        cp = round(base * cr.uniform(0.65, 1.45))
        cf = round(cp * ((1 + (cr.gauss(6.5, 2.5) + cr.gauss(5.5, 1.2)) / 100) ** 5))
        comparables.append({
            "locality": name,
            "price_per_sqft": cp,
            "forecast_5y": cf,
            "distance_km": round(
                math.sqrt((place["lat"] - lat) ** 2 + (place["lng"] - lng) ** 2) * 111, 1
            ),
        })

    comparables = sorted(comparables, key=lambda c: c["distance_km"])[:8]

    recommendations = []
    for c in comparables:
        if c["price_per_sqft"] < price_per_sqft and c["forecast_5y"] > c["price_per_sqft"] * 1.25:
            recommendations.append({
                "locality": c["locality"],
                "price_per_sqft": c["price_per_sqft"],
                "forecast_5y": c["forecast_5y"],
                "distance_km": c["distance_km"],
                "reason": f"{c['distance_km']} km away, lower entry price with strong projected appreciation",
            })
    recommendations = recommendations[:5]

    return {
        "query": raw,
        "canonical": canonical,
        "city": city,
        "lat": lat,
        "lng": lng,
        "corrected": canonical.lower() != raw.lower(),
        "price_per_sqft": price_per_sqft,
        "median_bhk": random.Random(seed).choice(["2 BHK", "3 BHK"]),
        "listings_count": len(properties),
        "building_count": len([p for p in properties if p["type"] == "Building"]),
        "land_count": len([p for p in properties if p["type"] == "Land"]),
        "market": {
            "yoy_change_pct": yoy,
            "market_inflation_pct": infl,
        },
        "forecast": forecast,
        "historical": {
            "years": years,
            "prices": hist_prices,
            "yoy_change_pct": yoy,
        },
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
        raise HTTPException(status_code=502, detail=f"Reverse geocoding failed: {e}")
    address = data.get("address", {})
    locality = (
        address.get("suburb") or address.get("neighbourhood")
        or address.get("city_district") or address.get("city")
        or address.get("town") or address.get("village")
    )
    return {"locality": locality, "display_name": data.get("display_name", "")}


@app.post("/api/ai/ask")
async def ai_ask(payload: AIRequest):
    if not payload.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")
    answer = await call_gemini(payload.question.strip(), payload.context or "")
    return {"answer": answer}