/**
 * Security rules: browsers must never reach Firestore directly, signed in or
 * not. Runs the real client SDK against the emulators with the rules loaded.
 */
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, setDoc } from "firebase/firestore";
import { describe, expect, it } from "vitest";

const app = initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "demo-stockpilot", apiKey: "demo-key" }, "rules-test");
const firestore = getFirestore(app);
connectFirestoreEmulator(firestore, ...(process.env.FIRESTORE_EMULATOR_HOST!.split(":") as [string, string]).map((v, i) => (i ? Number(v) : v)) as [string, number]);
const auth = getAuth(app);
connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true });

const denied = expect.objectContaining({ code: "permission-denied" });

describe("Firestore security rules", () => {
  it("deny anonymous reads and writes", async () => {
    await expect(getDoc(doc(firestore, "businesses/anybusiness1"))).rejects.toEqual(denied);
    await expect(setDoc(doc(firestore, "businesses/anybusiness1"), { name: "x" })).rejects.toEqual(denied);
  });

  it("deny signed-in users direct access to any business data", async () => {
    await createUserWithEmailAndPassword(auth, `rules-${Date.now()}@example.com`, "correct-horse-battery");
    await expect(getDocs(collection(firestore, "businesses/anybusiness1/products"))).rejects.toEqual(denied);
    await expect(setDoc(doc(firestore, "businesses/anybusiness1/movements/forged"), { quantityChange: 1000 })).rejects.toEqual(denied);
    await expect(getDoc(doc(firestore, `users/${auth.currentUser!.uid}`))).rejects.toEqual(denied);
    await expect(setDoc(doc(firestore, "invitations/abc"), { role: "owner" })).rejects.toEqual(denied);
  });
});
