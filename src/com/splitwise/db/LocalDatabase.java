// Manages local JSON storage for user accounts, bills, and settlements.
package com.splitwise.db;

import com.splitwise.util.JsonUtil;
import com.splitwise.util.PasswordUtil;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.*;
import java.util.concurrent.locks.ReentrantReadWriteLock;

public class LocalDatabase {

    private final Path dataDir;
    private final Path usersPath;
    private final Path billsDir;
    private final Path legacyDbPath;

    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();

    private final Map<String, Map<String, Object>> users = new LinkedHashMap<>();
    private final Map<String, String> userEmailIndex = new HashMap<>();
    private final Map<String, String> sessions = new HashMap<>();
    private final Map<String, Map<String, Map<String, Object>>> userBills = new LinkedHashMap<>();
    private final Map<String, List<Map<String, Object>>> userSettlements = new LinkedHashMap<>();

    // Initializes database in the given directory using default filename
    public LocalDatabase(String dataDirName) {
        this(dataDirName, "db.json");
    }

    // Initializes database paths, directories, and loads cached data
    public LocalDatabase(String dataDirName, String legacyFileName) {
        this.dataDir = Paths.get(dataDirName).toAbsolutePath().normalize();
        this.usersPath = this.dataDir.resolve("users.json");
        this.billsDir = this.dataDir.resolve("bills");
        this.legacyDbPath = this.dataDir.resolve(legacyFileName);

        initDirectories();
        load();
    }

    // Creates storage directories if they do not exist
    private void initDirectories() {
        try {
            if (!Files.exists(dataDir)) {
                Files.createDirectories(dataDir);
            }
            if (!Files.exists(billsDir)) {
                Files.createDirectories(billsDir);
            }
        } catch (IOException e) {
            System.err.println("[LocalDatabase] Could not create database directories: " + e.getMessage());
        }
    }

    // Reads users and bill files into memory caches
    public void load() {
        lock.writeLock().lock();
        try {
            users.clear();
            userEmailIndex.clear();
            sessions.clear();
            userBills.clear();
            userSettlements.clear();

            if (!Files.exists(usersPath) && Files.exists(legacyDbPath)) {
                System.out.println("[LocalDatabase] Migrating legacy db.json to separated users.json and user-wise bills...");
                migrateLegacyDb();
                return;
            }

            if (Files.exists(usersPath)) {
                try {
                    String content = Files.readString(usersPath, StandardCharsets.UTF_8);
                    Map<String, Object> root = JsonUtil.parseObject(content);
                    List<Object> userList = JsonUtil.getList(root, "users");
                    for (Object o : userList) {
                        if (o instanceof Map) {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> u = (Map<String, Object>) o;
                            String id = JsonUtil.getString(u, "id", UUID.randomUUID().toString());
                            String email = JsonUtil.getString(u, "email", "").toLowerCase().trim();
                            users.put(id, u);
                            if (!email.isEmpty()) {
                                userEmailIndex.put(email, id);
                            }
                        }
                    }
                    System.out.println(String.format("[LocalDatabase] Loaded %d user accounts from %s", users.size(), usersPath));
                } catch (Exception e) {
                    System.err.println("[LocalDatabase] Error reading users.json: " + e.getMessage());
                }
            } else {
                saveUsersInternal();
            }

            int totalBillsLoaded = 0;
            if (Files.exists(billsDir)) {
                try (DirectoryStream<Path> stream = Files.newDirectoryStream(billsDir, "*.json")) {
                    for (Path file : stream) {
                        try {
                            String fileName = file.getFileName().toString();
                            String fileUserId = fileName.substring(0, fileName.lastIndexOf(".json"));
                            String content = Files.readString(file, StandardCharsets.UTF_8);
                            Map<String, Object> root = JsonUtil.parseObject(content);

                            String userId = JsonUtil.getString(root, "userId", fileUserId);
                            Map<String, Map<String, Object>> billsMap = userBills.computeIfAbsent(userId, k -> new LinkedHashMap<>());

                            List<Object> billsList = JsonUtil.getList(root, "bills");
                            for (Object o : billsList) {
                                if (o instanceof Map) {
                                    @SuppressWarnings("unchecked")
                                    Map<String, Object> b = (Map<String, Object>) o;
                                    String id = JsonUtil.getString(b, "id", UUID.randomUUID().toString());
                                    billsMap.put(id, b);
                                    totalBillsLoaded++;
                                }
                            }

                            List<Object> settleList = JsonUtil.getList(root, "settlements");
                            List<Map<String, Object>> settles = userSettlements.computeIfAbsent(userId, k -> new ArrayList<>());
                            for (Object o : settleList) {
                                if (o instanceof Map) {
                                    @SuppressWarnings("unchecked")
                                    Map<String, Object> s = (Map<String, Object>) o;
                                    settles.add(s);
                                }
                            }
                        } catch (Exception e) {
                            System.err.println("[LocalDatabase] Error reading bill file " + file + ": " + e.getMessage());
                        }
                    }
                } catch (IOException e) {
                    System.err.println("[LocalDatabase] Error reading bills directory: " + e.getMessage());
                }
            }

            System.out.println(String.format("[LocalDatabase] Loaded %d total bills across %d user partitions in %s",
                    totalBillsLoaded, userBills.size(), billsDir));

        } finally {
            lock.writeLock().unlock();
        }
    }

