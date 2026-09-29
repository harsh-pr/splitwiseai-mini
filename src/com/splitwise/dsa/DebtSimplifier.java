// Simplifies debts between people using greedy cash flow matching.
package com.splitwise.dsa;

import java.util.*;

public class DebtSimplifier {

    public static class Transaction {
        public String from;
        public String to;
        public double amount;

        // Creates an empty transaction
        public Transaction() {}

        // Creates a transaction from one person to another with a rounded amount
        public Transaction(String from, String to, double amount) {
            this.from = from;
            this.to = to;
            this.amount = Math.round(amount * 100.0) / 100.0;
        }

        // Converts transaction data into a map
        public Map<String, Object> toMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("from", from);
            map.put("to", to);
            map.put("amount", amount);
            return map;
        }

        // Returns a human readable string describing the payment
        @Override
        public String toString() {
            return String.format("%s pays %s: ₹%.2f", from, to, amount);
        }
    }

    public static class ParticipantBalance {
        public String name;
        public double netAmount;

        // Stores a person's name and their net balance
        public ParticipantBalance(String name, double netAmount) {
            this.name = name;
            this.netAmount = netAmount;
        }
    }

    // Minimizes total transactions needed to settle all debts
    public static List<Transaction> simplifyDebts(List<Transaction> initialDebts) {
        Map<String, Double> balances = new HashMap<>();
        for (Transaction t : initialDebts) {
            if (t.from.equalsIgnoreCase(t.to) || t.amount <= 0.001) continue;
            balances.put(t.from, balances.getOrDefault(t.from, 0.0) - t.amount);
            balances.put(t.to, balances.getOrDefault(t.to, 0.0) + t.amount);
        }

        PriorityQueue<ParticipantBalance> debtors = new PriorityQueue<>(
            (a, b) -> Double.compare(a.netAmount, b.netAmount)
        );

        PriorityQueue<ParticipantBalance> creditors = new PriorityQueue<>(
            (a, b) -> Double.compare(b.netAmount, a.netAmount)
        );

        for (Map.Entry<String, Double> entry : balances.entrySet()) {
            double bal = Math.round(entry.getValue() * 100.0) / 100.0;
            if (bal < -0.01) {
                debtors.offer(new ParticipantBalance(entry.getKey(), bal));
            } else if (bal > 0.01) {
                creditors.offer(new ParticipantBalance(entry.getKey(), bal));
            }
        }

        List<Transaction> simplified = new ArrayList<>();

        while (!debtors.isEmpty() && !creditors.isEmpty()) {
            ParticipantBalance debtor = debtors.poll();
            ParticipantBalance creditor = creditors.poll();

            double settleAmount = Math.min(-debtor.netAmount, creditor.netAmount);
            settleAmount = Math.round(settleAmount * 100.0) / 100.0;

            if (settleAmount > 0.001) {
                simplified.add(new Transaction(debtor.name, creditor.name, settleAmount));
            }

            debtor.netAmount += settleAmount;
            creditor.netAmount -= settleAmount;

            if (debtor.netAmount < -0.01) {
                debtors.offer(debtor);
            }
            if (creditor.netAmount > 0.01) {
                creditors.offer(creditor);
            }
        }

        return simplified;
    }

    // Calculates how much each person owes the payer from bill items
    public static List<Transaction> calculateDebtsFromBill(
            String payer,
            List<String> participants,
            List<Map<String, Object>> items,
            double tax,
            double tip,
            double totalAmount) {

        List<Transaction> debts = new ArrayList<>();
        if (payer == null || payer.trim().isEmpty() || participants.isEmpty()) {
            return debts;
        }

        Map<String, Double> personSubtotals = new LinkedHashMap<>();
        for (String p : participants) {
            personSubtotals.put(p, 0.0);
        }

        if (items != null && !items.isEmpty()) {
            for (Map<String, Object> item : items) {
                double price = 0.0;
                Object pObj = item.get("price");
                if (pObj instanceof Number) price = ((Number) pObj).doubleValue();

                @SuppressWarnings("unchecked")
                List<Object> assigned = (List<Object>) item.get("assignedTo");
                if (assigned == null || assigned.isEmpty()) {
                    assigned = new ArrayList<>(participants);
                }

                List<String> assignedNames = new ArrayList<>();
                for (Object a : assigned) {
                    if (a != null && !a.toString().trim().isEmpty()) {
                        assignedNames.add(a.toString().trim());
                    }
                }
                if (assignedNames.isEmpty()) {
                    assignedNames.addAll(participants);
                }

                double perPerson = price / assignedNames.size();
                for (String person : assignedNames) {
                    personSubtotals.put(person, personSubtotals.getOrDefault(person, 0.0) + perPerson);
                }
            }
        } else {
            double perPerson = totalAmount / participants.size();
            for (String p : participants) {
                personSubtotals.put(p, perPerson);
            }
        }

        double sumSubtotals = 0.0;
        for (double sub : personSubtotals.values()) sumSubtotals += sub;
        double extraFee = tax + tip;

        for (Map.Entry<String, Double> entry : personSubtotals.entrySet()) {
            String person = entry.getKey();
            if (person.equalsIgnoreCase(payer)) continue;

            double share = entry.getValue();
            if (sumSubtotals > 0.001 && extraFee > 0) {
                share += (entry.getValue() / sumSubtotals) * extraFee;
            } else if (extraFee > 0 && !participants.isEmpty()) {
                share += extraFee / participants.size();
            }

            share = Math.round(share * 100.0) / 100.0;
            if (share > 0.01) {
                debts.add(new Transaction(person, payer, share));
            }
        }

        return debts;
    }

    // Runs a sample demonstration of debt simplification
    public static void main(String[] args) {
        System.out.println("==================================================");
        System.out.println(" SplitWise AI - Java Debt Simplification Engine ");
        System.out.println(" Algorithm: Greedy Cash-Flow with PriorityQueue");
        System.out.println("==================================================");

        List<Transaction> initialDebts = Arrays.asList(
            new Transaction("Sarthak", "Harsh", 600),
            new Transaction("Hrudayesh", "Sarthak", 400),
            new Transaction("Rigved", "Harsh", 700),
            new Transaction("Hrudayesh", "Rigved", 300),
            new Transaction("Sarthak", "Rigved", 500)
        );

        System.out.println("\n--- Raw Transactions (" + initialDebts.size() + " transfers) ---");
        for (Transaction t : initialDebts) {
            System.out.println("  " + t);
        }

        List<Transaction> simplified = simplifyDebts(initialDebts);

        System.out.println("\n--- Optimized Transactions (" + simplified.size() + " transfers) ---");
        for (Transaction t : simplified) {
            System.out.println("  ✓ " + t);
        }
        System.out.println("\nDebt simplification completed successfully.");
    }
}
