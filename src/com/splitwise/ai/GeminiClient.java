package com.splitwise.ai;

import com.splitwise.util.JsonUtil;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.LocalDate;
import java.util.*;

public class GeminiClient {

    private final String apiKey;
    private final HttpClient httpClient;

    private static final String[] MODELS = {
        "gemini-flash-lite-latest",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest",
        "gemini-2.5-flash"
    };

        // init client
    public GeminiClient(String apiKey) {
        this.apiKey = apiKey != null ? apiKey.trim() : "";
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .build();
    }

        // check configured
    public boolean isConfigured() {
        return apiKey != null && !apiKey.isEmpty() && !apiKey.startsWith("YOUR_");
    }

        // analyze bill image
    public Map<String, Object> analyzeReceipt(String base64Image, String mimeType, String category) throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException("GEMINI_API_KEY is not configured in .env file.");
        }

        if (base64Image == null || base64Image.trim().isEmpty()) {
            throw new IllegalArgumentException("No receipt image provided.");
        }

        String cleanBase64 = base64Image.replaceAll("^data:[^;]+;base64,", "").replaceAll("\\s+", "");
        if (mimeType == null || mimeType.isEmpty()) {
            mimeType = "image/jpeg";
        }

        String cat = (category != null && !category.trim().isEmpty()) ? category.trim().toLowerCase() : "restaurant";

        String prompt = "You are an expert OCR and financial receipt parsing engine.\n"
                + "Selected expense category: " + cat + ".\n"
                + "Input can be a printed receipt, handwritten bill slip, digital invoice, utility bill, or app screenshot (e.g. GPay, PhonePe, Paytm, Blinkit, Zepto, DMart, BookMyShow, BESCOM/MSEDCL electricity bill).\n\n"
                + "EXTRACTION RULES BY CATEGORY:\n"
                + "1. 'merchantName': Merchant, store, supermarket (e.g. 'D Mart', 'Reliance Fresh', 'Blinkit'), restaurant, utility board, or UPI recipient name.\n"
                + "2. 'date': Transaction or bill issue date in YYYY-MM-DD format (if missing, use '" + LocalDate.now() + "').\n"
                + "3. 'items': Array of all purchased or billed line items:\n"
                + "   - For grocery/mart receipts (like D-Mart): Extract each purchased product.\n"
                + "     * 'name': Product name from 'Particulars' column.\n"
                + "     * 'quantity': Count from 'Qty' column (integer, default 1).\n"
                + "     * 'price': Final charged line total from 'Value' or 'Amount' column after discounts.\n"
                + "   - For 'restaurant': All dishes, beverages, starters.\n"
                + "   - For 'utilities' (Electricity, Water, Gas, Broadband, Flat Maintenance):\n"
                + "     * Specialized support for Indian Electricity & Utility Bills (e.g. MSEDCL / Mahavitaran, BESCOM, Tata Power, Adani Electricity, BSES, Torrent, UPPCL, TNEB):\n"
                + "     * MULTILINGUAL (MARATHI / HINDI) KEY MAPPINGS:\n"
                + "       - 'ग्राहक नाव' / 'Customer Name' -> consumerName (e.g. 'SHASHI RANJAN PRASAD')\n"
                + "       - 'ग्राहक क्रमांक' / 'उपभोक्ता संख्या' / Consumer Number -> consumerNumber (e.g. '020260315243')\n"
                + "       - 'एकूण वापर' / 'युनिट' / Total Units -> unitsConsumed (e.g. '214 Units')\n"
                + "       - 'देयक महिना' / 'बिल माह' / Billing Month -> billingMonth (e.g. 'September 2026')\n"
                + "       - 'देयक दिनांक' / Bill Date -> date (e.g. '2026-09-15')\n"
                + "       - 'देय दिनांक' / Due Date -> dueDate (e.g. '2026-10-05')\n"
                + "       - 'billingDays': Integer number of days covered by this bill (e.g. 30, 31, 28). If bill explicitly states days or billing period dates (e.g. '01/08/2026 to 31/08/2026' -> 31 days, or 'कालावधी' / 'दिवस' / 'Billing cycle: 30 days'), extract that exact number. If not mentioned, all utility bills are monthly, so determine days from billingMonth (e.g. 30 for Sep/Apr/Jun/Nov, 31 for Jan/Mar/May/Jul/Aug/Oct/Dec, 28 for Feb) or default to 30.\n"
                + "       - 'billingPeriod': Short human-readable summary of the billing cycle (e.g. 'September 2026 (30 Days)' or '30 Days • Monthly Bill').\n"
                + "       - 'देयक रक्कम' / 'पूर्णांक देयक' / 'Net Payable' -> 'total' (e.g. 2420.00). Use this exact rounded payable amount as 'total'.\n"
                + "       - 'स्थिर आकार' / 'स्थायी प्रभार' -> 'Fixed Charges (स्थिर आकार)'\n"
                + "       - 'वीज आकार' / 'ऊर्जा प्रभार' -> 'Energy Charges (वीज आकार)'\n"
                + "       - 'वहन आकार' -> 'Wheeling Charges (वहन आकार)'\n"
                + "       - 'इंधन समायोजन आकार' (FAC) -> 'Fuel Adjustment Charges (इंधन समायोजन)'\n"
                + "       - 'वीज शुल्क' -> 'Electricity Duty (वीज शुल्क 16%)'\n"
                + "     * CRITICAL LINE ITEM ACCURACY RULES FOR UTILITIES:\n"
                + "       1. Every item price MUST be a strictly positive number (> 0).\n"
                + "       2. NEVER include zero-rupee rows (e.g. 0.0 sales tax, 0.0 other charges). Omit them.\n"
                + "       3. NEVER output negative price items. If the bill has minor credit adjustments, arrears, prompt discount, or rounding adjustments (e.g. 'समायोजित रक्कम -26.60', 'एकूण थकबाकी -0.71', 'पूर्णांक राउंडिंग -2.41', net difference -3.12):\n"
                + "          DO NOT create separate negative items! Instead, NET/ABSORB this difference into the main variable 'Energy Charges' line item, so that:\n"
                + "          The sum of items (Fixed + Wheeling + Fuel + Duty + Energy) EXACTLY EQUALS the final rounded payable total ('देयक रक्कम' / 'पूर्णांक देयक', e.g. 2420.00).\n"
                + "          Keep 'Fixed Charges' (140.00), 'Wheeling Charges' (342.40), and 'Duty' (334.22) exact as printed on the bill!\n"
                + "     * Specialized support for Wi-Fi & Broadband Invoices (e.g. Tata Play Fiber, JioFiber, Airtel Xstream, ACT Fibernet):\n"
                + "       - 'merchantName': Provider name (e.g. 'Tata Play Fiber')\n"
                + "       - 'total': Final payable amount (e.g. 1178.82)\n"
                + "       - 'items': Extract base broadband plan charge under 'items' (e.g. '100 Mbps Unlimited - 1 Month' price 999.0).\n"
                + "       - 'tax': IGST or CGST+SGST amount (e.g. 179.82). Keep tax separated in 'tax' field.\n"
                + "       - 'taxInclusive': Set to false if tax is charged on top of base plan amount, or true if already included.\n"
                + "       - 'billingDays': Integer days in service period (e.g. 30, 31, 90). If period is '01-09-2026 to 30-09-2026', calculate 30 days. Default to 30 for monthly.\n"
                + "       - 'billingPeriod': Human-readable period summary (e.g. '01 Sep 2026 - 30 Sep 2026 (30 Days)').\n"
                + "   - For 'entertainment' (Movie tickets, Events, Concerts, BookMyShow, PVR, INOX):\n"
                + "     * 'merchantName': Cinema or booking platform (e.g. 'PVR Cinemas', 'BookMyShow', 'INOX').\n"
                + "     * 'items': STRICTLY actual tickets and concessions (popcorn, beverages, food combos).\n"
                + "     * STRICT PROHIBITION ON TAX & FEE LINE ITEMS: NEVER include 'Booking Charge', 'Convenience Fee', 'Platform Fee', 'Internet Handling Fee', 'IGST', 'CGST', 'SGST', or 'GST' in the 'items' array! These are not items!\n"
                + "     * Sum up all booking fees, convenience charges, and platform fees into the 'tip' field (e.g. 70.80).\n"
                + "     * Sum up all taxes (GST, CGST, SGST, IGST) into the 'tax' field (e.g. 10.80).\n"
                + "     * Set 'taxInclusive' to false if fees and taxes are added on top of ticket base prices.\n"
                + "   - For UPI Payment Screenshots (GPay, PhonePe, Paytm):\n"
                + "     * 'total': Transaction amount paid.\n"
                + "     * 'merchantName': Recipient person or business name.\n"
                + "     * 'items': Single lump sum item named after recipient (quantity: 1, price: total).\n"
                + "4. 'subtotal': Raw sum of line items before taxes.\n"
                + "5. 'tax': Tax or GST amount printed on the receipt. For utilities bills (e.g. MSEDCL), if 'Electricity Duty' (वीज शुल्क) is listed, put that duty amount here (e.g. 334.22) so it displays in the summary.\n"
                + "6. 'taxInclusive': Boolean. In India, most retail, restaurant, and utility bills already include taxes in line item prices or final payable amount (e.g. MSEDCL electricity bills, D-Mart receipts, MRP groceries). Set to true if the total matches or includes items sum. Set to false ONLY if tax is explicitly added as an extra surcharge at the bottom.\n"
                + "7. 'tip': Service charge, delivery charge, packaging fee, or booking/convenience fee.\n"
                + "8. 'total': Final grand total payable.\n"
                + "9. 'confidence': OCR accuracy estimation (e.g. '95%').\n\n"
                + "Respond STRICTLY with raw JSON matching this structure without markdown fences:\n"
                + "{\n"
                + "  \"merchantName\": \"Store / Merchant / Utility Board\",\n"
                + "  \"date\": \"YYYY-MM-DD\",\n"
                + "  \"category\": \"" + cat + "\",\n"
                + "  \"consumerName\": \"Consumer Name if present\",\n"
                + "  \"consumerNumber\": \"Consumer Number if present\",\n"
                + "  \"unitsConsumed\": \"Units e.g. 214 Units\",\n"
                + "  \"billingMonth\": \"Billing Month e.g. September 2026\",\n"
                + "  \"billingDays\": 30,\n"
                + "  \"billingPeriod\": \"September 2026 (30 Days)\",\n"
                + "  \"items\": [\n"
                + "    { \"name\": \"Item name\", \"quantity\": 1, \"price\": 100.0 }\n"
                + "  ],\n"
                + "  \"subtotal\": 100.0,\n"
                + "  \"tax\": 0.0,\n"
                + "  \"taxInclusive\": true,\n"
                + "  \"tip\": 0.0,\n"
                + "  \"total\": 100.0,\n"
                + "  \"confidence\": \"95%\"\n"
                + "}";

        Map<String, Object> textPart = new LinkedHashMap<>();
        textPart.put("text", prompt);

        Map<String, Object> inlineData = new LinkedHashMap<>();
        inlineData.put("mimeType", mimeType);
        inlineData.put("data", cleanBase64);

        Map<String, Object> imagePart = new LinkedHashMap<>();
        imagePart.put("inlineData", inlineData);

        Map<String, Object> contentObj = new LinkedHashMap<>();
        contentObj.put("parts", Arrays.asList(textPart, imagePart));

        Map<String, Object> generationConfig = new LinkedHashMap<>();
        generationConfig.put("responseMimeType", "application/json");
        generationConfig.put("temperature", 0.1);

        Map<String, Object> requestBodyMap = new LinkedHashMap<>();
        requestBodyMap.put("contents", Collections.singletonList(contentObj));
        requestBodyMap.put("generationConfig", generationConfig);

        String jsonPayload = JsonUtil.stringify(requestBodyMap);
        String rawResponseText = executeWithWaterfall(jsonPayload);

        String cleanedText = cleanJsonMarkdown(rawResponseText);
        Map<String, Object> parsed = JsonUtil.parseObject(cleanedText);

        List<Object> rawItems = JsonUtil.getList(parsed, "items");
        List<Map<String, Object>> cleanItems = new ArrayList<>();
        double itemsSum = 0.0;
        double parsedTax = JsonUtil.getDouble(parsed, "tax", 0.0);
        double parsedTip = JsonUtil.getDouble(parsed, "tip", 0.0);
        double parsedTotal = JsonUtil.getDouble(parsed, "total", 0.0);
        String mName = JsonUtil.getString(parsed, "merchantName", "Scanned Bill");

        for (Object o : rawItems) {
            if (o instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> it = (Map<String, Object>) o;
                String name = JsonUtil.getString(it, "name", "Item").trim();
                double price = JsonUtil.getDouble(it, "price", 0.0);
                if (price <= 0.001) continue;

                if (isTaxLineItem(name, cat)) {
                    if (parsedTax <= 0.001) parsedTax = price;
                    continue;
                }
                if (isFeeOrChargeLineItem(name, cat)) {
                    if (parsedTip <= 0.001) parsedTip = price;
                    continue;
                }

                int qty = 1;
                if (it.containsKey("quantity")) {
                    qty = JsonUtil.getInt(it, "quantity", 1);
                } else if (it.containsKey("qty")) {
                    qty = JsonUtil.getInt(it, "qty", 1);
                }
                int safeQty = Math.max(1, qty);

                Map<String, Object> cleanItem = new LinkedHashMap<>();
                cleanItem.put("name", name);
                cleanItem.put("quantity", safeQty);
                cleanItem.put("price", Math.round(price * 100.0) / 100.0);
                cleanItem.put("unitPrice", Math.round((price / safeQty) * 100.0) / 100.0);
                cleanItem.put("assignedTo", new ArrayList<>());

                cleanItems.add(cleanItem);
                itemsSum += price;
            }
        }

        if (cleanItems.isEmpty() && parsedTotal > 0) {
            Map<String, Object> fallback = new LinkedHashMap<>();
            fallback.put("name", mName);
            fallback.put("quantity", 1);
            fallback.put("price", parsedTotal);
            fallback.put("unitPrice", parsedTotal);
            fallback.put("assignedTo", new ArrayList<>());
            cleanItems.add(fallback);
            itemsSum = parsedTotal;
        }

        boolean isTaxAlreadyIncluded = false;
        if (parsed.containsKey("taxInclusive")) {
            isTaxAlreadyIncluded = JsonUtil.getBoolean(parsed, "taxInclusive", true);
        } else {
            isTaxAlreadyIncluded = true;
        }

        if (parsedTotal > 0 && parsedTax > 0) {
            if (Math.abs((itemsSum + parsedTax + parsedTip) - parsedTotal) <= 1.0) {
                isTaxAlreadyIncluded = false;
            } else if (Math.abs((itemsSum + parsedTip) - parsedTotal) <= 1.0) {
                isTaxAlreadyIncluded = true;
            } else if ("utilities".equalsIgnoreCase(cat)) {
                isTaxAlreadyIncluded = true;
            } else {
                double threshold = Math.max(50.0, parsedTotal * 0.05);
                if (Math.abs(itemsSum - parsedTotal) <= threshold) {
                    isTaxAlreadyIncluded = true;
                }
            }

            if (isTaxAlreadyIncluded) {
                parsed.put("taxInclusive", true);
                if (parsedTax > 0) {
                    parsed.put("tax", parsedTax);
                    parsed.put("infoGst", parsedTax);
                } else {
                    parsed.put("tax", 0.0);
                }

                double diff = Math.round((itemsSum - parsedTotal) * 100.0) / 100.0;
                if (Math.abs(diff) > 0.01 && Math.abs(diff) <= Math.max(50.0, parsedTotal * 0.05) && !cleanItems.isEmpty()) {
                    Map<String, Object> targetItem = findBestTargetItemForAdjustment(cleanItems);
                    if (targetItem != null) {
                        double p = JsonUtil.getDouble(targetItem, "price", 0.0);
                        if (p > Math.abs(diff) + 1.0) {
                            targetItem.put("price", Math.round((p - diff) * 100.0) / 100.0);
                        }
                    }
                }
            } else {
                parsed.put("taxInclusive", false);
                parsed.put("tax", parsedTax);
            }
        } else {
            parsed.put("tax", parsedTax);
        }

        parsed.put("tip", parsedTip);
        if (parsedTotal > 0) {
            parsed.put("total", parsedTotal);
        } else {
            double effectiveTax = isTaxAlreadyIncluded ? 0.0 : parsedTax;
            parsed.put("total", Math.round((itemsSum + effectiveTax + parsedTip) * 100.0) / 100.0);
        }

        String cName = JsonUtil.getString(parsed, "consumerName", "");
        String cNum = JsonUtil.getString(parsed, "consumerNumber", "");
        String units = JsonUtil.getString(parsed, "unitsConsumed", "");
        String month = JsonUtil.getString(parsed, "billingMonth", "");

        if ("utilities".equalsIgnoreCase(cat)) {
            List<String> metaParts = new ArrayList<>();
            if (!units.isEmpty()) metaParts.add(units.endsWith("Units") ? units : units + " Units");
            if (!month.isEmpty()) metaParts.add(month);
            if (!cNum.isEmpty()) metaParts.add("Cons #" + cNum);
            if (!cName.isEmpty()) metaParts.add(cName);

            if (!metaParts.isEmpty()) {
                String metaStr = String.join(" • ", metaParts);
                parsed.put("categorySubtitle", mName + " (" + metaStr + ")");
            }

            int bDays = JsonUtil.getInt(parsed, "billingDays", 0);
            if (bDays <= 0 || bDays > 366) {
                String lowerMonth = month.toLowerCase();
                if (lowerMonth.contains("feb")) {
                    bDays = 28;
                } else if (lowerMonth.contains("apr") || lowerMonth.contains("jun") || lowerMonth.contains("sep") || lowerMonth.contains("nov")) {
                    bDays = 30;
                } else if (lowerMonth.contains("jan") || lowerMonth.contains("mar") || lowerMonth.contains("may") || lowerMonth.contains("jul") || lowerMonth.contains("aug") || lowerMonth.contains("oct") || lowerMonth.contains("dec")) {
                    bDays = 31;
                } else {
                    bDays = 30;
                }
            }
            parsed.put("billingDays", bDays);
            String bPeriod = JsonUtil.getString(parsed, "billingPeriod", "").trim();
            if (bPeriod.isEmpty()) {
                if (!month.isEmpty()) {
                    bPeriod = month + " (" + bDays + " Days)";
                } else {
                    bPeriod = bDays + " Days (Monthly Bill)";
                }
            }
            parsed.put("billingPeriod", bPeriod);
        }

        parsed.put("items", cleanItems);

        return parsed;
    }

        // adjust rounding difference
    private Map<String, Object> findBestTargetItemForAdjustment(List<Map<String, Object>> items) {
        if (items == null || items.isEmpty()) return null;
        for (Map<String, Object> it : items) {
            String name = JsonUtil.getString(it, "name", "").toLowerCase();
            if (name.contains("energy") || name.contains("ऊर्जा") || name.contains("वीज आकार")
                    || name.contains("main") || name.contains("broadband") || name.contains("ticket")) {
                return it;
            }
        }
        Map<String, Object> largest = items.get(0);
        double maxPrice = JsonUtil.getDouble(largest, "price", 0.0);
        for (Map<String, Object> it : items) {
            double p = JsonUtil.getDouble(it, "price", 0.0);
            if (p > maxPrice) {
                maxPrice = p;
                largest = it;
            }
        }
        return largest;
    }

        // clean json response
    private String cleanJsonMarkdown(String raw) {
        if (raw == null) return "{}";
        String s = raw.trim();
        if (s.startsWith("```")) {
            int firstNewline = s.indexOf("\n");
            if (firstNewline != -1) {
                s = s.substring(firstNewline + 1);
            }
            if (s.endsWith("```")) {
                s = s.substring(0, s.length() - 3);
            }
        }
        return s.trim();
    }

        // split chat
    public Map<String, Object> splitChat(String userPrompt, List<Map<String, Object>> items, List<String> participants, String category, String currentPayer, double targetBillTotal) throws Exception {
        if (!isConfigured()) {
            throw new IllegalStateException("GEMINI_API_KEY is not configured in .env file.");
        }

        String cat = (category != null && !category.trim().isEmpty()) ? category.trim().toLowerCase() : "restaurant";
        String payer = (currentPayer != null && !currentPayer.trim().isEmpty() && !"you".equalsIgnoreCase(currentPayer.trim())) ? currentPayer.trim() : "";

        List<Map<String, Object>> sanitizedExistingItems = new ArrayList<>();
        double existingTotal = 0.0;
        boolean onlyHasPlaceholder = true;

        if (items != null) {
            for (Map<String, Object> it : items) {
                String name = JsonUtil.getString(it, "name", "").trim();
                if (isDummyItem(name)) {
                    continue;
                }
                if (!isPlaceholderItem(name)) {
                    onlyHasPlaceholder = false;
                }
                sanitizedExistingItems.add(it);
                existingTotal += JsonUtil.getDouble(it, "price", 0.0);
            }
        }

        boolean isUtility = "utilities".equalsIgnoreCase(cat);
        boolean hasFixedTarget = (targetBillTotal > 0) || (isUtility && existingTotal > 0);
        double effectiveTotal = (targetBillTotal > 0) ? targetBillTotal : (isUtility ? existingTotal : 0.0);

        List<String> cleanInputParticipants = new ArrayList<>();
        if (participants != null) {
            for (String p : participants) {
                if (p != null && !p.trim().isEmpty() && !"you".equalsIgnoreCase(p.trim())) {
                    cleanInputParticipants.add(p.trim());
                }
            }
        }

        StringBuilder sysPrompt = new StringBuilder();
        sysPrompt.append("You are SplitWise AI's intelligent expense and split management engine.\n")
                .append("Selected expense category: ").append(cat).append(".\n")
                .append("Current line items: ").append(JsonUtil.stringify(sanitizedExistingItems)).append("\n")
                .append("Current participants: ").append(JsonUtil.stringify(cleanInputParticipants)).append("\n")
                .append("Current designated payer: ").append(payer.isEmpty() ? "(Not set yet)" : payer).append("\n");

        if (hasFixedTarget && effectiveTotal > 0) {
            sysPrompt.append("TOTAL BILL AMOUNT (STRICTLY FIXED): ₹").append(String.format(Locale.US, "%.2f", effectiveTotal)).append("\n")
                    .append("NOTE: This bill has a strictly fixed total invoice amount of ₹").append(String.format(Locale.US, "%.2f", effectiveTotal))
                    .append(". Any stay duration split, pro-ration, or equal split MUST sum up to this exact total (₹")
                    .append(String.format(Locale.US, "%.2f", effectiveTotal)).append("). Do NOT drift, round up, or alter this total amount!\n");
        }
        sysPrompt.append("User instruction: \"").append(userPrompt).append("\"\n\n")
                .append("CRITICAL RULES:\n")
                .append("1. STRICT PROHIBITION ON DUMMY / FILLER ITEMS:\n")
                .append("   - NEVER EVER create, invent, or output line items named 'Remaining Bill Amount', 'Remaining', 'Remaining Balance', 'Unallocated', 'Balance', 'Others', or 'Adjustment'.\n")
                .append("   - Every line item MUST correspond to a genuine dish, grocery product, or service charge.\n")
                .append("   - The bill total is ALWAYS the sum of the actual items. DO NOT force the total to match any prior amount by making up difference/filler items!\n\n")
                .append("2. REPLACING PLACEHOLDERS VS ACCUMULATING ITEMS:\n")
                .append("   - If current items are empty or only contain a generic placeholder (e.g. 'Bill Total', 'Cafe', 'Dining Expense', 'Shared Expense', or an un-itemized lump sum):\n")
                .append("     * If user specifies items with prices (e.g. '3 cold coffee for 300rs, 1 pizza for 250rs, 2 water for 40rs'):\n")
                .append("       Output these exact items and prices (replacing any placeholder). Do NOT invent any extra items.\n")
                .append("     * If user specifies items WITHOUT prices on an existing lump sum (e.g. 'we had cold coffee, pizza, and water'):\n")
                .append("       Divide the existing total (₹").append(String.format(Locale.US, "%.2f", effectiveTotal > 0 ? effectiveTotal : existingTotal)).append(") equally among the items, replacing the placeholder.\n")
                .append("   - If current items already have real items (e.g. 'Cold Coffee', 'Pizza', 'Water'):\n")
                .append("     * In restaurant/grocery: KEEP previously listed real items when adding extra dishes.\n")
                .append("     * CRITICAL OVERRIDE FOR FLAT & UTILITIES DURATION SPLITS: When user specifies, updates, or re-states stay durations or flatmate stay timelines (e.g. 'Harsh 15 days, Sarthak 15 days' or 'Harsh stayed 15 days with Sarthak. Sarthak stayed 15 days with Hrudayesh and Rigved'), DO NOT KEEP PREVIOUS DURATION ITEMS! COMPLETELY DISCARD previous duration items and recalculate fresh items reflecting the user's latest stay prompt!\n")
                .append("     * When user updates or deletes an item (e.g. 'remove pizza', 'change water to 3'): update or remove that item.\n\n")
                .append("3. ITEM EXTRACTION, QUANTITY & TOTAL PRICE:\n")
                .append("   - Create a separate JSON item for each distinct dish/product. Never merge multiple dishes into one line.\n")
                .append("   - 'price' in the JSON MUST be the TOTAL price for that line item (e.g. if '2 fries for 100rs each', quantity is 2 and price is 200.0).\n")
                .append("   - If user says '3 cold coffee for 300rs', quantity is 3 and total price is 300.0.\n\n")
                .append("4. PARTICIPANT DISCOVERY & STRICT PROHIBITION ON INVENTING 'Me', 'User', OR 'You':\n")
                .append("   - STRICT PROHIBITION ON INVENTING PARTICIPANTS: NEVER EVER invent, add, or output 'You', 'User', or 'Me' unless the user EXPLICITLY wrote the literal word 'me', 'I', or 'myself' in the prompt!\n")
                .append("   - If the user lists specific names (e.g. 'Harsh stayed 15 days with Sarthak. Sarthak stayed 15 days with Hrudayesh and Rigved'), the participants are ONLY the explicitly named people: ['Harsh', 'Sarthak', 'Hrudayesh', 'Rigved']. DO NOT add 'Me'!\n")
                .append("   - In utility duration splits, 'updatedParticipants' MUST contain ONLY the active flatmates with stay shares. Prune out any previous unused participants or stray 'Me'.\n")
                .append("   - In each item's 'assignedTo' array, list the exact participants sharing that item.\n")
                .append("   - If user says 'split equally', assign all current participants to every item.\n\n")
                .append("5. PAYER IDENTIFICATION:\n")
                .append("   - If user mentions who paid (e.g. 'sarthak paid the bill', 'Harsh paid', 'I paid'), set 'payer' to that person's exact name.\n")
                .append("   - If user DOES NOT mention who paid, retain the current designated payer (or leave empty if none). NEVER set payer to 'You'.\n\n")
                .append("6. FLAT & UTILITIES: DURATION-BASED SPLIT VS EQUAL SPLIT (ELECTRICITY, WI-FI / BROADBAND, SOCIETY MAINTENANCE):\n")
                .append("   - When category is 'utilities' or user is splitting electricity, wifi/broadband, or flat maintenance:\n")
                .append("   - A. DURATION-BASED STAY SPLIT:\n")
                .append("     * A utility bill covers a monthly billing cycle (usually 30 days, or 28-31 days as specified on bill). No person can stay more than the billing cycle days (max 30 days per person in a 30-day bill).\n")
                .append("     * ALWAYS RECALCULATE FRESH ITEMS: Whenever user specifies stay days or flatmate timelines, COMPLETELY REPLACE previous duration items with the newly calculated breakdown. NEVER retain old duration items!\n")
                .append("     * TIMELINE & OVERLAP RESOLUTION (e.g. 'Harsh stayed 15 days with Sarthak. Sarthak stayed 15 days with Hrudayesh and Rigved'):\n")
                .append("       - Understand the periods: Period 1 (15 days): Harsh & Sarthak. Period 2 (15 days): Sarthak, Hrudayesh & Rigved.\n")
                .append("       - Total days in month = 15 + 15 = 30 days.\n")
                .append("       - Flatmates' total stay:\n")
                .append("         * Harsh: 15 days (Period 1 only)\n")
                .append("         * Sarthak: 30 days (Full month: 15 days in Period 1 + 15 days in Period 2!)\n")
                .append("         * Hrudayesh: 15 days (Period 2 only)\n")
                .append("         * Rigved: 15 days (Period 2 only)\n")
                .append("       - Participants are ONLY [Harsh, Sarthak, Hrudayesh, Rigved]. NEVER add 'Me'!\n")
                .append("       - Accurate proportional cost calculation for the total bill (₹").append(String.format(Locale.US, "%.2f", effectiveTotal)).append("):\n")
                .append("         Period 1 cost (15/30 * Total) = 50% of total bill, split equally between Harsh & Sarthak.\n")
                .append("         Period 2 cost (15/30 * Total) = 50% of total bill, split equally among Sarthak, Hrudayesh & Rigved.\n")
                .append("         Harsh share = Period 1 / 2.\n")
                .append("         Sarthak share = (Period 1 / 2) + (Period 2 / 3). (Sarthak pays more because he stayed the whole month!).\n")
                .append("         Hrudayesh share = Period 2 / 3.\n")
                .append("         Rigved share = Period 2 / 3.\n")
                .append("         Sum of shares EXACTLY EQUALS the total bill (₹").append(String.format(Locale.US, "%.2f", effectiveTotal)).append(").\n")
                .append("       - Output items STRICTLY as: { \"name\": \"Harsh (15 days)\", \"quantity\": 1, \"price\": <share>, \"assignedTo\": [\"Harsh\"] }, { \"name\": \"Sarthak (30 days)\", \"quantity\": 1, \"price\": <share>, \"assignedTo\": [\"Sarthak\"] }, etc.\n")
                .append("     * SIMPLE INDEPENDENT STAY DAYS (e.g. 'Harsh 15 days, Sarthak 15 days, Hrudayesh 10 days, Rigved 14 days'):\n")
                .append("       - Calculate person-days: Harsh 15, Sarthak 15, Hrudayesh 10, Rigved 14. Total = 54 person-days.\n")
                .append("       - Each person's share = round((days / total_days) * total_bill, 2).\n")
                .append("       - Item name: '<Person> (<duration>)', e.g. 'Harsh (15 days)', assignedTo: ['Harsh'].\n")
                .append("     * In 'assistantMessage', explain the stay breakdown clearly.\n")
                .append("   - B. EQUAL SPLIT (NORMAL SPLIT):\n")
                .append("     * If user says 'split equally', 'split among everyone', or 'normal split':\n")
                .append("     * Consolidate into a single service item (e.g. { \"name\": \"Electricity Bill\", \"quantity\": 1, \"price\": ").append(String.format(Locale.US, "%.2f", effectiveTotal)).append(", \"assignedTo\": [\"Harsh\", \"Sarthak\", \"Hrudayesh\", \"Rigved\"] }), OR assign all participants to every existing item.\n")
                .append("   - C. SOCIETY MAINTENANCE BILLS:\n")
                .append("     * Recognize flat/society maintenance charges, building upkeep, and repairs. Handle either equal split across all flatmates or duration-based if requested.\n\n")
                .append("7. ENTERTAINMENT & MOVIE TICKETS (NORMAL CHATBOX):\n")
                .append("   - When category is 'entertainment':\n")
                .append("   - This is a normal chatbox (like restaurant and grocery) for splitting movie tickets, event passes, and concessions (popcorn, snacks, drinks).\n")
                .append("   - Retain item quantities (e.g. quantity: 4 for 4 tickets). Keep line items strictly as actual tickets and concessions.\n")
                .append("   - STRICT PROHIBITION ON TAX & FEE ITEMS:\n")
                .append("     * NEVER create or output line items for 'Booking Charge', 'Convenience Fee', 'Platform Fee', 'Internet Handling Fee', 'IGST', 'CGST', 'SGST', or 'GST'. Taxes and fees are handled separately in the bill summary, NEVER as items.\n")
                .append("   - Handle user split requests naturally: e.g. 'split tickets equally among all', 'Harsh paid', '2 tickets for Sarthak, 2 for Harsh', or adding snacks e.g. 'we also got popcorn for 350'.\n\n")
                .append("Respond STRICTLY with raw JSON matching this structure without markdown fences:\n")
                .append("{\n")
                .append("  \"assistantMessage\": \"1-2 sentence confirmation of the changes\",\n")
                .append("  \"updatedParticipants\": [\"Harsh\", \"Sarthak\", \"Hrudayesh\"],\n")
                .append("  \"updatedItems\": [\n")
                .append("    { \"name\": \"Cold Coffee\", \"quantity\": 3, \"price\": 300.0, \"assignedTo\": [\"Harsh\", \"Sarthak\", \"Hrudayesh\"] },\n")
                .append("    { \"name\": \"Pizza\", \"quantity\": 1, \"price\": 250.0, \"assignedTo\": [\"Harsh\", \"Sarthak\", \"Hrudayesh\"] },\n")
                .append("    { \"name\": \"Water\", \"quantity\": 2, \"price\": 40.0, \"assignedTo\": [\"Harsh\", \"Sarthak\", \"Hrudayesh\"] }\n")
                .append("  ],\n")
                .append("  \"payer\": \"Sarthak\"\n")
                .append("}");

        Map<String, Object> textPart = new LinkedHashMap<>();
        textPart.put("text", sysPrompt.toString());

        Map<String, Object> contentObj = new LinkedHashMap<>();
        contentObj.put("parts", Collections.singletonList(textPart));

        Map<String, Object> generationConfig = new LinkedHashMap<>();
        generationConfig.put("responseMimeType", "application/json");
        generationConfig.put("temperature", 0.2);

        Map<String, Object> requestBodyMap = new LinkedHashMap<>();
        requestBodyMap.put("contents", Collections.singletonList(contentObj));
        requestBodyMap.put("generationConfig", generationConfig);

        String jsonPayload = JsonUtil.stringify(requestBodyMap);
        String rawResponseText = executeWithWaterfall(jsonPayload);

        String cleanedText = cleanJsonMarkdown(rawResponseText);
        Map<String, Object> chatRes = JsonUtil.parseObject(cleanedText);

        boolean userMentionedMe = userPrompt.toLowerCase().matches(".*\\b(me|i|myself|mine)\\b.*");

        List<Object> rawParts = JsonUtil.getList(chatRes, "updatedParticipants");
        List<String> cleanParts = new ArrayList<>();
        for (Object p : rawParts) {
            if (p != null) {
                String pStr = p.toString().trim();
                if (!pStr.equalsIgnoreCase("you") && !pStr.isEmpty()) {
                    if (!userMentionedMe && (pStr.equalsIgnoreCase("me") || pStr.equalsIgnoreCase("myself"))) {
                        continue;
                    }
                    cleanParts.add(pStr);
                }
            }
        }
        if (!cleanParts.isEmpty()) {
            chatRes.put("updatedParticipants", cleanParts);
        }

        String returnedPayer = JsonUtil.getString(chatRes, "payer", "");
        if ("you".equalsIgnoreCase(returnedPayer) || (!userMentionedMe && "me".equalsIgnoreCase(returnedPayer))) {
            returnedPayer = cleanParts.isEmpty() ? "" : cleanParts.get(0);
        }
        chatRes.put("payer", returnedPayer);

        List<Object> rawUpdated = JsonUtil.getList(chatRes, "updatedItems");
        List<Map<String, Object>> cleanUpdated = new ArrayList<>();

        boolean hasRealItems = false;
        for (Object o : rawUpdated) {
            if (o instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> it = (Map<String, Object>) o;
                String name = JsonUtil.getString(it, "name", "").trim();
                if (!isDummyItem(name) && !isPlaceholderItem(name)) {
                    hasRealItems = true;
                    break;
                }
            }
        }

        for (Object o : rawUpdated) {
            if (o instanceof Map) {
                @SuppressWarnings("unchecked")
                Map<String, Object> it = (Map<String, Object>) o;
                String name = JsonUtil.getString(it, "name", "Item").trim();
                if (isDummyItem(name)) {
                    continue;
                }
                if (!userMentionedMe && (name.toLowerCase().startsWith("me (") || name.equalsIgnoreCase("me"))) {
                    continue;
                }
                if (hasRealItems && isPlaceholderItem(name)) {
                    continue;
                }

                Map<String, Object> ci = new LinkedHashMap<>(it);
                ci.put("name", name);
                int qty = 1;
                if (ci.containsKey("quantity")) {
                    qty = JsonUtil.getInt(ci, "quantity", 1);
                } else if (ci.containsKey("qty")) {
                    qty = JsonUtil.getInt(ci, "qty", 1);
                }
                ci.put("quantity", qty > 0 ? qty : 1);
                double price = JsonUtil.getDouble(ci, "price", 0.0);
                ci.put("price", Math.round(price * 100.0) / 100.0);

                List<Object> rawAssign = JsonUtil.getList(ci, "assignedTo");
                List<String> cleanAssign = new ArrayList<>();
                for (Object a : rawAssign) {
                    if (a != null) {
                        String aStr = a.toString().trim();
                        if (!aStr.equalsIgnoreCase("you") && !aStr.isEmpty()) {
                            if (!userMentionedMe && (aStr.equalsIgnoreCase("me") || aStr.equalsIgnoreCase("myself"))) {
                                continue;
                            }
                            cleanAssign.add(aStr);
                        }
                    }
                }
                ci.put("assignedTo", cleanAssign);

                cleanUpdated.add(ci);
            }
        }

        if (hasFixedTarget && effectiveTotal > 0 && !cleanUpdated.isEmpty()) {
            boolean isDurationSplit = false;
            for (Map<String, Object> it : cleanUpdated) {
                String n = JsonUtil.getString(it, "name", "");
                if (n.matches("(?i).*\\b\\d+\\s*(days?|wks?|weeks?)\\b.*")) {
                    isDurationSplit = true;
                    break;
                }
            }

            if (isUtility || isDurationSplit) {
                if (cleanUpdated.size() == 1) {
                    cleanUpdated.get(0).put("price", Math.round(effectiveTotal * 100.0) / 100.0);
                } else {
                    boolean allHaveDays = true;
                    List<Integer> itemDays = new ArrayList<>();
                    java.util.regex.Pattern dayPattern = java.util.regex.Pattern.compile("(?i)\\b(\\d+)\\s*(?:days?|day)\\b");
                    for (Map<String, Object> it : cleanUpdated) {
                        String n = JsonUtil.getString(it, "name", "");
                        java.util.regex.Matcher m = dayPattern.matcher(n);
                        if (m.find()) {
                            try {
                                itemDays.add(Integer.parseInt(m.group(1)));
                            } catch (Exception ex) {
                                allHaveDays = false;
                                break;
                            }
                        } else {
                            allHaveDays = false;
                            break;
                        }
                    }

                    boolean isTimelineOverlap = userPrompt.toLowerCase().matches(".*\\b(stayed with|with each other|with)\\b.*");
                    if (allHaveDays && !isTimelineOverlap && itemDays.size() == cleanUpdated.size()) {
                        int totalDays = 0;
                        for (int d : itemDays) totalDays += d;
                        if (totalDays > 0) {
                            double runningSum = 0.0;
                            int maxIdx = 0;
                            double maxShare = -1.0;
                            for (int i = 0; i < cleanUpdated.size(); i++) {
                                int days = itemDays.get(i);
                                double share = Math.round(((days / (double) totalDays) * effectiveTotal) * 100.0) / 100.0;
                                cleanUpdated.get(i).put("price", share);
                                runningSum += share;
                                if (share > maxShare) {
                                    maxShare = share;
                                    maxIdx = i;
                                }
                            }
                            double diff = Math.round((effectiveTotal - runningSum) * 100.0) / 100.0;
                            if (Math.abs(diff) >= 0.009) {
                                double adjusted = (Double) cleanUpdated.get(maxIdx).get("price") + diff;
                                cleanUpdated.get(maxIdx).put("price", Math.round(adjusted * 100.0) / 100.0);
                            }
                        }
                    } else {
                        double currentSum = 0.0;
                        for (Map<String, Object> it : cleanUpdated) {
                            currentSum += JsonUtil.getDouble(it, "price", 0.0);
                        }
                        if (currentSum > 0) {
                            double runningSum = 0.0;
                            int maxIdx = 0;
                            double maxShare = -1.0;
                            for (int i = 0; i < cleanUpdated.size(); i++) {
                                double originalPrice = JsonUtil.getDouble(cleanUpdated.get(i), "price", 0.0);
                                double scaled = Math.round(((originalPrice / currentSum) * effectiveTotal) * 100.0) / 100.0;
                                cleanUpdated.get(i).put("price", scaled);
                                runningSum += scaled;
                                if (scaled > maxShare) {
                                    maxShare = scaled;
                                    maxIdx = i;
                                }
                            }
                            double diff = Math.round((effectiveTotal - runningSum) * 100.0) / 100.0;
                            if (Math.abs(diff) >= 0.009) {
                                double adjusted = (Double) cleanUpdated.get(maxIdx).get("price") + diff;
                                cleanUpdated.get(maxIdx).put("price", Math.round(adjusted * 100.0) / 100.0);
                            }
                        }
                    }
                }
            }
        }

        if (!cleanUpdated.isEmpty()) {
            chatRes.put("updatedItems", cleanUpdated);
        }

        return chatRes;
    }

        // split chat overload
    public Map<String, Object> splitChat(String userPrompt, List<Map<String, Object>> items, List<String> participants, String category, String currentPayer) throws Exception {
        return splitChat(userPrompt, items, participants, category, currentPayer, 0.0);
    }

        // split chat overload
    public Map<String, Object> splitChat(String userPrompt, List<Map<String, Object>> items, List<String> participants, String category) throws Exception {
        return splitChat(userPrompt, items, participants, category, "", 0.0);
    }

        // split chat overload
    public Map<String, Object> splitChat(String userPrompt, List<Map<String, Object>> items, List<String> participants) throws Exception {
        return splitChat(userPrompt, items, participants, "restaurant", "", 0.0);
    }

        // is tax item
    public static boolean isTaxLineItem(String name, String category) {
        if (name == null) return false;
        String s = name.trim().toLowerCase();
        if ("utilities".equalsIgnoreCase(category) && (s.contains("duty") || s.contains("शुल्क"))) {
            return false;
        }
        return s.contains("igst") || s.contains("cgst") || s.contains("sgst") || s.contains("gst")
                || s.matches(".*\\b(tax|taxes|vat)\\b.*");
    }

        // is tip or fee item
    public static boolean isFeeOrChargeLineItem(String name, String category) {
        if (name == null) return false;
        String s = name.trim().toLowerCase();
        if ("utilities".equalsIgnoreCase(category)) {
            return false;
        }
        return s.contains("booking charge") || s.contains("booking fee")
                || s.contains("convenience fee") || s.contains("convenience charge")
                || s.contains("platform fee") || s.contains("platform charge")
                || s.contains("internet handling") || s.contains("service charge")
                || s.contains("service fee") || s.contains("packaging charge")
                || s.contains("delivery fee") || s.contains("delivery charge")
                || s.contains("handling fee");
    }

        // is dummy item
    private boolean isDummyItem(String name) {
        if (name == null) return false;
        String lower = name.trim().toLowerCase();
        return lower.contains("remaining")
                || lower.contains("unallocated")
                || lower.equals("balance")
                || lower.equals("difference")
                || lower.equals("other")
                || lower.equals("others")
                || lower.equals("adjustment")
                || isTaxLineItem(lower, "")
                || isFeeOrChargeLineItem(lower, "");
    }

        // is generic name
    private boolean isPlaceholderItem(String name) {
        if (name == null) return false;
        String lower = name.trim().toLowerCase();
        return lower.equals("bill total")
                || lower.equals("shared expense")
                || lower.equals("dining expense")
                || lower.equals("flat utilities bill")
                || lower.equals("groceries & mart")
                || lower.equals("entertainment outing")
                || lower.equals("cafe")
                || lower.equals("maintenance bill")
                || lower.equals("society maintenance");
    }

        // call gemini api
    private String executeWithWaterfall(String jsonPayload) throws Exception {
        Exception lastException = null;

        for (String model : MODELS) {
            try {
                String endpoint = "https://generativelanguage.googleapis.com/v1beta/models/"
                        + model + ":generateContent?key=" + apiKey;

                HttpRequest request = HttpRequest.newBuilder()
                        .uri(URI.create(endpoint))
                        .header("Content-Type", "application/json")
                        .timeout(Duration.ofSeconds(25))
                        .POST(HttpRequest.BodyPublishers.ofString(jsonPayload))
                        .build();

                HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

                if (response.statusCode() == 200) {
                    Map<String, Object> resMap = JsonUtil.parseObject(response.body());
                    List<Object> candidates = JsonUtil.getList(resMap, "candidates");
                    if (!candidates.isEmpty() && candidates.get(0) instanceof Map) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> firstCandidate = (Map<String, Object>) candidates.get(0);
                        Map<String, Object> content = JsonUtil.getMap(firstCandidate, "content");
                        List<Object> parts = JsonUtil.getList(content, "parts");
                        if (!parts.isEmpty() && parts.get(0) instanceof Map) {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> firstPart = (Map<String, Object>) parts.get(0);
                            String text = JsonUtil.getString(firstPart, "text", "");
                            if (!text.isEmpty()) {
                                return text;
                            }
                        }
                    }
                } else if (response.statusCode() == 429 || response.statusCode() == 404 || response.statusCode() >= 500) {
                    System.err.println("[GeminiClient] Model " + model + " returned " + response.statusCode() + ", falling back to next model...");
                    lastException = new RuntimeException("Model " + model + " error HTTP " + response.statusCode() + ": " + response.body());
                    continue;
                } else {
                    throw new RuntimeException("Gemini API error HTTP " + response.statusCode() + ": " + response.body());
                }
            } catch (Exception e) {
                lastException = e;
                System.err.println("[GeminiClient] Exception with model " + model + ": " + e.getMessage());
            }
        }

        throw new RuntimeException("All Gemini models failed. Last error: " + (lastException != null ? lastException.getMessage() : "Unknown"));
    }
}
