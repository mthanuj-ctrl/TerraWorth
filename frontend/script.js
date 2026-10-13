(function () {
    "use strict";
    var BACKEND_BASE = "https://terraworth-api.onrender.com";
    var map = null, markerCluster = null, activeCharts = {};
    var CACHE = { lastResult: null };

    function $(id) { return document.getElementById(id); }

    function showFeedback(msg, type) {
        var el = $("searchFeedback");
        el.textContent = msg;
        el.className = "feedback" + (type ? " " + type : "");
    }

    function showLoading(containerId) {
        var el = $(containerId);
        if (el) el.innerHTML = '<div class="loading-bar"></div>';
    }

    function destroyChart(key) {
        if (activeCharts[key]) { activeCharts[key].destroy(); delete activeCharts[key]; }
    }

    function initMap() {
        if (map) return;
        map = L.map("map", { center: [12.9716, 77.5946], zoom: 11 });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors", maxZoom: 19, subdomains: "abc"
        }).addTo(map);
        markerCluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
        map.addLayer(markerCluster);
    }

    function tierColor(tier) {
        return tier === "Budget" ? "#2e7d32" : tier === "Luxury" ? "#b71c1c" : "#e65100";
    }

    function addMarkers(properties) {
        markerCluster.clearLayers();
        var bounds = [];
        properties.forEach(function (p) {
            var m = L.circleMarker([p.lat, p.lng], {
                radius: 8, fillColor: tierColor(p.tier), color: "#1e1e1e",
                weight: 1.5, opacity: 1, fillOpacity: 0.85
            });
            m.bindPopup("<strong>" + (p.address || "Property") + "</strong><br />" +
                "Tier: " + p.tier + "<br />Price/sqft: &#8377;" + Number(p.price_per_sqft).toLocaleString("en-IN") +
                "<br />Configuration: " + (p.bhk || "N/A") + "<br />Area: " + (p.area_sqft || "N/A") + " sqft");
            markerCluster.addLayer(m);
            bounds.push([p.lat, p.lng]);
        });
        if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    function renderMetrics(data) {
        var el = $("metricsContent");
        el.innerHTML = '<table class="metrics-table">' +
            "<tr><td>Locality</td><td>" + (data.canonical || data.query) + "</td></tr>" +
            "<tr><td>City</td><td>" + (data.city || "N/A") + "</td></tr>" +
            "<tr><td>Price per sqft</td><td>&#8377;" + Number(data.price_per_sqft).toLocaleString("en-IN") + "</td></tr>" +
            "<tr><td>Median BHK</td><td>" + (data.median_bhk || "N/A") + "</td></tr>" +
            "<tr><td>Listings sampled</td><td>" + (data.listings_count || 0) + "</td></tr>" +
            "<tr><td>YoY change</td><td>" + (data.market.yoy_change_pct || "N/A") + "%</td></tr></table>";
        destroyChart("hist");
        var ctx = document.createElement("canvas"); ctx.id = "histChart";
        var wrap = document.createElement("div"); wrap.className = "chart-container"; wrap.appendChild(ctx);
        el.appendChild(wrap);
        activeCharts.hist = new Chart(ctx.getContext("2d"), {
            type: "bar",
            data: { labels: data.historical.years, datasets: [{ label: "Price per sqft", data: data.historical.prices, backgroundColor: "#1e1e1e" }] },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: function (v) { return "\u20B9" + Number(v).toLocaleString("en-IN"); } } } } }
        });
    }

    function renderForecast(data) {
        var el = $("forecastContent");
        var f = data.forecast;
        el.innerHTML = '<div class="forecast-row"><span class="forecast-label">6 months</span><span class="forecast-value">&#8377;' + Number(f.m6).toLocaleString("en-IN") + "</span></div>" +
            '<div class="forecast-row"><span class="forecast-label">2 years</span><span class="forecast-value">&#8377;' + Number(f.y2).toLocaleString("en-IN") + "</span></div>" +
            '<div class="forecast-row"><span class="forecast-label">5 years</span><span class="forecast-value">&#8377;' + Number(f.y5).toLocaleString("en-IN") + "</span></div>";
        destroyChart("forecast");
        var ctx = document.createElement("canvas"); ctx.id = "forecastChart";
        var wrap = document.createElement("div"); wrap.className = "chart-container"; wrap.appendChild(ctx);
        el.appendChild(wrap);
        activeCharts.forecast = new Chart(ctx.getContext("2d"), {
            type: "line",
            data: { labels: ["Now", "6M", "2Y", "5Y"], datasets: [{ label: "Projected price/sqft", data: [data.price_per_sqft, f.m6, f.y2, f.y5], borderColor: "#2e7d32", backgroundColor: "rgba(46,125,50,0.12)", fill: true, tension: 0.25 }] },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: function (v) { return "\u20B9" + Number(v).toLocaleString("en-IN"); } } } } }
        });
    }

    function renderCharts(data) {
        var el = $("chartsContent");
        el.innerHTML = "";
        var comps = data.comparables || [];
        if (comps.length > 0) {
            destroyChart("bar");
            var ctx = document.createElement("canvas"); ctx.id = "barChart";
            var wrap = document.createElement("div"); wrap.className = "chart-container"; wrap.appendChild(ctx);
            el.appendChild(wrap);
            activeCharts.bar = new Chart(ctx.getContext("2d"), {
                type: "bar",
                data: { labels: comps.map(function (c) { return c.locality; }), datasets: [{ label: "Price per sqft", data: comps.map(function (c) { return c.price_per_sqft; }), backgroundColor: comps.map(function (c) { return c.price_per_sqft > data.price_per_sqft ? "#b71c1c" : "#2e7d32"; }) }] },
                options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 45, minRotation: 30 } }, y: { ticks: { callback: function (v) { return "\u20B9" + Number(v).toLocaleString("en-IN"); } } } } }
            });
        } else {
            el.innerHTML = '<p class="placeholder">No comparable localities found for charting.</p>';
        }
    }

    function renderRecommendations(data) {
        var el = $("recommendationsContent");
        var recs = data.recommendations || [];
        if (recs.length === 0) { el.innerHTML = '<p class="placeholder">No alternative recommendations available.</p>'; return; }
        var html = "";
        recs.forEach(function (r) {
            html += '<div class="recommendation-item"><strong>' + r.locality + "</strong><br />Price/sqft: &#8377;" + Number(r.price_per_sqft).toLocaleString("en-IN") + "<br />Projected 5Y: &#8377;" + Number(r.forecast_5y).toLocaleString("en-IN") + "<br />Why: " + r.reason + "</div>";
        });
        el.innerHTML = html;
    }

    function addUserMessage(text) {
        var log = $("aiChatLog");
        var div = document.createElement("div");
        div.className = "user-msg"; div.textContent = "You: " + text;
        log.appendChild(div); log.scrollTop = log.scrollHeight;
    }

    function renderAIResponse(text) {
        var log = $("aiChatLog");
        var div = document.createElement("div");
        div.className = "ai-msg"; div.textContent = text;
        log.appendChild(div); log.scrollTop = log.scrollHeight;
    }

    function fetchJSON(url, options) {
        return fetch(url, options).then(function (res) {
            if (!res.ok) return res.json().catch(function () { return {}; }).then(function (b) { throw new Error(b.detail || ("HTTP " + res.status)); });
            return res.json();
        });
    }

    function searchLocality(query) {
        if (!query || query.trim().length < 2) { showFeedback("Please enter a valid locality name.", "error"); return; }
        showFeedback("Searching " + query + "...", "");
        showLoading("metricsContent"); showLoading("forecastContent"); showLoading("chartsContent"); showLoading("recommendationsContent");
        fetchJSON(BACKEND_BASE + "/api/locality/search?q=" + encodeURIComponent(query.trim()))
            .then(function (data) {
                CACHE.lastResult = data;
                showFeedback("Showing results for " + data.canonical + (data.corrected ? " (corrected from " + query + ")" : ""), "success");
                renderMetrics(data); renderForecast(data); renderCharts(data); renderRecommendations(data);
                addMarkers(data.properties || []);
            })
            .catch(function (err) {
                showFeedback("Search failed: " + err.message, "error");
                $("metricsContent").innerHTML = '<p class="placeholder">Could not load metrics.</p>';
                $("forecastContent").innerHTML = '<p class="placeholder">Could not load forecast.</p>';
                $("chartsContent").innerHTML = '<p class="placeholder">Could not load charts.</p>';
                $("recommendationsContent").innerHTML = '<p class="placeholder">Could not load recommendations.</p>';
            });
    }

    function detectLocation() {
        if (!navigator.geolocation) { showFeedback("Geolocation not supported.", "error"); return; }
        showFeedback("Detecting your location...", "");
        navigator.geolocation.getCurrentPosition(function (pos) {
            fetchJSON(BACKEND_BASE + "/api/locality/reverse?lat=" + pos.coords.latitude + "&lng=" + pos.coords.longitude)
                .then(function (data) { if (data.locality) { $("localityInput").value = data.locality; searchLocality(data.locality); } else showFeedback("Could not determine locality.", "error"); })
                .catch(function () { showFeedback("Reverse geocoding failed.", "error"); });
        }, function () { showFeedback("Location access denied.", "error"); });
    }

    function askAI() {
        var input = $("aiQueryInput");
        var query = input.value.trim();
        if (!query) return;
        addUserMessage(query); input.value = "";
        var context = CACHE.lastResult ? "Locality: " + CACHE.lastResult.canonical + ", Price/sqft: " + CACHE.lastResult.price_per_sqft : "No locality selected yet.";
        showLoading("aiChatLog");
        fetchJSON(BACKEND_BASE + "/api/ai/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: query, context: context }) })
            .then(function (data) { renderAIResponse(data.answer || "No response from AI."); })
            .catch(function (err) { renderAIResponse("AI request failed: " + err.message); });
    }

    function wireEvents() {
        $("searchBtn").addEventListener("click", function () { searchLocality($("localityInput").value); });
        $("localityInput").addEventListener("keydown", function (e) { if (e.key === "Enter") searchLocality($("localityInput").value); });
        $("detectLocationBtn").addEventListener("click", detectLocation);
        $("aiSendBtn").addEventListener("click", askAI);
        $("aiQueryInput").addEventListener("keydown", function (e) { if (e.key === "Enter") askAI(); });
    }

    document.addEventListener("DOMContentLoaded", function () {
        initMap(); wireEvents(); showFeedback("Ready. Search a locality or use your location.", "");
        setTimeout(function () { document.querySelectorAll(".card").forEach(function (c) { c.classList.add("fade-in"); }); }, 100);
    });
})();
