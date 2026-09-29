// Base class for HTTP handlers with CORS, request reading, and JSON responses.
package com.splitwise.server;

import com.splitwise.db.LocalDatabase;
import com.splitwise.util.JsonUtil;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public abstract class BaseHandler implements HttpHandler {

    protected final LocalDatabase db;

    // Initializes base handler with local database reference
    public BaseHandler(LocalDatabase db) {
        this.db = db;
    }

    // Handles CORS preflight and delegates request execution
    @Override
    public void handle(HttpExchange exchange) throws IOException {
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, Authorization");

        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            return;
        }

        try {
            handleRequest(exchange);
        } catch (Exception e) {
            e.printStackTrace();
            sendError(exchange, 500, "Internal server error: " + e.getMessage());
        }
    }

    // Abstract method implemented by specific API route handlers
    protected abstract void handleRequest(HttpExchange exchange) throws Exception;

    // Reads the incoming HTTP request body string
    protected String readRequestBody(HttpExchange exchange) throws IOException {
        InputStream is = exchange.getRequestBody();
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = is.read(buffer)) != -1) {
            baos.write(buffer, 0, read);
        }
        return baos.toString(StandardCharsets.UTF_8);
    }

    // Sends a JSON response with given HTTP status code
    protected void sendJson(HttpExchange exchange, int statusCode, Object data) throws IOException {
        String json = JsonUtil.stringify(data);
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=UTF-8");
        exchange.sendResponseHeaders(statusCode, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    // Sends a standard error response as JSON
    protected void sendError(HttpExchange exchange, int statusCode, String message) throws IOException {
        Map<String, Object> err = new LinkedHashMap<>();
        err.put("success", false);
        err.put("error", message);
        sendJson(exchange, statusCode, err);
    }

    // Retrieves current logged-in user from the Bearer token
    protected Map<String, Object> getAuthenticatedUser(HttpExchange exchange) {
        String authHeader = exchange.getRequestHeaders().getFirst("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return null;
        }
        String token = authHeader.substring(7).trim();
        return db.getUserByToken(token);
    }

    // Parses URL query parameters into a key-value map
    protected Map<String, String> parseQueryParams(String query) {
        Map<String, String> params = new LinkedHashMap<>();
        if (query == null || query.isEmpty()) return params;
        String[] pairs = query.split("&");
        for (String pair : pairs) {
            int idx = pair.indexOf("=");
            if (idx > 0) {
                params.put(pair.substring(0, idx), pair.substring(idx + 1));
            } else {
                params.put(pair, "");
            }
        }
        return params;
    }
}
