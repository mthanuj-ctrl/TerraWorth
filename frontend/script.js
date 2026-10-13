(function () {
    "use strict";

    // ================================================================
    // CHANGE THIS TO YOUR ACTUAL RENDER URL AFTER DEPLOYMENT
    // ================================================================
    var BACKEND_BASE = "https://terraworth-api.onrender.com";

    var map = null, markerCluster = null, activeCharts = {};
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

    function destroyChart(key) {
        if (activeCharts[key]) {
            activeCharts[key].destroy();
            delete activeCharts[key];
        }
    }

    function initMap() {
        if (map) return;
        map = L.map("map", { center: [12.9716, 77.5946], zoom: 11 });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19,
            subdomains: "abc"
        }).addTo(map);
        markerCluster = L.markerClusterGroup({
            showCoverageOnHover: false,
            maxClusterRadius: 50
        });
        map.addLayer(markerCluster);
    }

    function tierColor(tier) {
        return tier === "Budget" ? "#2e7d32"
            : tier === "Luxury" ? "#b71c1c" : "#e65100";
    }

    function typeIcon(type) {
        return type === "Land" ? "\u25A0" : "\u25CF";
    }

    function addMarkers(properties) {
        if (!markerCluster) return;
        markerCluster.clearLayers();
        var bounds = [];
        properties.forEach(function (p) {
            var color = tierColor(p.tier);
            var marker;

            if (p.type === "Land") {
                marker = L.squareMarker
                    ? L.squareMarker([p.lat, p.lng], {
                        radius: 9, fillColor: color, color: "#1e1e1e",
                        weight: 2, opacity: 1, fillOpacity: 0.85
                    })
                    : L.circleMarker([p.lat, p.lng], {
                        radius: 9, fillColor: color, color: "#1e1e1e",
                        weight: 2, opacity: 1, fillOpacity: 0.85
                    });
            } else {
                marker = L.circleMarker([p.lat, p.lng], {
                    radius: 7, fillColor: color, color: "#1e1e1e",
                    weight: 1.5, opacity: 1, fillOpacity: 0.85
                });
            }

            marker.bindPopup(
                "<strong>" + (p.address || "Property") + "</strong><br />" +
                "Type: " + (p.type || "Building") + "<br />" +
                "Tier: " + p.tier + "<br />" +
                "Price/sqft: &#8377;" + Number(p.price_per_sqft).toLocaleString("en-IN") + "<br />" +
                "Configuration: " + (p.bhk || "N/A") + "<br />" +
                "Area: " + (p.area_sqft || "N/A") + " sqft"
            );
            markerCluster.addLayer(marker);
            bounds.push([p.lat, p.lng]);
        });
        if (bounds.length > 0) {
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
        }
    }

    function renderMetrics(data) {
        var el = $("metricsContent");
        if (!el) return;
        var hist = data.historical || {};
        var trend = hist.yoy_change_pct != null
            ? hist.yoy_change_pct.toFixed(1) + "%" : "N/A";

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

        destroyChart("hist");
        var ctx = document.createElement("canvas");
        ctx.id = "histChart";
        var wrap = document.createElement("div");
        wrap.className = "chart-container";
        wrap.appendChild(ctx);
        el.appendChild(wrap);

        activeCharts.hist = new Chart(ctx.getContext("2d"), {
            type: "bar",
            data: {
                labels: hist.years || ["2022", "2023", "2024", "2025"],
                datasets: [{
                    label: "Price per sqft (INR)",
                    data: hist.prices || [],
                    backgroundColor: "#1e1e1e",
                    borderColor: "#2c2c2c",
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: function (v) {
                                return "\u20B9" + Number(v).toLocaleString("en-IN");
                            }
                        }
                    }
                }
            }
        });
    }

    function renderForecast(data) {
        var el = $("forecastContent");
        if (!el) return;
        var f = data.forecast || {};
        el.innerHTML =
            '<div class="forecast-row"><span class="forecast-label">6 months</span><span class="forecast-value">&#8377;' +
            (f.m6 != null ? Number(f.m6).toLocaleString("en-IN") : "N/A") + "</span></div>" +
            '<div class="forecast-row"><span class="forecast-label">2 years</span><span class="forecast-value">&#8377;' +
            (f.y2 != null ? Number(f.y2).toLocaleString("en-IN") : "N/A") + "</span></div>" +
            '<div class="forecast-row"><span class="forecast-label">5 years</span><span class="forecast-value">&#8377;' +
            (f.y5 != null ? Number(f.y5).toLocaleString("en-IN") : "N/A") + "</span></div>";

        destroyChart("forecast");
        var ctx = document.createElement("canvas");
        ctx.id = "forecastChart";
        var wrap = document.createElement("div");
        wrap.className = "chart-container";
        wrap.appendChild(ctx);
        el.appendChild(wrap);

        activeCharts.forecast = new Chart(ctx.getContext("2d"), {
            type: "line",
            data: {
                labels: ["Now", "6M", "2Y", "5Y"],
                datasets: [{
                    label: "Projected price per sqft",
                    data: [data.price_per_sqft, f.m6, f.y2, f.y5],
                    borderColor: "#2e7d32",
                    backgroundColor: "rgba(46,125,50,0.12)",
                    fill: true,
                    tension: 0.25,
                    pointBackgroundColor: "#1e1e1e",
                    pointRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    y: {
                        ticks: {
                            callback: function (v) {
                                return "\u20B9" + Number(v).toLocaleString("en-IN");
                            }
                        }
                    }
                }
            }
        });
    }

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
            '<p class="metrics-note">R squared measures how well the linear trend explains price variance. ' +
            'RMSE and MAE are the average prediction error in rupees. ' +
            'MAPE is the average percentage error. Lower RMSE, MAE, and MAPE indicate a better fit.</p>';
    }

    function renderTierPie(data) {
        var el = $("tierPieContent");
        if (!el) return;
        var dist = data.tier_distribution || {};
        var labels = Object.keys(dist);
        var values = labels.map(function (k) { return dist[k]; });

        if (values.every(function (v) { return v === 0; })) {
            el.innerHTML = '<p class="placeholder">No property tier data available.</p>';
            return;
        }

        destroyChart("tierPie");
        el.innerHTML = "";
        var ctx = document.createElement("canvas");
        ctx.id = "tierPieChart";
        var wrap = document.createElement("div");
        wrap.className = "chart-container";
        wrap.appendChild(ctx);
        el.appendChild(wrap);

        activeCharts.tierPie = new Chart(ctx.getContext("2d"), {
            type: "doughnut",
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: ["#2e7d32", "#e65100", "#b71c1c"],
                    borderColor: "#2c2c2c",
                    borderWidth: 1.5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { position: "bottom", labels: { boxWidth: 14 } }
                }
            }
        });
    }

    function renderComparables(data) {
        var el = $("chartsContent");
        if (!el) return;
        el.innerHTML = "";
        var comps = data.comparables || [];
        if (comps.length === 0) {
            el.innerHTML = '<p class="placeholder">No comparable localities found.</p>';
            return;
        }

        // Bar chart with distance labels.
        destroyChart("bar");
        var ctx = document.createElement("canvas");
        ctx.id = "barChart";
        var wrap = document.createElement("div");
        wrap.className = "chart-container";
        wrap.appendChild(ctx);
        el.appendChild(wrap);

        activeCharts.bar = new Chart(ctx.getContext("2d"), {
            type: "bar",
            data: {
                labels: comps.map(function (c) {
                    return c.locality + " (" + c.distance_km + " km)";
                }),
                datasets: [{
                    label: "Price per sqft (INR)",
                    data: comps.map(function (c) { return c.price_per_sqft; }),
                    backgroundColor: comps.map(function (c) {
                        return c.price_per_sqft > data.price_per_sqft ? "#b71c1c" : "#2e7d32";
                    }),
                    borderColor: "#2c2c2c",
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { maxRotation: 45, minRotation: 30 } },
                    y: {
                        beginAtZero: false,
                        ticks: {
                            callback: function (v) {
                                return "\u20B9" + Number(v).toLocaleString("en-IN");
                            }
                        }
                    }
                }
            }
        });

        // Histogram of price distribution.
        var allPrices = comps.map(function (c) { return c.price_per_sqft; });
        allPrices.push(data.price_per_sqft);
        var min = Math.min.apply(null, allPrices);
        var max = Math.max.apply(null, allPrices);
        var binCount = 6;
        var binWidth = (max - min) / binCount || 1;
        var bins = new Array(binCount).fill(0);
        var binLabels = [];
        for (var i = 0; i < binCount; i++) {
            var lo = Math.round(min + i * binWidth);
            var hi = Math.round(min + (i + 1) * binWidth);
            binLabels.push("\u20B9" + lo.toLocaleString("en-IN") + " - \u20B9" + hi.toLocaleString("en-IN"));
        }
        allPrices.forEach(function (p) {
            var idx = Math.min(binCount - 1, Math.floor((p - min) / binWidth));
            bins[idx]++;
        });

        destroyChart("histogram");
        var hCtx = document.createElement("canvas");
        hCtx.id = "histogramChart";
        var hWrap = document.createElement("div");
        hWrap.className = "chart-container";
        hWrap.appendChild(hCtx);
        el.appendChild(hWrap);

        activeCharts.histogram = new Chart(hCtx.getContext("2d"), {
            type: "bar",
            data: {
                labels: binLabels,
                datasets: [{
                    label: "Frequency",
                    data: bins,
                    backgroundColor: "#1e1e1e",
                    borderColor: "#2c2c2c",
                    borderWidth: 1,
                    barPercentage: 0.95,
                    categoryPercentage: 1.0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { maxRotation: 45, minRotation: 30 } },
                    y: { beginAtZero: true, ticks: { stepSize: 1 } }
                }
            }
        });
    }

    function renderRecommendations(data) {
        var el = $("recommendationsContent");
        if (!el) return;
        var recs = data.recommendations || [];

        if (recs.length === 0) {
            el.innerHTML = '<p class="placeholder">No alternative recommendations available at this time.</p>';
            return;
        }

        var html = "";
        recs.forEach(function (r) {
            html +=
                '<div class="recommendation-item">' +
                "<strong>" + r.locality + "</strong><br />" +
                "Distance: " + (r.distance_km || "N/A") + " km<br />" +
                "Price/sqft: &#8377;" + Number(r.price_per_sqft).toLocaleString("en-IN") + "<br />" +
                "Projected 5Y: &#8377;" + Number(r.forecast_5y || r.price_per_sqft * 1.4).toLocaleString("en-IN") + "<br />" +
                "Why: " + (r.reason || "Better value ratio") +
                "</div>";
        });
        el.innerHTML = html;
    }

    function renderMethodology(data) {
        var el = $("methodologyContent");
        if (!el) return;
        el.innerHTML =
            '<p><strong>Data source:</strong> Nominatim geocoding (OpenStreetMap) for coordinates, ' +
            'Overpass API for residential buildings, land plots, and nearby localities, and a seeded synthetic price model ' +
            'anchored to the city base price.</p>' +
            '<p><strong>Land plots:</strong> Fetched from Overpass with landuse=residential, landuse=construction, and plot=* tags. ' +
            'Markers use square shapes to distinguish them from round building markers.</p>' +
            '<p><strong>Comparable localities:</strong> Fetched from Overpass place nodes (suburb, neighbourhood, village, town) ' +
            'within a 12 km radius of the searched coordinates. Distance is computed with the haversine formula.</p>' +
            '<p><strong>Historical prices:</strong> Computed as ' +
            'price x 0.78 (2022), price x 0.85 (2023), price x 0.93 (2024), price (2025).</p>' +
            '<p><strong>Forecast:</strong> ' +
            'annual = (yoy + inflation) / 100; ' +
            '6M = price x (1 + annual)^0.5; ' +
            '2Y = price x (1 + annual)^2; ' +
            '5Y = price x (1 + annual)^5.</p>' +
            '<p><strong>Evaluation metrics:</strong> A linear regression is fit to the four historical ' +
            'points. R squared, RMSE, MAE, and MAPE are computed by comparing the fitted line to the actuals.</p>' +
            '<p><strong>Tier clustering:</strong> Properties are sorted by price per sqft. ' +
            'The bottom 33 percent are Budget, the next 34 percent are Mid-Tier, and the top 33 percent are Luxury.</p>';
    }

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
        if (!query || query.trim().length < 2) {
            showFeedback("Please enter a valid locality name.", "error");
            return;
        }
        showFeedback("Searching " + query + "...", "");
        ["metricsContent", "forecastContent", "chartsContent",
         "recommendationsContent", "evaluationContent",
         "tierPieContent", "methodologyContent"].forEach(showLoading);

        fetchJSON(BACKEND_BASE + "/api/locality/search?q=" + encodeURIComponent(query.trim()))
            .then(function (data) {
                CACHE.lastResult = data;
                showFeedback(
                    "Showing results for " + data.canonical +
                    (data.corrected ? ' (corrected from "' + query + '")' : ""),
                    "success"
                );
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
                ["metricsContent", "forecastContent", "chartsContent",
                 "recommendationsContent", "evaluationContent",
                 "tierPieContent", "methodologyContent"].forEach(function (id) {
                    var el = $(id);
                    if (el) el.innerHTML = '<p class="placeholder">Could not load data.</p>';
                });
            });
    }

    function detectLocation() {
        if (!navigator.geolocation) {
            showFeedback("Geolocation is not supported by this browser.", "error");
            return;
        }
        showFeedback("Detecting your location...", "");
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                fetchJSON(BACKEND_BASE + "/api/locality/reverse?lat=" +
                    pos.coords.latitude + "&lng=" + pos.coords.longitude)
                    .then(function (data) {
                        if (data.locality) {
                            $("localityInput").value = data.locality;
                            searchLocality(data.locality);
                        } else {
                            showFeedback("Could not determine locality from coordinates.", "error");
                        }
                    })
                    .catch(function () {
                        showFeedback("Reverse geocoding failed. Try typing a locality name.", "error");
                    });
            },
            function () {
                showFeedback("Location access denied. Please type a locality name.", "error");
            }
        );
    }

    function askAI() {
        var input = $("aiQueryInput");
        var query = input.value.trim();
        if (!query) return;
        addUserMessage(query);
        input.value = "";

        var context = CACHE.lastResult
            ? ("Locality: " + CACHE.lastResult.canonical +
               ", City: " + (CACHE.lastResult.city || "N/A") +
               ", Price/sqft: " + CACHE.lastResult.price_per_sqft +
               ", Forecast 5Y: " + CACHE.lastResult.forecast.y5 +
               ", Buildings: " + (CACHE.lastResult.building_count || 0) +
               ", Land plots: " + (CACHE.lastResult.land_count || 0))
            : "No locality selected yet.";

        showLoading("aiChatLog");

        fetchJSON(BACKEND_BASE + "/api/ai/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: query, context: context })
        })
            .then(function (data) {
                renderAIResponse(data.answer || "No response from AI.");
            })
            .catch(function (err) {
                renderAIResponse("AI request failed: " + err.message);
            });
    }

    function wireEvents() {
        $("searchBtn").addEventListener("click", function () {
            searchLocality($("localityInput").value);
        });
        $("localityInput").addEventListener("keydown", function (e) {
            if (e.key === "Enter") searchLocality($("localityInput").value);
        });
        $("detectLocationBtn").addEventListener("click", detectLocation);
        $("aiSendBtn").addEventListener("click", askAI);
        $("aiQueryInput").addEventListener("keydown", function (e) {
            if (e.key === "Enter") askAI();
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        initMap();
        wireEvents();
        showFeedback("Ready. Search a locality or use your location.", "");
        setTimeout(function () {
            document.querySelectorAll(".card").forEach(function (c) {
                c.classList.add("fade-in");
            });
        }, 100);
    });
})();