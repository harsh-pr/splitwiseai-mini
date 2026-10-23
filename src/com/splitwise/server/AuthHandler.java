package com.splitwise.server;

import com.splitwise.db.LocalDatabase;
import com.splitwise.util.JsonUtil;
import com.sun.net.httpserver.HttpExchange;

import java.util.LinkedHashMap;
import java.util.Map;

public class AuthHandler extends BaseHandler {

        // init handler
    public AuthHandler(LocalDatabase db) {
        super(db);
    }

        // handle auth routes
    @Override
    protected void handleRequest(HttpExchange exchange) throws Exception {
        String path = exchange.getRequestURI().getPath();
        String method = exchange.getRequestMethod();

        if ("/api/auth/register".equalsIgnoreCase(path)) {
            if (!"POST".equalsIgnoreCase(method)) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }
            handleRegister(exchange);
        } else if ("/api/auth/login".equalsIgnoreCase(path)) {
            if (!"POST".equalsIgnoreCase(method)) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }
            handleLogin(exchange);
        } else if ("/api/auth/me".equalsIgnoreCase(path)) {
            if ("PUT".equalsIgnoreCase(method)) {
                handleUpdateUpi(exchange);
            } else if ("GET".equalsIgnoreCase(method)) {
                handleMe(exchange);
            } else {
                sendError(exchange, 405, "Method not allowed");
            }
        } else if ("/api/auth/upi".equalsIgnoreCase(path)) {
            if (!"PUT".equalsIgnoreCase(method) && !"POST".equalsIgnoreCase(method)) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }
            handleUpdateUpi(exchange);
        } else if ("/api/auth/logout".equalsIgnoreCase(path)) {
            if (!"POST".equalsIgnoreCase(method)) {
                sendError(exchange, 405, "Method not allowed");
                return;
            }
            handleLogout(exchange);
        } else {
            sendError(exchange, 404, "Auth endpoint not found: " + path);
        }
    }

        // register
    private void handleRegister(HttpExchange exchange) throws Exception {
        String body = readRequestBody(exchange);
        Map<String, Object> req = JsonUtil.parseObject(body);

        String name = JsonUtil.getString(req, "name", "").trim();
        String email = JsonUtil.getString(req, "email", "").trim();
        String password = JsonUtil.getString(req, "password", "").trim();

        if (name.isEmpty() || email.isEmpty() || password.isEmpty()) {
            sendError(exchange, 400, "Name, email, and password are required.");
            return;
        }

        if (password.length() < 4) {
            sendError(exchange, 400, "Password must be at least 4 characters.");
            return;
        }

        Map<String, Object> user = db.registerUser(name, email, password);
        if (user == null) {
            sendError(exchange, 409, "User with this email already exists.");
            return;
        }

        String userId = JsonUtil.getString(user, "id", "");
        String token = db.createSession(userId);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("token", token);
        res.put("user", user);

        sendJson(exchange, 201, res);
    }

        // login
    private void handleLogin(HttpExchange exchange) throws Exception {
        String body = readRequestBody(exchange);
        Map<String, Object> req = JsonUtil.parseObject(body);

        String email = JsonUtil.getString(req, "email", "").trim();
        String password = JsonUtil.getString(req, "password", "").trim();

        if (email.isEmpty() || password.isEmpty()) {
            sendError(exchange, 400, "Email and password are required.");
            return;
        }

        Map<String, Object> user = db.authenticate(email, password);
        if (user == null) {
            sendError(exchange, 401, "Invalid email or password.");
            return;
        }

        String userId = JsonUtil.getString(user, "id", "");
        String token = db.createSession(userId);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("token", token);
        res.put("user", user);

        sendJson(exchange, 200, res);
    }

        // get me
    private void handleMe(HttpExchange exchange) throws Exception {
        Map<String, Object> user = getAuthenticatedUser(exchange);
        if (user == null) {
            sendError(exchange, 401, "Not authenticated or session expired.");
            return;
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("user", user);

        sendJson(exchange, 200, res);
    }

        // update upi
    private void handleUpdateUpi(HttpExchange exchange) throws Exception {
        Map<String, Object> user = getAuthenticatedUser(exchange);
        if (user == null) {
            sendError(exchange, 401, "Not authenticated or session expired.");
            return;
        }

        String body = readRequestBody(exchange);
        Map<String, Object> req = JsonUtil.parseObject(body);
        String upiId = JsonUtil.getString(req, "upiId", "").trim();

        if (upiId.isEmpty()) {
            sendError(exchange, 400, "UPI ID is required.");
            return;
        }

        String userId = JsonUtil.getString(user, "id", "");
        boolean updated = db.updateUserUpi(userId, upiId);

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", updated);
        res.put("upiId", upiId);

        sendJson(exchange, 200, res);
    }

        // logout
    private void handleLogout(HttpExchange exchange) throws Exception {
        String authHeader = exchange.getRequestHeaders().getFirst("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7).trim();
            db.removeSession(token);
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("success", true);
        res.put("message", "Logged out successfully");

        sendJson(exchange, 200, res);
    }
}
