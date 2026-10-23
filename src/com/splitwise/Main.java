package com.splitwise;

import com.splitwise.ai.GeminiClient;
import com.splitwise.db.LocalDatabase;
import com.splitwise.server.*;
import com.splitwise.util.JsonUtil;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.concurrent.Executors;

public class Main {

        // start server
    public static void main(String[] args) {
        System.out.println("================================================================");
        System.out.println("   SplitWise AI - Core Java Server (Zero External Frameworks)   ");
        System.out.println("================================================================");

        Map<String, String> env = loadEnv();

        int port = 8080;
        String portStr = env.getOrDefault("PORT", System.getenv("PORT"));
        if (portStr != null) {
            try {
                port = Integer.parseInt(portStr.trim());
            } catch (NumberFormatException ignored) {}
        }

        String geminiKey = env.getOrDefault("GEMINI_API_KEY", System.getenv("GEMINI_API_KEY"));

        LocalDatabase db = new LocalDatabase("data", "db.json");
        GeminiClient geminiClient = new GeminiClient(geminiKey);

        try {
            HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);

            server.createContext("/api/config", exchange -> {
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                byte[] resp = "{}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, resp.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(resp);
                }
            });
            server.createContext("/api/health", new HealthHandler(geminiClient.isConfigured()));
            server.createContext("/api/auth", new AuthHandler(db));
            server.createContext("/api/bills", new BillHandler(db));
            server.createContext("/api/analyze-bill", new AnalyzeBillHandler(db, geminiClient));
            server.createContext("/api/split-chat", new SplitChatHandler(db, geminiClient));
            server.createContext("/api/simplify-debts", new DebtHandler(db));
            server.createContext("/api/settle", new DebtHandler(db));
            server.createContext("/", new StaticFileHandler("web"));

            server.setExecutor(Executors.newCachedThreadPool());
            server.start();

            System.out.println(String.format(" ✓ Server running at: http://localhost:%d", port));
            System.out.println(" ✓ Database: Accounts (data/users.json) & User-wise splits (data/bills/<userId>.json)");
            System.out.println(" ✓ Auth: Core Java Salted SHA-256 + Session Tokens");
            System.out.println(" ✓ DSA: Greedy Cash-Flow Debt Simplification Engine (PriorityQueue)");
            System.out.println(" ✓ AI Engine: " + (geminiClient.isConfigured() ? "Google Gemini 2.5 Flash (Active)" : "API Key Not Found (Set in .env)"));
            System.out.println("================================================================");
            System.out.println(" Open your browser and visit: http://localhost:" + port);
            System.out.println(" Press Ctrl+C to stop the server.");

        } catch (IOException e) {
            System.err.println("Fatal: Failed to start server on port " + port + ": " + e.getMessage());
            e.printStackTrace();
        }
    }

        // load env
    private static Map<String, String> loadEnv() {
        Map<String, String> env = new HashMap<>();
        Path envPath = Paths.get(".env");
        if (Files.exists(envPath)) {
            try {
                List<String> lines = Files.readAllLines(envPath, StandardCharsets.UTF_8);
                for (String line : lines) {
                    line = line.trim();
                    if (line.isEmpty() || line.startsWith("#")) continue;
                    int idx = line.indexOf("=");
                    if (idx > 0) {
                        String key = line.substring(0, idx).trim();
                        String val = line.substring(idx + 1).trim();
                        env.put(key, val);
                    }
                }
            } catch (IOException e) {
                System.err.println("Note: Could not read .env: " + e.getMessage());
            }
        }
        return env;
    }

    private static class HealthHandler implements HttpHandler {
        private final boolean geminiConfigured;

                // health handler constructor
        public HealthHandler(boolean geminiConfigured) {
            this.geminiConfigured = geminiConfigured;
        }

                // handle health check
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
            exchange.getResponseHeaders().set("Content-Type", "application/json");

            Map<String, Object> health = new LinkedHashMap<>();
            health.put("status", "ok");
            health.put("app", "SplitWise AI (Core Java)");
            health.put("version", "2.0.0");
            health.put("geminiConfigured", geminiConfigured);
            health.put("timestamp", System.currentTimeMillis());

            byte[] bytes = JsonUtil.stringify(health).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        }
    }
}
