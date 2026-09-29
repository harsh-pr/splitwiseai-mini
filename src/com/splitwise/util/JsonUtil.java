// Utility to parse JSON strings and convert Java objects to JSON.
package com.splitwise.util;

import java.util.*;

public class JsonUtil {

    // Converts an object, map, or list into a compact JSON string
    public static String stringify(Object obj) {
        if (obj == null) return "null";
        if (obj instanceof String) {
            return escapeString((String) obj);
        }
        if (obj instanceof Number || obj instanceof Boolean) {
            return obj.toString();
        }
        if (obj instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) obj;
            StringBuilder sb = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) sb.append(",");
                first = false;
                sb.append(escapeString(String.valueOf(entry.getKey())));
                sb.append(":");
                sb.append(stringify(entry.getValue()));
            }
            sb.append("}");
            return sb.toString();
        }
        if (obj instanceof Collection) {
            Collection<?> col = (Collection<?>) obj;
            StringBuilder sb = new StringBuilder("[");
            boolean first = true;
            for (Object item : col) {
                if (!first) sb.append(",");
                first = false;
                sb.append(stringify(item));
            }
            sb.append("]");
            return sb.toString();
        }
        if (obj.getClass().isArray()) {
            Object[] arr = (Object[]) obj;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < arr.length; i++) {
                if (i > 0) sb.append(",");
                sb.append(stringify(arr[i]));
            }
            sb.append("]");
            return sb.toString();
        }
        return escapeString(obj.toString());
    }

    // Formats an object into a pretty-printed JSON string
    public static String stringifyPretty(Object obj) {
        StringBuilder sb = new StringBuilder();
        stringifyPretty(obj, sb, 0);
        return sb.toString();
    }

    // Helper that formats nested objects with line breaks and indentation
    private static void stringifyPretty(Object obj, StringBuilder sb, int indentLevel) {
        if (obj == null) {
            sb.append("null");
            return;
        }
        if (obj instanceof String) {
            sb.append(escapeString((String) obj));
            return;
        }
        if (obj instanceof Number || obj instanceof Boolean) {
            sb.append(obj.toString());
            return;
        }
        if (obj instanceof Map) {
            Map<?, ?> map = (Map<?, ?>) obj;
            if (map.isEmpty()) {
                sb.append("{}");
                return;
            }
            sb.append("{\n");
            int nextIndent = indentLevel + 1;
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) {
                    sb.append(",\n");
                }
                first = false;
                appendIndent(sb, nextIndent);
                sb.append(escapeString(String.valueOf(entry.getKey()))).append(": ");
                stringifyPretty(entry.getValue(), sb, nextIndent);
            }
            sb.append("\n");
            appendIndent(sb, indentLevel);
            sb.append("}");
            return;
        }
        if (obj instanceof Collection) {
            Collection<?> col = (Collection<?>) obj;
            if (col.isEmpty()) {
                sb.append("[]");
                return;
            }
            sb.append("[\n");
            int nextIndent = indentLevel + 1;
            boolean first = true;
            for (Object item : col) {
                if (!first) {
                    sb.append(",\n");
                }
                first = false;
                appendIndent(sb, nextIndent);
                stringifyPretty(item, sb, nextIndent);
            }
            sb.append("\n");
            appendIndent(sb, indentLevel);
            sb.append("]");
            return;
        }
        if (obj.getClass().isArray()) {
            Object[] arr = (Object[]) obj;
            if (arr.length == 0) {
                sb.append("[]");
                return;
            }
            sb.append("[\n");
            int nextIndent = indentLevel + 1;
            for (int i = 0; i < arr.length; i++) {
                if (i > 0) {
                    sb.append(",\n");
                }
                appendIndent(sb, nextIndent);
                stringifyPretty(arr[i], sb, nextIndent);
            }
            sb.append("\n");
            appendIndent(sb, indentLevel);
            sb.append("]");
            return;
        }
        sb.append(escapeString(obj.toString()));
    }

    // Appends indentation spaces to the string builder
    private static void appendIndent(StringBuilder sb, int count) {
        for (int i = 0; i < count; i++) {
            sb.append("  ");
        }
    }

    // Escapes special characters for valid JSON strings
    private static String escapeString(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\b': sb.append("\\b");  break;
                case '\f': sb.append("\\f");  break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < ' ') {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        sb.append("\"");
        return sb.toString();
    }

    // Parses a JSON string into Java Maps, Lists, or primitive values
    public static Object parse(String json) {
        if (json == null) return null;
        json = json.trim();
        while (json.startsWith("\uFEFF")) {
            json = json.substring(1).trim();
        }
        if (json.isEmpty()) return null;
        Parser parser = new Parser(json);
        return parser.parseValue();
    }

    // Parses a JSON string directly into a Map
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String json) {
        Object val = parse(json);
        if (val instanceof Map) {
            return (Map<String, Object>) val;
        }
        return new LinkedHashMap<>();
    }

    // Parses a JSON string directly into a List
    @SuppressWarnings("unchecked")
    public static List<Object> parseArray(String json) {
        Object val = parse(json);
        if (val instanceof List) {
            return (List<Object>) val;
        }
        return new ArrayList<>();
    }

    // Safely reads a string from a map with fallback
    public static String getString(Map<String, Object> map, String key, String defaultVal) {
        if (map == null || !map.containsKey(key) || map.get(key) == null) return defaultVal;
        return String.valueOf(map.get(key));
    }

    // Safely reads a floating point number from a map with fallback
    public static double getDouble(Map<String, Object> map, String key, double defaultVal) {
        if (map == null || !map.containsKey(key) || map.get(key) == null) return defaultVal;
        Object v = map.get(key);
        if (v instanceof Number) return ((Number) v).doubleValue();
        try {
            return Double.parseDouble(String.valueOf(v).replaceAll("[^0-9.-]", ""));
        } catch (Exception e) {
            return defaultVal;
        }
    }

    // Safely reads an integer from a map with fallback
    public static int getInt(Map<String, Object> map, String key, int defaultVal) {
        return (int) getDouble(map, key, defaultVal);
    }

    // Safely reads a boolean from a map with fallback
    public static boolean getBoolean(Map<String, Object> map, String key, boolean defaultVal) {
        if (map == null || !map.containsKey(key) || map.get(key) == null) return defaultVal;
        Object v = map.get(key);
        if (v instanceof Boolean) return (Boolean) v;
        return "true".equalsIgnoreCase(String.valueOf(v));
    }

    // Safely reads a list from a map or returns an empty list
    @SuppressWarnings("unchecked")
    public static List<Object> getList(Map<String, Object> map, String key) {
        if (map == null || !map.containsKey(key) || !(map.get(key) instanceof List)) {
            return new ArrayList<>();
        }
        return (List<Object>) map.get(key);
    }

    // Safely reads a nested map from a map or returns an empty map
    @SuppressWarnings("unchecked")
    public static Map<String, Object> getMap(Map<String, Object> map, String key) {
        if (map == null || !map.containsKey(key) || !(map.get(key) instanceof Map)) {
            return new LinkedHashMap<>();
        }
        return (Map<String, Object>) map.get(key);
    }

    private static class Parser {
        private final String src;
        private int idx = 0;

        // Initializes parser with input JSON string
        Parser(String src) {
            this.src = src;
        }

        // Advances the index past whitespace characters
        private void skipWhitespace() {
            while (idx < src.length() && (Character.isWhitespace(src.charAt(idx)) || src.charAt(idx) == '\uFEFF')) {
                idx++;
            }
        }

        // Parses the next JSON value based on the current character
        Object parseValue() {
            skipWhitespace();
            if (idx >= src.length()) return null;
            char c = src.charAt(idx);
            if (c == '{') return parseObject();
            if (c == '[') return parseArray();
            if (c == '"') return parseString();
            if (c == 't' || c == 'f') return parseBoolean();
            if (c == 'n') return parseNull();
            if (c == '-' || Character.isDigit(c)) return parseNumber();
            throw new RuntimeException("Unexpected character in JSON: " + c + " at index " + idx);
        }

        // Parses a JSON object enclosed in curly braces
        Map<String, Object> parseObject() {
            Map<String, Object> map = new LinkedHashMap<>();
            idx++;
            skipWhitespace();
            if (idx < src.length() && src.charAt(idx) == '}') {
                idx++;
                return map;
            }

            while (idx < src.length()) {
                skipWhitespace();
                String key = parseString();
                skipWhitespace();
                if (idx >= src.length() || src.charAt(idx) != ':') {
                    throw new RuntimeException("Expected ':' after key at " + idx);
                }
                idx++;
                Object val = parseValue();
                map.put(key, val);
                skipWhitespace();
                if (idx < src.length() && src.charAt(idx) == ',') {
                    idx++;
                } else if (idx < src.length() && src.charAt(idx) == '}') {
                    idx++;
                    break;
                } else {
                    throw new RuntimeException("Expected ',' or '}' in object at " + idx);
                }
            }
            return map;
        }

        // Parses a JSON array enclosed in square brackets
        List<Object> parseArray() {
            List<Object> list = new ArrayList<>();
            idx++;
            skipWhitespace();
            if (idx < src.length() && src.charAt(idx) == ']') {
                idx++;
                return list;
            }

            while (idx < src.length()) {
                Object val = parseValue();
                list.add(val);
                skipWhitespace();
                if (idx < src.length() && src.charAt(idx) == ',') {
                    idx++;
                } else if (idx < src.length() && src.charAt(idx) == ']') {
                    idx++;
                    break;
                } else {
                    throw new RuntimeException("Expected ',' or ']' in array at " + idx);
                }
            }
            return list;
        }

        // Parses a quoted JSON string with escape sequence handling
        String parseString() {
            if (src.charAt(idx) != '"') {
                throw new RuntimeException("Expected '\"' at index " + idx);
            }
            idx++;
            StringBuilder sb = new StringBuilder();
            while (idx < src.length()) {
                char c = src.charAt(idx++);
                if (c == '"') {
                    return sb.toString();
                }
                if (c == '\\') {
                    if (idx >= src.length()) break;
                    char esc = src.charAt(idx++);
                    switch (esc) {
                        case '"': sb.append('"'); break;
                        case '\\': sb.append('\\'); break;
                        case '/': sb.append('/'); break;
                        case 'b': sb.append('\b'); break;
                        case 'f': sb.append('\f'); break;
                        case 'n': sb.append('\n'); break;
                        case 'r': sb.append('\r'); break;
                        case 't': sb.append('\t'); break;
                        case 'u':
                            if (idx + 4 <= src.length()) {
                                String hex = src.substring(idx, idx + 4);
                                sb.append((char) Integer.parseInt(hex, 16));
                                idx += 4;
                            }
                            break;
                        default: sb.append(esc);
                    }
                } else {
                    sb.append(c);
                }
            }
            return sb.toString();
        }

        // Parses a true or false JSON literal
        Boolean parseBoolean() {
            if (src.startsWith("true", idx)) {
                idx += 4;
                return Boolean.TRUE;
            }
            if (src.startsWith("false", idx)) {
                idx += 5;
                return Boolean.FALSE;
            }
            throw new RuntimeException("Invalid boolean literal at index " + idx);
        }

        // Parses a null JSON literal
        Object parseNull() {
            if (src.startsWith("null", idx)) {
                idx += 4;
                return null;
            }
            throw new RuntimeException("Invalid null literal at index " + idx);
        }

        // Parses a numeric JSON literal into Long, Double, or Integer
        Number parseNumber() {
            int start = idx;
            if (src.charAt(idx) == '-') idx++;
            while (idx < src.length() && Character.isDigit(src.charAt(idx))) idx++;
            boolean isFloating = false;
            if (idx < src.length() && src.charAt(idx) == '.') {
                isFloating = true;
                idx++;
                while (idx < src.length() && Character.isDigit(src.charAt(idx))) idx++;
            }
            if (idx < src.length() && (src.charAt(idx) == 'e' || src.charAt(idx) == 'E')) {
                isFloating = true;
                idx++;
                if (idx < src.length() && (src.charAt(idx) == '+' || src.charAt(idx) == '-')) idx++;
                while (idx < src.length() && Character.isDigit(src.charAt(idx))) idx++;
            }
            String numStr = src.substring(start, idx);
            if (isFloating) {
                return Double.parseDouble(numStr);
            } else {
                long l = Long.parseLong(numStr);
                if (l >= Integer.MIN_VALUE && l <= Integer.MAX_VALUE) {
                    return (int) l;
                }
                return l;
            }
        }
    }
}
