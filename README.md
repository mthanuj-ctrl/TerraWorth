# TerraWorth

Real-Time Housing Price Prediction & Neighborhood Affordability Clustering for Indian localities.

## Stack
- Frontend: HTML5, CSS3, Vanilla JS, Leaflet.js (OpenStreetMap)
- Backend: Python FastAPI with Google Gemini AI
- Analytics: R Shiny with ggplot2, dplyr, DT

## Free APIs (No Credit Card Required)
| Service | Purpose |
|---------|---------|
| OpenStreetMap Tiles | Map rendering |
| Nominatim | Geocoding |
| Overpass API | Residential buildings |
| Google Gemini | AI assistant |
| Render | Backend hosting |
| Netlify | Frontend hosting |

## Local Setup
1. Set `GEMINI_API_KEY` environment variable
2. `pip install -r backend/requirements.txt`
3. `uvicorn backend:app --reload --port 8000` (from the TerraWorth root)
4. Serve `frontend/` with any static server

## Deployment
- Backend: Render Web Service (rootDir: backend)
- Frontend: Netlify (publish: frontend)
- R Shiny: Run locally or deploy to Posit Connect Cloud
