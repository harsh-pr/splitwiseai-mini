// Serves static frontend files such as HTML, CSS, JavaScript, and images.
package com.splitwise.server;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;

import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

public class StaticFileHandler implements HttpHandler {

    private final Path webRoot;

    // Sets the root folder path for serving static files
    public StaticFileHandler(String webDir) {
        this.webRoot = Paths.get(webDir).toAbsolutePath().normalize();
    }

    // Serves the requested file or falls back to index.html
    @Override
    public void handle(HttpExchange exchange) throws IOException {
        String method = exchange.getRequestMethod();
        if (!"GET".equalsIgnoreCase(method) && !"HEAD".equalsIgnoreCase(method)) {
            exchange.sendResponseHeaders(405, -1);
            return;
        }

        String rawPath = exchange.getRequestURI().getPath();
        if (rawPath == null || rawPath.equals("/")) {
            rawPath = "/index.html";
        }

        Path targetPath = webRoot.resolve(rawPath.substring(1)).normalize();
        if (!targetPath.startsWith(webRoot) || !Files.exists(targetPath) || Files.isDirectory(targetPath)) {
            targetPath = webRoot.resolve("index.html");
        }

        if (!Files.exists(targetPath)) {
            String notFound = "404 Not Found";
            exchange.sendResponseHeaders(404, notFound.length());
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(notFound.getBytes());
            }
            return;
        }

        String mimeType = getMimeType(targetPath.getFileName().toString());
        exchange.getResponseHeaders().set("Content-Type", mimeType);
        exchange.getResponseHeaders().set("Cache-Control", "no-cache, no-store, must-revalidate");

        long fileSize = Files.size(targetPath);
        exchange.sendResponseHeaders(200, fileSize);

        if ("GET".equalsIgnoreCase(method)) {
            try (OutputStream os = exchange.getResponseBody();
                 FileInputStream fis = new FileInputStream(targetPath.toFile())) {
                byte[] buffer = new byte[8192];
                int read;
                while ((read = fis.read(buffer)) != -1) {
                    os.write(buffer, 0, read);
                }
            }
        }
    }

    // Determines the Content-Type header based on file extension
    private String getMimeType(String filename) {
        String lower = filename.toLowerCase();
        if (lower.endsWith(".html")) return "text/html; charset=UTF-8";
        if (lower.endsWith(".css")) return "text/css; charset=UTF-8";
        if (lower.endsWith(".js")) return "application/javascript; charset=UTF-8";
        if (lower.endsWith(".json")) return "application/json; charset=UTF-8";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        return "application/octet-stream";
    }
}