    // Migrates older single-file database to user-partitioned files
    private void migrateLegacyDb() {
        try {
            String content = Files.readString(legacyDbPath, StandardCharsets.UTF_8);
            Map<String, Object> root = JsonUtil.parseObject(content);

            List<Object> userList = JsonUtil.getList(root, "users");
            for (Object o : userList) {
                if (o instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> u = (Map<String, Object>) o;
                    String id = JsonUtil.getString(u, "id", UUID.randomUUID().toString());
                    String email = JsonUtil.getString(u, "email", "").toLowerCase().trim();
                    users.put(id, u);
                    if (!email.isEmpty()) {
                        userEmailIndex.put(email, id);
                    }
                }
            }
            saveUsersInternal();

            List<Object> billList = JsonUtil.getList(root, "bills");
            for (Object o : billList) {
                if (o instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> b = (Map<String, Object>) o;
                    String id = JsonUtil.getString(b, "id", UUID.randomUUID().toString());
                    String userId = JsonUtil.getString(b, "userId", "guest");
                    if (userId.isEmpty()) userId = "guest";

                    userBills.computeIfAbsent(userId, k -> new LinkedHashMap<>()).put(id, b);
                }
            }

            List<Object> settleList = JsonUtil.getList(root, "settlements");
            for (Object o : settleList) {
                if (o instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> s = (Map<String, Object>) o;
                    String userId = JsonUtil.getString(s, "userId", "guest");
                    if (userId.isEmpty()) userId = "guest";
                    userSettlements.computeIfAbsent(userId, k -> new ArrayList<>()).add(s);
                }
            }

            for (String uId : userBills.keySet()) {
                saveUserBillsInternal(uId);
            }
            for (String uId : userSettlements.keySet()) {
                if (!userBills.containsKey(uId)) {
                    saveUserBillsInternal(uId);
                }
            }

            System.out.println(String.format("[LocalDatabase] Migration complete! Created %s and %d user bill files in %s",
                    usersPath.getFileName(), userBills.size(), billsDir));

        } catch (Exception e) {
            System.err.println("[LocalDatabase] Error during migration: " + e.getMessage());
        }
    }

