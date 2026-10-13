library(shiny)
library(plotly)
library(dplyr)
library(DT)

generate_market_data <- function(seed = 42) {
  set.seed(seed)
  df <- data.frame(
    locality = c("Whitefield", "Koramangala", "Indiranagar", "HSR Layout", "Marathahalli",
                 "Electronic City", "Jayanagar", "Rajajinagar", "Hebbal", "Yelahanka"),
    price_per_sqft = c(7200, 12500, 11800, 10200, 7800, 6200, 11000, 9500, 8800, 7000),
    yoy_change = c(7.2, 5.1, 4.8, 6.3, 8.1, 9.5, 4.2, 5.7, 6.9, 7.8),
    inflation = c(5.8, 5.2, 5.0, 5.5, 6.1, 6.5, 4.8, 5.3, 5.9, 6.2)
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
      sliderInput("top_n", "Localities to compare", min = 3, max = 10, value = 6, step = 1)
    ),
    mainPanel(
      tabsetPanel(
        tabPanel("Price Distribution", plotlyOutput("histPlot", height = "400px"), plotlyOutput("barPlot", height = "400px")),
        tabPanel("Forecast Comparison", plotlyOutput("forecastPlot", height = "500px")),
        tabPanel("Affordability Table", DTOutput("tableOut")),
        tabPanel("Statistical Summary", verbatimTextOutput("summaryOut"))
      )
    )
  )
)

server <- function(input, output) {
  selected_data <- reactive({ market_data %>% filter(locality == input$locality) })
  top_data <- reactive({ market_data %>% arrange(desc(price_per_sqft)) %>% slice_head(n = input$top_n) })
  
  output$histPlot <- renderPlotly({
    plot_ly(market_data, x = ~price_per_sqft, type = "histogram", nbinsx = 8,
            marker = list(color = "#1e1e1e")) %>%
      layout(title = "Distribution of Price per Square Foot",
             xaxis = list(title = "Price per sqft (INR)"),
             yaxis = list(title = "Frequency"))
  })
  
  output$barPlot <- renderPlotly({
    d <- top_data()
    plot_ly(d, x = ~reorder(locality, -price_per_sqft), y = ~price_per_sqft, type = "bar",
            color = ~tier, colors = c("Budget" = "#2e7d32", "Mid-Tier" = "#e65100", "Luxury" = "#b71c1c")) %>%
      layout(title = paste("Top", input$top_n, "Localities by Price per sqft"),
             xaxis = list(title = "Locality"),
             yaxis = list(title = "Price per sqft (INR)"))
  })
  
  output$forecastPlot <- renderPlotly({
    d <- market_data %>% select(locality, price_per_sqft, forecast_6m, forecast_2y, forecast_5y)
    plot_ly(d, x = ~locality, y = ~price_per_sqft, type = "scatter", mode = "lines+markers", name = "Now") %>%
      add_trace(y = ~forecast_6m, name = "6 Months") %>%
      add_trace(y = ~forecast_2y, name = "2 Years") %>%
      add_trace(y = ~forecast_5y, name = "5 Years") %>%
      layout(title = "Projected Price Appreciation",
             xaxis = list(title = "Locality"),
             yaxis = list(title = "Price per sqft (INR)"))
  })
  
  output$tableOut <- renderDT({
    market_data %>% arrange(desc(price_per_sqft)) %>%
      select(Locality = locality, `Price / sqft` = price_per_sqft,
             `6M Forecast` = forecast_6m, `2Y Forecast` = forecast_2y,
             `5Y Forecast` = forecast_5y, Tier = tier) %>%
      datatable(options = list(pageLength = 10), rownames = FALSE)
  })
  
  output$summaryOut <- renderPrint({
    d <- selected_data()
    cat("Locality:", d$locality, "\nPrice per sqft:", format(round(d$price_per_sqft), big.mark = ","),
        "\nYoY change:", d$yoy_change, "%\nForecast 5 years:", format(round(d$forecast_5y), big.mark = ","),
        "\nTier:", as.character(d$tier), "\n")
  })
}

shinyApp(ui = ui, server = server)