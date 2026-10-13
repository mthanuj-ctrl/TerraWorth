library(shiny)
library(ggplot2)
library(dplyr)
library(tidyr)
library(DT)

generate_market_data <- function(seed = 42) {
    set.seed(seed)
    df <- data.frame(
        locality = c("Whitefield", "Koramangala", "Indiranagar", "HSR Layout", "Marathahalli",
                     "Electronic City", "Jayanagar", "Rajajinagar", "Hebbal", "Yelahanka"),
        price_per_sqft = c(7200, 12500, 11800, 10200, 7800, 6200, 11000, 9500, 8800, 7000),
        yoy_change = c(7.2, 5.1, 4.8, 6.3, 8.1, 9.5, 4.2, 5.7, 6.9, 7.8),
        inflation = c(5.8, 5.2, 5.0, 5.5, 6.1, 6.5, 4.8, 5.3, 5.9, 6.2),
        stringsAsFactors = FALSE
    )
    df$forecast_6m <- df$price_per_sqft * ((1 + (df$yoy_change + df$inflation) / 100) ^ 0.5)
    df$forecast_2y <- df$price_per_sqft * ((1 + (df$yoy_change + df$inflation) / 100) ^ 2)
    df$forecast_5y <- df$price_per_sqft * ((1 + (df$yoy_change + df$inflation) / 100) ^ 5)
    df$tier <- cut(df$price_per_sqft, breaks = quantile(df$price_per_sqft, probs = c(0, 0.33, 0.67, 1)),
                   labels = c("Budget", "Mid-Tier", "Luxury"), include.lowest = TRUE)
    df
}

market_data <- generate_market_data()

ui <- fluidPage(
    titlePanel("TerraWorth Analytics Dashboard"),
    sidebarLayout(
        sidebarPanel(
            selectInput("locality", "Select Locality", choices = sort(market_data$locality), selected = "Whitefield"),
            sliderInput("top_n", "Localities to compare", min = 3, max = 10, value = 6, step = 1),
            checkboxInput("show_tier", "Color bars by affordability tier", TRUE)
        ),
        mainPanel(
            tabsetPanel(
                tabPanel("Price Distribution", plotOutput("histPlot", height = "420px"), hr(), plotOutput("barPlot", height = "420px")),
                tabPanel("Forecast Comparison", plotOutput("forecastPlot", height = "480px")),
                tabPanel("Affordability Table", DTOutput("tableOut")),
                tabPanel("Statistical Summary", verbatimTextOutput("summaryOut"))
            )
        )
    )
)

server <- function(input, output) {
    selected_data <- reactive({ market_data %>% filter(locality == input$locality) })
    top_data <- reactive({ market_data %>% arrange(desc(price_per_sqft)) %>% slice_head(n = input$top_n) })

    output$histPlot <- renderPlot({
        ggplot(market_data, aes(x = price_per_sqft)) +
            geom_histogram(bins = 8, fill = "#1e1e1e", color = "#2c2c2c", alpha = 0.85) +
            labs(title = "Distribution of Price per Square Foot", x = "Price per sqft (INR)", y = "Frequency") +
            theme_minimal(base_family = "Georgia")
    })

    output$barPlot <- renderPlot({
        d <- top_data()
        p <- ggplot(d, aes(x = reorder(locality, -price_per_sqft), y = price_per_sqft))
        if (input$show_tier) {
            p <- p + geom_col(aes(fill = tier), color = "#2c2c2c", width = 0.7) +
                scale_fill_manual(values = c("Budget" = "#2e7d32", "Mid-Tier" = "#e65100", "Luxury" = "#b71c1c"))
        } else {
            p <- p + geom_col(fill = "#1e1e1e", color = "#2c2c2c", width = 0.7)
        }
        p + labs(title = paste("Top", input$top_n, "Localities by Price per sqft"), x = "Locality", y = "Price per sqft (INR)") +
            theme_minimal(base_family = "Georgia") +
            theme(axis.text.x = element_text(angle = 35, hjust = 1))
    })

    output$forecastPlot <- renderPlot({
        d <- market_data %>%
            select(locality, price_per_sqft, forecast_6m, forecast_2y, forecast_5y) %>%
            pivot_longer(cols = -locality, names_to = "horizon", values_to = "price") %>%
            mutate(horizon = factor(horizon, levels = c("price_per_sqft", "forecast_6m", "forecast_2y", "forecast_5y"),
                                    labels = c("Now", "6 months", "2 years", "5 years")))
        ggplot(d, aes(x = horizon, y = price, group = locality, color = locality)) +
            geom_line(linewidth = 1.1) + geom_point(size = 2.5) +
            labs(title = "Projected Price Appreciation", x = "Horizon", y = "Price per sqft (INR)", color = "Locality") +
            theme_minimal(base_family = "Georgia") + theme(legend.position = "bottom")
    })

    output$tableOut <- renderDT({
        market_data %>% arrange(desc(price_per_sqft)) %>%
            select(Locality = locality, `Price / sqft` = price_per_sqft, `6M Forecast` = forecast_6m,
                   `2Y Forecast` = forecast_2y, `5Y Forecast` = forecast_5y, Tier = tier) %>%
            datatable(options = list(pageLength = 10, dom = "tip"), rownames = FALSE)
    })

    output$summaryOut <- renderPrint({
        d <- selected_data()
        cat("Locality:", d$locality, "\nPrice per sqft:", format(round(d$price_per_sqft), big.mark = ","),
            "\nYoY change:", d$yoy_change, "%\nForecast 5 years:", format(round(d$forecast_5y), big.mark = ","),
            "\nTier:", as.character(d$tier), "\n")
    })
}

shinyApp(ui = ui, server = server)