    // Saves users map to users.json file atomically
    private void saveUsersInternal() {
        try {
            Map<String, Object> root = new LinkedHashMap<>();
            root.put("users", new ArrayList<>(users.values()));
            root.put("lastSaved", System.currentTimeMillis());

            String json = JsonUtil.stringifyPretty(root);
            Path tempPath = dataDir.resolve("users.json.tmp");
            Files.writeString(tempPath, json, StandardCharsets.UTF_8);
            Files.move(tempPath, usersPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            System.err.println("[LocalDatabase] Error saving users.json: " + e.getMessage());
        }
    }

    // Saves a user's bills and settlements to their personal JSON file
    private void saveUserBillsInternal(String userId) {
        try {
            if (!Files.exists(billsDir)) {
                Files.createDirectories(billsDir);
            }

            String safeUserId = (userId == null || userId.trim().isEmpty()) ? "guest" : userId.trim();
            Path filePath = billsDir.resolve(safeUserId + ".json");
            Path tempPath = billsDir.resolve(safeUserId + ".json.tmp");

            Map<String, Map<String, Object>> billsMap = userBills.getOrDefault(safeUserId, Collections.emptyMap());
            List<Map<String, Object>> settlesList = userSettlements.getOrDefault(safeUserId, Collections.emptyList());

            Map<String, Object> root = new LinkedHashMap<>();
            root.put("userId", safeUserId);
            root.put("bills", new ArrayList<>(billsMap.values()));
            root.put("settlements", new ArrayList<>(settlesList));
            root.put("lastSaved", System.currentTimeMillis());

            String json = JsonUtil.stringifyPretty(root);
            Files.writeString(tempPath, json, StandardCharsets.UTF_8);
            Files.move(tempPath, filePath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            System.err.println("[LocalDatabase] Error saving user bills file for " + userId + ": " + e.getMessage());
        }
    }

    // Creates a new user account with hashed password and salt
    public Map<String, Object> registerUser(String name, String email, String password) {
        lock.writeLock().lock();
        try {
            String normEmail = email.toLowerCase().trim();
            if (userEmailIndex.containsKey(normEmail)) {
                return null;
            }

            String userId = UUID.randomUUID().toString();
            String salt = PasswordUtil.generateSalt();
            String hash = PasswordUtil.hashPassword(password, salt);

            Map<String, Object> user = new LinkedHashMap<>();
            user.put("id", userId);
            user.put("name", name.trim());
            user.put("email", normEmail);
            user.put("passwordHash", hash);
            user.put("salt", salt);
            user.put("createdAt", System.currentTimeMillis());

            users.put(userId, user);
            userEmailIndex.put(normEmail, userId);
            saveUsersInternal();
            saveUserBillsInternal(userId);

            return sanitizeUser(user);
        } finally {
            lock.writeLock().unlock();
        }
    }

    // Verifies user credentials and returns user details if correct
    public Map<String, Object> authenticate(String email, String password) {
        lock.readLock().lock();
        try {
            String normEmail = email.toLowerCase().trim();
            String userId = userEmailIndex.get(normEmail);
            if (userId == null) return null;

            Map<String, Object> user = users.get(userId);
            if (user == null) return null;

            String salt = JsonUtil.getString(user, "salt", "");
            String expectedHash = JsonUtil.getString(user, "passwordHash", "");

            if (PasswordUtil.verifyPassword(password, salt, expectedHash)) {
                return sanitizeUser(user);
            }
            return null;
        } finally {
            lock.readLock().unlock();
        }
    }

    // Generates a session token for an authenticated user
    public String createSession(String userId) {
        lock.writeLock().lock();
        try {
            String token = UUID.randomUUID().toString();
            sessions.put(token, userId);
            return token;
        } finally {
            lock.writeLock().unlock();
        }
    }

    // Finds user associated with an active session token
    public Map<String, Object> getUserByToken(String token) {
        if (token == null || token.trim().isEmpty()) return null;
        lock.readLock().lock();
        try {
            String userId = sessions.get(token.trim());
            if (userId == null) return null;
            Map<String, Object> user = users.get(userId);
            return user != null ? sanitizeUser(user) : null;
        } finally {
            lock.readLock().unlock();
        }
    }

    // Logs out user by deleting their session token
    public void removeSession(String token) {
        if (token == null) return;
        lock.writeLock().lock();
        try {
            sessions.remove(token.trim());
        } finally {
            lock.writeLock().unlock();
        }
    }

    // Removes sensitive password hash and salt from user object
    private Map<String, Object> sanitizeUser(Map<String, Object> user) {
        Map<String, Object> clean = new LinkedHashMap<>(user);
        clean.remove("passwordHash");
        clean.remove("salt");
        return clean;
    }

    // Saves a new bill to database and writes to disk
    public Map<String, Object> addBill(Map<String, Object> bill) {
        lock.writeLock().lock();
        try {
            String id = JsonUtil.getString(bill, "id", UUID.randomUUID().toString());
            bill.put("id", id);
            if (!bill.containsKey("createdAt")) {
                bill.put("createdAt", System.currentTimeMillis());
            }

            String userId = JsonUtil.getString(bill, "userId", "guest");
            if (userId.isEmpty()) userId = "guest";

            Map<String, Map<String, Object>> billsMap = userBills.computeIfAbsent(userId, k -> new LinkedHashMap<>());
            billsMap.put(id, bill);

            saveUserBillsInternal(userId);
            return bill;
        } finally {
            lock.writeLock().unlock();
        }
    }

    // Retrieves all bills belonging to a user sorted by date
    public List<Map<String, Object>> getBills(String userId) {
        lock.readLock().lock();
        try {
            List<Map<String, Object>> result = new ArrayList<>();
            String targetUser = (userId != null && !userId.trim().isEmpty()) ? userId.trim() : "guest";

            Map<String, Map<String, Object>> billsMap = userBills.get(targetUser);
            if (billsMap != null) {
                result.addAll(billsMap.values());
            }

            result.sort((a, b) -> Long.compare(
                    ((Number) b.getOrDefault("createdAt", 0L)).longValue(),
                    ((Number) a.getOrDefault("createdAt", 0L)).longValue()
            ));
            return result;
        } finally {
            lock.readLock().unlock();
        }
    }

    // Deletes a bill from database and updates disk file
    public boolean deleteBill(String billId, String userId) {
        lock.writeLock().lock();
        try {
            String targetUser = (userId != null && !userId.trim().isEmpty()) ? userId.trim() : "guest";

            Map<String, Map<String, Object>> billsMap = userBills.get(targetUser);
            if (billsMap != null && billsMap.containsKey(billId)) {
                billsMap.remove(billId);
                saveUserBillsInternal(targetUser);
                return true;
            }

            for (Map.Entry<String, Map<String, Map<String, Object>>> entry : userBills.entrySet()) {
                if (entry.getValue().containsKey(billId)) {
                    entry.getValue().remove(billId);
                    saveUserBillsInternal(entry.getKey());
                    return true;
                }
            }

            return false;
        } finally {
            lock.writeLock().unlock();
        }
    }

    // Updates settlement status of a debt within a bill
    public boolean updateBillDebtStatus(String billId, String personFrom, boolean settled, String userId) {
        lock.writeLock().lock();
        try {
            String targetUser = (userId != null && !userId.trim().isEmpty()) ? userId.trim() : "guest";

            Map<String, Map<String, Object>> billsMap = userBills.get(targetUser);
            Map<String, Object> bill = (billsMap != null) ? billsMap.get(billId) : null;
            if (bill == null) {
                for (Map.Entry<String, Map<String, Map<String, Object>>> entry : userBills.entrySet()) {
                    if (entry.getValue().containsKey(billId)) {
                        bill = entry.getValue().get(billId);
                        targetUser = entry.getKey();
                        break;
                    }
                }
            }

            if (bill == null) return false;

            List<Object> debts = JsonUtil.getList(bill, "debts");
            boolean updated = false;
            for (Object dObj : debts) {
                if (dObj instanceof Map) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> d = (Map<String, Object>) dObj;
                    String from = JsonUtil.getString(d, "from", "").trim();
                    if (personFrom == null || personFrom.trim().isEmpty() || "all".equalsIgnoreCase(personFrom.trim())
                            || from.equalsIgnoreCase(personFrom.trim())) {
                        d.put("settled", settled);
                        updated = true;
                    }
                }
            }

            if (updated) {
                saveUserBillsInternal(targetUser);
            }
            return updated;
        } finally {
            lock.writeLock().unlock();
        }
    }

    // Updates the receiving UPI ID for a bill
    public boolean updateBillUpi(String billId, String newUpiId, String userId) {
        lock.writeLock().lock();
        try {
            String targetUser = (userId != null && !userId.trim().isEmpty()) ? userId.trim() : "guest";

            Map<String, Map<String, Object>> billsMap = userBills.get(targetUser);
            Map<String, Object> bill = (billsMap != null) ? billsMap.get(billId) : null;
            if (bill == null) {
                for (Map.Entry<String, Map<String, Map<String, Object>>> entry : userBills.entrySet()) {
                    if (entry.getValue().containsKey(billId)) {
                        bill = entry.getValue().get(billId);
                        targetUser = entry.getKey();
                        break;
                    }
                }
            }

            if (bill == null) return false;

            bill.put("upiId", newUpiId != null ? newUpiId.trim() : "");
            saveUserBillsInternal(targetUser);
            return true;
        } finally {
            lock.writeLock().unlock();
        }
    }

    // Records a completed debt settlement payment
    public void addSettlement(Map<String, Object> settlement) {
        lock.writeLock().lock();
        try {
            settlement.put("id", UUID.randomUUID().toString());
            settlement.put("settledAt", System.currentTimeMillis());

            String userId = JsonUtil.getString(settlement, "userId", "guest");
            if (userId.isEmpty()) userId = "guest";

            userSettlements.computeIfAbsent(userId, k -> new ArrayList<>()).add(settlement);
            saveUserBillsInternal(userId);
        } finally {
            lock.writeLock().unlock();
        }
    }

    // Returns all settlement records for a user
    public List<Map<String, Object>> getSettlements(String userId) {
        lock.readLock().lock();
        try {
            String targetUser = (userId != null && !userId.trim().isEmpty()) ? userId.trim() : "guest";
            List<Map<String, Object>> list = userSettlements.get(targetUser);
            return list != null ? new ArrayList<>(list) : new ArrayList<>();
        } finally {
            lock.readLock().unlock();
        }
    }
}
