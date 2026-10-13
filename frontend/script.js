(function () {
    "use strict";

    // CHANGE THIS TO YOUR ACTUAL RENDER URL AFTER DEPLOYMENT
    var BACKEND_BASE = "https://terraworth-api.onrender.com";

    var map = null, markerCluster = null;
    var CACHE = { lastResult: null };

    function $(id) { return document.getElementById(id); }

    function showFeedback(msg, type) {
        var el = $("searchFeedback");
        if (!el) return;
        el.textContent = msg;
        el.className = "feedback" + (type ? " " + type : "");
    }

    function showLoading(containerId) {
        var el = $(containerId);
        if (el) el.innerHTML = '<div class="loading-bar"></div>';
    }

    function hideCard(cardId) {
        var card = $(cardId);
        if (card) card.classList.add("hidden");
    }

    function showCard(cardId) {
        var card = $(cardId);
        if (card) card.classList.remove("hidden");
    }

    function initMap() {
        if (map) return;
        map = L.map("map", { center: [12.9716, 77.5946], zoom: 11 });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19,
            subdomains: "abc"
        }).addTo(map);
        markerCluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
        map.addLayer(markerCluster);
    }

    function tierColor(tier) {
        return tier === "Budget" ? "#2e7d32" : tier === "Luxury" ? "#b71c1c" : "#e65100";
    }

    function addMarkers(properties) {
        if (!markerCluster) return;
        markerCluster.clearLayers();
        var bounds = [];
        properties.forEach(function (p) {
            var color = tierColor(p.tier);
            var marker = p.type === "Land"
                ? L.circleMarker([p.lat, p.lng], { radius: 9, fillColor: color, color: "#1e1e1e", weight: 2, fillOpacity: 0.85 })
                : L.circleMarker([p.lat, p.lng], { radius: 7, fillColor: color, color: "#1e1e1e", weight: 1.5, fillOpacity: 0.85 });
            marker.bindPopup(
                "<strong>" + (p.address || "Property") + "</strong><br />" +
                "Type: " + p.type + "<br />Tier: " + p.tier + "<br />" +
                "Price/sqft: &#8377;" + Number(p.price_per_sqft).toLocaleString("en-IN") + "<br />" +
                "Configuration: " + p.bhk + "<br />Area: " + p.area_sqft + " sqft"
            );
            markerCluster.addLayer(marker);
            bounds.push([p.lat, p.lng]);
        });
        if (bounds.length > 0) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    // --- Render Metrics Table ---
    function renderMetrics(data) {
        var el = $("metricsContent");
        if (!el) return;
        var trend = data.historical.yoy_change_pct != null ? data.historical.yoy_change_pct.toFixed(1) + "%" : "N/A";
        el.innerHTML =
            '<table class="metrics-table">' +
            "<tr><td>Locality</td><td>" + (data.canonical || data.query) + "</td></tr>" +
            "<tr><td>City</td><td>" + (data.city || "N/A") + "</td></tr>" +
            "<tr><td>Price per sqft</td><td>&#8377;" + Number(data.price_per_sqft).toLocaleString("en-IN") + "</td></tr>" +
            "<tr><td>Median BHK</td><td>" + (data.median_bhk || "N/A") + "</td></tr>" +
            "<tr><td>Buildings</td><td>" + (data.building_count || 0) + "</td></tr>" +
            "<tr><td>Land plots</td><td>" + (data.land_count || 0) + "</td></tr>" +
            "<tr><td>Total listings</td><td>" + (data.listings_count || 0) + "</td></tr>" +
            "<tr><td>YoY change</td><td>" + trend + "</td></tr>" +
            "</table>";
    }

    // --- Render Forecast ---
    function renderForecast(data) {
        var el = $("forecastContent");
        if (!el) return;
        var f = data.forecast || {};
        el.innerHTML =
            '<div class="forecast-row"><span class="forecast-label">6 months</span><span class="forecast-value">&#8377;' + Number(f.m6).toLocaleString("en-IN") + "</span></div>" +
            '<div class="forecast-row"><span class="forecast-label">2 years</span><span class="forecast-value">&#8377;' + Number(f.y2).toLocaleString("en-IN") + "</span></div>" +
            '<div class="forecast-row"><span class="forecast-label">5 years</span><span class="forecast-value">&#8377;' + Number(f.y5).toLocaleString("en-IN") + "</span></div>";

        var trace = {
            x: ["Now", "6M", "2Y", "5Y"],
            y: [data.price_per_sqft, f.m6, f.y2, f.y5],
            type: "scatter",
            mode: "lines+markers",
            line: { color: "#2e7d32", width: 3 },
            marker: { size: 8, color: "#1e1e1e" },
            fill: "tozeroy",
            fillcolor: "rgba(46,125,50,0.12)"
        };
        var layout = {
            title: "Projected Price Appreciation",
            yaxis: { title: "Price per sqft (INR)", tickprefix: "₹" },
            margin: { t: 40, b: 40, l: 60, r: 20 }
        };
        Plotly.newPlot(el, [trace], layout, { responsive: true });
    }

    // --- Render Evaluation Metrics ---
    function renderEvaluationMetrics(data) {
        var el = $("evaluationContent");
        if (!el) return;
        var m = data.evaluation || {};
        el.innerHTML =
            '<table class="metrics-table">' +
            "<tr><td>R squared</td><td>" + (m.r2 != null ? m.r2.toFixed(4) : "N/A") + "</td></tr>" +
            "<tr><td>RMSE (INR)</td><td>" + (m.rmse != null ? Number(m.rmse).toLocaleString("en-IN") : "N/A") + "</td></tr>" +
            "<tr><td>MAE (INR)</td><td>" + (m.mae != null ? Number(m.mae).toLocaleString("en-IN") : "N/A") + "</td></tr>" +
            "<tr><td>MAPE</td><td>" + (m.mape != null ? m.mape.toFixed(2) + "%" : "N/A") + "</td></tr>" +
            "</table>" +
            '<p class="metrics-note">R squared measures how well the linear trend explains price variance. RMSE and MAE are the average prediction error in rupees. MAPE is the average percentage error.</p>';
    }

    // --- Render Tier Pie (Donut) ---
    function renderTierPie(data) {
        var el = $("tierPieContent");
        if (!el) return;
        var dist = data.tier_distribution || {};
        var labels = Object.keys(dist);
        var values = labels.map(function (k) { return dist[k]; });
        if (values.every(function (v) { return v === 0; })) { hideCard("tierPieCard"); return; }

        var trace = {
            labels: labels,
            values: values,
            type: "pie",
            hole: 0.4,
            marker: { colors: ["#2e7d32", "#e65100", "#b71c1c"] },
            textinfo: "label+percent",
            textposition: "outside"
        };
        var layout = { title: "Affordability Tier Distribution", margin: { t: 40, b: 40, l: 20, r: 20 } };
        Plotly.newPlot(el, [trace], layout, { responsive: true });
    }

    // --- Render Comparables (Bar Chart with Distance) ---
    function renderComparables(data) {
        var el = $("chartsContent");
        if (!el) return;
        el.innerHTML = "";
        var comps = data.comparables || [];
        if (comps.length === 0) { hideCard("chartsCard"); return; }

        // Bar chart
        var barTrace = {
            x: comps.map(function (c) { return c.locality + " (" + c.distance_km + " km)"; }),
            y: comps.map(function (c) { return c.price_per_sqft; }),
            type: "bar",
            marker: { color: comps.map(function (c) { return c.price_per_sqft > data.price_per_sqft ? "#b71c1c" : "#2e7d32"; }) }
        };
        var barLayout = {
            title: "Comparable Locality Prices",
            xaxis: { tickangle: -45 },
            yaxis: { title: "Price per sqft (INR)", tickprefix: "₹" },
            margin: { t: 40, b: 80, l: 60, r: 20 }
        };
        var barDiv = document.createElement("div");
        barDiv.className = "chart-container";
        el.appendChild(barDiv);
        Plotly.newPlot(barDiv, [barTrace], barLayout, { responsive: true });

        // Histogram
        var allPrices = comps.map(function (c) { return c.price_per_sqft; });
        allPrices.push(data.price_per_sqft);
        var histTrace = {
            x: allPrices,
            type: "histogram",
            marker: { color: "#1e1e1e" },
            nbinsx: 8
        };
        var histLayout = {
            title: "Price Distribution Histogram",
            xaxis: { title: "Price per sqft (INR)", tickprefix: "₹" },
            yaxis: { title: "Frequency" },
            margin: { t: 40, b: 40, l: 60, r: 20 }
        };
        var histDiv = document.createElement("div");
        histDiv.className = "chart-container";
        el.appendChild(histDiv);
        Plotly.newPlot(histDiv, [histTrace], histLayout, { responsive: true });

        // Scatter plot: Area vs Price
        var scatterTrace = {
            x: data.properties.map(function (p) { return p.area_sqft; }),
            y: data.properties.map(function (p) { return p.price_per_sqft; }),
            mode: "markers",
            type: "scatter",
            marker: {
                size: 10,
                color: data.properties.map(function (p) {
                    return p.tier === "Budget" ? "#2e7d32" : p.tier === "Luxury" ? "#b71c1c" : "#e65100";
                }),
                opacity: 0.7
            },
            text: data.properties.map(function (p) { return p.bhk + " - " + p.type; })
        };
        var scatterLayout = {
            title: "Area vs Price Scatter Plot",
            xaxis: { title: "Area (sqft)" },
            yaxis: { title: "Price per sqft (INR)", tickprefix: "₹" },
            margin: { t: 40, b: 40, l: 60, r: 20 }
        };
        var scatterDiv = document.createElement("div");
        scatterDiv.className = "chart-container";
        el.appendChild(scatterDiv);
        Plotly.newPlot(scatterDiv, [scatterTrace], scatterLayout, { responsive: true });
    }

    // --- Render Recommendations ---
    function renderRecommendations(data) {
        var el = $("recommendationsContent");
        if (!el) return;
        var recs = data.recommendations || [];
        if (recs.length === 0) { hideCard("recommendationsCard"); return; }
        var html = "";
        recs.forEach(function (r) {
            html += '<div class="recommendation-item"><strong>' + r.locality + '</strong><br />' +
                'Distance: ' + r.distance_km + ' km<br />' +
                'Price/sqft: ₹' + Number(r.price_per_sqft).toLocaleString("en-IN") + '<br />' +
                'Projected 5Y: ₹' + Number(r.forecast_5y).toLocaleString("en-IN") + '<br />' +
                'Why: ' + r.reason + '</div>';
        });
        el.innerHTML = html;
    }

    // --- Render Methodology ---
    function renderMethodology(data) {
        var el = $("methodologyContent");
        if (!el) return;
        el.innerHTML =
            '<p><strong>Data source:</strong> Nominatim (OpenStreetMap) for geocoding, Overpass API for buildings, land plots, and nearby localities.</p>' +
            '<p><strong>Overpass limit:</strong> Increased to 200 results (previously 30) to fix the fixed-count issue.</p>' +
            '<p><strong>Forecast:</strong> annual = (yoy + inflation) / 100; 6M = price × (1 + annual)^0.5; 2Y = price × (1 + annual)^2; 5Y = price × (1 + annual)^5.</p>' +
            '<p><strong>Evaluation metrics:</strong> Linear regression on four historical points; R², RMSE, MAE, MAPE computed.</p>' +
            '<p><strong>AI:</strong> Gemini 3.8 Flash with Google Search grounding for real-time data.</p>';
    }

    // --- AI Chat ---
    function addUserMessage(text) {
        var log = $("aiChatLog");
        if (!log) return;
        var div = document.createElement("div");
        div.className = "user-msg";
        div.textContent = "You: " + text;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }

    function renderAIResponse(text) {
        var log = $("aiChatLog");
        if (!log) return;
        var div = document.createElement("div");
        div.className = "ai-msg";
        div.textContent = text;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }

    function fetchJSON(url, options) {
        return fetch(url, options).then(function (res) {
            if (!res.ok) {
                return res.json().catch(function () { return {}; }).then(function (body) {
                    throw new Error(body.detail || ("HTTP " + res.status));
                });
            }
            return res.json();
        });
    }

    function searchLocality(query) {
        if (!query || query.trim().length < 2) { showFeedback("Please enter a valid locality name.", "error"); return; }
        showFeedback("Searching " + query + "...", "");
        ["metricsContent", "forecastContent", "chartsContent", "recommendationsContent",
         "evaluationContent", "tierPieContent", "methodologyContent"].forEach(showLoading);
        // Show all cards initially
        ["metricsCard", "forecastCard", "chartsCard", "recommendationsCard",
         "evaluationCard", "tierPieCard", "methodologyCard"].forEach(showCard);

        fetchJSON(BACKEND_BASE + "/api/locality/search?q=" + encodeURIComponent(query.trim()))
            .then(function (data) {
                CACHE.lastResult = data;
                showFeedback("Showing results for " + data.canonical + (data.corrected ? ' (corrected from "' + query + '")' : ""), "success");
                renderMetrics(data);
                renderForecast(data);
                renderEvaluationMetrics(data);
                renderTierPie(data);
                renderComparables(data);
                renderRecommendations(data);
                renderMethodology(data);
                addMarkers(data.properties || []);
            })
            .catch(function (err) {
                showFeedback("Search failed: " + err.message, "error");
                ["metricsContent", "forecastContent", "chartsContent", "recommendationsContent",
                 "evaluationContent", "tierPieContent", "methodologyContent"].forEach(function (id) {
                    var el = $(id);
                    if (el) el.innerHTML = '<p class="placeholder">Could not load data.</p>';
                });
            });
    }

    function detectLocation() {
        if (!navigator.geolocation) { showFeedback("Geolocation not supported.", "error"); return; }
        showFeedback("Detecting your location...", "");
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                fetchJSON(BACKEND_BASE + "/api/locality/reverse?lat=" + pos.coords.latitude + "&lng=" + pos.coords.longitude)
                    .then(function (data) {
                        if (data.locality) { $("localityInput").value = data.locality; searchLocality(data.locality); }
                        else showFeedback("Could not determine locality.", "error");
                    })
                    .catch(function () { showFeedback("Reverse geocoding failed.", "error"); });
            },
            function () { showFeedback("Location access denied.", "error"); }
        );
    }

    function askAI() {
        var input = $("aiQueryInput");
        var query = input.value.trim();
        if (!query) return;
        addUserMessage(query);
        input.value = "";

        var context = CACHE.lastResult
            ? "Locality: " + CACHE.lastResult.canonical + ", Price/sqft: " + CACHE.lastResult.price_per_sqft
            : "No locality selected yet.";

        showLoading("aiChatLog");

        fetchJSON(BACKEND_BASE + "/api/ai/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: query, context: context })
        })
        .then(function (data) { renderAIResponse(data.answer || "No response."); })
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
        initMap();
        wireEvents();
        showFeedback("Ready. Search a locality or use your location.", "");
        setTimeout(function () {
            document.querySelectorAll(".card").forEach(function (c) { c.classList.add("fade-in"); });
        }, 100);
    });
})();