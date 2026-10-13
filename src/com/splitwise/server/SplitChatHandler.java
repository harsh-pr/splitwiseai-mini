package com.splitwise.server;

import com.splitwise.ai.GeminiClient;
import com.splitwise.db.LocalDatabase;
import com.splitwise.util.JsonUtil;
import com.sun.net.httpserver.HttpExchange;

import java.util.*;

public class SplitChatHandler extends BaseHandler {

    private final GeminiClient geminiClient;

        // init handler
    public SplitChatHandler(LocalDatabase db, GeminiClient geminiClient) {
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
        if (body == null || body.trim().isEmpty()) {
            sendError(exchange, 400, "Empty request body.");
            return;
        }

        Map<String, Object> req;
        try {
            req = JsonUtil.parseObject(body);
        } catch (Exception e) {
            sendError(exchange, 400, "Invalid JSON payload: " + e.getMessage());
            return;
        }

        String prompt = JsonUtil.getString(req, "prompt", "").trim();
        if (prompt.isEmpty()) {
            sendError(exchange, 400, "Missing 'prompt' field in request.");
            return;
        }

        List<Object> rawItems = JsonUtil.getList(req, "items");
        List<Map<String, Object>> items = new ArrayList<>();
        for (Object o : rawItems) {
            if (o instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> it = (Map<String, Object>) o;
                items.add(it);
            }
        }

        List<Object> rawParts = JsonUtil.getList(req, "participants");
        List<String> participants = new ArrayList<>();
        for (Object p : rawParts) {
            if (p != null && !p.toString().trim().isEmpty()) {
                String pStr = p.toString().trim();
                if (!pStr.equalsIgnoreCase("you")) {
                    participants.add(pStr);
                }
            }
        }

        String category = JsonUtil.getString(req, "category", "restaurant");
        String rawPayer = JsonUtil.getString(req, "payer", "");
        String payer = rawPayer.equalsIgnoreCase("you") ? "" : rawPayer;
        double totalAmount = JsonUtil.getDouble(req, "totalAmount", 0.0);

        try {
            Map<String, Object> result = geminiClient.splitChat(prompt, items, participants, category, payer, totalAmount);
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("success", true);
            res.put("assistantMessage", JsonUtil.getString(result, "assistantMessage", "Allocated items according to prompt."));
            res.put("updatedParticipants", result.getOrDefault("updatedParticipants", participants));
            res.put("updatedItems", result.getOrDefault("updatedItems", items));
            res.put("payer", result.get("payer"));
            sendJson(exchange, 200, res);
        } catch (Exception e) {
            System.err.println("[SplitChatHandler] Error: " + e.getMessage());
            sendError(exchange, 500, "Split Assistant failed: " + e.getMessage());
        }
    }
}
