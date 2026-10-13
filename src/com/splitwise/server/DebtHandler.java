package com.splitwise.server;

import com.splitwise.db.LocalDatabase;
import com.splitwise.dsa.DebtSimplifier;
import com.splitwise.util.JsonUtil;
import com.sun.net.httpserver.HttpExchange;

import java.util.*;

public class DebtHandler extends BaseHandler {

        // init handler
    public DebtHandler(LocalDatabase db) {
        super(db);
    }

        // handle request
    @Override
    protected void handleRequest(HttpExchange exchange) throws Exception {
        String path = exchange.getRequestURI().getPath();
        String method = exchange.getRequestMethod();

        if (!"POST".equalsIgnoreCase(method)) {
            sendError(exchange, 405, "Method not allowed. Use POST.");
            return;
        }

        if ("/api/simplify-debts".equalsIgnoreCase(path)) {
            handleSimplifyDebts(exchange);
        } else if ("/api/settle".equalsIgnoreCase(path)) {
            handleSettle(exchange);
        } else {
            sendError(exchange, 404, "Endpoint not found: " + path);
        }
    }

        // simplify debts
    private void handleSimplifyDebts(HttpExchange exchange) throws Exception {
        Map<String, Object> user = getAuthenticatedUser(exchange);
        String userId = user != null ? JsonUtil.getString(user, "id", "") : "";

        String body = readRequestBody(exchange);
        Map<String, Object> req = JsonUtil.parseObject(body);

        List<DebtSimplifier.Transaction> rawDebts = new ArrayList<>();

        List<Object> explicitDebts = JsonUtil.getList(req, "debts");
        if (!explicitDebts.isEmpty()) {
            for (Object o : explicitDebts) {
                if (o instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> d = (Map<String, Object>) o;
                    String from = JsonUtil.getString(d, "from", "");
                    String to = JsonUtil.getString(d, "to", "");
                    double amount = JsonUtil.getDouble(d, "amount", 0.0);
                    if (!from.isEmpty() && !to.isEmpty() && amount > 0.01) {
                        rawDebts.add(new DebtSimplifier.Transaction(from, to, amount));
                    }
                }
            }
        } else {
            List<Map<String, Object>> bills = db.getBills(userId);
            for (Map<String, Object> b : bills) {
                List<Object> billDebts = JsonUtil.getList(b, "debts");
                for (Object d : billDebts) {
                    if (d instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> dm = (Map<String, Object>) d;
                        String from = JsonUtil.getString(dm, "from", "");
                        String to = JsonUtil.getString(dm, "to", "");
                        double amount = JsonUtil.getDouble(dm, "amount", 0.0);
                        if (!from.isEmpty() && !to.isEmpty() && amount > 0.01) {
                            rawDebts.add(new DebtSimplifier.Transaction(from, to, amount));
                        }
                    }
                }
            }
        }

        List<DebtSimplifier.Transaction> simplified = DebtSimplifier.simplifyDebts(rawDebts);

        List<Map<String, Object>> rawList = new ArrayList<>();
        for (DebtSimplifier.Transaction t : rawDebts) rawList.add(t.toMap());

        List<Map<String, Object>> simplifiedList = new ArrayList<>();
        for (DebtSimplifier.Transaction t : simplified) simplifiedList.add(t.toMap());

        Map<String, Double> netBalances = new LinkedHashMap<>();
        for (DebtSimplifier.Transaction t : rawDebts) {
            netBalances.put(t.from, netBalances.getOrDefault(t.from, 0.0) - t.amount);
            netBalances.put(t.to, netBalances.getOrDefault(t.to, 0.0) + t.amount);
        }
        for (Map.Entry<String, Double> entry : netBalances.entrySet()) {
            netBalances.put(entry.getKey(), Math.round(entry.getValue() * 100.0) / 100.0);
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("rawDebts", rawList);
        res.put("simplifiedDebts", simplifiedList);
        res.put("netBalances", netBalances);
        res.put("originalCount", rawDebts.size());
        res.put("simplifiedCount", simplified.size());

        sendJson(exchange, 200, res);
    }

        // settle debt
    private void handleSettle(HttpExchange exchange) throws Exception {
        Map<String, Object> user = getAuthenticatedUser(exchange);
        String userId = user != null ? JsonUtil.getString(user, "id", "") : "guest";

        String body = readRequestBody(exchange);
        Map<String, Object> req = JsonUtil.parseObject(body);

        String from = JsonUtil.getString(req, "from", "");
        String to = JsonUtil.getString(req, "to", "");
        double amount = JsonUtil.getDouble(req, "amount", 0.0);

        if (from.isEmpty() || to.isEmpty() || amount <= 0.0) {
            sendError(exchange, 400, "Missing 'from', 'to', or valid 'amount'.");
            return;
        }

        Map<String, Object> settlement = new LinkedHashMap<>();
        settlement.put("userId", userId);
        settlement.put("from", from);
        settlement.put("to", to);
        settlement.put("amount", amount);

        db.addSettlement(settlement);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("message", String.format("Settled: %s paid %s ₹%.2f", from, to, amount));
        res.put("settlement", settlement);

        sendJson(exchange, 200, res);
    }
}
