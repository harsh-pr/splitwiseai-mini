// Handles creating, reading, updating settlement status, and deleting bills.
package com.splitwise.server;

import com.splitwise.db.LocalDatabase;
import com.splitwise.dsa.DebtSimplifier;
import com.splitwise.util.JsonUtil;
import com.sun.net.httpserver.HttpExchange;

import java.util.*;

public class BillHandler extends BaseHandler {

    // Initializes bill handler with database reference
    public BillHandler(LocalDatabase db) {
        super(db);
    }

    // Routes request to handler method based on HTTP verb
    @Override
    protected void handleRequest(HttpExchange exchange) throws Exception {
        String method = exchange.getRequestMethod();

        if ("GET".equalsIgnoreCase(method)) {
            handleGetBills(exchange);
        } else if ("POST".equalsIgnoreCase(method)) {
            handleCreateBill(exchange);
        } else if ("PUT".equalsIgnoreCase(method) || "PATCH".equalsIgnoreCase(method)) {
            handleUpdateDebt(exchange);
        } else if ("DELETE".equalsIgnoreCase(method)) {
            handleDeleteBill(exchange);
        } else {
            sendError(exchange, 405, "Method not allowed: " + method);
        }
    }

    // Returns all bills belonging to the logged-in user
    private void handleGetBills(HttpExchange exchange) throws Exception {
        Map<String, Object> user = getAuthenticatedUser(exchange);
        String userId = user != null ? JsonUtil.getString(user, "id", "") : "";

        List<Map<String, Object>> bills = db.getBills(userId);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("bills", bills);

        sendJson(exchange, 200, res);
    }

    // Creates a new split bill and calculates debt distributions
    private void handleCreateBill(HttpExchange exchange) throws Exception {
        Map<String, Object> user = getAuthenticatedUser(exchange);
        String userId = user != null ? JsonUtil.getString(user, "id", "") : "guest";

        String body = readRequestBody(exchange);
        Map<String, Object> req = JsonUtil.parseObject(body);

        String title = JsonUtil.getString(req, "title", "Expense").trim();
        String category = JsonUtil.getString(req, "category", "general").trim();
        String payer = JsonUtil.getString(req, "payer", "").trim();
        String upiId = JsonUtil.getString(req, "upiId", "").trim();
        double totalAmount = JsonUtil.getDouble(req, "totalAmount", 0.0);
        double tax = JsonUtil.getDouble(req, "tax", 0.0);
        double tip = JsonUtil.getDouble(req, "tip", 0.0);

        List<Object> rawParts = JsonUtil.getList(req, "participants");
        List<String> participants = new ArrayList<>();
        for (Object p : rawParts) {
            if (p != null && !p.toString().trim().isEmpty()) {
                participants.add(p.toString().trim());
            }
        }

        if (payer.isEmpty()) {
            payer = user != null ? JsonUtil.getString(user, "name", "You") : "You";
        }
        if (!participants.contains(payer)) {
            participants.add(0, payer);
        }

        List<Object> rawItems = JsonUtil.getList(req, "items");
        List<Map<String, Object>> items = new ArrayList<>();
        double calculatedItemsSum = 0.0;
        for (Object o : rawItems) {
            if (o instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> it = (Map<String, Object>) o;
                String name = JsonUtil.getString(it, "name", "Item");
                int qty = Math.max(1, (int) JsonUtil.getDouble(it, "quantity", 1.0));
                double price = JsonUtil.getDouble(it, "price", 0.0);
                calculatedItemsSum += price;

                List<Object> assigned = JsonUtil.getList(it, "assignedTo");
                List<String> assignedClean = new ArrayList<>();
                for (Object a : assigned) {
                    if (a != null && !a.toString().trim().isEmpty()) {
                        assignedClean.add(a.toString().trim());
                    }
                }
                if (assignedClean.isEmpty()) {
                    assignedClean.addAll(participants);
                }

                Map<String, Object> cleanItem = new LinkedHashMap<>();
                cleanItem.put("name", name);
                cleanItem.put("quantity", qty);
                cleanItem.put("price", Math.round(price * 100.0) / 100.0);
                cleanItem.put("assignedTo", assignedClean);
                items.add(cleanItem);
            }
        }

        if (totalAmount <= 0.0) {
            totalAmount = calculatedItemsSum + tax + tip;
        }

        List<DebtSimplifier.Transaction> billDebts = DebtSimplifier.calculateDebtsFromBill(
                payer, participants, items, tax, tip, totalAmount
        );

        Map<String, Boolean> incomingSettled = new HashMap<>();
        List<Object> rawDebts = JsonUtil.getList(req, "debts");
        for (Object rd : rawDebts) {
            if (rd instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> dm = (Map<String, Object>) rd;
                String f = JsonUtil.getString(dm, "from", "").toLowerCase().trim();
                boolean st = JsonUtil.getBoolean(dm, "settled", false);
                if (st) {
                    incomingSettled.put(f, true);
                }
            }
        }

        List<Map<String, Object>> debtMaps = new ArrayList<>();
        for (DebtSimplifier.Transaction t : billDebts) {
            Map<String, Object> dm = t.toMap();
            boolean isSettled = incomingSettled.getOrDefault(t.from.toLowerCase().trim(), false);
            dm.put("settled", isSettled);
            debtMaps.add(dm);
        }

        Map<String, Object> billRecord = new LinkedHashMap<>();
        billRecord.put("id", UUID.randomUUID().toString());
        billRecord.put("userId", userId);
        billRecord.put("title", title);
        billRecord.put("category", category);
        billRecord.put("payer", payer);
        billRecord.put("upiId", upiId);
        billRecord.put("participants", participants);
        billRecord.put("items", items);
        billRecord.put("tax", Math.round(tax * 100.0) / 100.0);
        billRecord.put("tip", Math.round(tip * 100.0) / 100.0);
        billRecord.put("totalAmount", Math.round(totalAmount * 100.0) / 100.0);
        billRecord.put("debts", debtMaps);
        billRecord.put("createdAt", System.currentTimeMillis());

        Map<String, Object> saved = db.addBill(billRecord);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("bill", saved);

        sendJson(exchange, 201, res);
    }

