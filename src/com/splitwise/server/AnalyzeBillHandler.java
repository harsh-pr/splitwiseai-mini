package com.splitwise.server;

import com.splitwise.ai.GeminiClient;
import com.splitwise.db.LocalDatabase;
import com.splitwise.util.JsonUtil;
import com.sun.net.httpserver.HttpExchange;

import java.util.LinkedHashMap;
import java.util.Map;

public class AnalyzeBillHandler extends BaseHandler {

    private final GeminiClient geminiClient;

        // init handler
    public AnalyzeBillHandler(LocalDatabase db, GeminiClient geminiClient) {
        super(db);
        this.geminiClient = geminiClient;
    }

        // handle request
    @Override
    protected void handleRequest(HttpExchange exchange) throws Exception {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendError(exchange, 405, "Method not allowed. Use POST.");
            return;
        }

        String body = readRequestBody(exchange);
        Map<String, Object> req = JsonUtil.parseObject(body);

        String imageBase64 = JsonUtil.getString(req, "imageBase64", "");
        String mimeType = JsonUtil.getString(req, "mimeType", "image/jpeg");
        String category = JsonUtil.getString(req, "category", "restaurant");

        if (imageBase64.isEmpty()) {
            sendError(exchange, 400, "Missing 'imageBase64' field with image data.");
            return;
        }

        try {
            Map<String, Object> extractedData = geminiClient.analyzeReceipt(imageBase64, mimeType, category);
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("success", true);
            res.put("data", extractedData);
            sendJson(exchange, 200, res);
        } catch (Exception e) {
            System.err.println("[AnalyzeBillHandler] Error: " + e.getMessage());
            sendError(exchange, 500, "Receipt analysis failed: " + e.getMessage());
        }
    }
}
