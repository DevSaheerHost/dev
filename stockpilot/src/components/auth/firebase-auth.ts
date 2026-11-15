"use client";
import { FirebaseError } from "firebase/app";
import { signOut } from "firebase/auth";
import type { User } from "firebase/auth";
import { clientAuth } from "@/lib/firebase/client";

/** Exchange the freshly signed-in user's ID token for an httpOnly session cookie. */
export async function startServerSession(user: User): Promise<void> {
  const idToken = await user.getIdToken(true);
  const res = await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
  // Nothing needs the client-side Firebase session after this.
  await signOut(clientAuth()).catch(() => {});
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? "Couldn't start your session.");
  }
}

/** Friendly, non-enumerating messages for Firebase Auth errors. */
export function authMessage(e: unknown): string {
  const code = e instanceof FirebaseError ? e.code : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Email or password is incorrect.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a few minutes and try again.";
    case "auth/weak-password":
      return "Choose a stronger password (at least 10 characters).";
    case "auth/email-already-in-use":
      return "We couldn't create the account. If you already have one, sign in instead.";
    case "auth/network-request-failed":
      return "You appear to be offline. Check your connection.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    default:
      return e instanceof Error && !code ? e.message : "Something went wrong. Please try again.";
  }
}