    // Deletes an existing bill by its ID
    private void handleDeleteBill(HttpExchange exchange) throws Exception {
        Map<String, Object> user = getAuthenticatedUser(exchange);
        String userId = user != null ? JsonUtil.getString(user, "id", "") : "";

        Map<String, String> params = parseQueryParams(exchange.getRequestURI().getQuery());
        String billId = params.get("id");

        if (billId == null || billId.isEmpty()) {
            sendError(exchange, 400, "Missing 'id' parameter in query string.");
            return;
        }

        boolean deleted = db.deleteBill(billId, userId);
        if (deleted) {
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("success", true);
            res.put("message", "Bill deleted successfully");
            sendJson(exchange, 200, res);
        } else {
            sendError(exchange, 404, "Bill not found or unauthorized to delete.");
        }
    }

    // Updates settlement status or UPI ID for a bill
    private void handleUpdateDebt(HttpExchange exchange) throws Exception {
        Map<String, Object> user = getAuthenticatedUser(exchange);
        String userId = user != null ? JsonUtil.getString(user, "id", "") : "";

        String body = readRequestBody(exchange);
        Map<String, Object> req = JsonUtil.parseObject(body);

        String billId = JsonUtil.getString(req, "billId", "").trim();
        String personFrom = JsonUtil.getString(req, "from", "").trim();
        String newUpiId = JsonUtil.getString(req, "upiId", "").trim();
        boolean hasSettled = req.containsKey("settled");
        boolean settled = JsonUtil.getBoolean(req, "settled", true);

        if (billId.isEmpty()) {
            sendError(exchange, 400, "Missing 'billId' parameter.");
            return;
        }

        boolean updated = false;
        if (!newUpiId.isEmpty()) {
            updated = db.updateBillUpi(billId, newUpiId, userId);
        }
        if (hasSettled || !personFrom.isEmpty()) {
            updated = db.updateBillDebtStatus(billId, personFrom, settled, userId) || updated;
        }

        if (updated) {
            Map<String, Object> res = new LinkedHashMap<>();
            res.put("success", true);
            res.put("message", "Bill updated successfully.");
            sendJson(exchange, 200, res);
        } else {
            sendError(exchange, 404, "Bill not found or unauthorized to update.");
        }
    }
}
